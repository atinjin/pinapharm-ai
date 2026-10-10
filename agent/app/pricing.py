"""모델별 단가와 비용 계산. eval과 운영이 같은 함수를 쓰고, web은 계산된 cost_usd를 저장만 한다.

단가(USD / 1M 토큰) 출처: OpenRouter 모델 목록 API(https://openrouter.ai/api/v1/models)의 anthropic/* 값,
확인일 2026-10-10. OpenRouter 단가가 Anthropic 정가(https://www.anthropic.com/pricing)와 같음은
2026-10-09 OpenRouter 전환(PINAPM-13) 때 확인했다. 가격이 바뀌면 이 표만 고친다.
캐시 쓰기는 입력가 기준 배수(5분 ×1.25, 1시간 ×2)로 계산한다.
"""
import logging
import os

logger = logging.getLogger("agent.pricing")

WRITE_5M_MULT = 1.25
WRITE_1H_MULT = 2.0

# 키는 Anthropic 네이티브 ID의 접두어. 날짜가 붙은 ID(claude-haiku-4-5-20251001)도 접두어로 매칭한다.
PRICES: dict[str, dict[str, float]] = {
    "claude-fable-5-1": {"input": 10.0, "output": 50.0, "cache_read": 0.25},
    "claude-fable-5": {"input": 10.0, "output": 50.0, "cache_read": 1.0},
    "claude-opus-5-5": {"input": 4.0, "output": 20.0, "cache_read": 0.2},
    "claude-opus-5": {"input": 5.0, "output": 25.0, "cache_read": 0.5},
    "claude-sonnet-5-5": {"input": 2.0, "output": 10.0, "cache_read": 0.1},
    "claude-sonnet-5": {"input": 2.0, "output": 10.0, "cache_read": 0.2},
    "claude-haiku-5-5": {"input": 0.1, "output": 0.5, "cache_read": 0.01},
    "claude-opus-4-8": {"input": 5.0, "output": 25.0, "cache_read": 0.5},
    "claude-opus-4-7": {"input": 5.0, "output": 25.0, "cache_read": 0.5},
    "claude-opus-4-6": {"input": 5.0, "output": 25.0, "cache_read": 0.5},
    "claude-opus-4-5": {"input": 5.0, "output": 25.0, "cache_read": 0.5},
    "claude-opus-4-1": {"input": 15.0, "output": 75.0, "cache_read": 1.5},
    "claude-sonnet-4-6": {"input": 3.0, "output": 15.0, "cache_read": 0.3},
    "claude-sonnet-4-5": {"input": 3.0, "output": 15.0, "cache_read": 0.3},
    "claude-sonnet-4": {"input": 3.0, "output": 15.0, "cache_read": 0.3},
    "claude-haiku-4-5": {"input": 1.0, "output": 5.0, "cache_read": 0.1},
}

# 모르는 모델을 0이나 null로 계산하면 예산 합계에서 빠지므로 항목별 최고 단가로 계산한다
MAX_PRICE = {k: max(p[k] for p in PRICES.values()) for k in ("input", "output", "cache_read")}


def usd_krw() -> float:
    return float(os.environ.get("USD_KRW", "1400"))


def normalize_model(model: str) -> str:
    """OpenRouter 슬러그(anthropic/claude-opus-4.8)를 네이티브 ID 형식(claude-opus-4-8)으로."""
    return model.split("/", 1)[-1].replace(".", "-")


def price_for(model: str) -> dict[str, float]:
    name = normalize_model(model)
    best = None
    for key in PRICES:
        # 접두어는 세그먼트 경계에서만 인정한다(claude-opus-4-1 ≠ claude-opus-4-10)
        if (name == key or name.startswith(key + "-")) and (best is None or len(key) > len(best)):
            best = key
    if best is None:
        logger.warning("단가표에 없는 모델 %r — 최고 단가로 계산", model)
        return MAX_PRICE
    return PRICES[best]


def split_input(input_tokens: int, details: dict | None) -> dict[str, int]:
    """langchain input_tokens(캐시 포함 합계)를 캐시 미적용·읽기·5분 쓰기·1시간 쓰기로 나눈다.

    langchain-anthropic은 5m/1h 분해가 있으면 cache_creation을 0으로 둔다. 분해가 없을 때의
    cache_creation은 기본 TTL(5분) 쓰기로 본다. 그래서 둘을 더해도 이중 차감되지 않는다.
    """
    d = details or {}
    read = d.get("cache_read") or 0
    w5 = (d.get("ephemeral_5m_input_tokens") or 0) + (d.get("cache_creation") or 0)
    w1 = d.get("ephemeral_1h_input_tokens") or 0
    return {
        "uncached": max(input_tokens - read - w5 - w1, 0),
        "cache_read": read,
        "cache_write_5m": w5,
        "cache_write_1h": w1,
    }


def cost_usd(model: str, *, uncached: int, cache_read: int, cache_write_5m: int, cache_write_1h: int, output: int) -> float:
    p = price_for(model)
    total = (
        uncached * p["input"]
        + cache_read * p["cache_read"]
        + cache_write_5m * p["input"] * WRITE_5M_MULT
        + cache_write_1h * p["input"] * WRITE_1H_MULT
        + output * p["output"]
    )
    return total / 1_000_000
