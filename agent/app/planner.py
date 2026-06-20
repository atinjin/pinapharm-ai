import json
import re

from app.prompts import PLAN_SYSTEM

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
