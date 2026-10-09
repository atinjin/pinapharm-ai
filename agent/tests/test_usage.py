import pytest
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, LLMResult

from app.pricing import cost_usd
from app.usage import UsageCollector


def _result(model, usage, key="model_name"):
    msg = AIMessage(content="x", usage_metadata=usage, response_metadata={key: model} if model else {})
    return LLMResult(generations=[[ChatGeneration(message=msg)]])


def _usage(inp, out, **details):
    return {"input_tokens": inp, "output_tokens": out, "total_tokens": inp + out, "input_token_details": details}


def test_empty_collector_summary_is_none():
    assert UsageCollector().summary() is None


def test_ignores_results_without_usage_or_model():
    c = UsageCollector()
    c.on_llm_end(LLMResult(generations=[[ChatGeneration(message=AIMessage(content="x"))]]))
    c.on_llm_end(_result(None, _usage(10, 1)))
    assert c.summary() is None


def test_accumulates_calls_and_tokens_per_model():
    c = UsageCollector()
    c.on_llm_end(_result("anthropic/claude-opus-4.8", _usage(
        1000, 100, cache_read=300, cache_creation=0, ephemeral_5m_input_tokens=200, ephemeral_1h_input_tokens=0)))
    c.on_llm_end(_result("anthropic/claude-opus-4.8", _usage(500, 50, cache_read=0)))
    c.on_llm_end(_result("claude-haiku-4-5-20251001", _usage(80, 2)))
    s = c.summary()
    opus = s["models"]["claude-opus-4-8"]
    assert opus == {
        "calls": 2, "input": 1000, "cache_read": 300, "cache_write_5m": 200, "cache_write_1h": 0,
        "output": 150,
        "cost_usd": pytest.approx(cost_usd("claude-opus-4-8", uncached=1000, cache_read=300,
                                          cache_write_5m=200, cache_write_1h=0, output=150)),
    }
    assert s["models"]["claude-haiku-4-5-20251001"]["calls"] == 1
    assert s["cost_usd"] == pytest.approx(sum(m["cost_usd"] for m in s["models"].values()))


def test_main_calls_returns_calls_of_given_model():
    c = UsageCollector()
    for _ in range(3):
        c.on_llm_end(_result("anthropic/claude-opus-4.8", _usage(10, 1)))
    c.on_llm_end(_result("anthropic/claude-haiku-4.5", _usage(10, 1)))
    assert c.main_calls("claude-opus-4-8") == 3
    assert c.main_calls("anthropic/claude-opus-4.8") == 3


def test_reads_model_key_when_model_name_missing():
    c = UsageCollector()
    c.on_llm_end(_result("claude-opus-4-8", _usage(10, 1), key="model"))
    assert "claude-opus-4-8" in c.summary()["models"]
