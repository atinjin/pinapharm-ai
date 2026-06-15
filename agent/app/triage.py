import logging
import os
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import SystemMessage, HumanMessage

from app.config_client import get_config
from app.prompts import TRIAGE_SYSTEM

logger = logging.getLogger("agent.triage")

TRIAGE_MODEL = os.environ.get("TRIAGE_MODEL", "claude-haiku-4-5-20251001")


def _model() -> ChatAnthropic:
    return ChatAnthropic(model=TRIAGE_MODEL, max_tokens=10, temperature=0)


async def classify(message: str) -> str:
    """사용자 메시지를 'emergency' 또는 'normal'로 분류한다. 실패 시 'normal'."""
    try:
        cfg = await get_config()
        system = cfg.get("triagePrompt") or TRIAGE_SYSTEM
        resp = await _model().ainvoke(
            [SystemMessage(content=system), HumanMessage(content=message)]
        )
        text = (resp.content if isinstance(resp.content, str) else str(resp.content)).strip().upper()
        return "emergency" if "EMERGENCY" in text else "normal"
    except Exception:
        logger.exception("triage 분류 실패 — normal로 폴백")
        return "normal"
