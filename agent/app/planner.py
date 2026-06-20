import json
import logging
import os
import re

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import SystemMessage, HumanMessage

from app.config_client import get_config
from app.prompts import PLAN_SYSTEM

logger = logging.getLogger("agent.planner")
PLAN_MODEL = os.environ.get("PLAN_MODEL", "claude-haiku-4-5-20251001")

KNOWN_TOOLS = {
    "search_products", "get_health_profile", "save_health_profile",
    "load_consultation_skill", "retrieve_knowledge",
}
MAX_STEPS = 6


def _coerce(step) -> dict | None:
    if not isinstance(step, dict):
        return None
    title = step.get("title")
    if not isinstance(title, str) or not title.strip():
        return None
    tool = step.get("tool")
    return {"title": title.strip(), "tool": tool if tool in KNOWN_TOOLS else None}


def parse_plan(text: str) -> list[dict]:
    """모델 출력에서 계획 단계 리스트를 관용적으로 추출한다. 실패 시 빈 리스트."""
    if not text:
        return []
    try:
        data = json.loads(text)
    except Exception:
        m = re.search(r"\[.*\]", text, re.DOTALL)
        if not m:
            return []
        try:
            data = json.loads(m.group(0))
        except Exception:
            return []
    if not isinstance(data, list):
        return []
    return [s for s in (_coerce(x) for x in data) if s][:MAX_STEPS]


def _plan_model() -> ChatAnthropic:
    return ChatAnthropic(model=PLAN_MODEL, max_tokens=256, temperature=0)


async def make_plan(message: str) -> list[dict]:
    """상담 계획(단계 리스트)을 세운다. 실패 시 빈 리스트(무가이드 진행)."""
    try:
        cfg = await get_config()
        system = cfg.get("planPrompt") or PLAN_SYSTEM
        resp = await _plan_model().ainvoke([SystemMessage(content=system), HumanMessage(content=message)])
        text = resp.content if isinstance(resp.content, str) else str(resp.content)
        return parse_plan(text)
    except Exception:
        logger.exception("계획 수립 실패 — 빈 계획으로 폴백")
        return []
