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
    checks: list[Check]


def _text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
            elif isinstance(block, str):
                parts.append(block)
        return "".join(parts)
    return str(content)


def _observe_state(state) -> Observation:
    messages = state.get("messages", [])
    tools_called: list[str] = []
    response = ""
    for m in messages:
        for tc in getattr(m, "tool_calls", None) or []:
            tools_called.append(tc["name"])
        if getattr(m, "type", None) == "ai":
            text = _text(getattr(m, "content", ""))
            if text:
                response = text
    return Observation(
        triage=state.get("triage", ""),
        tools_called=tools_called,
        recommended_ids=list(state.get("recommended_ids", [])),
        response=response,
    )


async def observe(graph, message: str, session_id: str) -> Observation:
    try:
        state = await graph.ainvoke(
            {"messages": [HumanMessage(content=message)], "recommended_ids": [], "tool_turns": 0, "triage": ""},
            config={"configurable": {"thread_id": session_id}},
        )
    except Exception as e:  # noqa: BLE001 — 한 시나리오 실패가 전체를 막지 않도록
        return Observation(error=type(e).__name__)
    return _observe_state(state)


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


@dataclass
class Result:
    name: str
    category: str
    verdict: Verdict


@dataclass
class Report:
    results: list[Result]

    @property
    def total(self) -> int:
        return len(self.results)

    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.verdict.passed)

    @property
    def failed(self) -> int:
        return self.total - self.passed

    @property
    def safety_failed(self) -> int:
        return sum(1 for r in self.results if r.category == "safety" and not r.verdict.passed)


async def run_eval(graph, scenarios) -> Report:
    results: list[Result] = []
    for i, sc in enumerate(scenarios):
        name = sc["name"]
        obs = await observe(graph, sc["message"], f"eval-{i}-{name}")
        verdict = evaluate(obs, sc.get("expect", {}))
        results.append(Result(name, sc.get("category", "behavior"), verdict))
    return Report(results)


def format_report(report: Report) -> str:
    lines: list[str] = []
    for r in report.results:
        mark = "PASS" if r.verdict.passed else "FAIL"
        lines.append(f"[{mark}] {r.name} ({r.category})")
        for c in r.verdict.checks:
            cm = "✓" if c.ok else "✗"
            suffix = f" — {c.detail}" if (c.detail and not c.ok) else ""
            lines.append(f"    {cm} {c.name}{suffix}")
    lines.append("")
    lines.append(f"합계: {report.passed}/{report.total} 통과, safety 실패 {report.safety_failed}")
    return "\n".join(lines)
