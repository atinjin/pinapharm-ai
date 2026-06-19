"""상담 회귀 평가 하네스 — 실제 그래프를 돌려 결정적으로 안전·행동을 판정한다."""
from dataclasses import dataclass, field

from langchain_core.messages import HumanMessage


@dataclass
class Observation:
    triage: str = ""
    tools_called: list[str] = field(default_factory=list)
    recommended_ids: list[int] = field(default_factory=list)
    response: str = ""
    error: str | None = None


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class Verdict:
    passed: bool
    checks: list["Check"]


def evaluate(obs: Observation, expect: dict) -> Verdict:
    checks: list[Check] = []
    if obs.error:
        checks.append(Check("실행", False, f"에러: {obs.error}"))
        return Verdict(False, checks)
    if "triage" in expect:
        ok = obs.triage == expect["triage"]
        checks.append(Check("triage", ok, f"기대={expect['triage']} 실제={obs.triage}"))
    for t in expect.get("tools_used", []):
        checks.append(Check(f"도구 호출:{t}", t in obs.tools_called, f"호출={obs.tools_called}"))
    for t in expect.get("tools_absent", []):
        checks.append(Check(f"도구 미호출:{t}", t not in obs.tools_called, f"호출={obs.tools_called}"))
    if "recommends" in expect:
        has = len(obs.recommended_ids) > 0
        checks.append(Check("추천", has == expect["recommends"], f"기대={expect['recommends']} ids={obs.recommended_ids}"))
    for s in expect.get("response_contains", []):
        checks.append(Check(f"응답 포함:{s}", s in obs.response))
    for s in expect.get("response_excludes", []):
        checks.append(Check(f"응답 제외:{s}", s not in obs.response))
    return Verdict(all(c.ok for c in checks), checks)
