import logging
import os
import time

import httpx

from app.prompts import PERSONA, SYSTEM_PROMPT, EMERGENCY_MESSAGE, TRIAGE_SYSTEM, PLAN_SYSTEM

logger = logging.getLogger("agent.config")

_CACHE_TTL = 30.0  # 초. web에서 가져온 설정을 이 시간 동안 재사용한다.
_cache: dict = {"at": 0.0, "data": None}

# web 미응답 시 사용하는 폴백. prompts.py 상수와 동일.
DEFAULT_CONFIG = {
    "persona": PERSONA,
    "systemPrompt": SYSTEM_PROMPT,
    "emergencyMessage": EMERGENCY_MESSAGE,
    "triagePrompt": TRIAGE_SYSTEM,
    "planPrompt": PLAN_SYSTEM,
    "skills": [],
}


def _base_url() -> str:
    return os.environ.get("WEB_INTERNAL_URL", "http://localhost:3000")


async def get_config() -> dict:
    """web에서 에이전트 설정을 가져온다. TTL 캐시, 실패 시 DEFAULT_CONFIG 폴백."""
    now = time.monotonic()
    if _cache["data"] is not None and now - _cache["at"] < _CACHE_TTL:
        return _cache["data"]
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{_base_url()}/api/agent-config")
            resp.raise_for_status()
            data = resp.json()
        _cache["data"] = data
        _cache["at"] = now
        return data
    except Exception:
        logger.exception("agent-config 조회 실패 — 기본 설정으로 폴백")
        return _cache["data"] or DEFAULT_CONFIG


def build_system_prompt(cfg: dict) -> str:
    """persona + system_prompt + 활성 스킬 카탈로그 안내를 하나의 시스템 프롬프트로 조립한다."""
    parts = [cfg.get("persona", PERSONA), cfg.get("systemPrompt", SYSTEM_PROMPT)]
    skills = cfg.get("skills") or []
    if skills:
        lines = [
            "## 사용 가능한 상담 스킬",
            "아래 상담 상황에 해당하면 load_consultation_skill(name) 도구로 해당 절차를 불러와 그대로 따르세요.",
        ]
        lines += [f"- {s['name']}: {s['description']}" for s in skills]
        parts.append("\n".join(lines))
    return "\n\n".join(p for p in parts if p)


async def fetch_skill_body(name: str) -> str:
    """활성 상담 스킬의 본문을 web에서 가져온다."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{_base_url()}/api/agent-tools/skill", params={"name": name}
            )
            if resp.status_code == 404:
                return f"'{name}' 스킬을 찾을 수 없습니다."
            resp.raise_for_status()
            return resp.json().get("body", "")
    except Exception:
        logger.exception("스킬 본문 조회 실패: %s", name)
        return "스킬을 불러오지 못했습니다."
