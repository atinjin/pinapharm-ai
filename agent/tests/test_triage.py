from unittest.mock import AsyncMock, patch
from langchain_core.messages import AIMessage
from app.triage import classify


async def test_classify_emergency():
    assert await classify_with("emergency") == "emergency"


async def test_classify_normal():
    assert await classify_with("normal") == "normal"


async def test_classify_failure_defaults_normal():
    fake = AsyncMock()
    fake.ainvoke = AsyncMock(side_effect=RuntimeError("boom"))
    with patch("app.triage._model", return_value=fake):
        assert await classify("아무 말") == "normal"


async def classify_with(label):
    fake = AsyncMock()
    fake.ainvoke = AsyncMock(return_value=AIMessage(content=f"  {label.upper()}  "))
    with patch("app.triage._model", return_value=fake):
        return await classify("증상 설명")
