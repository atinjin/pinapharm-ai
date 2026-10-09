import pytest
from langchain_anthropic import ChatAnthropic

from app import llm


@pytest.mark.parametrize(
    "model, slug",
    [
        ("claude-opus-4-8", "anthropic/claude-opus-4.8"),
        ("claude-haiku-4-5-20251001", "anthropic/claude-haiku-4.5"),
        ("claude-sonnet-5-5", "anthropic/claude-sonnet-5.5"),
        ("anthropic/claude-opus-4.8", "anthropic/claude-opus-4.8"),
        ("openai/gpt-5", "openai/gpt-5"),
    ],
)
def test_to_openrouter_slug(model, slug):
    assert llm.to_openrouter_slug(model) == slug


def test_openrouter_chat_model(monkeypatch):
    monkeypatch.setattr(llm, "PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-or-key")
    m = llm.chat_model("claude-opus-4-8", max_tokens=1024)
    assert isinstance(m, ChatAnthropic)
    assert m.model == "anthropic/claude-opus-4.8"
    assert m.max_tokens == 1024
    assert m.anthropic_api_url == llm.OPENROUTER_BASE_URL
    assert m.anthropic_api_key.get_secret_value() == "test-or-key"
    assert m.default_headers["Authorization"] == "Bearer test-or-key"
    assert m.default_headers["X-Title"] == "PinaPharm"
    assert m.model_kwargs["extra_body"]["provider"] == llm.PROVIDER_ROUTING


def test_openrouter_merges_caller_model_kwargs(monkeypatch):
    monkeypatch.setattr(llm, "PROVIDER", "openrouter")
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-or-key")
    m = llm.chat_model(
        "claude-opus-4-8",
        model_kwargs={"custom_param": "x", "extra_body": {"foo": 1}},
    )
    assert m.model_kwargs["custom_param"] == "x"
    assert m.model_kwargs["extra_body"] == {"foo": 1, "provider": llm.PROVIDER_ROUTING}


def test_openrouter_missing_key_raises_at_call(monkeypatch):
    monkeypatch.setattr(llm, "PROVIDER", "openrouter")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="OPENROUTER_API_KEY"):
        llm.chat_model("claude-opus-4-8")


def test_anthropic_chat_model_unchanged(monkeypatch):
    monkeypatch.setattr(llm, "PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-ant-key")
    monkeypatch.delenv("ANTHROPIC_API_URL", raising=False)
    monkeypatch.delenv("ANTHROPIC_BASE_URL", raising=False)
    m = llm.chat_model("claude-haiku-4-5-20251001", max_tokens=10, temperature=0)
    assert m.model == "claude-haiku-4-5-20251001"
    assert m.anthropic_api_url == "https://api.anthropic.com"
    assert not m.default_headers
    assert "extra_body" not in m.model_kwargs


def test_anthropic_missing_key_raises_at_call(monkeypatch):
    monkeypatch.setattr(llm, "PROVIDER", "anthropic")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        llm.chat_model("claude-opus-4-8")


def test_unknown_provider_raises(monkeypatch):
    monkeypatch.setattr(llm, "PROVIDER", "bogus")
    with pytest.raises(RuntimeError, match="LLM_PROVIDER"):
        llm.chat_model("claude-opus-4-8")


@pytest.mark.parametrize(
    "provider, name", [("openrouter", "OPENROUTER_API_KEY"), ("anthropic", "ANTHROPIC_API_KEY")]
)
def test_key_env_follows_provider(monkeypatch, provider, name):
    monkeypatch.setattr(llm, "PROVIDER", provider)
    assert llm.key_env() == name


def test_callers_use_llm_chat_model(monkeypatch):
    from app import graph, planner, triage

    seen = []
    monkeypatch.setattr(llm, "chat_model", lambda model, **kw: seen.append((model, kw)) or "M")
    assert graph._chat_model() == "M"
    assert triage._model() == "M"
    assert planner._plan_model() == "M"
    assert seen == [
        (graph.MODEL, {"max_tokens": 2048}),
        (triage.TRIAGE_MODEL, {"max_tokens": 10, "temperature": 0}),
        (planner.PLAN_MODEL, {"max_tokens": 256, "temperature": 0}),
    ]
