# LangGraph 에이전트 전환 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 손으로 짠 while 루프 에이전트를 LangGraph `StateGraph`로 전환하면서 세션 메모리, 응급 triage, SSE 이벤트 전송, 답변 유실 해소를 함께 도입한다.

**Architecture:** `langchain_anthropic.ChatAnthropic`를 노드에서 호출하는 `StateGraph`(triage→agent⇄tools, finalize, emergency). SQLite checkpointer로 `session_id`별 대화를 영속화하고, `graph.astream(stream_mode=["messages","custom"])`을 타입 있는 SSE 이벤트로 매핑한다. 추천 제품 ID는 커스텀 tools 노드가 `get_stream_writer()`로 즉시 emit한다.

**Tech Stack:** Python 3.13, FastAPI, langgraph 1.2.5, langchain-anthropic 1.4.6, langgraph-checkpoint-sqlite, sse-starlette / Next.js(웹 클라이언트)

**검증된 API 사실 (구현 시 신뢰할 것):**
- `graph.astream(input, config, stream_mode=["messages","custom"])` → `(mode, chunk)` 튜플을 yield.
  - `mode == "messages"`: `chunk == (AIMessageChunk, metadata)`. `metadata["langgraph_node"]`로 어느 노드의 토큰인지 식별 → `agent`/`finalize`만 사용자에게 전달(triage Haiku 토큰 차단).
  - `mode == "custom"`: `chunk`는 노드가 `get_stream_writer()(obj)`로 보낸 객체 그대로.
- import 경로: `from langgraph.graph import StateGraph, START, END`, `from langgraph.graph.message import add_messages`, `from langgraph.config import get_stream_writer`, `from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver`, `from langgraph.checkpoint.memory import MemorySaver`, `from langchain_anthropic import ChatAnthropic`, `from langchain_core.messages import HumanMessage, AIMessage, ToolMessage, SystemMessage`, `from langchain_core.tools import tool`.
- `AsyncSqliteSaver.from_conn_string(path)`는 async context manager(`async with ... as saver`).
- `@tool` 함수는 **반드시 docstring**이 있어야 한다(없으면 ValueError).

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `agent/app/prompts.py` | `SYSTEM_PROMPT`(유지) + `EMERGENCY_MESSAGE` 상수 |
| `agent/app/tools.py` | `_fetch_products`(순수 HTTP) + `search_products` `@tool`(스키마 바인딩용) |
| `agent/app/triage.py` | Haiku 응급 분류 `classify(message) -> "emergency"|"normal"` |
| `agent/app/graph.py` | `AgentState`, 노드들, `build_graph(checkpointer)` |
| `agent/app/agent.py` | `stream_events(graph, message, session_id)` — SSE 이벤트 dict 제너레이터 |
| `agent/app/schemas.py` | `ChatRequest = {message, session_id}` |
| `agent/app/main.py` | lifespan(AsyncSqliteSaver) + `/chat` SSE 엔드포인트 |
| `agent/tests/*` | 단위/통합 테스트 |
| `web/src/components/store/ChatPanel.tsx` | SSE 파싱 + `session_id` 생성·전송 |
| `web/src/app/api/chat/route.ts` | SSE 스트리밍 프록시 |

**상수:** `MAX_TOOL_TURNS = 4` (그래프 도구 라운드 한계), `MODEL = claude-opus-4-8`(agent/finalize), `TRIAGE_MODEL = claude-haiku-4-5-20251001`.

---

## Task 1: 의존성 추가 (완료 확인)

**Files:**
- Modify: `agent/pyproject.toml`

- [ ] **Step 1: 의존성 설치 확인**

`uv add langgraph langchain-anthropic langgraph-checkpoint-sqlite sse-starlette`는 이미 실행됨. 확인:

Run: `cd agent && uv run python -c "import langgraph, langchain_anthropic, sse_starlette; from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver; print('ok')"`
Expected: `ok`

- [ ] **Step 2: pyproject 확인 후 커밋**

`agent/pyproject.toml`의 `dependencies`에 `langgraph`, `langchain-anthropic`, `langgraph-checkpoint-sqlite`, `sse-starlette`가 포함됐는지 확인.

```bash
git add agent/pyproject.toml agent/uv.lock
git commit -m "build: LangGraph 전환용 의존성 추가"
```

---

## Task 2: EMERGENCY_MESSAGE 상수

**Files:**
- Modify: `agent/app/prompts.py`

- [ ] **Step 1: 상수 추가**

`agent/app/prompts.py` 맨 끝에 추가:

```python


EMERGENCY_MESSAGE = (
    "말씀하신 증상은 즉시 전문적인 진료가 필요할 수 있는 신호로 보입니다. "
    "영양제 안내보다, 지금 바로 가까운 병원 응급실이나 119, 또는 대면 약사와 상담하시길 강하게 권해드립니다. "
    "증상이 빠르게 나빠지면 망설이지 말고 응급 연락을 해주세요."
)
```

- [ ] **Step 2: 임포트되는지 확인**

Run: `cd agent && uv run python -c "from app.prompts import EMERGENCY_MESSAGE; print(len(EMERGENCY_MESSAGE))"`
Expected: 0보다 큰 숫자 출력

- [ ] **Step 3: 커밋**

```bash
git add agent/app/prompts.py
git commit -m "feat: 응급 안내 고정 메시지 상수 추가"
```

---

## Task 3: tools.py — 순수 HTTP 함수 + LangChain @tool

**Files:**
- Modify: `agent/app/tools.py`
- Test: `agent/tests/test_tools.py`

- [ ] **Step 1: 실패하는 테스트로 교체**

`agent/tests/test_tools.py` 전체를 아래로 교체:

```python
import respx
import httpx
from app.tools import _fetch_products, search_products

@respx.mock
async def test_fetch_products_calls_web_api():
    route = respx.get("http://web.test/api/agent-tools/search-products").mock(
        return_value=httpx.Response(200, json=[{"id": 1, "name": "비타민C 1000", "price": 18000}])
    )
    result = await _fetch_products(condition="피로", base_url="http://web.test")
    assert route.called
    assert result[0]["name"] == "비타민C 1000"

@respx.mock
async def test_fetch_products_omits_empty_params():
    route = respx.get("http://web.test/api/agent-tools/search-products").mock(
        return_value=httpx.Response(200, json=[])
    )
    await _fetch_products(condition="피로", keyword="", base_url="http://web.test")
    assert route.calls.last.request.url.params.get("keyword") is None

def test_search_products_is_langchain_tool():
    # bind_tools에 넘길 수 있는 LangChain 도구여야 한다
    assert search_products.name == "search_products"
    assert "condition" in search_products.args
```

- [ ] **Step 2: 실패 확인**

Run: `cd agent && uv run pytest tests/test_tools.py -v`
Expected: FAIL — `_fetch_products` import 에러

- [ ] **Step 3: tools.py 구현**

`agent/app/tools.py` 전체를 아래로 교체:

```python
import os
import httpx
from langchain_core.tools import tool


async def _fetch_products(
    condition: str = "",
    keyword: str = "",
    base_url: str | None = None,
) -> list[dict]:
    """이 약국이 취급하는 영양제를 condition/keyword로 조회하는 순수 HTTP 호출."""
    base = base_url or os.environ.get("WEB_INTERNAL_URL", "http://localhost:3000")
    params = {k: v for k, v in {"condition": condition, "keyword": keyword}.items() if v}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{base}/api/agent-tools/search-products", params=params)
        resp.raise_for_status()
        return resp.json()


@tool
async def search_products(condition: str = "", keyword: str = "") -> list[dict]:
    """이 약국이 취급하는 영양제를 증상(condition)이나 키워드(keyword)로 검색한다.
    추천 전 반드시 호출한다. condition 예: 피로, 눈건강 / keyword 예: 비타민C."""
    return await _fetch_products(condition=condition, keyword=keyword)
```

- [ ] **Step 4: 통과 확인**

Run: `cd agent && uv run pytest tests/test_tools.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: 커밋**

```bash
git add agent/app/tools.py agent/tests/test_tools.py
git commit -m "refactor: tools를 순수 HTTP 함수 + LangChain @tool로 분리"
```

---

## Task 4: triage.py — Haiku 응급 분류

**Files:**
- Create: `agent/app/triage.py`
- Test: `agent/tests/test_triage.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`agent/tests/test_triage.py` 생성:

```python
from unittest.mock import AsyncMock, patch
from langchain_core.messages import AIMessage
from app.triage import classify


async def _run(label):
    fake = AsyncMock()
    fake.ainvoke = AsyncMock(return_value=AIMessage(content=label))
    with patch("app.triage._model", return_value=fake):
        return await classify("증상 설명")


async def test_classify_emergency():
    assert await classify_with("emergency") == "emergency"


async def test_classify_normal():
    assert await classify_with("normal") == "normal"


async def test_classify_failure_defaults_normal():
    fake = AsyncMock()
    fake.ainvoke = AsyncMock(side_effect=RuntimeError("boom"))
    with patch("app.triage._model", return_value=fake):
        assert await classify("아무 말") == "normal"


async def classify_with(label):
    fake = AsyncMock()
    fake.ainvoke = AsyncMock(return_value=AIMessage(content=f"  {label.upper()}  "))
    with patch("app.triage._model", return_value=fake):
        return await classify("증상 설명")
```

- [ ] **Step 2: 실패 확인**

Run: `cd agent && uv run pytest tests/test_triage.py -v`
Expected: FAIL — `app.triage` 없음

- [ ] **Step 3: triage.py 구현**

`agent/app/triage.py` 생성:

```python
import logging
import os
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import SystemMessage, HumanMessage

logger = logging.getLogger("agent.triage")

TRIAGE_MODEL = os.environ.get("TRIAGE_MODEL", "claude-haiku-4-5-20251001")

_TRIAGE_SYSTEM = (
    "너는 약국 상담 안전 분류기다. 사용자 메시지에 발열, 가슴 통증, 호흡곤란, "
    "심한 출혈, 의식저하, 마비, 심한 복통 등 즉시 진료가 필요한 응급 신호가 있으면 "
    "정확히 'EMERGENCY'만, 아니면 정확히 'NORMAL'만 출력한다. 다른 말은 절대 하지 마라."
)


def _model() -> ChatAnthropic:
    return ChatAnthropic(model=TRIAGE_MODEL, max_tokens=10, temperature=0)


async def classify(message: str) -> str:
    """사용자 메시지를 'emergency' 또는 'normal'로 분류한다. 실패 시 'normal'."""
    try:
        resp = await _model().ainvoke(
            [SystemMessage(content=_TRIAGE_SYSTEM), HumanMessage(content=message)]
        )
        text = (resp.content if isinstance(resp.content, str) else str(resp.content)).strip().upper()
        return "emergency" if "EMERGENCY" in text else "normal"
    except Exception:
        logger.exception("triage 분류 실패 — normal로 폴백")
        return "normal"
```

- [ ] **Step 4: 통과 확인**

Run: `cd agent && uv run pytest tests/test_triage.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: 커밋**

```bash
git add agent/app/triage.py agent/tests/test_triage.py
git commit -m "feat: Haiku 기반 응급 신호 triage 분류기"
```

---

## Task 5: graph.py — StateGraph 조립

**Files:**
- Create: `agent/app/graph.py`
- Test: `agent/tests/test_graph.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`agent/tests/test_graph.py` 생성:

```python
from unittest.mock import AsyncMock, MagicMock, patch
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import MemorySaver
from app.graph import build_graph, AgentState


def _ai(text="", tool_calls=None):
    return AIMessage(content=text, tool_calls=tool_calls or [])


def _tool_call(cond="피로"):
    return [{"name": "search_products", "args": {"condition": cond}, "id": "t1", "type": "tool_call"}]


def _model(calls):
    # bind_tools가 자기 자신을 반환해야 ainvoke side_effect가 적용된다
    m = AsyncMock()
    m.ainvoke = AsyncMock(side_effect=calls)
    m.bind_tools = MagicMock(return_value=m)
    return m


async def _collect(graph, message):
    cfg = {"configurable": {"thread_id": "s1"}}
    inp = {"messages": [HumanMessage(content=message)], "recommended_ids": [], "tool_turns": 0}
    events = []
    async for mode, chunk in graph.astream(inp, cfg, stream_mode=["custom", "values"]):
        events.append((mode, chunk))
    return events


async def test_normal_flow_runs_tool_then_answers():
    # triage=normal, agent가 도구 호출 후 답변
    fake_model = _model([_ai(tool_calls=_tool_call()), _ai(text="비타민C를 추천드려요.")])
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph._chat_model", return_value=fake_model), \
         patch("app.graph._fetch_products", new=AsyncMock(return_value=[{"id": 1, "name": "비타민C"}])):
        graph = build_graph(MemorySaver())
        events = await _collect(graph, "요즘 피곤해요")
    customs = [c for m, c in events if m == "custom"]
    assert any(c.get("type") == "recommendations" and c["ids"] == [1] for c in customs)
    final = [c for m, c in events if m == "values"][-1]
    assert "비타민C" in final["messages"][-1].content


async def test_emergency_flow_skips_tools():
    with patch("app.triage.classify", new=AsyncMock(return_value="emergency")), \
         patch("app.graph._fetch_products", new=AsyncMock()) as fetch:
        graph = build_graph(MemorySaver())
        events = await _collect(graph, "가슴이 너무 아프고 숨이 안 쉬어져요")
    fetch.assert_not_called()
    customs = [c for m, c in events if m == "custom"]
    assert any(c.get("type") == "emergency" for c in customs)


async def test_recommended_ids_dedup_across_turns():
    fake_model = _model([
        _ai(tool_calls=_tool_call("피로")),
        _ai(tool_calls=_tool_call("눈")),
        _ai(text="추천드립니다."),
    ])
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph._chat_model", return_value=fake_model), \
         patch("app.graph._fetch_products", new=AsyncMock(return_value=[{"id": 1, "name": "A"}])):
        graph = build_graph(MemorySaver())
        events = await _collect(graph, "피곤하고 눈도 침침")
    final = [c for m, c in events if m == "values"][-1]
    assert final["recommended_ids"] == [1]  # 두 번 검색해도 중복 없이 1개


async def test_turn_limit_routes_to_finalize():
    # 항상 도구만 호출하는 모델 → MAX_TOOL_TURNS 도달 시 finalize가 답변 생성
    tool_only = _ai(tool_calls=_tool_call())
    finalize_answer = _ai(text="정리해드리면 다음과 같아요.")
    fake_model = _model([tool_only] * 10 + [finalize_answer] * 5)
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph._chat_model", return_value=fake_model), \
         patch("app.graph._fetch_products", new=AsyncMock(return_value=[{"id": 9, "name": "Z"}])):
        graph = build_graph(MemorySaver())
        events = await _collect(graph, "계속 검색해줘")
    final = [c for m, c in events if m == "values"][-1]
    assert "정리해드리면" in final["messages"][-1].content
```

- [ ] **Step 2: 실패 확인**

Run: `cd agent && uv run pytest tests/test_graph.py -v`
Expected: FAIL — `app.graph` 없음

- [ ] **Step 3: graph.py 구현**

`agent/app/graph.py` 생성:

```python
import json
import os
from typing import Annotated, Literal, TypedDict

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import AIMessage, AnyMessage, SystemMessage, ToolMessage
from langgraph.config import get_stream_writer
from langgraph.graph import START, END, StateGraph
from langgraph.graph.message import add_messages

from app import triage
from app.prompts import SYSTEM_PROMPT, EMERGENCY_MESSAGE
from app.tools import _fetch_products, search_products

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-8")
MAX_TOOL_TURNS = 4


class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    recommended_ids: list[int]
    tool_turns: int
    triage: str


def _chat_model() -> ChatAnthropic:
    return ChatAnthropic(model=MODEL, max_tokens=1024)


def _last_human_text(state: AgentState) -> str:
    m = next((m for m in reversed(state["messages"]) if m.type == "human"), None)
    return m.content if m else ""


async def triage_node(state: AgentState) -> dict:
    decision = await triage.classify(_last_human_text(state))
    return {"triage": decision}


def route_triage(state: AgentState) -> Literal["agent", "emergency"]:
    return "emergency" if state.get("triage") == "emergency" else "agent"


async def agent_node(state: AgentState) -> dict:
    model = _chat_model().bind_tools([search_products])
    resp = await model.ainvoke([SystemMessage(content=SYSTEM_PROMPT)] + state["messages"])
    return {"messages": [resp]}


async def tools_node(state: AgentState) -> dict:
    last = state["messages"][-1]
    writer = get_stream_writer()
    tool_messages: list[ToolMessage] = []
    ids = list(state["recommended_ids"])
    for call in last.tool_calls:
        try:
            products = await _fetch_products(**call["args"])
            content = json.dumps(products, ensure_ascii=False)
            for p in products:
                if isinstance(p, dict) and "id" in p and p["id"] not in ids:
                    ids.append(p["id"])
        except Exception:
            content = "검색 중 오류가 발생했습니다. 결과를 가져오지 못했습니다."
        tool_messages.append(
            ToolMessage(content=content, tool_call_id=call["id"], name=call["name"])
        )
    if ids != state["recommended_ids"]:
        writer({"type": "recommendations", "ids": ids})
    return {
        "messages": tool_messages,
        "recommended_ids": ids,
        "tool_turns": state["tool_turns"] + 1,
    }


def route_after_agent(state: AgentState) -> Literal["tools", "finalize", "__end__"]:
    last = state["messages"][-1]
    if not getattr(last, "tool_calls", None):
        return END
    if state["tool_turns"] >= MAX_TOOL_TURNS:
        return "finalize"
    return "tools"


async def finalize_node(state: AgentState) -> dict:
    resp = await _chat_model().ainvoke([SystemMessage(content=SYSTEM_PROMPT)] + state["messages"])
    return {"messages": [resp]}


async def emergency_node(state: AgentState) -> dict:
    writer = get_stream_writer()
    writer({"type": "emergency", "message": EMERGENCY_MESSAGE})
    return {"messages": [AIMessage(content=EMERGENCY_MESSAGE)]}


def build_graph(checkpointer):
    g = StateGraph(AgentState)
    g.add_node("triage", triage_node)
    g.add_node("agent", agent_node)
    g.add_node("tools", tools_node)
    g.add_node("finalize", finalize_node)
    g.add_node("emergency", emergency_node)

    g.add_edge(START, "triage")
    g.add_conditional_edges("triage", route_triage, {"agent": "agent", "emergency": "emergency"})
    g.add_conditional_edges(
        "agent", route_after_agent, {"tools": "tools", "finalize": "finalize", END: END}
    )
    g.add_edge("tools", "agent")
    g.add_edge("finalize", END)
    g.add_edge("emergency", END)
    return g.compile(checkpointer=checkpointer)
```

- [ ] **Step 4: 통과 확인**

Run: `cd agent && uv run pytest tests/test_graph.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: 커밋**

```bash
git add agent/app/graph.py agent/tests/test_graph.py
git commit -m "feat: LangGraph StateGraph(triage/agent/tools/finalize/emergency) 조립"
```

---

## Task 6: schemas.py — 단일 메시지 요청

**Files:**
- Modify: `agent/app/schemas.py`

- [ ] **Step 1: 교체**

`agent/app/schemas.py` 전체를 교체:

```python
from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    session_id: str
```

- [ ] **Step 2: 임포트 확인**

Run: `cd agent && uv run python -c "from app.schemas import ChatRequest; print(ChatRequest(message='hi', session_id='s1'))"`
Expected: `message='hi' session_id='s1'` 출력

- [ ] **Step 3: 커밋**

```bash
git add agent/app/schemas.py
git commit -m "refactor: ChatRequest를 {message, session_id} 단일 메시지로 변경"
```

---

## Task 7: agent.py — SSE 이벤트 제너레이터

**Files:**
- Modify: `agent/app/agent.py`
- Test: `agent/tests/test_agent.py`

- [ ] **Step 1: 실패하는 테스트로 교체**

`agent/tests/test_agent.py` 전체를 교체:

```python
import json
from unittest.mock import AsyncMock, MagicMock, patch
from langchain_core.messages import AIMessage, HumanMessage
from langgraph.checkpoint.memory import MemorySaver
from app.agent import stream_events
from app.graph import build_graph


def _ai(text="", tool_calls=None):
    return AIMessage(content=text, tool_calls=tool_calls or [])


def _model(calls):
    m = AsyncMock()
    m.ainvoke = AsyncMock(side_effect=calls)
    m.bind_tools = MagicMock(return_value=m)
    return m


async def test_stream_events_emits_recommendations_and_done():
    fake_model = _model([
        _ai(tool_calls=[{"name": "search_products", "args": {"condition": "피로"}, "id": "t1", "type": "tool_call"}]),
        _ai(text="비타민C를 추천드려요."),
    ])
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph._chat_model", return_value=fake_model), \
         patch("app.graph._fetch_products", new=AsyncMock(return_value=[{"id": 1, "name": "비타민C"}])):
        graph = build_graph(MemorySaver())
        events = [e async for e in stream_events(graph, "피곤해요", "s1")]
    types = [e["event"] for e in events]
    assert "recommendations" in types
    assert types[-1] == "done"
    rec = json.loads(next(e["data"] for e in events if e["event"] == "recommendations"))
    assert rec["ids"] == [1]


async def test_stream_events_emergency():
    with patch("app.triage.classify", new=AsyncMock(return_value="emergency")):
        graph = build_graph(MemorySaver())
        events = [e async for e in stream_events(graph, "숨이 안 쉬어져요", "s2")]
    assert any(e["event"] == "emergency" for e in events)
    assert events[-1]["event"] == "done"
```

- [ ] **Step 2: 실패 확인**

Run: `cd agent && uv run pytest tests/test_agent.py -v`
Expected: FAIL — `stream_events` 없음

- [ ] **Step 3: agent.py 구현**

`agent/app/agent.py` 전체를 교체:

```python
import json
import logging
from collections.abc import AsyncIterator

from langchain_core.messages import HumanMessage

logger = logging.getLogger("agent.stream")

_STREAM_NODES = {"agent", "finalize"}


def _text_of(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"
        )
    return ""


async def stream_events(graph, message: str, session_id: str) -> AsyncIterator[dict]:
    """그래프 실행을 SSE 이벤트 dict({event, data}) 스트림으로 변환한다."""
    config = {"configurable": {"thread_id": session_id}}
    inp = {"messages": [HumanMessage(content=message)], "recommended_ids": [], "tool_turns": 0}
    try:
        async for mode, chunk in graph.astream(inp, config, stream_mode=["messages", "custom"]):
            if mode == "messages":
                msg, meta = chunk
                if meta.get("langgraph_node") in _STREAM_NODES:
                    text = _text_of(msg.content)
                    if text:
                        yield {"event": "token", "data": json.dumps({"text": text})}
            elif mode == "custom":
                t = chunk.get("type")
                if t == "recommendations":
                    yield {"event": "recommendations", "data": json.dumps({"ids": chunk["ids"]})}
                elif t == "emergency":
                    yield {"event": "emergency", "data": json.dumps({"message": chunk["message"]})}
        yield {"event": "done", "data": "{}"}
    except Exception:
        logger.exception("agent 스트림 처리 실패")
        yield {"event": "error", "data": json.dumps({"message": "상담 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."})}
```

- [ ] **Step 4: 통과 확인**

Run: `cd agent && uv run pytest tests/test_agent.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: 커밋**

```bash
git add agent/app/agent.py agent/tests/test_agent.py
git commit -m "feat: 그래프 실행을 SSE 이벤트 스트림으로 변환하는 stream_events"
```

---

## Task 8: main.py — lifespan + SSE 엔드포인트

**Files:**
- Modify: `agent/app/main.py`
- Test: `agent/tests/test_main.py`

- [ ] **Step 1: 실패하는 테스트 작성**

`agent/tests/test_main.py` 생성:

```python
from unittest.mock import AsyncMock, MagicMock, patch
from langchain_core.messages import AIMessage
from fastapi.testclient import TestClient
import app.main as main_module


def test_chat_streams_sse():
    fake_model = AsyncMock()
    fake_model.ainvoke = AsyncMock(side_effect=[AIMessage(content="안녕하세요, 맑은 약사입니다.")])
    fake_model.bind_tools = MagicMock(return_value=fake_model)
    with patch("app.triage.classify", new=AsyncMock(return_value="normal")), \
         patch("app.graph._chat_model", return_value=fake_model):
        with TestClient(main_module.app) as client:
            r = client.post("/chat", json={"message": "안녕", "session_id": "s1"})
            assert r.status_code == 200
            assert "text/event-stream" in r.headers["content-type"]
            assert "event: done" in r.text


def test_health():
    with TestClient(main_module.app) as client:
        assert client.get("/health").json() == {"ok": True}
```

- [ ] **Step 2: 실패 확인**

Run: `cd agent && uv run pytest tests/test_main.py -v`
Expected: FAIL

- [ ] **Step 3: main.py 구현**

`agent/app/main.py` 전체를 교체:

```python
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from sse_starlette.sse import EventSourceResponse
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from app.agent import stream_events
from app.graph import build_graph
from app.schemas import ChatRequest

DB_PATH = os.environ.get("AGENT_MEMORY_DB", "agent_memory.sqlite")


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with AsyncSqliteSaver.from_conn_string(DB_PATH) as saver:
        app.state.graph = build_graph(saver)
        yield


app = FastAPI(title="pharmacist-agent", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/chat")
async def chat(req: ChatRequest):
    return EventSourceResponse(stream_events(app.state.graph, req.message, req.session_id))
```

- [ ] **Step 4: 통과 확인**

Run: `cd agent && uv run pytest tests/test_main.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: 전체 에이전트 테스트 + 커밋**

Run: `cd agent && uv run pytest -v`
Expected: 모든 테스트 PASS

```bash
git add agent/app/main.py agent/tests/test_main.py
git commit -m "feat: AsyncSqliteSaver lifespan + SSE /chat 엔드포인트"
```

---

## Task 9: web — api/chat 프록시를 SSE로

**Files:**
- Modify: `web/src/app/api/chat/route.ts`

- [ ] **Step 1: Next.js 가이드 확인 (필수)**

`web/AGENTS.md`에 따라 이 Next.js는 브레이킹 체인지가 있다. 스트리밍 응답/Route Handler 관련 문서를 먼저 확인:

Run: `ls web/node_modules/next/dist/docs/ 2>/dev/null && grep -rl "stream\|Route Handler\|NextResponse" web/node_modules/next/dist/docs/ 2>/dev/null | head`
해당 문서를 읽고 스트리밍 프록시에 필요한 헤더/반환 형태를 확인한다.

- [ ] **Step 2: route.ts 수정**

`web/src/app/api/chat/route.ts` 전체를 교체(SSE 헤더 명시 + 버퍼링 비활성화):

```typescript
import { NextRequest } from "next/server";

// 클라이언트의 단일 메시지+session_id를 agent 서비스로 전달하고 SSE 스트림을 중계한다.
export async function POST(req: NextRequest) {
  const body = await req.text();
  const agentUrl = process.env.AGENT_URL ?? "http://localhost:8000";
  try {
    const upstream = await fetch(`${agentUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch {
    return new Response("상담 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.", { status: 502 });
  }
}
```

- [ ] **Step 3: 커밋**

```bash
git add web/src/app/api/chat/route.ts
git commit -m "feat: /api/chat를 SSE 스트리밍 프록시로 변경"
```

---

## Task 10: web — ChatPanel SSE 파싱 + session_id

**Files:**
- Modify: `web/src/components/store/ChatPanel.tsx`

- [ ] **Step 1: SSE 파싱으로 stream() 재작성**

`web/src/components/store/ChatPanel.tsx`에서 다음을 변경한다.

(a) 상단 `RECO_MARKER` 상수(9-10행)를 **삭제**하고, 컴포넌트 본문 `useState` 근처에 session_id ref를 추가:

```typescript
  const sessionId = useRef<string>("");
  if (!sessionId.current) sessionId.current = crypto.randomUUID();
```

(b) `stream(text)` 함수 전체(38-75행)를 아래로 교체:

```typescript
  async function stream(text: string) {
    const next: Msg[] = [...msgsRef.current, { role: "user", content: text }];
    setMessages(next);
    setLoading(true);
    let acc = "";
    let buf = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: sessionId.current }),
      });
      setMessages([...next, { role: "assistant", content: "" }]);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // SSE 프레임은 빈 줄(\n\n)로 구분된다
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const ev = parseSSE(frame);
          if (!ev) continue;
          if (ev.event === "token") {
            acc += JSON.parse(ev.data).text;
            setMessages([...next, { role: "assistant", content: acc }]);
          } else if (ev.event === "emergency") {
            acc += JSON.parse(ev.data).message;
            setMessages([...next, { role: "assistant", content: acc }]);
          } else if (ev.event === "recommendations") {
            const ids = JSON.parse(ev.data).ids;
            if (Array.isArray(ids) && ids.length > 0) setRecommended(ids);
          } else if (ev.event === "error") {
            acc += "\n\n" + JSON.parse(ev.data).message;
            setMessages([...next, { role: "assistant", content: acc }]);
          }
        }
      }
    } catch {
      setMessages([...next, { role: "assistant", content: "상담 연결에 문제가 발생했어요. 잠시 후 다시 시도해주세요." }]);
    } finally {
      setLoading(false);
    }
  }
```

(c) 컴포넌트 함수 바깥(파일 하단 `TypingDots` 옆)에 SSE 프레임 파서를 추가:

```typescript
function parseSSE(frame: string): { event: string; data: string } | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}
```

- [ ] **Step 2: 타입체크/린트**

Run: `cd web && npx tsc --noEmit 2>&1 | head` (또는 프로젝트의 lint 스크립트)
Expected: ChatPanel 관련 신규 타입 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add web/src/components/store/ChatPanel.tsx
git commit -m "feat: ChatPanel을 SSE 파싱 + session_id 전송으로 재작성"
```

---

## Task 11: 통합 수동 검증 + 정리

**Files:**
- 정리 대상: `agent/.pytest_cache/`, 루트의 임시 `agent_memory.sqlite`(런타임 생성물 — `.gitignore` 확인)

- [ ] **Step 1: .gitignore에 런타임 DB 추가**

`agent/.gitignore`에 `agent_memory.sqlite*`가 없으면 추가하고 커밋:

```bash
grep -q "agent_memory" agent/.gitignore || echo "agent_memory.sqlite*" >> agent/.gitignore
git add agent/.gitignore && git commit -m "chore: 에이전트 메모리 DB 무시"
```

- [ ] **Step 2: 에이전트 전체 테스트**

Run: `cd agent && uv run pytest -v`
Expected: 전부 PASS

- [ ] **Step 3: 두 서버 기동 후 수동 확인**

`/run` 또는 기존 기동 방식으로 agent(8000) + web(3000)을 띄운다. 브라우저에서:
1. 일반 질문("요즘 피곤해요") → 답변이 토큰 단위로 흐르고, 우측 패널에 추천 제품이 뜨는지.
2. 이어지는 질문("그럼 그 중 뭐가 좋아요?") → 같은 세션에서 맥락이 이어지는지(메모리 동작).
3. 응급 질문("갑자기 가슴이 조이고 숨이 안 쉬어져요") → 영양제 추천 없이 병원/응급 안내가 나오는지.

- [ ] **Step 4: 최종 커밋(있으면)**

수동 검증 중 수정이 있었다면 커밋.

---

## Self-Review 메모

- 스펙 9개 섹션 모두 대응: 그래프(Task5), 메모리(Task8 lifespan), triage(Task4), SSE 전송(Task7·9·10), 답변유실(Task5 finalize+route), 테스트(각 Task), 마이그레이션(Task6 스키마 변경).
- `_chat_model`/`_fetch_products`/`triage.classify`는 모든 테스트에서 patch 대상으로 일관되게 사용.
