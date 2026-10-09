"""LLM 생성 단일 지점. 기본은 OpenRouter의 Anthropic 호환 입력, 비상시 Anthropic 직접 호출.

설계: docs/superpowers/specs/2026-10-09-openrouter-design.md
"""
import os
import re

from langchain_anthropic import ChatAnthropic

PROVIDER = os.environ.get("LLM_PROVIDER", "openrouter")  # openrouter | anthropic
OPENROUTER_BASE_URL = "https://openrouter.ai/api"  # SDK가 /v1/messages를 붙인다
APP_TITLE = "PinaPharm"

# 상담 내용은 건강정보다. Anthropic 1P에 고정하고 학습·보존 제공자를 배제한다.
PROVIDER_ROUTING = {"order": ["anthropic"], "allow_fallbacks": False, "data_collection": "deny"}

_DATE_SUFFIX = re.compile(r"-\d{8}$")
_VERSION_TAIL = re.compile(r"-(\d+)-(\d+)$")


def to_openrouter_slug(model: str) -> str:
    """Anthropic 네이티브 ID를 OpenRouter 슬러그로. 예: claude-haiku-4-5-20251001 → anthropic/claude-haiku-4.5"""
    if "/" in model:
        return model
    base = _VERSION_TAIL.sub(r"-\1.\2", _DATE_SUFFIX.sub("", model))
    return f"anthropic/{base}"


_KEY_ENV = {"openrouter": "OPENROUTER_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}


def key_env() -> str:
    """현재 PROVIDER가 쓰는 API 키 환경변수 이름."""
    if PROVIDER not in _KEY_ENV:
        raise RuntimeError(f"알 수 없는 LLM_PROVIDER={PROVIDER!r} (openrouter | anthropic)")
    return _KEY_ENV[PROVIDER]


def _require_key() -> str:
    name = key_env()
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} 미설정 — LLM_PROVIDER={PROVIDER} 경로에 필요합니다.")
    return value


def chat_model(model: str, **kwargs) -> ChatAnthropic:
    key = _require_key()
    if PROVIDER == "anthropic":
        return ChatAnthropic(model=model, **kwargs)

    # provider는 Anthropic SDK 인자가 아니므로 extra_body로 요청 본문에 싣는다.
    model_kwargs = dict(kwargs.pop("model_kwargs", None) or {})
    model_kwargs["extra_body"] = {**(model_kwargs.get("extra_body") or {}), "provider": PROVIDER_ROUTING}
    return ChatAnthropic(
        model=to_openrouter_slug(model),
        base_url=OPENROUTER_BASE_URL,
        api_key=key,
        default_headers={"Authorization": f"Bearer {key}", "X-Title": APP_TITLE},
        model_kwargs=model_kwargs,
        **kwargs,
    )
