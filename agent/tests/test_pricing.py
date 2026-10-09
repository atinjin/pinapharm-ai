import logging

import pytest

from app import pricing
from app.pricing import cost_usd, price_for, normalize_model


def test_normalize_strips_openrouter_prefix_and_dots():
    assert normalize_model("anthropic/claude-opus-4.8") == "claude-opus-4-8"
    assert normalize_model("claude-haiku-4-5-20251001") == "claude-haiku-4-5-20251001"


def test_price_for_exact_and_openrouter_ids_match():
    assert price_for("claude-opus-4-8") == price_for("anthropic/claude-opus-4.8")
    assert price_for("claude-opus-4-8")["input"] == 5.0


def test_price_for_dated_id_matches_prefix():
    assert price_for("claude-haiku-4-5-20251001") == pricing.PRICES["claude-haiku-4-5"]


def test_price_for_prefers_longest_prefix():
    # claude-sonnet-4와 claude-sonnet-4-5가 둘 다 접두어지만 더 긴 쪽을 써야 한다
    assert price_for("claude-sonnet-4-5-20250929") == pricing.PRICES["claude-sonnet-4-5"]


def test_price_for_requires_segment_boundary():
    # claude-opus-4-1은 claude-opus-4-10의 접두어가 아니다(모르는 모델 취급)
    assert price_for("claude-opus-4-10") == pricing.MAX_PRICE


def test_unknown_model_uses_max_price_and_warns(caplog):
    with caplog.at_level(logging.WARNING, logger="agent.pricing"):
        p = price_for("gpt-9")
    assert p == pricing.MAX_PRICE
    assert p["input"] == max(v["input"] for v in pricing.PRICES.values())
    assert p["output"] == max(v["output"] for v in pricing.PRICES.values())
    assert "gpt-9" in caplog.text


def test_cost_uncached_and_output():
    # Opus 4.8: 입력 $5, 출력 $25 / MTok
    c = cost_usd("claude-opus-4-8", uncached=1_000_000, cache_read=0, cache_write_5m=0, cache_write_1h=0, output=1_000_000)
    assert c == pytest.approx(30.0)


def test_cost_cache_read_and_writes_distinguish_5m_1h():
    m = "claude-opus-4-8"
    read = cost_usd(m, uncached=0, cache_read=1_000_000, cache_write_5m=0, cache_write_1h=0, output=0)
    w5 = cost_usd(m, uncached=0, cache_read=0, cache_write_5m=1_000_000, cache_write_1h=0, output=0)
    w1 = cost_usd(m, uncached=0, cache_read=0, cache_write_5m=0, cache_write_1h=1_000_000, output=0)
    assert read == pytest.approx(0.5)
    assert w5 == pytest.approx(5.0 * 1.25)
    assert w1 == pytest.approx(5.0 * 2)


def test_uncached_tokens_subtracts_cache_without_double_counting():
    # OpenRouter·langchain-anthropic: 5m/1h 분해가 있으면 cache_creation은 0으로 온다
    details = {"cache_read": 300, "cache_creation": 0, "ephemeral_5m_input_tokens": 200, "ephemeral_1h_input_tokens": 100}
    assert pricing.split_input(1000, details) == {"uncached": 400, "cache_read": 300, "cache_write_5m": 200, "cache_write_1h": 100}


def test_uncached_tokens_treats_undivided_cache_creation_as_5m():
    details = {"cache_read": 0, "cache_creation": 250}
    assert pricing.split_input(1000, details) == {"uncached": 750, "cache_read": 0, "cache_write_5m": 250, "cache_write_1h": 0}


def test_uncached_tokens_handles_missing_details():
    assert pricing.split_input(42, None) == {"uncached": 42, "cache_read": 0, "cache_write_5m": 0, "cache_write_1h": 0}
