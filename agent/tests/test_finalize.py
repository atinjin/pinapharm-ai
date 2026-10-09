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
