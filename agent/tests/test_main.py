from unittest.mock import AsyncMock, MagicMock, patch
from langchain_core.messages import AIMessage
from fastapi.testclient import TestClient
import app.main as main_module


def test_chat_streams_sse():
    fake_model = AsyncMock()
    fake_model.ainvoke = AsyncMock(side_effect=[AIMessage(content="안녕하세요, 맑은 약사입니다.")])
    fake_model.bind_tools = MagicMock(return_value=fake_model)
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph._chat_model", return_value=fake_model):
        with TestClient(main_module.app) as client:
            r = client.post("/chat", json={"message": "안녕", "session_id": "s1"})
            assert r.status_code == 200
            assert "text/event-stream" in r.headers["content-type"]
            assert "event: done" in r.text


def test_health():
    with TestClient(main_module.app) as client:
        assert client.get("/health").json() == {"ok": True}
