# 상담 내역 기반 개인화 설계

- **날짜:** 2026-06-14
- **브랜치:** feat/consultation-personalization
- **범위(이번 iteration):** "기반 + 건강 프로필" 슬라이스 (옵션 A)

## 1. 목표와 배경

피나팜 맑은 약국의 AI 상담 약사가 **재방문 상담자를 기억하고 개인화**하도록 만든다.
현재 에이전트의 유일한 도구는 `search_products`이며, 상담 내역·추천·건강 정보는
DB에 전혀 누적되지 않는다. 스키마에는 `Consultation`/`Message`/`Recommendation`
테이블이 정의돼 있으나 코드에서 사용되지 않는 "고아 테이블" 상태다.

이번 작업의 핵심 결과:
> "같은 사람이 다시 방문하면, 에이전트가 저장된 건강 프로필을 기억해
> 매번 다시 묻지 않고, 그 정보를 안전 점검·추천에 반영한다."

### 현재 흐름(확인된 사실)
- `ChatPanel`이 `crypto.randomUUID()`로 session_id를 만들지만 `useRef`에만 두어
  **새로고침하면 사라진다** (localStorage 미저장).
- session_id는 agent로 전달되어 langgraph의 `thread_id`로 쓰인다 — 즉 **한 세션 안의
  대화 연속성(체크포인트)**만 담당하며, 세션 간 기억은 없다.
- `graph.tools_node`는 모든 tool_call을 product 검색으로 간주하고
  (`_fetch_products(**args)`), `agent_node`는 `[search_products]`만 바인딩한다.
- 에이전트는 session_id를 직접 알지 못한다(오직 langgraph config의 `thread_id`).

## 2. 설계 원칙 — 미래 호환 신원(Identity)

개인화는 추상 `customerId` 위에 짓고, 그 ID의 **출처만 갈아끼울 수 있게** 한다.
사람(Customer)과 로그인 수단(Identity)을 분리하는 표준 패턴(Auth.js Account 모델과 동일).

- **지금:** `provider = "anonymous"`, `providerAccountId = localStorage 세션 UUID`.
- **나중:** 카카오/구글/애플 로그인 → 같은 Customer에 `Identity` 행만 추가(계정 병합).
  익명으로 쌓인 상담·프로필이 로그인 계정으로 승계된다. 개인화 코드는 불변.
- **에이전트 도구는 항상 session_id만 넘기고**, `session_id → customerId` 해석은
  web에서 수행한다. LLM은 customerId도 session_id도 직접 다루지 않는다.

## 3. 데이터 모델 (web/prisma)

기존 컨벤션(리스트는 JSON 문자열, 예: `conditionTags String @default("[]")`)을 따른다.

```prisma
model Customer {                    // "사람" — 개인화의 앵커
  id            Int       @id @default(autoincrement())
  identities    Identity[]
  healthProfile HealthProfile?
  consultations Consultation[]
  createdAt     DateTime  @default(now())
}

model Identity {                    // 로그인 수단 — 멀티 프로바이더 대비
  id                Int      @id @default(autoincrement())
  provider          String   // 지금은 "anonymous"; 후일 "kakao"|"google"|"apple"
  providerAccountId String   // 지금은 localStorage 세션 UUID; 후일 OAuth sub
  customer          Customer @relation(fields: [customerId], references: [id])
  customerId        Int
  createdAt         DateTime @default(now())
  @@unique([provider, providerAccountId])
}

model HealthProfile {              // 1:1 Customer — 지속적 건강 사실
  id           Int      @id @default(autoincrement())
  customer     Customer @relation(fields: [customerId], references: [id])
  customerId   Int      @unique
  ageBand      String?            // "20대","30대"...
  sex          String?            // "남"|"여"|null
  conditions   String   @default("[]")  // 기저질환 (JSON 배열 문자열)
  medications  String   @default("[]")  // 복용 중인 약
  allergies    String   @default("[]")  // 알레르기
  pregnancy    String?            // "임신"|"수유"|null
  notes        String?            // 식습관/생활 자유메모
  updatedAt    DateTime @updatedAt
}

model Consultation {              // 기존 모델에 customer 연결만 추가
  // ... 기존 필드(id, sessionId, messages, recommendations, createdAt) 유지 ...
  customer     Customer? @relation(fields: [customerId], references: [id])
  customerId   Int?
}
```

결정 사항:
- **HealthProfile은 Customer와 별도 1:1 테이블** (신원 앵커 vs 건강 데이터 책임 분리).
- **Order ↔ Customer 연결은 이번 범위 제외** (재구매 기능은 다음 iteration).

## 4. 신원 해석 & 세션 영속화

### (a) 클라이언트 — session_id 영속화
`ChatPanel`에서 session_id를 localStorage에 저장해 새로고침·재방문 시 동일 ID 사용.

```ts
const sessionId = useRef<string>("");
if (!sessionId.current) {
  sessionId.current =
    localStorage.getItem("pham_session_id") ??
    (() => { const id = crypto.randomUUID();
             localStorage.setItem("pham_session_id", id); return id; })();
}
```

### (b) 서버 — `resolveCustomer(sessionId)` 헬퍼 (web `src/lib/`)
모든 개인화 엔드포인트의 진입점. 익명 Identity를 get-or-create.

```ts
async function resolveCustomer(sessionId: string): Promise<number> {
  const found = await prisma.identity.findUnique({
    where: { provider_providerAccountId: { provider: "anonymous", providerAccountId: sessionId } },
  });
  if (found) return found.customerId;
  const customer = await prisma.customer.create({
    data: { identities: { create: { provider: "anonymous", providerAccountId: sessionId } } },
  });
  return customer.id;
}
```

미래 호환: 카카오 로그인 도입 시 같은 헬퍼에 `provider:"kakao"` 분기와 익명→로그인
Customer 병합 로직을 추가하면 된다.

## 5. 에이전트 도구 & 그래프 변경

### 새 도구 2개 (web 엔드포인트 + 에이전트 도구 정의)
- **`get_health_profile`** → `GET /api/agent-tools/health-profile`
  저장된 프로필 조회. 에이전트가 상담 초반에 호출해 재질문 방지 + 자동 안전 점검.
  프로필이 없으면 빈 결과를 반환.
- **`save_health_profile`** → `POST /api/agent-tools/health-profile`
  대화에서 알게 된 지속적 사실을 **부분 병합 upsert**.
  - 리스트 필드(conditions/medications/allergies): 기존 값에 **합집합 추가**(중복 제거),
    통째 덮어쓰기 금지.
  - 스칼라 필드(ageBand/sex/pregnancy/notes): 제공된 값만 갱신, 미제공 필드는 보존.

### 그래프 리팩터
- `agent_node`: `bind_tools([search_products, get_health_profile, save_health_profile])`.
- `tools_node`: 모든 호출을 product 검색으로 간주하던 로직을 **도구명 기반 디스패치**로
  일반화. `search_products` 결과만 `recommended_ids`에 누적하고 `recommendations`
  이벤트를 emit. health-profile 도구는 별도 처리.
- **session_id 주입:** `tools_node(state, config)`에서
  `config["configurable"]["thread_id"]`(=session_id)를 읽어 health-profile web 호출에
  주입. **LLM 도구 인자에는 session_id가 없다** — 모델은 프로필 필드만 채운다.

### 도구 입력 스키마(요약)
- `get_health_profile`: 입력 없음(session_id는 주입).
- `save_health_profile`: `ageBand?`, `sex?`, `conditions?: string[]`, `medications?: string[]`,
  `allergies?: string[]`, `pregnancy?`, `notes?` — 모두 선택, 알게 된 것만 전달.

### 프롬프트(SYSTEM_PROMPT) 보강
- 상담 시작 시 `get_health_profile`를 호출해 맥락을 먼저 확인하도록 지시.
- 지속적 건강 사실(기저질환·복용약·알레르기·임신/수유·연령대)을 알게 되면
  `save_health_profile`로 기록하도록 지시. 단발성·일시 증상은 저장하지 않음.

## 6. 상담·추천 적재

web `/api/chat` 프록시가 담당하여 에이전트는 prisma와 무관하게 유지한다.
- 요청 수신 시 `resolveCustomer(session_id)` → 해당 session_id의 `Consultation`
  get-or-create(customer 연결) → 유저 `Message` 즉시 저장.
- SSE 스트림을 중계하면서 어시스턴트 텍스트를 누적 → 스트림 완료 시 어시스턴트
  `Message` 저장.
- 스트림의 `recommendations` 이벤트(ids)를 수신하면 해당 product들에 대해
  `Recommendation` 행을 저장(중복 방지).

## 7. 테스트

### 에이전트 (pytest, 기존 14개 유지)
- `tools_node` 도구명 디스패치: search vs health-profile 분기.
- session_id 주입: config의 thread_id가 health-profile 호출에 전달되는지.
- `save_health_profile`/`get_health_profile`의 web 호출(respx 목으로 검증).
- 기존 product 검색·추천 누적 동작 회귀 없음.

### web
- `resolveCustomer`: 신규 session_id는 생성, 재방문 session_id는 동일 customer 반환.
- health-profile upsert: 리스트 합집합 병합, 스칼라 보존 검증.
- `/api/chat`: 유저/어시스턴트 메시지 적재, 추천 적재.

### 수동 확인
- 채팅 → 건강 사실 언급 → 새로고침 → 재상담 시 에이전트가 프로필을 기억하고
  다시 묻지 않으며 안전 점검에 반영하는지 확인.

## 8. 범위 밖 (다음 iteration)
- 카카오/구글/애플 OAuth 로그인 UI 및 익명→로그인 계정 병합 실제 구현.
- `get_consultation_history`(맥락 인사), 재구매 리마인드, 추천 필터링.
- Order ↔ Customer 연결.
```
