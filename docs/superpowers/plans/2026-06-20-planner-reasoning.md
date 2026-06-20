# 다단계 추론 — 명시적 플래너(안 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `triage` 다음에 명시적 플래너 노드를 두어 짧은 상담 계획을 세우고, 그 계획을 ① 새 SSE `event:"plan"`으로 채팅에 노출하고 ② 기존 agent 루프의 시스템 프롬프트에 체크리스트로 주입해 안내한다.

**Architecture:** 정상 경로 `START → triage → plan → agent⇄tools → finalize/END`(응급 경로 불변). 기존 루프·추천 파이프라인 재사용. 계획 수립 실패 시 빈 계획으로 폴백(상담 차단 없음). pytest는 cheap 모델/`make_plan`을 패치해 무료·결정적 유지.

**Tech Stack:** Python 3.13, langgraph, langchain-anthropic(Haiku for planner), pytest(asyncio auto); web Next.js/React/Zustand, vitest.

## Global Constraints

- 에이전트는 DB 직접 접근 금지 — 기존 web 내부 API 경로 그대로. 추천 파이프라인(`recommended_ids`·`recommendations` SSE·카드) 불변.
- `parse_plan`/`make_plan`은 절대 raise 금지 — 어떤 오류든 빈 계획 `[]` 폴백. 빈 계획 ⇒ `## 상담 계획` 블록 없음 ⇒ 루프는 현행과 동일.
- AgentState의 `plan` 접근은 항상 `state.get("plan")`(초기 입력에 없을 수 있음).
- 플래너 SSE는 **단계 title 문자열 리스트만** 클라이언트에 노출. 전체 step dict(tool 포함)는 state로만.
- 정상경로 그래프/스트림 테스트는 반드시 `make_plan`을 패치(실제 네트워크/키 호출 방지).
- pytest는 `agent/`에서 `.venv/bin/pytest`; 커밋 메시지 말미 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: `parse_plan` 관용 파서 + `PLAN_SYSTEM` 프롬프트

**Files:** Create `agent/app/planner.py`; Modify `agent/app/prompts.py`; Test `agent/tests/test_planner.py`

**Interfaces (produces):**
- `PLAN_SYSTEM: str` (in `prompts.py`)
- `parse_plan(text: str) -> list[dict]` — `{"title": str, "tool": str|None}`; 오류/비배열 → `[]`; title 없으면 드롭; tool은 알려진 5개 아니면 None; 최대 6단계.

- [ ] **Step 1: 실패 테스트** — `agent/tests/test_planner.py`:
```python
from app.planner import parse_plan

def test_parse_plan_happy():
    text = '[{"title":"건강 프로필 확인","tool":"get_health_profile"},{"title":"제품 검색","tool":"search_products"}]'
    assert parse_plan(text) == [
        {"title": "건강 프로필 확인", "tool": "get_health_profile"},
        {"title": "제품 검색", "tool": "search_products"},
    ]

def test_parse_plan_tolerates_prose_wrapper():
    assert parse_plan('```json\n[{"title":"증상 정리","tool":null}]\n```') == [{"title": "증상 정리", "tool": None}]

def test_parse_plan_unknown_tool_becomes_null():
    assert parse_plan('[{"title":"x","tool":"made_up"}]') == [{"title": "x", "tool": None}]

def test_parse_plan_garbage_returns_empty():
    assert parse_plan("이건 JSON이 아니에요") == []
    assert parse_plan("") == []

def test_parse_plan_drops_titleless_entries():
    assert parse_plan('[{"tool":"search_products"},{"title":"좋아"}]') == [{"title": "좋아", "tool": None}]

def test_parse_plan_caps_length():
    big = "[" + ",".join('{"title":"s%d"}' % i for i in range(20)) + "]"
    assert len(parse_plan(big)) <= 6
```

- [ ] **Step 2: 실패 확인** — `cd agent && .venv/bin/pytest tests/test_planner.py -q` → ModuleNotFoundError.

- [ ] **Step 3: 구현** — `agent/app/prompts.py` 끝에 추가:
```python
PLAN_SYSTEM = (
    "너는 약국 상담의 계획 수립기다. 상담자 메시지를 보고, 맑은 약사가 따를 "
    "짧은 상담 계획을 한국어로 세운다. 출력은 오직 JSON 배열만, 다른 말은 절대 하지 마라. "
    "각 원소는 {\"title\": \"단계 설명\", \"tool\": 도구명 또는 null}. "
    "tool은 다음 중 하나이거나 null이다: search_products, get_health_profile, "
    "save_health_profile, load_consultation_skill, retrieve_knowledge. "
    "단계는 최대 5개로 간결하게. 진단·단정은 하지 않는다."
)
```
`agent/app/planner.py`:
```python
import json
import re

from app.prompts import PLAN_SYSTEM

KNOWN_TOOLS = {
    "search_products", "get_health_profile", "save_health_profile",
    "load_consultation_skill", "retrieve_knowledge",
}
MAX_STEPS = 6


def _coerce(step) -> dict | None:
    if not isinstance(step, dict):
        return None
    title = step.get("title")
    if not isinstance(title, str) or not title.strip():
        return None
    tool = step.get("tool")
    return {"title": title.strip(), "tool": tool if tool in KNOWN_TOOLS else None}


def parse_plan(text: str) -> list[dict]:
    """모델 출력에서 계획 단계 리스트를 관용적으로 추출한다. 실패 시 빈 리스트."""
    if not text:
        return []
    try:
        data = json.loads(text)
    except Exception:
        m = re.search(r"\[.*\]", text, re.DOTALL)
        if not m:
            return []
        try:
            data = json.loads(m.group(0))
        except Exception:
            return []
    if not isinstance(data, list):
        return []
    return [s for s in (_coerce(x) for x in data) if s][:MAX_STEPS]
```
(`PLAN_SYSTEM`은 `prompts.py`에 정의하고 `planner.py`는 import — 단일 소스.)

- [ ] **Step 4: 통과 확인** — `.venv/bin/pytest tests/test_planner.py -q` → 6 passed.
- [ ] **Step 5: 커밋** — `feat(agent): tolerant plan parser + PLAN_SYSTEM prompt`

---

### Task 2: `_plan_model` + `make_plan` (cheap Haiku, triage 패턴)

**Files:** Modify `agent/app/planner.py`; Test `agent/tests/test_planner.py`

**Interfaces (produces):**
- `_plan_model() -> ChatAnthropic` (Haiku, max_tokens=256, temperature=0)
- `async make_plan(message: str) -> list[dict]` — `get_config()`→`cfg.get("planPrompt") or PLAN_SYSTEM`→`.ainvoke`→`parse_plan`; 예외→`[]`.

- [ ] **Step 1: 실패 테스트** — `tests/test_planner.py`에 추가:
```python
from unittest.mock import AsyncMock, patch
from langchain_core.messages import AIMessage
from app.planner import make_plan

async def test_make_plan_parses_model_json():
    fake = AsyncMock()
    fake.ainvoke = AsyncMock(return_value=AIMessage(content='[{"title":"제품 검색","tool":"search_products"}]'))
    with patch("app.planner._plan_model", return_value=fake), \
         patch("app.planner.get_config", new=AsyncMock(return_value={})):
        assert await make_plan("피곤해요") == [{"title": "제품 검색", "tool": "search_products"}]

async def test_make_plan_uses_config_planPrompt_override():
    seen = {}
    async def cfg(): return {"planPrompt": "CUSTOM-PLAN"}
    fake = AsyncMock()
    async def cap(msgs):
        seen["system"] = msgs[0].content
        return AIMessage(content="[]")
    fake.ainvoke = AsyncMock(side_effect=cap)
    with patch("app.planner._plan_model", return_value=fake), patch("app.planner.get_config", new=cfg):
        await make_plan("안녕")
    assert seen["system"] == "CUSTOM-PLAN"

async def test_make_plan_failure_returns_empty():
    fake = AsyncMock()
    fake.ainvoke = AsyncMock(side_effect=RuntimeError("boom"))
    with patch("app.planner._plan_model", return_value=fake), \
         patch("app.planner.get_config", new=AsyncMock(return_value={})):
        assert await make_plan("x") == []
```

- [ ] **Step 2: 실패 확인** — `make_plan`/`_plan_model` 미정의.
- [ ] **Step 3: 구현** — `planner.py` 상단 import + 본문 추가:
```python
import logging
import os

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import SystemMessage, HumanMessage

from app.config_client import get_config

logger = logging.getLogger("agent.planner")
PLAN_MODEL = os.environ.get("PLAN_MODEL", "claude-haiku-4-5-20251001")


def _plan_model() -> ChatAnthropic:
    return ChatAnthropic(model=PLAN_MODEL, max_tokens=256, temperature=0)


async def make_plan(message: str) -> list[dict]:
    """상담 계획(단계 리스트)을 세운다. 실패 시 빈 리스트(무가이드 진행)."""
    try:
        cfg = await get_config()
        system = cfg.get("planPrompt") or PLAN_SYSTEM
        resp = await _plan_model().ainvoke([SystemMessage(content=system), HumanMessage(content=message)])
        text = resp.content if isinstance(resp.content, str) else str(resp.content)
        return parse_plan(text)
    except Exception:
        logger.exception("계획 수립 실패 — 빈 계획으로 폴백")
        return []
```
- [ ] **Step 4: 통과 확인** — `.venv/bin/pytest tests/test_planner.py -q` → 9 passed.
- [ ] **Step 5: 커밋** — `feat(agent): make_plan via cheap Haiku model with planPrompt override`

---

### Task 3: `planPrompt` 폴백 in DEFAULT_CONFIG

**Files:** Modify `agent/app/config_client.py`; Test `agent/tests/test_config_client.py` (없으면 생성)

**Interfaces:** `DEFAULT_CONFIG["planPrompt"] == PLAN_SYSTEM`.

- [ ] **Step 1: 실패 테스트** — `agent/tests/test_config_client.py`(없으면 생성):
```python
from app.config_client import DEFAULT_CONFIG
from app.prompts import PLAN_SYSTEM

def test_default_config_has_plan_prompt():
    assert DEFAULT_CONFIG["planPrompt"] == PLAN_SYSTEM
```
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — `config_client.py`의 prompts import에 `PLAN_SYSTEM` 추가, `DEFAULT_CONFIG`에 `"planPrompt": PLAN_SYSTEM,` 추가.
- [ ] **Step 4: 통과 확인.**
- [ ] **Step 5: 커밋** — `feat(agent): planPrompt fallback in DEFAULT_CONFIG`

---

### Task 4: `plan_node` + 그래프 배선 + 프롬프트 주입 (핵심)

**Files:** Modify `agent/app/graph.py`; Test `agent/tests/test_graph.py`

**Interfaces (produces/consumes):**
- consumes `make_plan` (Task 2). `AgentState` += `plan: list`.
- `plan_node(state)->dict` (emits custom `{"type":"plan","steps":[titles]}`, returns `{"plan":steps}`).
- `_plan_checklist(state)->str`. `route_triage`→`Literal["plan","emergency"]`. `build_graph` 배선: node `plan`, triage map `{"plan":"plan","emergency":"emergency"}`, edge `plan→agent`.

- [ ] **Step 1: 실패 테스트** — `tests/test_graph.py`에 추가(기존 `_model`/`_collect`/`_ai`/`MagicMock` 재사용):
```python
async def test_plan_node_emits_plan_event_and_stores_state():
    fake_model = _model([_ai(text="도와드릴게요.")])
    plan = [{"title": "건강 프로필 확인", "tool": "get_health_profile"},
            {"title": "제품 검색", "tool": "search_products"}]
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph.make_plan", new=AsyncMock(return_value=plan)), \
         patch("app.graph._chat_model", return_value=fake_model):
        graph = build_graph(MemorySaver())
        events = await _collect(graph, "피곤해요")
    customs = [c for m, c in events if m == "custom"]
    assert any(c.get("type") == "plan" and c["steps"] == ["건강 프로필 확인", "제품 검색"] for c in customs)
    final = [c for m, c in events if m == "values"][-1]
    assert final["plan"] == plan

async def test_plan_injected_into_agent_system_prompt():
    captured = {}
    async def cap_invoke(msgs):
        captured["system"] = msgs[0].content
        return _ai(text="네.")
    fake_model = AsyncMock(); fake_model.ainvoke = AsyncMock(side_effect=cap_invoke)
    fake_model.bind_tools = MagicMock(return_value=fake_model)
    plan = [{"title": "근거 검색", "tool": "retrieve_knowledge"}]
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph.make_plan", new=AsyncMock(return_value=plan)), \
         patch("app.graph._chat_model", return_value=fake_model):
        graph = build_graph(MemorySaver()); await _collect(graph, "오메가3 안전한가요")
    assert "## 상담 계획" in captured["system"] and "근거 검색" in captured["system"]

async def test_empty_plan_runs_loop_unguided():
    fake_model = _model([_ai(text="네, 도와드릴게요.")])
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph.make_plan", new=AsyncMock(return_value=[])), \
         patch("app.graph._chat_model", return_value=fake_model):
        graph = build_graph(MemorySaver()); events = await _collect(graph, "안녕하세요")
    customs = [c for m, c in events if m == "custom"]
    plan_evts = [c for c in customs if c.get("type") == "plan"]
    assert plan_evts and plan_evts[0]["steps"] == []
    final = [c for m, c in events if m == "values"][-1]
    assert "도와드릴게요" in final["messages"][-1].content

async def test_emergency_skips_plan_node():
    with patch("app.triage.classify", new=AsyncMock(return_value="emergency")), \
         patch("app.graph.make_plan", new=AsyncMock()) as mk:
        graph = build_graph(MemorySaver()); events = await _collect(graph, "가슴이 너무 아프고 숨이 안 쉬어져요")
    mk.assert_not_called()
    customs = [c for m, c in events if m == "custom"]
    assert any(c.get("type") == "emergency" for c in customs)
    assert not any(c.get("type") == "plan" for c in customs)
```
**그리고 기존 정상경로 5개 테스트**(`test_normal_flow_runs_tool_then_answers`, `test_recommended_ids_dedup_across_turns`, 그 외 normal triage를 쓰는 것들)의 `with` 블록에 `patch("app.graph.make_plan", new=AsyncMock(return_value=[]))`를 추가한다. (응급 테스트·`tools_node` 직접호출 테스트는 무관.)

- [ ] **Step 2: 실패 확인** — 신규 실패 + 패치 전 기존 정상경로 실패.
- [ ] **Step 3: 구현** — `graph.py`:
  - import: `from app.planner import make_plan`.
  - `AgentState`에 `plan: list` 추가.
  - `route_triage`: 시그니처 `-> Literal["plan", "emergency"]`; `return "emergency" if state.get("triage") == "emergency" else "plan"`.
  - 신규:
```python
async def plan_node(state: AgentState) -> dict:
    steps = await make_plan(_last_human_text(state))
    writer = get_stream_writer()
    writer({"type": "plan", "steps": [s["title"] for s in steps]})
    return {"plan": steps}


def _plan_checklist(state: AgentState) -> str:
    steps = state.get("plan") or []
    if not steps:
        return ""
    lines = ["## 상담 계획", "아래 계획을 참고하되, 대화 흐름에 맞게 유연하게 진행하세요(체크리스트, 강제 아님):"]
    for s in steps:
        hint = f" (도구: {s['tool']})" if s.get("tool") else ""
        lines.append(f"- {s['title']}{hint}")
    return "\n".join(lines)
```
  - `agent_node`/`finalize_node`: `system = build_system_prompt(cfg)` 다음에 `checklist = _plan_checklist(state)` / `if checklist: system = f"{system}\n\n{checklist}"`.
  - `build_graph`: `g.add_node("plan", plan_node)`; 기존 triage 조건엣지 맵을 `{"plan": "plan", "emergency": "emergency"}`로; `g.add_edge("plan", "agent")`.
- [ ] **Step 4: 통과 확인** — `.venv/bin/pytest tests/test_graph.py -q` → 전체 green.
- [ ] **Step 5: 커밋** — `feat(agent): plan node guides loop via system-prompt checklist + plan SSE custom event`

---

### Task 5: `stream_events` plan 이벤트 노출

**Files:** Modify `agent/app/agent.py`; Test `agent/tests/test_agent.py`

**Interfaces:** custom 분기에 `elif t == "plan"` 추가 → `event:"plan"`, `{"steps":[...]}`. `_STREAM_NODES` 불변.

- [ ] **Step 1: 실패 테스트** — `tests/test_agent.py`에 추가:
```python
async def test_stream_events_emits_plan_before_tokens():
    fake_model = _model([_ai(text="도와드릴게요.")])
    plan = [{"title": "증상 정리", "tool": None}]
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph.make_plan", new=AsyncMock(return_value=plan)), \
         patch("app.graph._chat_model", return_value=fake_model):
        graph = build_graph(MemorySaver())
        events = [e async for e in stream_events(graph, "피곤해요", "sPlan")]
    types = [e["event"] for e in events]
    assert "plan" in types
    assert json.loads(next(e for e in events if e["event"] == "plan")["data"])["steps"] == ["증상 정리"]
    assert types.index("plan") < types.index("token")
    assert types[-1] == "done"
```
기존 정상경로 test_agent 테스트(`test_stream_events_emits_recommendations_and_done` 등)에 `patch("app.graph.make_plan", new=AsyncMock(return_value=[]))` 추가(응급 테스트는 무관).

- [ ] **Step 2: 실패 확인** — plan 이벤트 누락.
- [ ] **Step 3: 구현** — `agent.py` custom 분기, emergency 다음에:
```python
elif t == "plan":
    yield {"event": "plan", "data": json.dumps({"steps": chunk["steps"]})}
```
- [ ] **Step 4: 통과 확인** — `.venv/bin/pytest tests/test_agent.py -q` → green.
- [ ] **Step 5: 회귀** — `.venv/bin/pytest -q`(에이전트 전체) green.
- [ ] **Step 6: 커밋** — `feat(agent): surface plan as SSE event:"plan"`

---

### Task 6: 웹 스토어 `plan`/`setPlan` + ChatPanel 렌더

**Files:** Modify `web/src/components/store/StoreProvider.tsx`, `web/src/components/store/ChatPanel.tsx`

**Interfaces:** store `plan: string[]|null` + `setPlan(steps: string[])`. ChatPanel: `plan` 이벤트 파싱 + `PlanBlock` 렌더 + `stream()` 시작 `setPlan([])`.

- [ ] **Step 1: 스토어** — `StoreProvider.tsx`에 `matchedIds`/`setRecommended` 패턴대로:
  - 타입: `plan: string[] | null;`, `setPlan: (steps: string[]) => void;`
  - 상태: `const [plan, setPlanState] = useState<string[] | null>(null);`
  - 콜백: `const setPlan = useCallback((steps: string[]) => setPlanState(steps), []);`
  - value 객체에 `plan, setPlan` 추가.
- [ ] **Step 2: ChatPanel** — `useStore()`에서 `setPlan, plan` 구조분해; `stream()` 시작부에 `setPlan([])`; SSE 루프에 recommendations 분기 옆:
```ts
} else if (ev.event === "plan") {
  const steps = JSON.parse(ev.data).steps;
  if (Array.isArray(steps) && steps.length > 0) setPlan(steps);
}
```
  - 컴포넌트(파일 내):
```tsx
function PlanBlock({ steps }: { steps: string[] }) {
  return (
    <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-slate-600">
        <span className="spark flex h-5 w-5 items-center justify-center rounded-full text-[10px] text-white">✦</span>
        상담 계획
      </div>
      <ol className="ml-1 list-decimal space-y-0.5 pl-4 text-[13px] text-slate-600">
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
    </div>
  );
}
```
  - 어시스턴트 분기에서 마지막 메시지 위에: `{m.role === "assistant" && i === messages.length - 1 && plan && plan.length > 0 && <PlanBlock steps={plan} />}` (`.chat-md` 위).
- [ ] **Step 3: 검증** — `cd web && npm test`(회귀 green) + `npm run build` 또는 `tsc --noEmit`로 컴파일 확인.
- [ ] **Step 4: 커밋** — `feat(web): render 상담 계획 block + handle plan SSE event`

---

### Task 7: 웹 프록시 통과·미영속 특성 테스트

**Files:** Modify `web/tests/agentStream.test.ts`(+선택 `web/tests/chat.test.ts`). route.ts/agentStream.ts 변경 없음.

- [ ] **Step 1: 테스트 추가** — `agentStream.test.ts`:
```ts
it("plan 이벤트는 무시한다(텍스트·ids에 영향 없음)", () => {
  const raw =
    'event: plan\ndata: {"steps":["증상 정리","제품 검색"]}\n\n' +
    'event: token\ndata: {"text":"안녕"}\n\n' +
    'event: recommendations\ndata: {"ids":[5]}\n\n';
  expect(extractFromSSE(raw)).toEqual({ text: "안녕", ids: [5] });
});
```
(선택) `chat.test.ts`의 `sseFrames` 앞에 `event: plan\ndata: {"steps":["증상 정리"]}\n\n` 프레임을 추가하고, 저장된 어시스턴트 메시지가 여전히 토큰만(plan 미포함)인지 확인.
- [ ] **Step 2: 통과 확인** — `cd web && npm test` → green(현행 동작이 옳음을 고정하는 특성 테스트).
- [ ] **Step 3: 커밋** — `test(web): plan event passes through proxy, excluded from persistence`

---

### Task 8: eval `plan_steps` 관측 + `plan_includes` 규칙 + 시나리오

**Files:** Modify `agent/app/eval/harness.py`, `agent/app/eval/scenarios.py`; Test `agent/tests/test_eval.py`

**Interfaces:** `Observation.plan_steps: list[str]`; `_observe_state`가 state["plan"] title 추출; `evaluate`에 `plan_includes` 규칙; `scenarios.py`에 behavior 시나리오 1개.

- [ ] **Step 1: 실패 테스트** — `tests/test_eval.py`에 추가:
```python
def test_observe_state_extracts_plan_steps():
    state = {"triage": "normal", "recommended_ids": [],
             "plan": [{"title": "건강 프로필 확인", "tool": "get_health_profile"},
                      {"title": "제품 검색", "tool": "search_products"}],
             "messages": [AIMessage(content="추천드려요.")]}
    assert _observe_state(state).plan_steps == ["건강 프로필 확인", "제품 검색"]

def test_evaluate_plan_includes_pass_and_fail():
    obs = Observation(plan_steps=["증상 정리", "제품 검색"])
    assert evaluate(obs, {"plan_includes": ["검색"]}).passed
    assert not evaluate(obs, {"plan_includes": ["근거"]}).passed

def test_observe_state_missing_plan_is_empty():
    assert _observe_state({"messages": [AIMessage(content="x")]}).plan_steps == []
```
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** —
  - `harness.py`: `Observation`에 `plan_steps: list[str] = field(default_factory=list)`. `_observe_state`에 `plan_steps=[s["title"] for s in state.get("plan", []) if isinstance(s, dict) and "title" in s]` 추가해 Observation에 전달. `evaluate`에 추가:
```python
    for s in expect.get("plan_includes", []):
        checks.append(Check(f"계획 포함:{s}", any(s in t for t in obs.plan_steps), f"plan={obs.plan_steps}"))
```
  - `scenarios.py`: behavior 시나리오 1개 추가(예: name `"plan_recommend"`, message 추천 요청, `expect: {"plan_includes": ["검색"]}`). 이름 중복 없게.
- [ ] **Step 4: 통과 확인** — `.venv/bin/pytest tests/test_eval.py -q` → green(기존 + 신규, 시나리오 구조 테스트도).
- [ ] **Step 5: 커밋** — `feat(eval): plan_steps observation + plan_includes rule + scenario`

---

### Task 9: 문서 — ROADMAP 갱신

**Files:** Modify `docs/ROADMAP.md`

- [ ] **Step 1:** D 섹션 `- [ ] 멀티에이전트 / 다단계 추론` → `- [x] 다단계 추론 — 명시적 플래너(계획 노드)로 단계 계획 수립·채팅 노출·시스템 프롬프트 주입. 설계/플랜 링크.` (멀티에이전트 잔여가 있으면 별도 미체크 라인 유지.)
- [ ] **Step 2:** 이중 DEFAULTS 메모(약 112줄)에 한 줄 추가: `planPrompt`는 현재 **agent 단일 소스**(`prompts.PLAN_SYSTEM`/`DEFAULT_CONFIG`)이며 web `agentConfig.ts`/`agent-config` 라우트엔 미반영 — 추후 어드민 UI 도입 시 동기화 확장 필요.
- [ ] **Step 3: 커밋** — `docs: mark 다단계 추론 planner done; note planPrompt agent-only gap`

---

## Self-Review

- 그래프 배선(triage→{plan,emergency}, plan→agent) — Task 4 ✅
- plan SSE 이벤트(노드 emit + stream_events 분기) — Task 4·5 ✅
- 계획 주입(시스템 프롬프트 체크리스트) — Task 4 ✅
- 관용 파서 + graceful 빈 계획 — Task 1·2 ✅
- 추천 파이프라인 보존 — 변경 없음(Task 4 주: tools_node 불변) ✅
- 웹 노출(스토어+ChatPanel) + 통과/미영속 — Task 6·7 ✅
- eval 확장 — Task 8 ✅
- 문서/갭 메모 — Task 9 ✅
- 정상경로 테스트 `make_plan` 패치 필수(네트워크 방지) — Task 4·5에 명시 ✅
- 타입/이름 일관: `plan`/`plan_steps`/`plan_includes`/`PLAN_SYSTEM`/`make_plan`/`_plan_checklist` 태스크 간 일치 ✅
