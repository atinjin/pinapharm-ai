"""한 요청(사용자 턴) 동안의 LLM 사용량을 모델별로 모으는 콜백 핸들러."""
import threading
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, LLMResult

from app.pricing import cost_usd, normalize_model, split_input

_TOKEN_KEYS = ("input", "cache_read", "cache_write_5m", "cache_write_1h", "output")


class UsageCollector(BaseCallbackHandler):
    """on_llm_end마다 모델별 호출 수와 토큰을 누적한다. input은 캐시 미적용분이다."""

    def __init__(self) -> None:
        super().__init__()
        self._lock = threading.Lock()
        self._models: dict[str, dict[str, int]] = {}

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        try:
            gen = response.generations[0][0]
        except IndexError:
            return
        if not isinstance(gen, ChatGeneration) or not isinstance(gen.message, AIMessage):
            return
        usage = gen.message.usage_metadata
        meta = gen.message.response_metadata or {}
        model = meta.get("model_name") or meta.get("model")
        if not usage or not model:
            return
        parts = split_input(usage.get("input_tokens") or 0, usage.get("input_token_details"))
        row = {
            "input": parts["uncached"],
            "cache_read": parts["cache_read"],
            "cache_write_5m": parts["cache_write_5m"],
            "cache_write_1h": parts["cache_write_1h"],
            "output": usage.get("output_tokens") or 0,
        }
        key = normalize_model(model)
        with self._lock:
            acc = self._models.setdefault(key, {"calls": 0, **{k: 0 for k in _TOKEN_KEYS}})
            acc["calls"] += 1
            for k in _TOKEN_KEYS:
                acc[k] += row[k]

    def main_calls(self, model: str) -> int:
        return self._models.get(normalize_model(model), {}).get("calls", 0)

    def summary(self) -> dict | None:
        """{"cost_usd", "models": {model: {calls, input, cache_read, cache_write_5m, cache_write_1h, output, cost_usd}}}.
        집계가 없으면 None."""
        with self._lock:
            if not self._models:
                return None
            models = {}
            for name, acc in self._models.items():
                cost = cost_usd(
                    name,
                    uncached=acc["input"],
                    cache_read=acc["cache_read"],
                    cache_write_5m=acc["cache_write_5m"],
                    cache_write_1h=acc["cache_write_1h"],
                    output=acc["output"],
                )
                models[name] = {**acc, "cost_usd": cost}
        return {"cost_usd": sum(m["cost_usd"] for m in models.values()), "models": models}
