from unittest.mock import AsyncMock, patch
from app.agent import run_agent_stream
from app.schemas import ChatMessage

class FakeBlock:
    def __init__(self, type, text=None, name=None, input=None, id=None):
        self.type = type; self.text = text; self.name = name; self.input = input; self.id = id

class FakeResponse:
    def __init__(self, content, stop_reason):
        self.content = content; self.stop_reason = stop_reason

async def test_agent_runs_tool_then_answers():
    # 1차: 도구 호출, 2차: 최종 텍스트
    responses = [
        FakeResponse([FakeBlock("tool_use", name="search_products", input={"condition": "피로"}, id="t1")], "tool_use"),
        FakeResponse([FakeBlock("text", text="비타민C를 추천드려요.")], "end_turn"),
    ]
    fake_client = AsyncMock()
    fake_client.messages.create = AsyncMock(side_effect=responses)

    with patch("app.agent.get_client", return_value=fake_client), \
         patch("app.agent.run_tool", new=AsyncMock(return_value=[{"id": 1, "name": "비타민C 1000"}])):
        chunks = []
        async for c in run_agent_stream([ChatMessage(role="user", content="요즘 피곤해요")]):
            chunks.append(c)
        assert "비타민C" in "".join(chunks)
