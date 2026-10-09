from unittest.mock import AsyncMock, MagicMock, patch
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END
from app import graph
from app.graph import MAX_TOOL_TURNS, build_graph, route_after_agent, route_after_tools


def _call(id_="t1", name="search_products"):
    return {"name": name, "args": {"condition": "피로"}, "id": id_, "type": "tool_call"}


def _state(messages, tool_turns=0):
    return {"messages": messages, "recommended_ids": [], "tool_turns": tool_turns, "triage": "normal", "plan": []}


def test_route_after_agent_always_runs_tools_even_at_limit():
    st = _state([AIMessage(content="", tool_calls=[_call()])], tool_turns=MAX_TOOL_TURNS)
    assert route_after_agent(st) == "tools"


def test_route_after_agent_ends_without_tool_calls():
    assert route_after_agent(_state([AIMessage(content="답변")])) == END


def test_route_after_tools_goes_to_finalize_at_limit():
    assert route_after_tools(_state([], tool_turns=MAX_TOOL_TURNS)) == "finalize"


def test_route_after_tools_returns_to_agent_below_limit():
    assert route_after_tools(_state([], tool_turns=MAX_TOOL_TURNS - 1)) == "agent"


async def _run_finalize(state):
    bare = AsyncMock()
    bare.ainvoke = AsyncMock(return_value=AIMessage(content="정리했어요."))
    with patch("app.graph.get_config", new=AsyncMock(return_value={})), \
         patch("app.graph.build_system_prompt", return_value="SYS"), \
         patch("app.graph._chat_model", return_value=bare):
        out = await graph.finalize_node(state)
    return bare, out


async def test_finalize_passes_agent_tools_with_tool_choice_none():
    from langchain_anthropic.chat_models import convert_to_anthropic_tool
    st = _state([HumanMessage(content="q"), AIMessage(content="", tool_calls=[_call()]),
                 ToolMessage(content="[]", tool_call_id="t1", name="search_products")])
    bare, out = await _run_finalize(st)
    kwargs = bare.ainvoke.await_args.kwargs
    assert kwargs["tool_choice"] == {"type": "none"}
    assert kwargs["tools"] == [convert_to_anthropic_tool(t) for t in graph.AGENT_TOOLS]
    assert out["messages"][0].content == "정리했어요."


async def test_finalize_system_ends_with_wrapup_instruction():
    # 도구를 더 못 쓰는 턴이므로 추가 확인을 약속하지 말고 마무리하라는 지시가 system 끝에 붙는다
    st = _state([HumanMessage(content="q")])
    st["plan"] = [{"title": "제품 검색", "tool": "search_products"}]
    bare, _ = await _run_finalize(st)
    system = bare.ainvoke.await_args.args[0][0].content
    assert isinstance(system, str)
    assert system.startswith("SYS\n\n## 상담 계획")
    assert system.endswith(graph.FINALIZE_INSTRUCTION)


async def test_agent_system_has_no_wrapup_instruction():
    m = AsyncMock()
    m.ainvoke = AsyncMock(return_value=AIMessage(content="네."))
    m.bind_tools = MagicMock(return_value=m)
    with patch("app.graph.get_config", new=AsyncMock(return_value={})), \
         patch("app.graph.build_system_prompt", return_value="SYS"), \
         patch("app.graph._chat_model", return_value=m):
        await graph.agent_node(_state([HumanMessage(content="q")]))
    assert graph.FINALIZE_INSTRUCTION not in m.ainvoke.await_args.args[0][0].content


def test_finalize_tools_match_bind_tools_payload():
    # agent 경로(bind_tools)가 요청에 싣는 tools와 finalize가 넘기는 tools가 같아야 캐시 프리픽스가 맞는다
    import json
    from langchain_anthropic import ChatAnthropic
    bound = ChatAnthropic(model="claude-opus-4-8", api_key="test").bind_tools(graph.AGENT_TOOLS)
    assert json.dumps(bound.kwargs["tools"], ensure_ascii=False) == \
        json.dumps(graph._finalize_tools(), ensure_ascii=False)
    assert "tool_choice" not in bound.kwargs


async def test_agent_node_binds_agent_tools():
    m = AsyncMock()
    m.ainvoke = AsyncMock(return_value=AIMessage(content="네."))
    m.bind_tools = MagicMock(return_value=m)
    with patch("app.graph.get_config", new=AsyncMock(return_value={})), \
         patch("app.graph.build_system_prompt", return_value="SYS"), \
         patch("app.graph._chat_model", return_value=m):
        await graph.agent_node(_state([HumanMessage(content="q")]))
    assert m.bind_tools.call_args.args[0] == graph.AGENT_TOOLS


def _tool_use_block(id_="t1"):
    return {"type": "tool_use", "id": id_, "name": "search_products", "input": {"condition": "피로"}}


def test_llm_view_strips_unpaired_tool_use_from_calls_and_content():
    ai = AIMessage(content=[{"type": "text", "text": "찾아볼게요"}, _tool_use_block("t1")], tool_calls=[_call("t1")])
    msgs = [HumanMessage(content="q1"), ai, HumanMessage(content="q2")]
    view = graph._llm_view(msgs)
    assert len(view) == 3
    assert view[1].tool_calls == []
    assert view[1].content == [{"type": "text", "text": "찾아볼게요"}]
    # 체크포인트 원본은 그대로
    assert ai.tool_calls and len(ai.content) == 2


def test_llm_view_keeps_paired_tool_use():
    ai = AIMessage(content=[_tool_use_block("t1")], tool_calls=[_call("t1")])
    tm = ToolMessage(content="[]", tool_call_id="t1", name="search_products")
    msgs = [HumanMessage(content="q"), ai, tm, AIMessage(content="답")]
    assert graph._llm_view(msgs) == msgs


def test_llm_view_strips_only_unpaired_calls_of_partial_pair():
    ai = AIMessage(content=[_tool_use_block("t1"), _tool_use_block("t2")], tool_calls=[_call("t1"), _call("t2")])
    tm = ToolMessage(content="[]", tool_call_id="t1", name="search_products")
    view = graph._llm_view([HumanMessage(content="q"), ai, tm])
    assert [c["id"] for c in view[1].tool_calls] == ["t1"]
    assert [b["id"] for b in view[1].content] == ["t1"]


def test_llm_view_drops_message_left_empty():
    # 내용 없이 tool_use만 있던 메시지는 빈 assistant 메시지가 되므로 통째로 뺀다
    ai = AIMessage(content="", tool_calls=[_call("t1")])
    view = graph._llm_view([HumanMessage(content="q1"), ai, HumanMessage(content="q2")])
    assert [m.type for m in view] == ["human", "human"]


async def test_agent_node_recovers_polluted_thread():
    # 이전 버전 finalize 실패로 짝 없는 tool_use가 남은 체크포인트에서도 요청에는 실리지 않는다
    polluted = AIMessage(content=[_tool_use_block("t1")], tool_calls=[_call("t1")])
    m = AsyncMock()
    m.ainvoke = AsyncMock(return_value=AIMessage(content="네."))
    m.bind_tools = MagicMock(return_value=m)
    with patch("app.graph.get_config", new=AsyncMock(return_value={})), \
         patch("app.graph.build_system_prompt", return_value="SYS"), \
         patch("app.graph._chat_model", return_value=m):
        await graph.agent_node(_state([HumanMessage(content="q1"), polluted, HumanMessage(content="q2")]))
    sent = m.ainvoke.await_args.args[0]
    assert not any(getattr(x, "tool_calls", None) for x in sent)


async def test_finalize_node_uses_llm_view():
    polluted = AIMessage(content="", tool_calls=[_call("old")])
    st = _state([HumanMessage(content="q1"), polluted, HumanMessage(content="q2"),
                 AIMessage(content="", tool_calls=[_call("t1")]),
                 ToolMessage(content="[]", tool_call_id="t1", name="search_products")])
    bare, _ = await _run_finalize(st)
    sent = bare.ainvoke.await_args.args[0]
    ids = [c["id"] for x in sent for c in (getattr(x, "tool_calls", None) or [])]
    assert ids == ["t1"]


async def test_turn_limit_finalize_sees_paired_history():
    # 한도 턴: agent 4회 → tools 4회 → finalize 1회. finalize 요청에 짝 없는 tool_use가 없어야 한다.
    bound = AsyncMock()
    bound.ainvoke = AsyncMock(side_effect=lambda *a, **k: AIMessage(content="", tool_calls=[_call()]))
    bare = AsyncMock()
    bare.ainvoke = AsyncMock(side_effect=lambda *a, **k: AIMessage(content="정리했어요."))
    bare.bind_tools = MagicMock(return_value=bound)
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph.make_plan", new=AsyncMock(return_value=[])), \
         patch("app.graph._chat_model", return_value=bare), \
         patch("app.graph._fetch_products", new=AsyncMock(return_value=[{"id": 9, "name": "Z"}])):
        g = build_graph(MemorySaver())
        cfg = {"configurable": {"thread_id": "s1"}}
        await g.ainvoke({"messages": [HumanMessage(content="계속 검색")], "recommended_ids": [], "tool_turns": 0}, cfg)
    assert bound.ainvoke.await_count == MAX_TOOL_TURNS
    bare.ainvoke.assert_awaited_once()
    sent = bare.ainvoke.await_args.args[0]
    assert isinstance(sent[-1], ToolMessage)
