import logging
import os
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import SystemMessage, HumanMessage

logger = logging.getLogger("agent.triage")

TRIAGE_MODEL = os.environ.get("TRIAGE_MODEL", "claude-haiku-4-5-20251001")

_TRIAGE_SYSTEM = (
    "너는 약국 상담 안전 분류기다. 사용자 메시지에 발열, 가슴 통증, 호흡곤란, "
    "심한 출혈, 의식저하, 마비, 심한 복통 등 즉시 진료가 필요한 응급 신호가 있으면 "
    "정확히 'EMERGENCY'만, 아니면 정확히 'NORMAL'만 출력한다. 다른 말은 절대 하지 마라."
)


def _model() -> ChatAnthropic:
    return ChatAnthropic(model=TRIAGE_MODEL, max_tokens=10, temperature=0)


async def classify(message: str) -> str:
    """사용자 메시지를 'emergency' 또는 'normal'로 분류한다. 실패 시 'normal'."""
    try:
        resp = await _model().ainvoke(
            [SystemMessage(content=_TRIAGE_SYSTEM), HumanMessage(content=message)]
        )
        text = (resp.content if isinstance(resp.content, str) else str(resp.content)).strip().upper()
        return "emergency" if "EMERGENCY" in text else "normal"
    except Exception:
        logger.exception("triage 분류 실패 — normal로 폴백")
        return "normal"
