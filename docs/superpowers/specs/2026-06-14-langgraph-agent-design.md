# LangGraph 에이전트 전환 설계

- **작성일**: 2026-06-14
- **대상**: `agent/` 상담 약사 서비스 + `web/` 채팅 프론트
- **상태**: 승인됨 (구현 대기)

## 1. 배경 & 목표

현재 [agent/app/agent.py](../../../agent/app/agent.py)는 손으로 짠 `while` 루프로 Anthropic Messages API를 호출하고 도구를 실행한다. 동작은 단순하지만 다음 한계가 있다.

- 세션 메모리가 없어 클라이언트가 매 요청마다 전체 대화 이력을 전송한다.
- 응급 신호 안전 처리가 시스템 프롬프트의 "선의"에만 의존한다(결정적 가드레일 없음).
- 추천 제품 ID를 `<<<RECO>>>` 인밴드 마커로 텍스트 스트림에 섞어 전달한다(취약).
- `MAX_TURNS` 소진 시 마지막 도구 호출 결과가 버려지고 답변이 유실된다.

**목표**: 위 로직을 LangGraph `StateGraph`로 정석 전환하면서, (1) SQLite checkpointer 기반 세션 메모리, (2) 응급 신호 triage 노드, (3) 타입 있는 SSE 이벤트 전송, (4) 답변 유실 구조적 해소를 함께 도입한다.

## 2. 범위

| 포함 | 제외 |
|---|---|
| StateGraph 포팅 (triage/agent/tools/emergency/finalize 노드) | 멀티에이전트 분리(분류/추천/복약 약사) |
| SQLite checkpointer 세션 메모리 | LangSmith 관찰성 연동 |
| Haiku 기반 응급 triage | 휴먼인더루프(약사 검수) interrupt |
| SSE 이벤트 전송 계약 + 웹 클라이언트 재작성 | 도구 추가(현행 search_products 1개 유지) |
| 답변 유실(MAX_TURNS) 구조적 해소 | |

## 3. 결정 사항 (확정)

- **접근**: 정석 LangGraph — `langchain_anthropic.ChatAnthropic` + 프리빌트 `ToolNode`/조건부 라우팅. 메시지는 LangChain 메시지 객체로 관리.
- **이력 계약**: 클라이언트는 `{ message, session_id }`(최신 메시지 + 스레드 ID)만 전송. checkpointer가 이력을 서버에 보관.
- **메모리 저장소**: SQLite 파일 체크포인터(`langgraph-checkpoint-sqlite`). 서버 재시작에도 대화 유지.
- **triage 판정**: Haiku 분류 호출(robustness 우선). 실패 시 `normal`로 fail-safe.
- **전송**: `text/event-stream`(SSE), 타입별 이벤트. `<<<RECO>>>` 마커 폐기.

## 4. 그래프 구조

### State

```python
class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    recommended_ids: list[int]   # search_products 결과 누적
    tool_turns: int              # 도구 호출 라운드 카운터
```

### 노드 & 엣지

```
START → triage ─(emergency)→ emergency → END
              └─(normal)───→ agent ─(route_after_agent)─┬─ END        (tool_call 없음)
                                                        ├─ tools → agent  (한계 미만)
                                                        └─ finalize → END (한계 도달)
```

- **triage**: 최신 사용자 메시지를 Haiku로 `emergency | normal` 분류. 응급이면 `emergency`, 아니면 `agent`로 라우팅. 분류 실패 시 `normal`.
- **emergency**: LLM·도구 호출 없이 `EMERGENCY_MESSAGE`(즉시 병원/대면 약사 권유) 고정 텍스트를 스트리밍하고 종료. 결정적 가드레일.
- **agent**: `ChatAnthropic(model=MODEL).bind_tools([search_products])` 호출. 호출 시 `tool_turns` 증가.
- **route_after_agent** (조건부 엣지):
  ```python
  def route_after_agent(state):
      last = state["messages"][-1]
      if not last.tool_calls:           return END
      if state["tool_turns"] >= LIMIT:  return "finalize"
      return "tools"
  ```
- **tools**: `ToolNode([search_products], handle_tool_errors=True)`. 결과 ToolMessage에서 제품 id를 추출해 `recommended_ids`에 중복 없이 누적하고, `custom` 스트림으로 즉시 emit.
- **finalize**: `ChatAnthropic`을 **도구 없이** 호출 → 누적된 도구 결과로 최종 텍스트를 강제 생성 → END. 답변 유실 해소(방안 C).

`compile(checkpointer=SqliteSaver(...))` + `recursion_limit`(안전망) 설정.

## 5. 컴포넌트 / 파일

| 파일 | 변경 |
|---|---|
| `agent/app/graph.py` | **신규**: `AgentState`, 노드 함수, `StateGraph` 빌드/컴파일(+SQLite checkpointer) |
| `agent/app/triage.py` | **신규**: Haiku 분류 함수 (`emergency` \| `normal`) |
| `agent/app/tools.py` | **수정**: `search_products`를 LangChain `@tool`로 래핑. HTTP 호출 로직은 유지 |
| `agent/app/prompts.py` | **유지** + `EMERGENCY_MESSAGE` 상수 추가 |
| `agent/app/schemas.py` | **수정**: `ChatRequest = { message: str, session_id: str }` |
| `agent/app/agent.py` | **축소**: `run_agent_stream`을 `graph.astream` 래퍼로 교체 (또는 graph.py로 흡수) |
| `agent/app/main.py` | **수정**: `/chat`이 `session_id`를 `thread_id`로 전달, SSE 응답으로 매핑 |
| `agent/pyproject.toml` | **수정**: `langgraph`, `langchain-anthropic`, `langgraph-checkpoint-sqlite`, `sse-starlette` 추가 |
| `web/src/components/store/ChatPanel.tsx` | **수정**: SSE 파싱으로 재작성, `session_id` 생성·전송 |
| `web/src/app/api/chat/route.ts` | **소폭**: SSE 스트리밍 프록시(헤더 `text/event-stream`) |

## 6. 데이터 흐름 & 전송 계약

### 스트림 모드

`graph.astream(input, config, stream_mode=["messages", "custom"])`

- `messages` → LLM 토큰
- `custom` → 노드에서 `get_stream_writer()`로 구조화된 이벤트(추천 ID, 응급 등) emit

### SSE 이벤트 (서버 → 클라이언트)

```
event: token            data: {"text": "비타민"}
event: recommendations  data: {"ids": [1, 3]}
event: emergency        data: {"message": "..."}
event: error            data: {"message": "..."}
event: done             data: {}
```

- 추천 ID가 더 이상 텍스트에 섞이지 않고 채널로 분리된다.
- 에러는 본문에 섞지 않고 `event: error`로 보낸다.

### 요청 (클라이언트 → 서버)

```json
{ "message": "요즘 피곤해요", "session_id": "uuid" }
```

- 클라이언트는 첫 메시지에서 `crypto.randomUUID()`로 `session_id`를 생성해 세션 동안 유지.
- 서버는 `config={"configurable": {"thread_id": session_id}}`로 graph 실행.

### 클라이언트 처리

- `fetch` 스트림에서 SSE 프레임을 `\n\n` 단위로 파싱, `event.type`으로 분기.
- `token`→메시지 누적, `recommendations`→우측 패널 ID 세팅, `emergency`→경고 배너, `error`→에러 표시.

## 7. 에러 처리 & 엣지케이스

- **MAX_TURNS(답변 유실)**: `tool_turns >= LIMIT`이면 `finalize` 노드가 도구 없이 최종 답변을 강제 생성. `recursion_limit`은 안전망.
- **도구 호출 실패**: `ToolNode(handle_tool_errors=True)`가 예외를 에러 ToolMessage로 모델에 반환 → 모델이 "조회 불가" 안내. 그래프 비정상 종료 방지.
- **triage 분류 실패**: `normal`로 fail-safe + 서버 로깅. 시스템 프롬프트 안전 규칙이 2차 방어선.
- **노드 예외 전반**: `main.py`의 `astream` 루프에서 잡아 `event: error` 발송 후 종료 + 서버 로깅.
- **빈 검색 결과**: 별도 노드 없이 시스템 프롬프트 5번 규칙(맞는 제품 없음 안내)으로 처리.

## 8. 테스트

`ChatAnthropic`은 `FakeMessagesListChatModel` 또는 monkeypatch로 모킹.

- **triage**: 응급 입력→`emergency`, 일반 입력→`agent` 라우팅 (분류기 모킹)
- **agent 루프**: 도구 1회 호출 후 답변 (기존 `test_agent.py` 그래프 버전 포팅)
- **recommended_ids**: 누적 + 중복 제거 검증
- **finalize**: 턴 한계 도달 시 도구 없이 최종 답변 생성됨
- **emergency 경로**: 도구·LLM 호출 없이 고정 메시지
- **메모리**: 동일 `thread_id` 2회 호출 시 이전 맥락 이어짐 (SQLite checkpointer)
- **SSE 직렬화**: token/recommendations/done 이벤트 프레임 형식 검증

## 9. 마이그레이션 노트

- 응답 스트림 계약이 `text/plain` + 마커 → SSE로 **파괴적으로 변경**된다. agent와 web을 함께 배포해야 한다.
- `schemas.ChatRequest`의 기존 `messages` 필드가 `message`로 바뀌므로, 구버전 클라이언트는 호환되지 않는다.
- `session_id`는 기존 스키마에 선언만 되어 있었고 미사용 → 이제 thread_id로 실제 사용된다.
