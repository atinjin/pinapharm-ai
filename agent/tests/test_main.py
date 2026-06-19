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


def test_skill_dryrun_returns_response():
    fake_model = AsyncMock()
    fake_model.ainvoke = AsyncMock(return_value=AIMessage(content="콧물엔 수분 섭취를 권합니다."))
    with patch("app.main._chat_model", return_value=fake_model), \
         patch("app.main.get_config", new=AsyncMock(return_value={"persona": "맑은 약사"})):
        with TestClient(main_module.app) as client:
            r = client.post("/skill-dryrun", json={"query": "콧물이 나요", "skill_body": "1) 수분 섭취 권고"})
            assert r.status_code == 200
            assert r.json()["response"] == "콧물엔 수분 섭취를 권합니다."


def test_skill_dryrun_handles_failure():
    fake_model = AsyncMock()
    fake_model.ainvoke = AsyncMock(side_effect=RuntimeError("no key"))
    with patch("app.main._chat_model", return_value=fake_model), \
         patch("app.main.get_config", new=AsyncMock(return_value={"persona": ""})):
        with TestClient(main_module.app) as client:
            r = client.post("/skill-dryrun", json={"query": "q", "skill_body": "b"})
            assert r.status_code == 502


def test_health():
    with TestClient(main_module.app) as client:
        assert client.get("/health").json() == {"ok": True}
