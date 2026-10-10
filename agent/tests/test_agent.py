import json
from unittest.mock import AsyncMock, MagicMock, patch
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import MemorySaver
from app.agent import stream_events
from app.graph import build_graph


def _ai(text="", tool_calls=None):
    return AIMessage(content=text, tool_calls=tool_calls or [])


def _model(calls):
    m = AsyncMock()
    m.ainvoke = AsyncMock(side_effect=calls)
    m.bind_tools = MagicMock(return_value=m)
    return m


async def test_stream_events_emits_recommendations_and_done():
    fake_model = _model([
        _ai(tool_calls=[{"name": "search_products", "args": {"condition": "피로"}, "id": "t1", "type": "tool_call"}]),
        _ai(tool_calls=[{"name": "recommend_products", "args": {"product_ids": [1]}, "id": "r1", "type": "tool_call"}]),
        _ai(text="비타민C를 추천드려요."),
    ])
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph.make_plan", new=AsyncMock(return_value=[])), \
         patch("app.graph._chat_model", return_value=fake_model), \
         patch("app.graph._fetch_products", new=AsyncMock(return_value=[{"id": 1, "name": "비타민C"}])):
        graph = build_graph(MemorySaver())
        events = [e async for e in stream_events(graph, "피곤해요", "s1")]
    types = [e["event"] for e in events]
    assert "recommendations" in types
    assert types[-1] == "done"
    rec = json.loads(next(e["data"] for e in events if e["event"] == "recommendations"))
    assert rec["ids"] == [1]


async def test_stream_events_resets_seen_products_each_turn():
    # 이전 턴에 검색한 제품은 다음 턴에 검색 없이 카드로 보낼 수 없다
    fake_model = _model([
        _ai(tool_calls=[{"name": "search_products", "args": {}, "id": "t1", "type": "tool_call"}]),
        _ai(text="찾아봤어요."),
        _ai(tool_calls=[{"name": "recommend_products", "args": {"product_ids": [1]}, "id": "r1", "type": "tool_call"}]),
        _ai(text="권해요."),
    ])
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph.make_plan", new=AsyncMock(return_value=[])), \
         patch("app.graph._chat_model", return_value=fake_model), \
         patch("app.graph._fetch_products", new=AsyncMock(return_value=[{"id": 1, "name": "비타민C"}])):
        graph = build_graph(MemorySaver())
        first = [e async for e in stream_events(graph, "피곤해요", "sSeen")]
        second = [e async for e in stream_events(graph, "그걸로 할게요", "sSeen")]
    assert not any(e["event"] == "recommendations" for e in first + second)


async def test_stream_events_emergency():
    with patch("app.triage.classify", new=AsyncMock(return_value="emergency")):
        graph = build_graph(MemorySaver())
        events = [e async for e in stream_events(graph, "숨이 안 쉬어져요", "s2")]
    assert any(e["event"] == "emergency" for e in events)
    assert events[-1]["event"] == "done"


async def test_stream_events_redacts_pii_at_ingress():
    # 입구에서 마스킹되어 triage(및 이후 LLM·메모리)에 원본 PII가 닿지 않아야 한다
    seen = {}

    async def capturing_classify(msg):
        seen["msg"] = msg
        return "normal"

    fake_model = _model([_ai(text="네, 도와드릴게요.")])
    with patch("app.triage.classify", new=capturing_classify), \
         patch("app.graph.make_plan", new=AsyncMock(return_value=[])), \
         patch("app.graph._chat_model", return_value=fake_model):
        graph = build_graph(MemorySaver())
        async for _ in stream_events(graph, "제 번호 010-1234-5678", "sP"):
            pass
    assert "010-1234-5678" not in seen["msg"]
    assert "[전화번호]" in seen["msg"]


async def test_stream_events_emits_plan_before_tokens():
    fake_model = _model([_ai(text="도와드릴게요.")])
    plan = [{"title": "증상 정리", "tool": None}]
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph.make_plan", new=AsyncMock(return_value=plan)), \
         patch("app.graph._chat_model", return_value=fake_model):
        graph = build_graph(MemorySaver())
        events = [e async for e in stream_events(graph, "피곤해요", "sPlan")]
    types = [e["event"] for e in events]
    assert "plan" in types
    assert json.loads(next(e for e in events if e["event"] == "plan")["data"])["steps"] == ["증상 정리"]
    assert types.index("plan") < types.index("token")
    assert types[-1] == "done"


async def test_stream_events_separates_text_of_different_ai_messages():
    # 도구 호출 전 안내문과 도구 이후 답변이 "준비해볼게요.증상 관련…"처럼 붙지 않아야 한다
    fake_model = _model([
        _ai(text="준비해볼게요.", tool_calls=[{"name": "search_products", "args": {}, "id": "t1", "type": "tool_call"}]),
        _ai(text="증상 관련 제품이에요."),
    ])
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph.make_plan", new=AsyncMock(return_value=[])), \
         patch("app.graph._chat_model", return_value=fake_model), \
         patch("app.graph._fetch_products", new=AsyncMock(return_value=[{"id": 1, "name": "비타민C"}])):
        graph = build_graph(MemorySaver())
        events = [e async for e in stream_events(graph, "피곤해요", "sSep")]
    text = "".join(json.loads(e["data"])["text"] for e in events if e["event"] == "token")
    assert text == "준비해볼게요.\n\n증상 관련 제품이에요."


def _llm_result(model, inp, out, **details):
    from langchain_core.outputs import ChatGeneration, LLMResult
    usage = {"input_tokens": inp, "output_tokens": out, "total_tokens": inp + out, "input_token_details": details}
    msg = AIMessage(content="x", usage_metadata=usage, response_metadata={"model_name": model})
    return LLMResult(generations=[[ChatGeneration(message=msg)]])


class _UsageGraph:
    """config로 받은 콜백에 사용량을 보고하는 가짜 그래프. fail이면 보고 후 예외를 던진다."""

    def __init__(self, fail=False):
        self.fail = fail
        self.config = None

    async def astream(self, inp, config, stream_mode):
        self.config = config
        for h in config.get("callbacks") or []:
            h.on_llm_end(_llm_result("anthropic/claude-opus-4.8", 1000, 100, cache_read=400, cache_creation=0,
                                     ephemeral_5m_input_tokens=300, ephemeral_1h_input_tokens=0))
        yield "custom", {"type": "plan", "steps": []}
        if self.fail:
            raise RuntimeError("boom")


async def test_stream_events_passes_callbacks_and_emits_usage_before_done():
    g = _UsageGraph()
    events = [e async for e in stream_events(g, "피곤해요", "sU")]
    assert g.config["configurable"] == {"thread_id": "sU"}
    types = [e["event"] for e in events]
    assert types[-2:] == ["usage", "done"]
    usage = json.loads(events[-2]["data"])
    opus = usage["models"]["claude-opus-4-8"]
    assert opus["calls"] == 1
    assert (opus["input"], opus["cache_read"], opus["cache_write_5m"], opus["output"]) == (300, 400, 300, 100)
    assert usage["cost_usd"] > 0


async def test_stream_events_emits_usage_before_error():
    events = [e async for e in stream_events(_UsageGraph(fail=True), "피곤해요", "sUe")]
    assert [e["event"] for e in events][-2:] == ["usage", "error"]


async def test_stream_events_logs_usage_as_json_line(caplog):
    import logging
    with caplog.at_level(logging.INFO, logger="agent.usage"):
        async for _ in stream_events(_UsageGraph(), "피곤해요", "sLog"):
            pass
    line = next(r.getMessage() for r in caplog.records if r.name == "agent.usage")
    data = json.loads(line)
    assert data["session_id"] == "sLog"
    assert data["status"] == "done"
    assert "claude-opus-4-8" in data["models"]


async def test_stream_events_without_usage_omits_event():
    # mock 모델은 usage_metadata가 없으므로 usage 이벤트가 없어야 하고 done이 마지막이다
    fake_model = _model([_ai(text="도와드릴게요.")])
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph.make_plan", new=AsyncMock(return_value=[])), \
         patch("app.graph._chat_model", return_value=fake_model):
        graph = build_graph(MemorySaver())
        events = [e async for e in stream_events(graph, "피곤해요", "sNoU")]
    types = [e["event"] for e in events]
    assert "usage" not in types
    assert types[-1] == "done"
