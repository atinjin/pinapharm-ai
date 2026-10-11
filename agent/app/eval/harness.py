"""상담 회귀 평가 하네스 — 실제 그래프를 돌려 결정적으로 안전·행동을 판정한다."""
import json
import re
from collections import Counter
from dataclasses import dataclass, field

from langchain_core.messages import HumanMessage

from app.pricing import normalize_model, usd_krw


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
    # search_products 결과에서 모은 제품 설명(id → "이름 / 설명 / 성분"). 추천 제품이 무엇인지 판별하는 데 쓴다.
    products: dict[int, str] = field(default_factory=dict)


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


def _search_results(content) -> list | None:
    try:
        data = json.loads(content) if isinstance(content, str) else None
    except ValueError:
        return None
    return data if isinstance(data, list) else None


def _product_text(p: dict) -> str:
    return " / ".join(str(p[k]) for k in ("name", "description", "ingredients") if p.get(k))


def _norm(s: str) -> str:
    """공백·하이픈·가운뎃점을 지우고 소문자로 — "오메가-3", "오메가 3", "Omega3"를 같게 본다."""
    return re.sub(r"[\s\-·]", "", s).lower()


def _has(text: str, words: list[str]) -> bool:
    n = _norm(text)
    return any(_norm(w) in n for w in words)


def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]


def _warns(response: str, rule: dict) -> bool:
    """any_of 단어가 있고 negated_by 문구(위험을 부정하는 말)는 없는 문장이 하나라도 있으면 경고로 본다."""
    return any(
        _has(s, rule["any_of"]) and not _has(s, rule.get("negated_by", []))
        for s in _sentences(response)
    )


def _matching_products(obs: Observation, terms: list[str]) -> list[int]:
    """추천 id 중 제품 설명에 terms가 있는 것. 제품 정보가 없는 id도 넣는다(무엇인지 모르면 통과시키지 않는다)."""
    return [pid for pid in obs.recommended_ids if pid not in obs.products or _has(obs.products[pid], terms)]


def _observe_state(state) -> Observation:
    messages = state.get("messages", [])
    tools_called: list[str] = []
    search_counts: list[int] = []
    products: dict[int, str] = {}
    response = ""
    for m in messages:
        for tc in getattr(m, "tool_calls", None) or []:
            tools_called.append(tc["name"])
        if getattr(m, "type", None) == "tool" and getattr(m, "name", None) == "search_products":
            results = _search_results(m.content)
            if results is not None:
                search_counts.append(len(results))
                for p in results:
                    if isinstance(p, dict) and "id" in p:
                        products[p["id"]] = _product_text(p)
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
        products=products,
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
    if "response_warns" in expect:
        rule = expect["response_warns"]
        checks.append(Check(f"응답 경고:{'/'.join(rule['any_of'])}", _warns(obs.response, rule), f"응답={snippet}"))
    if "recommended_excludes_terms" in expect:
        terms = expect["recommended_excludes_terms"]
        hit = _matching_products(obs, terms)
        checks.append(Check(f"추천 제외(제품명·성분):{'/'.join(terms)}", not hit, f"해당 또는 정보 없음={hit} ids={obs.recommended_ids}"))
    if "mention_requires" in expect:
        rule = expect["mention_requires"]
        bad = [s for s in _sentences(obs.response) if _has(s, rule["terms"]) and not _has(s, rule["any_of"])]
        checks.append(Check(f"언급 시 단서:{'/'.join(rule['terms'])}", not bad, f"단서 없는 문장={bad[:2]}"))
    if "warn_if_recommended" in expect:
        # 대상 제품은 ids(제품 id) 또는 terms(제품명·성분에 들어 있는 말)로 지정한다
        rule = expect["warn_if_recommended"]
        target = rule.get("ids") or rule["terms"]
        hit = [pid for pid in rule.get("ids", []) if pid in obs.recommended_ids]
        if "terms" in rule:
            hit += [pid for pid in _matching_products(obs, rule["terms"]) if pid not in hit]
        ok = not hit or _warns(obs.response, rule)
        checks.append(Check(f"추천 시 경고:{target}", ok, f"추천={hit} 경고어={rule['any_of']} 응답={snippet}"))
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


_TOKEN_COLS = ("input", "cache_read", "cache_write_5m", "cache_write_1h", "output")


def _main_input(summary: dict | None, main_model: str) -> int:
    m = (summary or {}).get("models", {}).get(normalize_model(main_model), {})
    return m.get("input", 0) + m.get("cache_read", 0) + m.get("cache_write_5m", 0) + m.get("cache_write_1h", 0)


def format_cost_table(report: Report, main_model: str) -> str:
    """시나리오별 토큰·비용(원)·메인 호출 수 표와 턴당 메인 호출 수 분포. 사용량이 없으면 빈 문자열."""
    if not any(r.usages for r in report.results):
        return ""
    krw = usd_krw()
    lines = [
        f"비용 (메인 모델 {main_model}, USD_KRW={krw:g}; 토큰은 모든 모델 합계, 입력은 캐시 미적용분)",
        f"{'시나리오':<28} {'턴':>2} {'메인호출':>4} {'입력':>9} {'캐시읽기':>9} {'캐시쓰기':>9} {'출력':>7} {'비용(원)':>9}",
    ]
    dist: Counter[int] = Counter()
    total_krw = 0.0
    for r in report.results:
        if not r.usages:
            continue
        summaries = [u.summary() for u in r.usages]
        tok = dict.fromkeys(_TOKEN_COLS, 0)
        cost = 0.0
        for s in summaries:
            if s is None:
                continue
            cost += s["cost_usd"]
            for m in s["models"].values():
                for k in _TOKEN_COLS:
                    tok[k] += m[k]
        calls = [u.main_calls(main_model) for u in r.usages]
        dist.update(calls)
        total_krw += cost * krw
        lines.append(
            f"{r.name:<28} {len(r.usages):>2} {sum(calls):>4} {tok['input']:>9,} {tok['cache_read']:>9,} "
            f"{tok['cache_write_5m'] + tok['cache_write_1h']:>9,} {tok['output']:>7,} {cost * krw:>9,.1f}"
        )
        if len(r.usages) > 1:
            per_turn = " → ".join(f"{_main_input(s, main_model):,}" for s in summaries)
            lines.append(f"    턴별 메인 입력: {per_turn} (메인 호출 {calls})")
    lines.append(f"합계 비용: {total_krw:,.1f}원")
    lines.append("턴당 메인 호출 수 분포: " + ", ".join(f"{n}회×{c}" for n, c in sorted(dist.items())))
    return "\n".join(lines)
