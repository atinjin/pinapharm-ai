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
        _ai(text="비타민C를 추천드려요."),
    ])
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph._chat_model", return_value=fake_model), \
         patch("app.graph._fetch_products", new=AsyncMock(return_value=[{"id": 1, "name": "비타민C"}])):
        graph = build_graph(MemorySaver())
        events = [e async for e in stream_events(graph, "피곤해요", "s1")]
    types = [e["event"] for e in events]
    assert "recommendations" in types
    assert types[-1] == "done"
    rec = json.loads(next(e["data"] for e in events if e["event"] == "recommendations"))
    assert rec["ids"] == [1]


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
         patch("app.graph._chat_model", return_value=fake_model):
        graph = build_graph(MemorySaver())
        async for _ in stream_events(graph, "제 번호 010-1234-5678", "sP"):
            pass
    assert "010-1234-5678" not in seen["msg"]
    assert "[전화번호]" in seen["msg"]
