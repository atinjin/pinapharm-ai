import json
from unittest.mock import AsyncMock, MagicMock, patch
from app.agent import run_agent_stream, RECO_MARKER
from app.schemas import ChatMessage

class FakeBlock:
    def __init__(self, type, text=None, name=None, input=None, id=None):
        self.type = type; self.text = text; self.name = name; self.input = input; self.id = id

class FakeResponse:
    def __init__(self, content, stop_reason):
        self.content = content; self.stop_reason = stop_reason

class FakeStream:
    def __init__(self, response):
        self._response = response
    async def __aenter__(self):
        return self
    async def __aexit__(self, *exc):
        return False
    @property
    def text_stream(self):
        return self._iter_text()
    async def _iter_text(self):
        for b in self._response.content:
            if b.type == "text":
                yield b.text
    async def get_final_message(self):
        return self._response

async def test_agent_runs_tool_then_answers():
    # 1차: 도구 호출, 2차: 최종 텍스트
    responses = iter([
        FakeResponse([FakeBlock("tool_use", name="search_products", input={"condition": "피로"}, id="t1")], "tool_use"),
        FakeResponse([FakeBlock("text", text="비타민C를 추천드려요.")], "end_turn"),
    ])
    fake_client = AsyncMock()
    fake_client.messages.stream = MagicMock(side_effect=lambda **kw: FakeStream(next(responses)))

    with patch("app.agent.get_client", return_value=fake_client), \
         patch("app.agent.run_tool", new=AsyncMock(return_value=[{"id": 1, "name": "비타민C 1000"}])):
        chunks = []
        async for c in run_agent_stream([ChatMessage(role="user", content="요즘 피곤해요")]):
            chunks.append(c)
        full = "".join(chunks)
        assert "비타민C" in full
        # 추천 제품 ID trailer가 마지막에 포함되어야 한다
        assert RECO_MARKER in full
        trailer = full.split(RECO_MARKER)[1]
        assert json.loads(trailer) == {"ids": [1]}
