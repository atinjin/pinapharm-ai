from unittest.mock import AsyncMock, MagicMock, patch
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END
from app.graph import build_graph, AgentState, MAX_TOOL_TURNS, route_after_tools


def _ai(text="", tool_calls=None):
    return AIMessage(content=text, tool_calls=tool_calls or [])


def _tool_call(cond="피로"):
    return [{"name": "search_products", "args": {"condition": cond}, "id": "t1", "type": "tool_call"}]


def _recommend_call(ids, id_="r1"):
    return [{"name": "recommend_products", "args": {"product_ids": ids}, "id": id_, "type": "tool_call"}]


def _model(calls):
    # bind_tools가 자기 자신을 반환해야 ainvoke side_effect가 적용된다
    m = AsyncMock()
    m.ainvoke = AsyncMock(side_effect=calls)
    m.bind_tools = MagicMock(return_value=m)
    return m


async def _collect(graph, message):
    cfg = {"configurable": {"thread_id": "s1"}}
    inp = {"messages": [HumanMessage(content=message)], "recommended_ids": [], "tool_turns": 0}
    events = []
    async for mode, chunk in graph.astream(inp, cfg, stream_mode=["custom", "values"]):
        events.append((mode, chunk))
    return events


async def test_normal_flow_runs_tool_then_answers():
    # triage=normal, agent가 검색 → 추천 지정 후 답변
    fake_model = _model([
        _ai(tool_calls=_tool_call()),
        _ai(tool_calls=_recommend_call([1])),
        _ai(text="비타민C를 추천드려요."),
    ])
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph.make_plan", new=AsyncMock(return_value=[])), \
         patch("app.graph._chat_model", return_value=fake_model), \
         patch("app.graph._fetch_products", new=AsyncMock(return_value=[{"id": 1, "name": "비타민C"}])):
        graph = build_graph(MemorySaver())
        events = await _collect(graph, "요즘 피곤해요")
    customs = [c for m, c in events if m == "custom"]
    assert any(c.get("type") == "recommendations" and c["ids"] == [1] for c in customs)
    final = [c for m, c in events if m == "values"][-1]
    assert "비타민C" in final["messages"][-1].content


async def test_emergency_flow_skips_tools():
    with patch("app.triage.classify", new=AsyncMock(return_value="emergency")), \
         patch("app.graph._fetch_products", new=AsyncMock()) as fetch:
        graph = build_graph(MemorySaver())
        events = await _collect(graph, "가슴이 너무 아프고 숨이 안 쉬어져요")
    fetch.assert_not_called()
    customs = [c for m, c in events if m == "custom"]
    assert any(c.get("type") == "emergency" for c in customs)


async def _run(calls, products, message="피곤하고 눈도 침침"):
    fake_model = _model(calls)
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph.make_plan", new=AsyncMock(return_value=[])), \
         patch("app.graph._chat_model", return_value=fake_model), \
         patch("app.graph._fetch_products", new=AsyncMock(return_value=products)):
        graph = build_graph(MemorySaver())
        events = await _collect(graph, message)
    customs = [c for m, c in events if m == "custom" and c.get("type") == "recommendations"]
    final = [c for m, c in events if m == "values"][-1]
    return customs, final


async def test_search_without_recommend_emits_no_recommendations():
    # 검색 결과는 후보일 뿐 카드가 아니다
    customs, final = await _run(
        [_ai(tool_calls=_tool_call("피로")), _ai(tool_calls=_tool_call("눈")), _ai(text="추천드립니다.")],
        [{"id": 1, "name": "A"}, {"id": 2, "name": "B"}],
    )
    assert customs == []
    assert final["recommended_ids"] == []
    assert final["seen_product_ids"] == [1, 2]  # 두 번 검색해도 중복 없이


async def test_recommend_passes_only_searched_ids():
    # 오메가3(4)는 검색으로 봤지만 권하지 않았고, 99는 검색에 없던(지어낸) id다
    customs, final = await _run(
        [_ai(tool_calls=_tool_call("혈행")), _ai(tool_calls=_recommend_call([5, 99])), _ai(text="5번을 권해요.")],
        [{"id": 4, "name": "오메가3"}, {"id": 5, "name": "B"}],
    )
    assert [c["ids"] for c in customs] == [[5]]
    assert final["recommended_ids"] == [5]


async def test_recommend_before_search_is_ignored():
    customs, final = await _run(
        [_ai(tool_calls=_recommend_call([1])), _ai(text="제품을 찾지 못했어요.")],
        [{"id": 1, "name": "A"}],
    )
    assert customs == []
    assert final["recommended_ids"] == []


async def test_recommend_tool_message_is_short():
    fake = [_ai(tool_calls=_tool_call()), _ai(tool_calls=_recommend_call([1, 2])), _ai(text="두 제품을 권해요.")]
    _, final = await _run(fake, [{"id": 1, "name": "A"}, {"id": 2, "name": "B"}])
    msg = next(m for m in final["messages"] if getattr(m, "name", None) == "recommend_products")
    assert msg.content == "추천 카드 2개 표시"


async def test_recommend_caps_at_three_and_dedups():
    products = [{"id": i, "name": str(i)} for i in range(1, 6)]
    customs, final = await _run(
        [_ai(tool_calls=_tool_call()), _ai(tool_calls=_recommend_call([1, 1, 2])),
         _ai(tool_calls=_recommend_call([3, 4, 5], "r2")), _ai(text="권해요.")],
        products,
    )
    assert [c["ids"] for c in customs] == [[1, 2], [1, 2, 3]]
    assert final["recommended_ids"] == [1, 2, 3]


async def test_turn_limit_routes_to_finalize():
    # agent(bind_tools 경로)는 항상 도구만 호출, finalize(bare 경로)는 최종 답변.
    # 두 경로의 mock을 분리해야 호출 순서가 섞이지 않는다.
    # 매 호출마다 새 메시지 객체를 만들어야 add_messages가 id 충돌로 교체하지 않는다
    bound = AsyncMock()
    bound.ainvoke = AsyncMock(side_effect=lambda *a, **k: _ai(tool_calls=_tool_call()))
    bare = AsyncMock()
    bare.ainvoke = AsyncMock(side_effect=lambda *a, **k: _ai(text="정리해드리면 다음과 같아요."))
    bare.bind_tools = MagicMock(return_value=bound)
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph.make_plan", new=AsyncMock(return_value=[])), \
         patch("app.graph._chat_model", return_value=bare), \
         patch("app.graph._fetch_products", new=AsyncMock(return_value=[{"id": 9, "name": "Z"}])):
        graph = build_graph(MemorySaver())
        events = await _collect(graph, "계속 검색해줘")
    final = [c for m, c in events if m == "values"][-1]
    assert "정리해드리면" in final["messages"][-1].content


def _after_tools_state(ai: AIMessage, tool_turns=1) -> dict:
    tool_msgs = [
        ToolMessage(content="ok", tool_call_id=c["id"], name=c["name"]) for c in ai.tool_calls
    ]
    return {"messages": [HumanMessage(content="질문"), ai, *tool_msgs], "tool_turns": tool_turns}


def test_route_after_tools_ends_when_recommend_only_with_text():
    # 답변 본문과 추천 지정을 한 메시지로 보냈으면 LLM을 다시 부를 이유가 없다
    ai = _ai(text="비타민C를 권해요.", tool_calls=_recommend_call([1]))
    assert route_after_tools(_after_tools_state(ai)) == END


def test_route_after_tools_ends_with_text_in_content_blocks():
    ai = AIMessage(
        content=[
            {"type": "text", "text": "비타민C를 권해요."},
            {"type": "tool_use", "id": "r1", "name": "recommend_products", "input": {"product_ids": [1]}},
        ],
        tool_calls=_recommend_call([1]),
    )
    assert route_after_tools(_after_tools_state(ai)) == END


def test_route_after_tools_returns_to_agent_when_recommend_without_text():
    ai = _ai(text="  ", tool_calls=_recommend_call([1]))
    assert route_after_tools(_after_tools_state(ai)) == "agent"


def test_route_after_tools_returns_to_agent_when_mixed_with_other_tools():
    ai = _ai(text="찾아보고 권할게요.", tool_calls=_recommend_call([1]) + _tool_call())
    assert route_after_tools(_after_tools_state(ai)) == "agent"


def test_route_after_tools_limit_wins_over_end():
    ai = _ai(text="비타민C를 권해요.", tool_calls=_recommend_call([1]))
    assert route_after_tools(_after_tools_state(ai, tool_turns=MAX_TOOL_TURNS)) == "finalize"


async def test_recommend_with_text_ends_turn_without_extra_llm_call():
    fake_model = _model([
        _ai(tool_calls=_tool_call()),
        _ai(text="비타민C를 권해요.", tool_calls=_recommend_call([1])),
    ])
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph.make_plan", new=AsyncMock(return_value=[])), \
         patch("app.graph._chat_model", return_value=fake_model), \
         patch("app.graph._fetch_products", new=AsyncMock(return_value=[{"id": 1, "name": "비타민C"}])):
        graph = build_graph(MemorySaver())
        events = await _collect(graph, "요즘 피곤해요")
    assert fake_model.ainvoke.await_count == 2
    final = [c for m, c in events if m == "values"][-1]
    assert final["recommended_ids"] == [1]
    assert isinstance(final["messages"][-1], ToolMessage)


async def test_get_health_profile_dispatch_injects_session_id():
    from unittest.mock import AsyncMock as _AM, patch as _patch
    fake_model = _model([
        _ai(tool_calls=[{"name": "get_health_profile", "args": {}, "id": "h1", "type": "tool_call"}]),
        _ai(text="프로필을 확인했어요."),
    ])
    fetch = _AM(return_value={"conditions": ["고혈압"]})
    with _patch("app.triage.classify", new=_AM(return_value="normal")), \
         _patch("app.graph.make_plan", new=_AM(return_value=[])), \
         _patch("app.graph._chat_model", return_value=fake_model), \
         _patch("app.graph._fetch_health_profile", new=fetch):
        graph = build_graph(MemorySaver())
        await _collect(graph, "상담 시작할게요")
    fetch.assert_awaited_once()
    assert fetch.await_args.args[0] == "s1"  # thread_id == session_id 주입


async def test_save_health_profile_dispatch_passes_fields():
    from unittest.mock import AsyncMock as _AM, patch as _patch
    fake_model = _model([
        _ai(tool_calls=[{"name": "save_health_profile", "args": {"medications": ["혈압약"]}, "id": "s1", "type": "tool_call"}]),
        _ai(text="기록했어요."),
    ])
    save = _AM(return_value={"medications": ["혈압약"]})
    with _patch("app.triage.classify", new=_AM(return_value="normal")), \
         _patch("app.graph.make_plan", new=_AM(return_value=[])), \
         _patch("app.graph._chat_model", return_value=fake_model), \
         _patch("app.graph._save_health_profile", new=save):
        graph = build_graph(MemorySaver())
        await _collect(graph, "혈압약 먹고 있어요")
    save.assert_awaited_once()
    assert save.await_args.args[0] == "s1"
    assert save.await_args.kwargs.get("medications") == ["혈압약"]


async def test_tools_node_dispatches_retrieve_knowledge(monkeypatch):
    from unittest.mock import patch as _patch, MagicMock
    from app import graph

    async def fake_fetch_knowledge(**kwargs):
        return [{"title": "오메가3", "text": "출혈 주의", "metadata": {}, "score": 0.9}]

    monkeypatch.setattr(graph, "_fetch_knowledge", fake_fetch_knowledge)

    ai = AIMessage(content="", tool_calls=[{"name": "retrieve_knowledge", "args": {"query": "오메가", "k": 4}, "id": "t1"}])
    state = {"messages": [ai], "recommended_ids": [], "tool_turns": 0, "triage": "normal"}
    config = {"configurable": {"thread_id": "s1"}}
    with _patch("app.graph.get_stream_writer", return_value=MagicMock()):
        out = await graph.tools_node(state, config)
    msg = out["messages"][0]
    assert "오메가3" in msg.content
    assert msg.name == "retrieve_knowledge"


async def test_plan_node_emits_plan_event_and_stores_state():
    fake_model = _model([_ai(text="도와드릴게요.")])
    plan = [{"title": "건강 프로필 확인", "tool": "get_health_profile"},
            {"title": "제품 검색", "tool": "search_products"}]
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph.make_plan", new=AsyncMock(return_value=plan)), \
         patch("app.graph._chat_model", return_value=fake_model):
        graph = build_graph(MemorySaver())
        events = await _collect(graph, "피곤해요")
    customs = [c for m, c in events if m == "custom"]
    assert any(c.get("type") == "plan" and c["steps"] == ["건강 프로필 확인", "제품 검색"] for c in customs)
    final = [c for m, c in events if m == "values"][-1]
    assert final["plan"] == plan


async def test_plan_injected_into_agent_system_prompt():
    captured = {}
    async def cap_invoke(msgs):
        captured["system"] = msgs[0].content
        return _ai(text="네.")
    fake_model = AsyncMock(); fake_model.ainvoke = AsyncMock(side_effect=cap_invoke)
    fake_model.bind_tools = MagicMock(return_value=fake_model)
    plan = [{"title": "근거 검색", "tool": "retrieve_knowledge"}]
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph.make_plan", new=AsyncMock(return_value=plan)), \
         patch("app.graph._chat_model", return_value=fake_model):
        graph = build_graph(MemorySaver()); await _collect(graph, "오메가3 안전한가요")
    assert "## 상담 계획" in captured["system"] and "근거 검색" in captured["system"]


async def test_empty_plan_runs_loop_unguided():
    fake_model = _model([_ai(text="네, 도와드릴게요.")])
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph.make_plan", new=AsyncMock(return_value=[])), \
         patch("app.graph._chat_model", return_value=fake_model):
        graph = build_graph(MemorySaver()); events = await _collect(graph, "안녕하세요")
    customs = [c for m, c in events if m == "custom"]
    plan_evts = [c for c in customs if c.get("type") == "plan"]
    assert plan_evts and plan_evts[0]["steps"] == []
    final = [c for m, c in events if m == "values"][-1]
    assert "도와드릴게요" in final["messages"][-1].content


async def test_emergency_skips_plan_node():
    with patch("app.triage.classify", new=AsyncMock(return_value="emergency")), \
         patch("app.graph.make_plan", new=AsyncMock()) as mk:
        graph = build_graph(MemorySaver()); events = await _collect(graph, "가슴이 너무 아프고 숨이 안 쉬어져요")
    mk.assert_not_called()
    customs = [c for m, c in events if m == "custom"]
    assert any(c.get("type") == "emergency" for c in customs)
    assert not any(c.get("type") == "plan" for c in customs)
