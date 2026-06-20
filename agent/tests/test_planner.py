from unittest.mock import AsyncMock, patch
from langchain_core.messages import AIMessage

from app.planner import parse_plan, make_plan


async def test_make_plan_parses_model_json():
    fake = AsyncMock()
    fake.ainvoke = AsyncMock(return_value=AIMessage(content='[{"title":"제품 검색","tool":"search_products"}]'))
    with patch("app.planner._plan_model", return_value=fake), \
         patch("app.planner.get_config", new=AsyncMock(return_value={})):
        assert await make_plan("피곤해요") == [{"title": "제품 검색", "tool": "search_products"}]


async def test_make_plan_uses_config_planPrompt_override():
    seen = {}
    async def cfg(): return {"planPrompt": "CUSTOM-PLAN"}
    fake = AsyncMock()
    async def cap(msgs):
        seen["system"] = msgs[0].content
        return AIMessage(content="[]")
    fake.ainvoke = AsyncMock(side_effect=cap)
    with patch("app.planner._plan_model", return_value=fake), patch("app.planner.get_config", new=cfg):
        await make_plan("안녕")
    assert seen["system"] == "CUSTOM-PLAN"


async def test_make_plan_failure_returns_empty():
    fake = AsyncMock()
    fake.ainvoke = AsyncMock(side_effect=RuntimeError("boom"))
    with patch("app.planner._plan_model", return_value=fake), \
         patch("app.planner.get_config", new=AsyncMock(return_value={})):
        assert await make_plan("x") == []


def test_parse_plan_happy():
    text = '[{"title":"건강 프로필 확인","tool":"get_health_profile"},{"title":"제품 검색","tool":"search_products"}]'
    assert parse_plan(text) == [
        {"title": "건강 프로필 확인", "tool": "get_health_profile"},
        {"title": "제품 검색", "tool": "search_products"},
    ]

def test_parse_plan_tolerates_prose_wrapper():
    assert parse_plan('```json\n[{"title":"증상 정리","tool":null}]\n```') == [{"title": "증상 정리", "tool": None}]

def test_parse_plan_unknown_tool_becomes_null():
    assert parse_plan('[{"title":"x","tool":"made_up"}]') == [{"title": "x", "tool": None}]

def test_parse_plan_garbage_returns_empty():
    assert parse_plan("이건 JSON이 아니에요") == []
    assert parse_plan("") == []

def test_parse_plan_drops_titleless_entries():
    assert parse_plan('[{"tool":"search_products"},{"title":"좋아"}]') == [{"title": "좋아", "tool": None}]

def test_parse_plan_caps_length():
    big = "[" + ",".join('{"title":"s%d"}' % i for i in range(20)) + "]"
    assert len(parse_plan(big)) <= 6
