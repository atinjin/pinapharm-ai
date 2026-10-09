"""상담 회귀 평가 하네스 — 실제 그래프를 돌려 결정적으로 안전·행동을 판정한다."""
import json
from dataclasses import dataclass, field

from langchain_core.messages import HumanMessage


@dataclass
class Observation:
    triage: str = ""
    tools_called: list[str] = field(default_factory=list)
    recommended_ids: list[int] = field(default_factory=list)
    response: str = ""
    error: str | None = None
    plan_steps: list[str] = field(default_factory=list)
    # search_products 결과(JSON 배열)마다의 제품 수. 오류 문구 결과는 세지 않는다.
    search_result_counts: list[int] = field(default_factory=list)


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


def _result_count(content) -> int | None:
    try:
        data = json.loads(content) if isinstance(content, str) else None
    except ValueError:
        return None
    return len(data) if isinstance(data, list) else None


def _observe_state(state) -> Observation:
    messages = state.get("messages", [])
    tools_called: list[str] = []
    search_counts: list[int] = []
    response = ""
    for m in messages:
        for tc in getattr(m, "tool_calls", None) or []:
            tools_called.append(tc["name"])
        if getattr(m, "type", None) == "tool" and getattr(m, "name", None) == "search_products":
            n = _result_count(m.content)
            if n is not None:
                search_counts.append(n)
        if getattr(m, "type", None) == "ai":
            text = _text(getattr(m, "content", ""))
            if text:
                response = text
    plan_steps = [s["title"] for s in state.get("plan", []) if isinstance(s, dict) and "title" in s]
    return Observation(
        triage=state.get("triage", ""),
        tools_called=tools_called,
        recommended_ids=list(state.get("recommended_ids", [])),
        response=response,
        plan_steps=plan_steps,
        search_result_counts=search_counts,
    )


async def observe(graph, message: str, session_id: str) -> Observation:
    try:
        state = await graph.ainvoke(
            {"messages": [HumanMessage(content=message)], "recommended_ids": [], "seen_product_ids": [], "tool_turns": 0, "triage": ""},
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
    snippet = obs.response[:80]
    for s in expect.get("response_contains", []):
        checks.append(Check(f"응답 포함:{s}", s in obs.response, f"응답={snippet}"))
    for s in expect.get("response_excludes", []):
        checks.append(Check(f"응답 제외:{s}", s not in obs.response, f"응답={snippet}"))
    for s in expect.get("plan_includes", []):
        checks.append(Check(f"계획 포함:{s}", any(s in t for t in obs.plan_steps), f"plan={obs.plan_steps}"))
    if expect.get("responds"):
        checks.append(Check("응답 있음", bool(obs.response.strip()), f"응답={snippet!r}"))
    if "response_contains_any" in expect:
        words = expect["response_contains_any"]
        checks.append(Check(f"응답 포함(하나 이상):{'/'.join(words)}", any(w in obs.response for w in words), f"응답={snippet}"))
    for pid in expect.get("recommended_excludes", []):
        checks.append(Check(f"추천 제외:{pid}", pid not in obs.recommended_ids, f"ids={obs.recommended_ids}"))
    if "warn_if_recommended" in expect:
        rule = expect["warn_if_recommended"]
        hit = [pid for pid in rule["ids"] if pid in obs.recommended_ids]
        ok = not hit or any(w in obs.response for w in rule["any_of"])
        checks.append(Check(f"추천 시 경고:{rule['ids']}", ok, f"추천={hit} 경고어={rule['any_of']} 응답={snippet}"))
    if "max_search_results" in expect:
        n = expect["max_search_results"]
        ok = all(c <= n for c in obs.search_result_counts)
        checks.append(Check(f"검색 결과 {n}개 이하", ok, f"결과 수={obs.search_result_counts}"))
    return Verdict(all(c.ok for c in checks), checks)


@dataclass
class Result:
    name: str
    category: str
    verdict: Verdict
    # 턴마다 usage_factory가 만든 수집기(run_eval에 factory를 줬을 때만)
    usages: list = field(default_factory=list)


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


async def run_eval(graph, scenarios, usage_factory=None) -> Report:
    """시나리오를 차례로 실행한다. turns가 있으면 같은 thread_id로 순서대로 보내고 마지막 턴을 판정한다.

    usage_factory를 주면 턴마다 새 수집기를 만들어 graph.with_config(callbacks=[...])로 붙인다.
    """
    results: list[Result] = []
    for i, sc in enumerate(scenarios):
        name = sc["name"]
        turns = sc.get("turns") or [sc["message"]]
        usages = []
        obs = Observation()
        for msg in turns:
            g = graph
            if usage_factory is not None:
                u = usage_factory()
                usages.append(u)
                g = graph.with_config(callbacks=[u])
            obs = await observe(g, msg, f"eval-{i}-{name}")
            if obs.error:
                break
        verdict = evaluate(obs, sc.get("expect", {}))
        results.append(Result(name, sc.get("category", "behavior"), verdict, usages))
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
