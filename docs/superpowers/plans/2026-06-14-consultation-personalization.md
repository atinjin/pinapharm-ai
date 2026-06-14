# 상담 내역 기반 개인화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 재방문 상담자를 식별해 저장된 건강 프로필을 기억하고, 상담·추천을 DB에 누적하는 개인화 기반을 만든다.

**Architecture:** 사람(`Customer`)과 로그인 수단(`Identity`)을 분리해 미래 OAuth 호환을 확보한다. 에이전트는 prisma를 모르고 `session_id`만 알며(=langgraph `thread_id`), web의 `/api/agent-tools/*` 엔드포인트가 `session_id → customerId`를 해석한다. 건강 프로필은 에이전트 도구 2개(`get_health_profile`/`save_health_profile`)로 읽고 쓰며, 상담·추천 적재는 web `/api/chat` 프록시가 담당한다.

**Tech Stack:** Next.js(web, vitest, Prisma+SQLite), Python/FastAPI + LangGraph(agent, pytest+respx), httpx.

**Spec:** `docs/superpowers/specs/2026-06-14-consultation-personalization-design.md`

---

## File Structure

**web (생성):**
- `web/src/lib/customers.ts` — `resolveCustomer`, `getHealthProfile`, `saveHealthProfile`
- `web/src/lib/consultations.ts` — `getOrCreateConsultation`, `appendMessage`, `saveRecommendations`
- `web/src/lib/agentStream.ts` — `extractFromSSE` (SSE 본문에서 답변·추천 id 추출, 순수 함수)
- `web/src/app/api/agent-tools/health-profile/route.ts` — GET/POST 건강 프로필
- `web/tests/customers.test.ts`, `web/tests/consultations.test.ts`, `web/tests/agentStream.test.ts`, `web/tests/health-profile.test.ts`

**web (수정):**
- `web/prisma/schema.prisma` — Customer/Identity/HealthProfile 추가, Consultation에 customer 연결
- `web/src/app/api/chat/route.ts` — 상담·추천 적재 추가
- `web/src/components/store/ChatPanel.tsx:17-18` — session_id localStorage 영속화

**agent (수정):**
- `agent/app/tools.py` — health-profile HTTP 헬퍼 + 도구 2개
- `agent/app/graph.py:44-73` — tools_node 도구명 디스패치 + session_id 주입, agent_node 바인딩
- `agent/app/prompts.py` — 프로필 도구 사용 지침
- `agent/tests/test_tools.py`, `agent/tests/test_graph.py` — 신규 도구/디스패치 테스트

---

## Task 0: 환경 준비 (web .env + 마이그레이션 베이스라인)

**Files:**
- Create: `web/.env`

- [ ] **Step 1: .env 생성**

```bash
cd web
cp .env.example .env
```

- [ ] **Step 2: 현재 스키마로 prisma client 생성 + 마이그레이션 적용**

```bash
cd web
npx prisma migrate dev
```
Expected: "Already in sync" 또는 기존 `20260613123337_init` 적용 후 client 생성 성공.

- [ ] **Step 3: web 테스트 베이스라인 확인**

Run: `cd web && npm test`
Expected: 기존 테스트 PASS (products/import/api-products).

- [ ] **Step 4: agent 테스트 베이스라인 확인**

Run: `cd agent && uv run --extra dev python -m pytest -q`
Expected: `14 passed`.

---

## Task 1: Prisma 스키마 — Customer / Identity / HealthProfile

**Files:**
- Modify: `web/prisma/schema.prisma`

- [ ] **Step 1: 모델 추가 및 Consultation 연결**

`web/prisma/schema.prisma`의 `Consultation` 모델에 customer 관계를 추가하고(아래 2줄), 파일 끝에 신규 모델 3개를 추가한다.

Consultation 모델 안에 추가:
```prisma
  customer        Customer? @relation(fields: [customerId], references: [id])
  customerId      Int?
```

파일 끝에 추가:
```prisma
model Customer {
  id            Int            @id @default(autoincrement())
  identities    Identity[]
  healthProfile HealthProfile?
  consultations Consultation[]
  createdAt     DateTime       @default(now())
}

model Identity {
  id                Int      @id @default(autoincrement())
  provider          String
  providerAccountId String
  customer          Customer @relation(fields: [customerId], references: [id])
  customerId        Int
  createdAt         DateTime @default(now())

  @@unique([provider, providerAccountId])
}

model HealthProfile {
  id          Int      @id @default(autoincrement())
  customer    Customer @relation(fields: [customerId], references: [id])
  customerId  Int      @unique
  ageBand     String?
  sex         String?
  conditions  String   @default("[]")
  medications String   @default("[]")
  allergies   String   @default("[]")
  pregnancy   String?
  notes       String?
  updatedAt   DateTime @updatedAt
}
```

- [ ] **Step 2: 마이그레이션 생성·적용**

Run: `cd web && npx prisma migrate dev --name add_personalization`
Expected: 새 마이그레이션 생성, 적용 성공, prisma client 재생성.

- [ ] **Step 3: 스키마 검증 (타입 생성 확인)**

Run: `cd web && npx prisma validate`
Expected: "The schema ... is valid 🚀".

- [ ] **Step 4: 커밋**

```bash
cd web && git add prisma/schema.prisma prisma/migrations
git commit -m "feat: 개인화용 Customer/Identity/HealthProfile 스키마 추가"
```

---

## Task 2: `resolveCustomer` + 건강 프로필 lib

**Files:**
- Create: `web/src/lib/customers.ts`
- Test: `web/tests/customers.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`web/tests/customers.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveCustomer, getHealthProfile, saveHealthProfile } from "@/lib/customers";

describe("resolveCustomer", () => {
  it("새 session_id는 customer를 생성한다", async () => {
    const id = await resolveCustomer("sess-new-" + Date.now());
    expect(typeof id).toBe("number");
  });
  it("같은 session_id는 같은 customer를 반환한다", async () => {
    const s = "sess-same-" + Date.now();
    const a = await resolveCustomer(s);
    const b = await resolveCustomer(s);
    expect(a).toBe(b);
  });
});

describe("health profile", () => {
  it("프로필이 없으면 빈 값을 반환한다", async () => {
    const cid = await resolveCustomer("sess-empty-" + Date.now());
    const p = await getHealthProfile(cid);
    expect(p.conditions).toEqual([]);
    expect(p.ageBand).toBeNull();
  });
  it("리스트는 합집합 병합, 스칼라는 보존한다", async () => {
    const cid = await resolveCustomer("sess-merge-" + Date.now());
    await saveHealthProfile(cid, { ageBand: "30대", medications: ["혈압약"] });
    const p = await saveHealthProfile(cid, { medications: ["오메가3", "혈압약"], pregnancy: "임신" });
    expect(p.medications.sort()).toEqual(["오메가3", "혈압약"]);
    expect(p.ageBand).toBe("30대"); // 미제공 스칼라 보존
    expect(p.pregnancy).toBe("임신");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web && npx vitest run tests/customers.test.ts`
Expected: FAIL — `@/lib/customers` 모듈 없음.

- [ ] **Step 3: 구현**

`web/src/lib/customers.ts`:
```ts
import { prisma } from "@/lib/prisma";
import { parseTags, stringifyTags } from "@/lib/products";

export async function resolveCustomer(sessionId: string): Promise<number> {
  const found = await prisma.identity.findUnique({
    where: {
      provider_providerAccountId: { provider: "anonymous", providerAccountId: sessionId },
    },
  });
  if (found) return found.customerId;
  const customer = await prisma.customer.create({
    data: { identities: { create: { provider: "anonymous", providerAccountId: sessionId } } },
  });
  return customer.id;
}

export type HealthProfileInput = {
  ageBand?: string;
  sex?: string;
  conditions?: string[];
  medications?: string[];
  allergies?: string[];
  pregnancy?: string;
  notes?: string;
};

export type HealthProfileView = {
  ageBand: string | null;
  sex: string | null;
  conditions: string[];
  medications: string[];
  allergies: string[];
  pregnancy: string | null;
  notes: string | null;
};

function unionTags(existing: string, incoming?: string[]): string {
  if (!incoming || incoming.length === 0) return existing;
  const merged = Array.from(new Set([...parseTags(existing), ...incoming.map(String)]));
  return stringifyTags(merged);
}

export async function getHealthProfile(customerId: number): Promise<HealthProfileView> {
  const p = await prisma.healthProfile.findUnique({ where: { customerId } });
  return {
    ageBand: p?.ageBand ?? null,
    sex: p?.sex ?? null,
    conditions: p ? parseTags(p.conditions) : [],
    medications: p ? parseTags(p.medications) : [],
    allergies: p ? parseTags(p.allergies) : [],
    pregnancy: p?.pregnancy ?? null,
    notes: p?.notes ?? null,
  };
}

export async function saveHealthProfile(
  customerId: number,
  input: HealthProfileInput
): Promise<HealthProfileView> {
  const existing = await prisma.healthProfile.findUnique({ where: { customerId } });
  const data = {
    ageBand: input.ageBand ?? existing?.ageBand ?? null,
    sex: input.sex ?? existing?.sex ?? null,
    pregnancy: input.pregnancy ?? existing?.pregnancy ?? null,
    notes: input.notes ?? existing?.notes ?? null,
    conditions: unionTags(existing?.conditions ?? "[]", input.conditions),
    medications: unionTags(existing?.medications ?? "[]", input.medications),
    allergies: unionTags(existing?.allergies ?? "[]", input.allergies),
  };
  await prisma.healthProfile.upsert({
    where: { customerId },
    create: { customerId, ...data },
    update: data,
  });
  return getHealthProfile(customerId);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npx vitest run tests/customers.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: 커밋**

```bash
cd web && git add src/lib/customers.ts tests/customers.test.ts
git commit -m "feat: resolveCustomer + 건강 프로필 get/save lib"
```

---

## Task 3: 건강 프로필 에이전트 엔드포인트

**Files:**
- Create: `web/src/app/api/agent-tools/health-profile/route.ts`
- Test: `web/tests/health-profile.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`web/tests/health-profile.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/agent-tools/health-profile/route";

function getReq(url: string) {
  return new NextRequest(new Request(url, { method: "GET" }));
}
function postReq(url: string, body: unknown) {
  return new NextRequest(
    new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

describe("health-profile endpoint", () => {
  it("session_id 없는 GET은 400", async () => {
    const res = await GET(getReq("http://t/api/agent-tools/health-profile"));
    expect(res.status).toBe(400);
  });
  it("POST 저장 후 GET으로 조회된다", async () => {
    const s = "sess-ep-" + Date.now();
    const post = await POST(
      postReq("http://t/api/agent-tools/health-profile", { session_id: s, conditions: ["고혈압"] })
    );
    expect(post.status).toBe(200);
    const got = await GET(getReq(`http://t/api/agent-tools/health-profile?session_id=${s}`));
    const json = await got.json();
    expect(json.conditions).toEqual(["고혈압"]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web && npx vitest run tests/health-profile.test.ts`
Expected: FAIL — route 모듈 없음.

- [ ] **Step 3: 구현**

`web/src/app/api/agent-tools/health-profile/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveCustomer, getHealthProfile, saveHealthProfile } from "@/lib/customers";

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("session_id");
  if (!sessionId) return NextResponse.json({ error: "session_id required" }, { status: 400 });
  const customerId = await resolveCustomer(sessionId);
  return NextResponse.json(await getHealthProfile(customerId));
}

const saveSchema = z.object({
  session_id: z.string().min(1),
  ageBand: z.string().optional(),
  sex: z.string().optional(),
  conditions: z.array(z.string()).optional(),
  medications: z.array(z.string()).optional(),
  allergies: z.array(z.string()).optional(),
  pregnancy: z.string().optional(),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = saveSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { session_id, ...input } = parsed.data;
  const customerId = await resolveCustomer(session_id);
  return NextResponse.json(await saveHealthProfile(customerId, input));
}
```

Note: `GET`/`POST`는 `NextRequest`를 받지만 테스트는 표준 `Request`를 캐스팅해 넘긴다. `req.nextUrl`은 Next 런타임에서 채워지므로, 테스트에서 GET은 `nextUrl` 접근을 위해 `NextRequest`로 들어와야 한다 — 테스트의 GET 호출은 `new NextRequest(url)`로 바꾼다. Step 1 테스트의 `req()` GET 분기를 다음으로 교체:
```ts
import { NextRequest } from "next/server";
// GET: return new NextRequest(url) as any;
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npx vitest run tests/health-profile.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: 커밋**

```bash
cd web && git add src/app/api/agent-tools/health-profile/route.ts tests/health-profile.test.ts
git commit -m "feat: 건강 프로필 GET/POST 에이전트 엔드포인트"
```

---

## Task 4: SSE 본문 파서 (`extractFromSSE`)

**Files:**
- Create: `web/src/lib/agentStream.ts`
- Test: `web/tests/agentStream.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`web/tests/agentStream.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { extractFromSSE } from "@/lib/agentStream";

describe("extractFromSSE", () => {
  it("token 이벤트를 이어붙여 답변을 만든다", () => {
    const raw =
      'event: token\ndata: {"text":"안녕"}\n\n' +
      'event: token\ndata: {"text":"하세요"}\n\n' +
      'event: done\ndata: {}\n\n';
    expect(extractFromSSE(raw)).toEqual({ text: "안녕하세요", ids: [] });
  });
  it("recommendations 이벤트에서 중복 없는 id를 모은다", () => {
    const raw =
      'event: recommendations\ndata: {"ids":[1,2]}\n\n' +
      'event: recommendations\ndata: {"ids":[2,3]}\n\n';
    expect(extractFromSSE(raw).ids).toEqual([1, 2, 3]);
  });
  it("emergency 메시지도 답변에 포함한다", () => {
    const raw = 'event: emergency\ndata: {"message":"병원에 가세요"}\n\n';
    expect(extractFromSSE(raw).text).toBe("병원에 가세요");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web && npx vitest run tests/agentStream.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`web/src/lib/agentStream.ts`:
```ts
// 에이전트 SSE 본문(text)에서 어시스턴트 답변과 추천 product id를 추출하는 순수 함수.
export function extractFromSSE(raw: string): { text: string; ids: number[] } {
  let text = "";
  const ids: number[] = [];
  for (const frame of raw.split("\n\n")) {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) continue;
    const data = dataLines.join("\n");
    try {
      if (event === "token") text += JSON.parse(data).text ?? "";
      else if (event === "emergency") text += JSON.parse(data).message ?? "";
      else if (event === "recommendations") {
        const arr = JSON.parse(data).ids;
        if (Array.isArray(arr)) for (const id of arr) if (!ids.includes(id)) ids.push(id);
      }
    } catch {
      // 파싱 불가 프레임은 무시
    }
  }
  return { text, ids };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npx vitest run tests/agentStream.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
cd web && git add src/lib/agentStream.ts tests/agentStream.test.ts
git commit -m "feat: 에이전트 SSE 본문 파서 extractFromSSE"
```

---

## Task 5: 상담·추천 적재 lib

**Files:**
- Create: `web/src/lib/consultations.ts`
- Test: `web/tests/consultations.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`web/tests/consultations.test.ts`:
```ts
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolveCustomer } from "@/lib/customers";
import { getOrCreateConsultation, appendMessage, saveRecommendations } from "@/lib/consultations";

describe("consultation 적재", () => {
  beforeAll(async () => {
    await prisma.pharmacist.upsert({ where: { id: 1 }, update: {}, create: { id: 1, name: "김약사" } });
  });

  it("같은 session_id는 같은 consultation을 재사용한다", async () => {
    const s = "sess-c-" + Date.now();
    const cid = await resolveCustomer(s);
    const a = await getOrCreateConsultation(s, cid);
    const b = await getOrCreateConsultation(s, cid);
    expect(a).toBe(b);
  });

  it("메시지를 적재한다", async () => {
    const s = "sess-m-" + Date.now();
    const cid = await resolveCustomer(s);
    const con = await getOrCreateConsultation(s, cid);
    await appendMessage(con, "user", "피곤해요");
    await appendMessage(con, "assistant", "비타민C를 추천드려요");
    const count = await prisma.message.count({ where: { consultationId: con } });
    expect(count).toBe(2);
  });

  it("추천은 중복 없이 저장한다", async () => {
    const s = "sess-r-" + Date.now();
    const cid = await resolveCustomer(s);
    const con = await getOrCreateConsultation(s, cid);
    const p = await prisma.product.create({ data: { name: "테스트제품", price: 1000, pharmacistId: 1 } });
    await saveRecommendations(con, [p.id, p.id]);
    const count = await prisma.recommendation.count({ where: { consultationId: con } });
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web && npx vitest run tests/consultations.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현**

`web/src/lib/consultations.ts`:
```ts
import { prisma } from "@/lib/prisma";

export async function getOrCreateConsultation(sessionId: string, customerId: number): Promise<number> {
  const existing = await prisma.consultation.findFirst({
    where: { sessionId },
    orderBy: { id: "desc" },
  });
  if (existing) return existing.id;
  const c = await prisma.consultation.create({ data: { sessionId, customerId } });
  return c.id;
}

export async function appendMessage(consultationId: number, role: string, content: string) {
  return prisma.message.create({ data: { consultationId, role, content } });
}

export async function saveRecommendations(consultationId: number, productIds: number[]) {
  for (const productId of productIds) {
    const exists = await prisma.recommendation.findFirst({ where: { consultationId, productId } });
    if (!exists) await prisma.recommendation.create({ data: { consultationId, productId } });
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npx vitest run tests/consultations.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: 커밋**

```bash
cd web && git add src/lib/consultations.ts tests/consultations.test.ts
git commit -m "feat: 상담/메시지/추천 적재 lib"
```

---

## Task 6: `/api/chat` — 상담·추천 적재 통합

**Files:**
- Modify: `web/src/app/api/chat/route.ts`

- [ ] **Step 1: 라우트 전체 교체**

`web/src/app/api/chat/route.ts` 전체를 아래로 교체:
```ts
import { NextRequest } from "next/server";
import { resolveCustomer } from "@/lib/customers";
import { getOrCreateConsultation, appendMessage, saveRecommendations } from "@/lib/consultations";
import { extractFromSSE } from "@/lib/agentStream";

// 클라이언트 메시지+session_id를 agent로 중계하고, 스트림을 거울처럼 통과시키며
// 상담 메시지/추천을 DB에 적재한다.
export async function POST(req: NextRequest) {
  const { message, session_id } = (await req.json()) as { message: string; session_id: string };
  const agentUrl = process.env.AGENT_URL ?? "http://localhost:8000";

  // 적재 준비 (실패해도 상담은 계속 진행)
  let consultationId: number | null = null;
  try {
    const customerId = await resolveCustomer(session_id);
    consultationId = await getOrCreateConsultation(session_id, customerId);
    await appendMessage(consultationId, "user", message);
  } catch {
    // 적재 실패는 무시
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${agentUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, session_id }),
    });
  } catch {
    return new Response("상담 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.", { status: 502 });
  }

  const body = teeAndPersist(upstream.body!, consultationId);
  return new Response(body, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

// 업스트림 스트림을 클라이언트로 그대로 흘려보내면서 원문을 모아두었다가,
// 완료 시 어시스턴트 답변과 추천을 적재한다.
function teeAndPersist(
  upstream: ReadableStream<Uint8Array>,
  consultationId: number | null
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let raw = "";
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          raw += decoder.decode(value, { stream: true });
          controller.enqueue(value);
        }
      } finally {
        controller.close();
        if (consultationId !== null) {
          const { text, ids } = extractFromSSE(raw);
          try {
            if (text) await appendMessage(consultationId, "assistant", text);
            if (ids.length) await saveRecommendations(consultationId, ids);
          } catch {
            // 적재 실패는 무시
          }
        }
      }
    },
  });
}
```

- [ ] **Step 2: 타입/린트 확인**

Run: `cd web && npx tsc --noEmit && npm run lint`
Expected: 에러 없음.

- [ ] **Step 3: 전체 web 테스트 회귀 확인**

Run: `cd web && npm test`
Expected: 전체 PASS (기존 + customers/health-profile/agentStream/consultations).

- [ ] **Step 4: 커밋**

```bash
cd web && git add src/app/api/chat/route.ts
git commit -m "feat: /api/chat에서 상담/추천 적재"
```

---

## Task 7: ChatPanel — session_id localStorage 영속화

**Files:**
- Modify: `web/src/components/store/ChatPanel.tsx:17-18`

- [ ] **Step 1: session_id 초기화 교체**

`web/src/components/store/ChatPanel.tsx`의 17-18행:
```ts
  const sessionId = useRef<string>("");
  if (!sessionId.current) sessionId.current = crypto.randomUUID();
```
을 다음으로 교체:
```ts
  const sessionId = useRef<string>("");
  if (!sessionId.current) {
    const stored = typeof window !== "undefined" ? localStorage.getItem("pham_session_id") : null;
    if (stored) {
      sessionId.current = stored;
    } else {
      sessionId.current = crypto.randomUUID();
      if (typeof window !== "undefined") localStorage.setItem("pham_session_id", sessionId.current);
    }
  }
```

- [ ] **Step 2: 타입/린트 확인**

Run: `cd web && npx tsc --noEmit && npm run lint`
Expected: 에러 없음.

- [ ] **Step 3: 커밋**

```bash
cd web && git add src/components/store/ChatPanel.tsx
git commit -m "feat: ChatPanel session_id를 localStorage에 영속화"
```

---

## Task 8: 에이전트 건강 프로필 도구 (tools.py)

**Files:**
- Modify: `agent/app/tools.py`
- Test: `agent/tests/test_tools.py`

- [ ] **Step 1: 실패하는 테스트 추가**

`agent/tests/test_tools.py` 끝에 추가:
```python
@respx.mock
async def test_fetch_health_profile_calls_web_api():
    route = respx.get("http://web.test/api/agent-tools/health-profile").mock(
        return_value=httpx.Response(200, json={"conditions": ["고혈압"], "medications": []})
    )
    from app.tools import _fetch_health_profile
    result = await _fetch_health_profile("sess-1", base_url="http://web.test")
    assert route.called
    assert route.calls.last.request.url.params.get("session_id") == "sess-1"
    assert result["conditions"] == ["고혈압"]

@respx.mock
async def test_save_health_profile_posts_session_and_fields():
    import json as _json
    route = respx.post("http://web.test/api/agent-tools/health-profile").mock(
        return_value=httpx.Response(200, json={"medications": ["혈압약"]})
    )
    from app.tools import _save_health_profile
    await _save_health_profile("sess-2", base_url="http://web.test", medications=["혈압약"], ageBand="")
    body = _json.loads(route.calls.last.request.content)
    assert body["session_id"] == "sess-2"
    assert body["medications"] == ["혈압약"]
    assert "ageBand" not in body  # 빈 값은 제외

def test_health_profile_tools_are_langchain_tools():
    from app.tools import get_health_profile, save_health_profile
    assert get_health_profile.name == "get_health_profile"
    assert save_health_profile.name == "save_health_profile"
    assert "medications" in save_health_profile.args
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd agent && uv run --extra dev python -m pytest tests/test_tools.py -q`
Expected: FAIL — `_fetch_health_profile`/`get_health_profile` 등 없음.

- [ ] **Step 3: 구현**

`agent/app/tools.py` 끝에 추가:
```python
async def _fetch_health_profile(session_id: str, base_url: str | None = None) -> dict:
    """저장된 건강 프로필을 web에서 조회하는 순수 HTTP 호출."""
    base = base_url or os.environ.get("WEB_INTERNAL_URL", "http://localhost:3000")
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{base}/api/agent-tools/health-profile", params={"session_id": session_id}
        )
        resp.raise_for_status()
        return resp.json()


async def _save_health_profile(session_id: str, base_url: str | None = None, **fields) -> dict:
    """건강 프로필을 web에 부분 병합 저장하는 순수 HTTP 호출. 빈 값은 제외한다."""
    base = base_url or os.environ.get("WEB_INTERNAL_URL", "http://localhost:3000")
    payload = {"session_id": session_id}
    for k, v in fields.items():
        if v not in (None, "", []):
            payload[k] = v
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(f"{base}/api/agent-tools/health-profile", json=payload)
        resp.raise_for_status()
        return resp.json()


@tool
async def get_health_profile() -> dict:
    """상담자의 저장된 건강 프로필(연령대·기저질환·복용약·알레르기·임신/수유 등)을 조회한다.
    상담 시작 시 호출해 이미 아는 정보는 다시 묻지 말고 안전 점검에 활용한다.
    (실제 호출은 그래프의 tools_node가 session_id를 주입해 수행한다.)"""
    return {}


@tool
async def save_health_profile(
    ageBand: str = "",
    sex: str = "",
    conditions: list[str] | None = None,
    medications: list[str] | None = None,
    allergies: list[str] | None = None,
    pregnancy: str = "",
    notes: str = "",
) -> dict:
    """대화에서 알게 된 상담자의 지속적 건강 사실을 저장한다. 알게 된 항목만 전달한다.
    일시적 증상이 아니라 연령대(ageBand)·기저질환(conditions)·복용 중인 약(medications)·
    알레르기(allergies)·임신/수유(pregnancy) 같은 지속 정보만 기록한다.
    (실제 호출은 그래프의 tools_node가 session_id를 주입해 수행한다.)"""
    return {}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd agent && uv run --extra dev python -m pytest tests/test_tools.py -q`
Expected: PASS (기존 3 + 신규 3).

- [ ] **Step 5: 커밋**

```bash
cd agent && git add app/tools.py tests/test_tools.py
git commit -m "feat: 에이전트 건강 프로필 도구 get/save_health_profile"
```

---

## Task 9: 그래프 — 도구명 디스패치 + session_id 주입

**Files:**
- Modify: `agent/app/graph.py:13` (import), `:44-47` (agent_node), `:50-73` (tools_node)
- Test: `agent/tests/test_graph.py`

- [ ] **Step 1: 실패하는 테스트 추가**

`agent/tests/test_graph.py` 끝에 추가:
```python
async def test_get_health_profile_dispatch_injects_session_id():
    from unittest.mock import AsyncMock as _AM, patch as _patch
    fake_model = _model([
        _ai(tool_calls=[{"name": "get_health_profile", "args": {}, "id": "h1", "type": "tool_call"}]),
        _ai(text="프로필을 확인했어요."),
    ])
    fetch = _AM(return_value={"conditions": ["고혈압"]})
    with _patch("app.triage.classify", new=_AM(return_value="normal")), \
         _patch("app.graph._chat_model", return_value=fake_model), \
         _patch("app.graph._fetch_health_profile", new=fetch):
        graph = build_graph(MemorySaver())
        await _collect(graph, "상담 시작할게요")
    fetch.assert_awaited_once()
    assert fetch.await_args.args[0] == "s1"  # thread_id == session_id 주입


async def test_save_health_profile_dispatch_passes_fields():
    from unittest.mock import AsyncMock as _AM, patch as _patch
    fake_model = _model([
        _ai(tool_calls=[{"name": "save_health_profile", "args": {"medications": ["혈압약"]}, "id": "s1", "type": "tool_call"}]),
        _ai(text="기록했어요."),
    ])
    save = _AM(return_value={"medications": ["혈압약"]})
    with _patch("app.triage.classify", new=_AM(return_value="normal")), \
         _patch("app.graph._chat_model", return_value=fake_model), \
         _patch("app.graph._save_health_profile", new=save):
        graph = build_graph(MemorySaver())
        await _collect(graph, "혈압약 먹고 있어요")
    save.assert_awaited_once()
    assert save.await_args.args[0] == "s1"
    assert save.await_args.kwargs.get("medications") == ["혈압약"]
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd agent && uv run --extra dev python -m pytest tests/test_graph.py -q`
Expected: FAIL — `app.graph._fetch_health_profile` 패치 대상 없음 / 디스패치 미구현.

- [ ] **Step 3: graph.py import 교체 (13행)**

```python
from app.tools import _fetch_products, search_products
```
을:
```python
from app.tools import (
    _fetch_products,
    _fetch_health_profile,
    _save_health_profile,
    search_products,
    get_health_profile,
    save_health_profile,
)
```

- [ ] **Step 4: agent_node 바인딩 교체 (45행)**

```python
    model = _chat_model().bind_tools([search_products])
```
을:
```python
    model = _chat_model().bind_tools([search_products, get_health_profile, save_health_profile])
```

- [ ] **Step 5: tools_node 교체 (50-73행)**

`RunnableConfig` import를 graph.py 상단 langchain_core 임포트에 추가하고:
```python
from langchain_core.runnables import RunnableConfig
```
`tools_node` 전체를 아래로 교체:
```python
async def tools_node(state: AgentState, config: RunnableConfig) -> dict:
    last = state["messages"][-1]
    writer = get_stream_writer()
    session_id = config["configurable"]["thread_id"]
    tool_messages: list[ToolMessage] = []
    ids = list(state["recommended_ids"])
    for call in last.tool_calls:
        name = call["name"]
        try:
            if name == "search_products":
                products = await _fetch_products(**call["args"])
                content = json.dumps(products, ensure_ascii=False)
                for p in products:
                    if isinstance(p, dict) and "id" in p and p["id"] not in ids:
                        ids.append(p["id"])
            elif name == "get_health_profile":
                profile = await _fetch_health_profile(session_id)
                content = json.dumps(profile, ensure_ascii=False)
            elif name == "save_health_profile":
                saved = await _save_health_profile(session_id, **call["args"])
                content = json.dumps(saved, ensure_ascii=False)
            else:
                content = f"알 수 없는 도구: {name}"
        except Exception:
            content = "도구 실행 중 오류가 발생했습니다. 결과를 가져오지 못했습니다."
        tool_messages.append(
            ToolMessage(content=content, tool_call_id=call["id"], name=name)
        )
    if ids != state["recommended_ids"]:
        writer({"type": "recommendations", "ids": ids})
    return {
        "messages": tool_messages,
        "recommended_ids": ids,
        "tool_turns": state["tool_turns"] + 1,
    }
```

- [ ] **Step 6: 전체 agent 테스트 통과 확인**

Run: `cd agent && uv run --extra dev python -m pytest -q`
Expected: PASS (기존 14 + tools 3 + graph 2 = 19). 기존 product 흐름 회귀 없음.

- [ ] **Step 7: 커밋**

```bash
cd agent && git add app/graph.py tests/test_graph.py
git commit -m "feat: tools_node 도구명 디스패치 + session_id 주입"
```

---

## Task 10: SYSTEM_PROMPT — 프로필 도구 사용 지침

**Files:**
- Modify: `agent/app/prompts.py`

- [ ] **Step 1: 원칙 추가**

`agent/app/prompts.py`의 `SYSTEM_PROMPT` 원칙 목록(번호 6 뒤)에 다음 두 원칙을 추가:
```
7. 상담 시작 시 get_health_profile로 상담자의 저장된 건강 프로필을 먼저 확인하세요. 이미 아는 정보(연령대·기저질환·복용약·알레르기·임신/수유)는 다시 묻지 말고, 추천과 주의사항에 반영하세요.
8. 대화 중 지속적인 건강 사실(기저질환·복용 중인 약·알레르기·임신/수유·연령대)을 알게 되면 save_health_profile로 기록하세요. 일시적·단발성 증상은 저장하지 마세요.
```

- [ ] **Step 2: 도구 호출 흐름 회귀 확인**

Run: `cd agent && uv run --extra dev python -m pytest -q`
Expected: PASS (19). 프롬프트 변경은 테스트에 영향 없음.

- [ ] **Step 3: 커밋**

```bash
cd agent && git add app/prompts.py
git commit -m "feat: 프로필 조회/저장 도구 사용 지침 추가"
```

---

## Task 11: 수동 통합 확인

**Files:** 없음 (실행 검증)

- [ ] **Step 1: 서버 기동**

Run: `make setup && make start` (web :3000, agent :8000). agent에 `ANTHROPIC_API_KEY` 환경변수 필요.

- [ ] **Step 2: 첫 상담 — 건강 사실 제공**

브라우저 http://localhost:3000 에서 "저는 30대이고 혈압약을 먹고 있어요. 피곤할 때 좋은 영양제 있나요?" 입력.
Expected: 추천이 우측에 뜨고, 혈압약 상호작용 주의가 답변에 언급된다.

- [ ] **Step 3: 새로고침 후 재상담 — 기억 확인**

페이지 새로고침 후 "피로에 또 뭐 없을까요?" 입력.
Expected: 연령대·혈압약을 다시 묻지 않고 이전 정보를 반영해 답한다. (localStorage의 동일 session_id로 프로필 회상)

- [ ] **Step 4: DB 적재 확인**

Run: `cd web && npx prisma studio` 또는
`cd web && node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.healthProfile.findMany().then(r=>{console.log(r);return p.\$disconnect()})"`
Expected: HealthProfile에 medications=["혈압약"], ageBand="30대"; Consultation/Message/Recommendation 행 존재.

- [ ] **Step 5: 서버 중지**

Run: `make stop`

---

## Self-Review 메모

- **Spec 커버리지:** §3 데이터 모델→T1, §4(a)→T7, §4(b)→T2, §5 도구→T8, §5 그래프→T9, §5 프롬프트→T10, §6 적재→T4·T5·T6, §7 테스트→각 Task의 TDD + T11. 누락 없음.
- **타입 일관성:** `resolveCustomer`/`getHealthProfile`/`saveHealthProfile`(T2) → 엔드포인트(T3)·도구(T8 web 호출) 시그니처 일치. `extractFromSSE`(T4) → `/api/chat`(T6) 사용 일치. tools.py `_fetch_health_profile(session_id)`/`_save_health_profile(session_id, **fields)`(T8) → graph 디스패치(T9) 호출 시그니처 일치.
- **범위 밖:** OAuth 로그인, get_consultation_history, 재구매, Order 연결은 미포함(스펙 §8).
