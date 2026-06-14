from unittest.mock import AsyncMock, MagicMock, patch
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import MemorySaver
from app.graph import build_graph, AgentState


def _ai(text="", tool_calls=None):
    return AIMessage(content=text, tool_calls=tool_calls or [])


def _tool_call(cond="피로"):
    return [{"name": "search_products", "args": {"condition": cond}, "id": "t1", "type": "tool_call"}]


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
    # triage=normal, agent가 도구 호출 후 답변
    fake_model = _model([_ai(tool_calls=_tool_call()), _ai(text="비타민C를 추천드려요.")])
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
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


async def test_recommended_ids_dedup_across_turns():
    fake_model = _model([
        _ai(tool_calls=_tool_call("피로")),
        _ai(tool_calls=_tool_call("눈")),
        _ai(text="추천드립니다."),
    ])
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph._chat_model", return_value=fake_model), \
         patch("app.graph._fetch_products", new=AsyncMock(return_value=[{"id": 1, "name": "A"}])):
        graph = build_graph(MemorySaver())
        events = await _collect(graph, "피곤하고 눈도 침침")
    final = [c for m, c in events if m == "values"][-1]
    assert final["recommended_ids"] == [1]  # 두 번 검색해도 중복 없이 1개


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
         patch("app.graph._chat_model", return_value=bare), \
         patch("app.graph._fetch_products", new=AsyncMock(return_value=[{"id": 9, "name": "Z"}])):
        graph = build_graph(MemorySaver())
        events = await _collect(graph, "계속 검색해줘")
    final = [c for m, c in events if m == "values"][-1]
    assert "정리해드리면" in final["messages"][-1].content


async def test_get_health_profile_dispatch_injects_session_id():
    from unittest.mock import AsyncMock as _AM, patch as _patch
    fake_model = _model([
        _ai(tool_calls=[{"name": "get_health_profile", "args": {}, "id": "h1", "type": "tool_call"}]),
        _ai(text="프로필을 확인했어요."),
    ])
    fetch = _AM(return_value={"conditions": ["고혈압"]})
    with _patch("app.triage.classify", new=_AM(return_value="normal")), \
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
         _patch("app.graph._chat_model", return_value=fake_model), \
         _patch("app.graph._save_health_profile", new=save):
        graph = build_graph(MemorySaver())
        await _collect(graph, "혈압약 먹고 있어요")
    save.assert_awaited_once()
    assert save.await_args.args[0] == "s1"
    assert save.await_args.kwargs.get("medications") == ["혈압약"]
