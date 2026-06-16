# RAG 상담 품질 향상 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 제품 추천을 의미 기반으로(Phase 1) 높이고, 상담 답변을 식약처 원료 지식에 그라운딩(Phase 2)하기 위해 Voyage 임베딩 + SQLite/Node 코사인 검색을 도구로 추가한다.

**Architecture:** 임베딩·벡터·검색은 모두 web(Node)에 두고 SQLite `KnowledgeChunk`(kind=product|ingredient)에 정규화된 Float32 벡터를 BLOB로 저장한다. 질의 시 Node에서 코사인 top-k를 계산한다. 에이전트는 기존 `/api/agent-tools/*` 패턴의 도구로만 접근한다. 임베딩 실패 시 lexical 폴백으로 채팅이 끊기지 않는다.

**Tech Stack:** Next.js 16 / Prisma + SQLite / vitest (web), FastAPI + LangGraph / pytest (agent), Voyage `voyage-3.5-lite` 임베딩(REST).

**참고 스펙:** [docs/superpowers/specs/2026-06-16-rag-consultation-design.md](../specs/2026-06-16-rag-consultation-design.md)

**상태:** ✅ 완료 — main 병합 `378d5fb` (12개 태스크 모두 구현·2단계 리뷰 완료). 아래 체크리스트는 실행 기록으로 보존.

---

## 실행 결과 (2026-06-17)

서브에이전트 기반(태스크별 구현 + 스펙/코드품질 2단계 리뷰 + 최종 종합 리뷰)으로 전 태스크 완료 후 `feat/rag-consultation` → main 병합·푸시.

| 태스크 | 커밋 | 태스크 | 커밋 |
|---|---|---|---|
| 1 KnowledgeChunk 모델 | `dd381f5` | 7 제품 색인+쓰기 훅 | `a48b197` |
| 2 vectors 유틸 | `8663423` | 8 하이브리드 제품 검색 | `8f90ba8` |
| 3 Voyage 임베딩 | `7058adc` | 9 retrieve_knowledge 도구 | `e7e35f1` |
| 4 knowledge 저장/검색 | `b79557a` | 10 그래프 바인딩·디스패치 | `ea6bdc9` |
| 5 retrieve-knowledge 엔드포인트 | `a318489` | 11 프롬프트 지침 | `e7d7d3d` |
| 6 원료 seed+색인 | `7a2b1e1` | 12 env fix(VOYAGE_TOKEN·.env) | `6cacb2e` |
| — | — | 최종 리뷰 보정 | `7eb9d69` |

**계획 대비 변경(실행 중 결정):**

- Task 8 하이브리드 테스트를 별도 파일 `web/tests/products-hybrid.test.ts`로 분리(임베딩 mock이 기존 제품 테스트에 번지지 않도록) + lexical/동의어가 못 잡는 **결정적** 의미검색 케이스로 작성.
- 임베딩 키: `embeddings.ts`가 `VOYAGE_API_KEY ?? VOYAGE_TOKEN` 모두 허용(.env가 `VOYAGE_TOKEN`을 사용 중).
- 색인 스크립트가 `.env`를 로드하도록 `import "dotenv/config"` 추가 + `dotenv`를 devDependency로 명시.
- 최종 리뷰 보정: 공유 dev.db 테스트 레이스 제거를 위해 vitest `fileParallelism: false`, 의미검색 상수화(`SEMANTIC_MIN_SCORE=0.2`/`SEMANTIC_TOP_K=10`), `.env.example`에 `EMBEDDING_DIM` 문서화.

**검증:** web vitest **45/45**, agent pytest **28/28**, `tsc --noEmit` clean. 폴백(임베딩 실패 시 lexical 검색·`retrieve-knowledge` `[]`)은 라이브로 확인됨.

**운영 주의(코드 결함 아님):** Voyage 무료 티어(3 RPM·결제수단 미등록)로 제품 17건 전량 색인 + 라이브 의미검색이 막힘. 결제수단 등록 후 `npm run index:products`(+`index:knowledge`) 재실행하면 의미검색·그라운딩이 정상화된다. 그 전까지는 lexical 폴백으로 동작. (참고: 로컬 :8000 포트가 다른 프로젝트와 충돌 시 web `.env`의 `AGENT_URL` 확인.)

**후속(범위 밖):** 원료 seed를 약사 검수로 20~30종 확장, 필요 시 Voyage `output_dimension` 연동, 대규모 시 `sqlite-vec`/리랭커.

---

## File Structure

**web (생성)**
- `web/src/lib/vectors.ts` — Float32 직렬화/역직렬화, L2 정규화, `cosineTopK`
- `web/src/lib/embeddings.ts` — Voyage `embed(texts, inputType)` (env 추상화)
- `web/src/lib/knowledge.ts` — `KnowledgeChunk` upsert/조회 + `retrieve(query, kind, k)`
- `web/src/app/api/agent-tools/retrieve-knowledge/route.ts` — 원료 지식 검색 엔드포인트
- `web/data/ingredient-knowledge.json` — 원료 지식 seed(약사 검수)
- `web/scripts/index-products.ts`, `web/scripts/index-knowledge.ts` — 색인 스크립트
- 테스트: `web/tests/vectors.test.ts`, `web/tests/embeddings.test.ts`, `web/tests/knowledge.test.ts`, `web/tests/retrieve-knowledge.test.ts`

**web (수정)**
- `web/prisma/schema.prisma` — `KnowledgeChunk` 모델
- `web/src/lib/products.ts` — `searchProducts` 하이브리드 + 쓰기 훅
- `web/src/lib/agentConfig.ts` — `DEFAULTS.system_prompt` 그라운딩 지침
- `web/package.json` — index 스크립트, `.env.example` — Voyage env
- `web/tests/products.test.ts` — 하이브리드/폴백 테스트

**agent (수정)**
- `agent/app/tools.py` — `_fetch_knowledge` + `retrieve_knowledge` 도구
- `agent/app/graph.py` — 도구 바인딩 + `tools_node` 디스패치
- `agent/app/prompts.py` — `SYSTEM_PROMPT` 그라운딩 지침
- 테스트: `agent/tests/test_tools.py`, `agent/tests/test_graph.py`

> 모든 작업은 브랜치 `feat/rag-consultation`에서 진행(이미 생성됨).

---

## Task 1: KnowledgeChunk 모델 + 마이그레이션

**Files:**
- Modify: `web/prisma/schema.prisma`

- [ ] **Step 1: 모델 추가** — `web/prisma/schema.prisma`의 `model HealthProfile {` 바로 앞에 삽입:

```prisma
model KnowledgeChunk {
  id        Int      @id @default(autoincrement())
  kind      String // "product" | "ingredient"
  refId     String? // product: productId / ingredient: 원료명
  title     String
  text      String
  metadata  String   @default("{}")
  embedding Bytes
  model     String
  updatedAt DateTime @updatedAt

  @@index([kind])
}
```

- [ ] **Step 2: 마이그레이션 적용**

Run: `cd web && npx prisma migrate dev --name add_knowledge_chunk`
Expected: `Your database is now in sync with your schema.` + Prisma Client 재생성.

- [ ] **Step 3: Commit**

```bash
git add web/prisma/schema.prisma web/prisma/migrations
git commit -m "feat(rag): KnowledgeChunk 모델 + 마이그레이션"
```

---

## Task 2: 벡터 유틸 (vectors.ts)

**Files:**
- Create: `web/src/lib/vectors.ts`
- Test: `web/tests/vectors.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `web/tests/vectors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalize, serialize, deserialize, cosineTopK } from "@/lib/vectors";

describe("vectors", () => {
  it("normalize makes unit length", () => {
    const v = normalize([3, 4]);
    expect(Math.hypot(...v)).toBeCloseTo(1, 6);
    expect(v[0]).toBeCloseTo(0.6, 6);
  });

  it("serialize/deserialize round-trips Float32", () => {
    const v = normalize([1, 2, 3, 4]);
    const back = Array.from(deserialize(serialize(v)));
    back.forEach((x, i) => expect(x).toBeCloseTo(v[i], 5));
  });

  it("cosineTopK ranks by similarity (normalized dot)", () => {
    const q = normalize([1, 0]);
    const chunks = [
      { id: 1, embedding: serialize(normalize([1, 0])) },
      { id: 2, embedding: serialize(normalize([0, 1])) },
      { id: 3, embedding: serialize(normalize([1, 1])) },
    ];
    const top = cosineTopK(q, chunks, 2);
    expect(top.map((t) => t.id)).toEqual([1, 3]);
    expect(top[0].score).toBeCloseTo(1, 5);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run tests/vectors.test.ts`
Expected: FAIL (`@/lib/vectors` 모듈 없음).

- [ ] **Step 3: 구현** — `web/src/lib/vectors.ts`:

```ts
export function normalize(vec: number[]): number[] {
  let norm = 0;
  for (const x of vec) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return vec.map((x) => x / norm);
}

export function serialize(vec: number[]): Buffer {
  const f32 = Float32Array.from(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

export function deserialize(buf: Buffer): Float32Array {
  // Prisma Bytes는 풀링된 Buffer일 수 있어 정렬을 위해 복사한다
  const copy = Uint8Array.prototype.slice.call(buf);
  return new Float32Array(copy.buffer);
}

type VecChunk<T> = T & { embedding: Buffer };

export function cosineTopK<T>(
  query: number[],
  chunks: VecChunk<T>[],
  k: number
): (T & { score: number })[] {
  const q = Float32Array.from(query); // query는 정규화되어 들어온다
  const scored = chunks.map((c) => {
    const v = deserialize(c.embedding);
    let dot = 0;
    const n = Math.min(q.length, v.length);
    for (let i = 0; i < n; i++) dot += q[i] * v[i];
    return { ...c, score: dot } as T & { score: number };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run tests/vectors.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/vectors.ts web/tests/vectors.test.ts
git commit -m "feat(rag): 벡터 직렬화·정규화·cosineTopK 유틸"
```

---

## Task 3: 임베딩 레이어 (embeddings.ts, Voyage)

**Files:**
- Create: `web/src/lib/embeddings.ts`
- Test: `web/tests/embeddings.test.ts`
- Modify: `web/.env.example`

- [ ] **Step 1: 실패하는 테스트 작성** (fetch 모킹) — `web/tests/embeddings.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { embed } from "@/lib/embeddings";

afterEach(() => vi.unstubAllGlobals());

describe("embed (voyage)", () => {
  it("posts to voyage and returns vectors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.VOYAGE_API_KEY = "test-key";

    const out = await embed(["a", "b"], "document");
    expect(out).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("voyageai.com");
    expect(JSON.parse(init.body).input_type).toBe("document");
    expect(init.headers.Authorization).toContain("test-key");
  });

  it("throws on non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate" }));
    process.env.VOYAGE_API_KEY = "test-key";
    await expect(embed(["x"], "query")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run tests/embeddings.test.ts`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현** — `web/src/lib/embeddings.ts`:

```ts
const PROVIDER = process.env.EMBEDDING_PROVIDER ?? "voyage";
const MODEL = process.env.EMBEDDING_MODEL ?? "voyage-3.5-lite";

/** 텍스트 배열을 임베딩한다. inputType: 색인="document", 질의="query". */
export async function embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (PROVIDER !== "voyage") throw new Error(`지원하지 않는 EMBEDDING_PROVIDER: ${PROVIDER}`);
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY 가 설정되지 않았습니다");

  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ input: texts, model: MODEL, input_type: inputType }),
  });
  if (!res.ok) throw new Error(`voyage embeddings 실패: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

export const EMBEDDING_MODEL_NAME = MODEL;
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run tests/embeddings.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: .env.example 갱신** — `web/.env.example`에 추가:

```
# 임베딩(RAG) — Voyage
VOYAGE_API_KEY=""
EMBEDDING_PROVIDER="voyage"
EMBEDDING_MODEL="voyage-3.5-lite"
```

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/embeddings.ts web/tests/embeddings.test.ts web/.env.example
git commit -m "feat(rag): Voyage 임베딩 레이어 + env"
```

---

## Task 4: 지식 저장/검색 (knowledge.ts)

**Files:**
- Create: `web/src/lib/knowledge.ts`
- Test: `web/tests/knowledge.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** (embeddings 모킹, prisma 사용) — `web/tests/knowledge.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/embeddings", () => ({
  embed: vi.fn(async (texts: string[]) =>
    texts.map((t) => (t.includes("눈") ? [1, 0] : [0, 1])) // 질의/문서 동일 규칙
  ),
  EMBEDDING_MODEL_NAME: "test-model",
}));

import { prisma } from "@/lib/prisma";
import { upsertChunk, retrieve } from "@/lib/knowledge";

beforeEach(async () => {
  await prisma.knowledgeChunk.deleteMany();
});

describe("knowledge retrieve", () => {
  it("returns top-k by cosine within a kind", async () => {
    await upsertChunk({ kind: "ingredient", refId: "루테인", title: "루테인", text: "눈 건강", metadata: {} });
    await upsertChunk({ kind: "ingredient", refId: "유산균", title: "유산균", text: "장 건강", metadata: {} });

    const hits = await retrieve("눈이 침침", "ingredient", 1);
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe("루테인");
    expect(hits[0].score).toBeGreaterThan(0.9);
  });

  it("filters by kind", async () => {
    await upsertChunk({ kind: "product", refId: "1", title: "P", text: "눈 영양제", metadata: {} });
    const hits = await retrieve("눈", "ingredient", 5);
    expect(hits).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run tests/knowledge.test.ts`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: 구현** — `web/src/lib/knowledge.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { embed, EMBEDDING_MODEL_NAME } from "@/lib/embeddings";
import { normalize, serialize, cosineTopK } from "@/lib/vectors";

export type ChunkInput = {
  kind: "product" | "ingredient";
  refId?: string;
  title: string;
  text: string;
  metadata: Record<string, unknown>;
};

/** 텍스트를 임베딩(정규화)해 KnowledgeChunk를 refId+kind 기준 upsert한다. */
export async function upsertChunk(input: ChunkInput): Promise<void> {
  const [vec] = await embed([input.text], "document");
  const embedding = serialize(normalize(vec));
  const data = {
    kind: input.kind,
    refId: input.refId ?? null,
    title: input.title,
    text: input.text,
    metadata: JSON.stringify(input.metadata ?? {}),
    embedding,
    model: EMBEDDING_MODEL_NAME,
  };
  const existing = await prisma.knowledgeChunk.findFirst({
    where: { kind: input.kind, refId: input.refId ?? null },
    select: { id: true },
  });
  if (existing) await prisma.knowledgeChunk.update({ where: { id: existing.id }, data });
  else await prisma.knowledgeChunk.create({ data });
}

export type KnowledgeHit = { title: string; text: string; metadata: Record<string, unknown>; score: number };

/** 질의를 임베딩해 해당 kind에서 코사인 top-k를 반환한다. */
export async function retrieve(query: string, kind: "product" | "ingredient", k: number): Promise<KnowledgeHit[]> {
  const [qvec] = await embed([query], "query");
  const q = normalize(qvec);
  const chunks = await prisma.knowledgeChunk.findMany({ where: { kind } });
  const top = cosineTopK(q, chunks, k);
  return top.map((c) => ({
    title: c.title,
    text: c.text,
    metadata: JSON.parse(c.metadata || "{}"),
    score: c.score,
  }));
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run tests/knowledge.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/knowledge.ts web/tests/knowledge.test.ts
git commit -m "feat(rag): KnowledgeChunk upsert + 코사인 retrieve"
```

---

## Task 5: retrieve-knowledge 엔드포인트

**Files:**
- Create: `web/src/app/api/agent-tools/retrieve-knowledge/route.ts`
- Test: `web/tests/retrieve-knowledge.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성** — `web/tests/retrieve-knowledge.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/embeddings", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map((t) => (t.includes("오메가") ? [1, 0] : [0, 1]))),
  EMBEDDING_MODEL_NAME: "test-model",
}));

import { prisma } from "@/lib/prisma";
import { upsertChunk } from "@/lib/knowledge";
import { GET } from "@/app/api/agent-tools/retrieve-knowledge/route";

beforeEach(async () => {
  await prisma.knowledgeChunk.deleteMany();
});

it("returns ranked knowledge hits as JSON", async () => {
  await upsertChunk({ kind: "ingredient", refId: "오메가3", title: "오메가3", text: "오메가 혈행", metadata: { 주의사항: "출혈 위험" } });
  const req = new NextRequest("http://localhost/api/agent-tools/retrieve-knowledge?q=오메가&k=3");
  const res = await GET(req);
  const body = await res.json();
  expect(body[0].title).toBe("오메가3");
  expect(body[0].metadata.주의사항).toBe("출혈 위험");
});

it("400 when q missing", async () => {
  const req = new NextRequest("http://localhost/api/agent-tools/retrieve-knowledge");
  const res = await GET(req);
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run tests/retrieve-knowledge.test.ts`
Expected: FAIL (route 없음).

- [ ] **Step 3: 구현** — `web/src/app/api/agent-tools/retrieve-knowledge/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { retrieve } from "@/lib/knowledge";

// 에이전트 전용 내부 도구. 원료 지식을 의미 기반으로 검색해 근거를 반환.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  const k = Number(req.nextUrl.searchParams.get("k") ?? "4");
  if (!q) return NextResponse.json({ error: "q가 필요합니다" }, { status: 400 });
  try {
    const hits = await retrieve(q, "ingredient", Number.isFinite(k) ? k : 4);
    return NextResponse.json(hits);
  } catch {
    // 임베딩 실패 등 → 근거 없음(채팅은 계속)
    return NextResponse.json([]);
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run tests/retrieve-knowledge.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/app/api/agent-tools/retrieve-knowledge web/tests/retrieve-knowledge.test.ts
git commit -m "feat(rag): retrieve-knowledge 내부 엔드포인트"
```

---

## Task 6: 원료 지식 seed + 색인 스크립트

**Files:**
- Create: `web/data/ingredient-knowledge.json`
- Create: `web/scripts/index-knowledge.ts`
- Modify: `web/package.json`

- [ ] **Step 1: seed 코퍼스 작성** — `web/data/ingredient-knowledge.json`. 식약처 인정정보 기반·약사 검수 항목. 최소 시작 세트(이후 확장):

```json
[
  {
    "원료명": "오메가3",
    "기능성": "혈중 중성지방 개선·혈행 개선에 도움을 줄 수 있음",
    "주의사항": "고용량은 출혈 경향을 높일 수 있음",
    "상호작용": "와파린 등 항응고·항혈소판제와 병용 시 출혈 위험 증가 가능",
    "일일섭취량": "EPA와 DHA의 합으로 0.5~2 g",
    "출처": "식약처 건강기능식품 기능성 원료 인정정보"
  },
  {
    "원료명": "루테인",
    "기능성": "노화로 인한 황반색소밀도 유지에 도움을 줄 수 있음",
    "주의사항": "흡연자의 고용량 베타카로틴 병용 주의",
    "상호작용": "특이 보고 적음",
    "일일섭취량": "10~20 mg",
    "출처": "식약처 건강기능식품 기능성 원료 인정정보"
  },
  {
    "원료명": "마그네슘",
    "기능성": "에너지 생성과 신경·근육 기능 유지에 필요",
    "주의사항": "과량 섭취 시 설사 가능, 신장질환자 주의",
    "상호작용": "일부 항생제·골다공증약 흡수 저해 가능(복용 간격 두기)",
    "일일섭취량": "315 mg 내외(상한 350 mg, 식품 외 급원)",
    "출처": "식약처 건강기능식품 기능성 원료 인정정보"
  }
]
```

> 구현자 주의: 이 파일은 **약사 검수 후 20~30종으로 확장**한다. LLM으로 내용을 생성하지 말 것. 각 항목 `출처` 필수.

- [ ] **Step 2: 색인 스크립트 작성** — `web/scripts/index-knowledge.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { upsertChunk } from "../src/lib/knowledge";

type Row = {
  원료명: string; 기능성: string; 주의사항: string; 상호작용: string; 일일섭취량: string; 출처: string;
};

async function main() {
  const path = resolve(process.cwd(), "data/ingredient-knowledge.json");
  const rows = JSON.parse(readFileSync(path, "utf8")) as Row[];
  for (const r of rows) {
    const text = `${r.원료명}. 기능성: ${r.기능성}. 주의사항: ${r.주의사항}. 상호작용: ${r.상호작용}. 일일섭취량: ${r.일일섭취량}.`;
    await upsertChunk({
      kind: "ingredient",
      refId: r.원료명,
      title: r.원료명,
      text,
      metadata: { 주의사항: r.주의사항, 상호작용: r.상호작용, 일일섭취량: r.일일섭취량, 출처: r.출처 },
    });
    console.log(`indexed: ${r.원료명}`);
  }
  console.log(`완료: ${rows.length}건`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: package.json 스크립트 추가** — `web/package.json`의 `"scripts"`에 추가:

```json
"index:knowledge": "tsx scripts/index-knowledge.ts"
```

> `tsx`가 devDependency에 없으면 추가: `npm i -D tsx` (기존 seed 스크립트가 ts-node/tsx 중 무엇을 쓰는지 `package.json`에서 확인하고 동일 방식을 따른다).

- [ ] **Step 4: 색인 실행(키 필요)**

Run: `cd web && VOYAGE_API_KEY=<키> npm run index:knowledge`
Expected: `indexed: 오메가3 ...` + `완료: N건`. (키 없으면 이 단계는 스킵하고 Task 12 검증에서 수행)

- [ ] **Step 5: Commit**

```bash
git add web/data/ingredient-knowledge.json web/scripts/index-knowledge.ts web/package.json
git commit -m "feat(rag): 원료 지식 seed + 색인 스크립트"
```

---

## Task 7: 제품 색인 스크립트 + 쓰기 훅

**Files:**
- Create: `web/scripts/index-products.ts`
- Modify: `web/src/lib/products.ts` (쓰기 훅), `web/package.json`

- [ ] **Step 1: 제품 청크 헬퍼 + 훅 추가** — `web/src/lib/products.ts` 상단 import에 추가하고 헬퍼를 정의:

```ts
import { upsertChunk } from "@/lib/knowledge";

// 제품 1건을 KnowledgeChunk(kind=product)로 색인. 실패는 무시(임베딩 장애 시 lexical 폴백).
export async function indexProduct(p: {
  id: number; name: string; brand?: string | null; description?: string | null;
  ingredients?: string | null; conditionTags: string;
}): Promise<void> {
  try {
    const tags = parseTags(p.conditionTags).join(" ");
    const text = [p.name, p.brand, p.description, p.ingredients, tags].filter(Boolean).join(" / ");
    await upsertChunk({
      kind: "product",
      refId: String(p.id),
      title: p.name,
      text,
      metadata: { brand: p.brand ?? null },
    });
  } catch (e) {
    console.error(`product 색인 실패(무시) id=${p.id}`, e);
  }
}
```

- [ ] **Step 2: createProduct/updateProduct에 best-effort 훅 연결** — 각 함수가 product를 반환한 직후 `await indexProduct(product)` 호출(반환 전). `createManyProducts`는 각 생성 직후 `await indexProduct(created)`(루프 내, try/catch 안에서 호출되므로 실패해도 카운트에 영향 없음). 예:

```ts
export async function updateProduct(id: number, input: { /* 기존 시그니처 동일 */ }) {
  const { conditionTags, ...rest } = input;
  const product = await prisma.product.update({
    where: { id },
    data: { ...rest, ...(conditionTags ? { conditionTags: stringifyTags(conditionTags) } : {}) },
  });
  await indexProduct(product);
  return product;
}
```

- [ ] **Step 3: 백필 스크립트 작성** — `web/scripts/index-products.ts`:

```ts
import { prisma } from "../src/lib/prisma";
import { indexProduct } from "../src/lib/products";

async function main() {
  const products = await prisma.product.findMany({ where: { isActive: true } });
  for (const p of products) await indexProduct(p);
  console.log(`제품 색인 완료: ${products.length}건`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: package.json 스크립트 추가**

```json
"index:products": "tsx scripts/index-products.ts"
```

- [ ] **Step 5: 타입체크**

Run: `cd web && npx tsc --noEmit`
Expected: 통과(에러 없음).

- [ ] **Step 6: Commit**

```bash
git add web/scripts/index-products.ts web/src/lib/products.ts web/package.json
git commit -m "feat(rag): 제품 색인 스크립트 + 쓰기 훅"
```

---

## Task 8: 하이브리드 제품 검색

**Files:**
- Modify: `web/src/lib/products.ts` (`searchProducts`)
- Test: `web/tests/products.test.ts`

- [ ] **Step 1: 실패하는 테스트 추가** — `web/tests/products.test.ts`에 추가(embeddings 모킹). 의미검색이 동의어 사전에 없는 표현을 잡는지 + 임베딩 실패 시 lexical 폴백:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/embeddings", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map((t) => (/축\s*처|기운|눈/.test(t) ? [1, 0] : [0, 1]))),
  EMBEDDING_MODEL_NAME: "test-model",
}));

import { prisma } from "@/lib/prisma";
import { searchProducts, indexProduct } from "@/lib/products";

describe("searchProducts hybrid", () => {
  beforeEach(async () => {
    await prisma.knowledgeChunk.deleteMany();
  });

  it("finds product via semantic match not in synonym dict", async () => {
    const p = await prisma.product.findFirst({ where: { isActive: true } });
    if (!p) return; // 시드 필요
    await indexProduct(p);
    const results = await searchProducts({ condition: "축 처지고 기운 없음" });
    expect(results.some((r) => r.id === p.id)).toBe(true);
  });

  it("falls back to lexical when embedding throws", async () => {
    const mod = await import("@/lib/embeddings");
    (mod.embed as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("no key"));
    const results = await searchProducts({ keyword: "비타민" });
    expect(Array.isArray(results)).toBe(true); // 예외 없이 lexical 결과 반환
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run tests/products.test.ts`
Expected: 새 테스트 FAIL(semantic 미구현).

- [ ] **Step 3: searchProducts 하이브리드로 수정** — 기존 lexical 로직을 내부 헬퍼로 유지하고 의미검색을 합친다:

```ts
import { embed } from "@/lib/embeddings";
import { normalize, cosineTopK } from "@/lib/vectors";

async function semanticProductIds(queryText: string, k: number): Promise<number[]> {
  const [qvec] = await embed([queryText], "query");
  const q = normalize(qvec);
  const chunks = await prisma.knowledgeChunk.findMany({ where: { kind: "product" } });
  return cosineTopK(q, chunks, k)
    .filter((c) => c.score > 0.2)
    .map((c) => Number(c.refId))
    .filter((n) => Number.isFinite(n));
}

export async function searchProducts(opts: { condition?: string; keyword?: string }) {
  const all = await prisma.product.findMany({ where: { isActive: true } });
  const terms = [opts.condition, opts.keyword].filter(Boolean) as string[];
  if (terms.length === 0) return all;

  // 기존 lexical(직접 부분일치 + 동의어 태그)
  const expanded = expandQueryTags(terms.join(" "));
  const lexical = all.filter((p) => {
    if (terms.some((t) => matchesQuery(p, t))) return true;
    if (expanded.size === 0) return false;
    return parseTags(p.conditionTags).some((t) => expanded.has(t));
  });

  // 의미검색(실패 시 무시)
  let semantic: typeof all = [];
  try {
    const ids = await semanticProductIds(terms.join(" "), 10);
    const byId = new Map(all.map((p) => [p.id, p]));
    semantic = ids.map((id) => byId.get(id)).filter((p): p is (typeof all)[number] => !!p);
  } catch (e) {
    console.error("의미검색 실패 → lexical만 사용", e);
  }

  // 병합: 의미검색 우선, 중복 제거 후 lexical 추가
  const seen = new Set<number>();
  const merged: typeof all = [];
  for (const p of [...semantic, ...lexical]) {
    if (!seen.has(p.id)) { seen.add(p.id); merged.push(p); }
  }
  return merged;
}
```

- [ ] **Step 4: 통과 확인 (전체 products 테스트)**

Run: `cd web && npx vitest run tests/products.test.ts`
Expected: PASS(기존 + 신규). 기존 lexical 테스트가 깨지지 않아야 함.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/products.ts web/tests/products.test.ts
git commit -m "feat(rag): 하이브리드(의미+lexical) 제품 검색 + 폴백"
```

---

## Task 9: 에이전트 retrieve_knowledge 도구

**Files:**
- Modify: `agent/app/tools.py`
- Test: `agent/tests/test_tools.py`

- [ ] **Step 1: 실패하는 테스트 작성** — `agent/tests/test_tools.py`에 추가:

```python
import httpx
import pytest
from app.tools import _fetch_knowledge


@pytest.mark.asyncio
async def test_fetch_knowledge_calls_endpoint(monkeypatch):
    captured = {}

    class FakeResp:
        def raise_for_status(self): pass
        def json(self): return [{"title": "오메가3", "text": "...", "metadata": {}, "score": 0.9}]

    class FakeClient:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): pass
        async def get(self, url, params=None):
            captured["url"] = url; captured["params"] = params
            return FakeResp()

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    out = await _fetch_knowledge(query="오메가", k=3)
    assert out[0]["title"] == "오메가3"
    assert captured["url"].endswith("/api/agent-tools/retrieve-knowledge")
    assert captured["params"] == {"q": "오메가", "k": 3}
```

> 기존 `test_tools.py`가 async 테스트를 어떻게 실행하는지 확인하고(pytest-asyncio 마커 또는 anyio) 동일 방식을 따른다.

- [ ] **Step 2: 실패 확인**

Run: `cd agent && .venv/bin/python -m pytest tests/test_tools.py -k knowledge -v`
Expected: FAIL (`_fetch_knowledge` 없음).

- [ ] **Step 3: 구현** — `agent/app/tools.py`에 추가(기존 `_fetch_*` 패턴):

```python
async def _fetch_knowledge(query: str = "", k: int = 4, base_url: str | None = None) -> list[dict]:
    """원료 지식을 web 내부 API에서 의미검색하는 순수 HTTP 호출."""
    base = base_url or os.environ.get("WEB_INTERNAL_URL", "http://localhost:3000")
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{base}/api/agent-tools/retrieve-knowledge", params={"q": query, "k": k}
        )
        resp.raise_for_status()
        return resp.json()


@tool
async def retrieve_knowledge(query: str, k: int = 4) -> list[dict]:
    """건강기능식품 원료의 기능성·주의사항·상호작용 근거를 검색한다.
    성분·복용·상호작용·안전 안내를 하기 전에 호출해 검색된 근거에 기반해 답한다."""
    return await _fetch_knowledge(query=query, k=k)
```

- [ ] **Step 4: 통과 확인**

Run: `cd agent && .venv/bin/python -m pytest tests/test_tools.py -k knowledge -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/app/tools.py agent/tests/test_tools.py
git commit -m "feat(rag): 에이전트 retrieve_knowledge 도구"
```

---

## Task 10: 그래프 바인딩 + 디스패치

**Files:**
- Modify: `agent/app/graph.py`
- Test: `agent/tests/test_graph.py`

- [ ] **Step 1: import + 바인딩 + 디스패치 수정** — `agent/app/graph.py`:

import 블록에 `retrieve_knowledge`, `_fetch_knowledge` 추가:

```python
from app.tools import (
    _fetch_products,
    _fetch_health_profile,
    _save_health_profile,
    _fetch_knowledge,
    search_products,
    get_health_profile,
    save_health_profile,
    load_consultation_skill,
    retrieve_knowledge,
)
```

`agent_node`의 `bind_tools`에 추가:

```python
    model = _chat_model().bind_tools(
        [search_products, get_health_profile, save_health_profile, load_consultation_skill, retrieve_knowledge]
    )
```

`tools_node` 디스패치에 분기 추가(`load_consultation_skill` 분기 뒤):

```python
            elif name == "retrieve_knowledge":
                knowledge = await _fetch_knowledge(**call["args"])
                content = json.dumps(knowledge, ensure_ascii=False)
```

- [ ] **Step 2: 디스패치 테스트 추가** — `agent/tests/test_graph.py`에 추가(기존 그래프 테스트 패턴을 따른다. `tools_node`를 직접 호출해 `retrieve_knowledge` tool_call을 처리하는지 확인, `_fetch_knowledge`를 monkeypatch):

```python
@pytest.mark.asyncio
async def test_tools_node_dispatches_retrieve_knowledge(monkeypatch):
    from app import graph

    async def fake_fetch_knowledge(**kwargs):
        return [{"title": "오메가3", "text": "출혈 주의", "metadata": {}, "score": 0.9}]

    monkeypatch.setattr(graph, "_fetch_knowledge", fake_fetch_knowledge)

    ai = AIMessage(content="", tool_calls=[{"name": "retrieve_knowledge", "args": {"query": "오메가", "k": 4}, "id": "t1"}])
    state = {"messages": [ai], "recommended_ids": [], "tool_turns": 0, "triage": "normal"}
    config = {"configurable": {"thread_id": "s1"}}
    out = await graph.tools_node(state, config)
    msg = out["messages"][0]
    assert "오메가3" in msg.content
    assert msg.name == "retrieve_knowledge"
```

> `AIMessage` import 및 async 실행 방식은 기존 `test_graph.py`를 따른다.

- [ ] **Step 3: 통과 확인**

Run: `cd agent && .venv/bin/python -m pytest tests/test_graph.py -v`
Expected: PASS(기존 + 신규).

- [ ] **Step 4: Commit**

```bash
git add agent/app/graph.py agent/tests/test_graph.py
git commit -m "feat(rag): retrieve_knowledge 그래프 바인딩·디스패치"
```

---

## Task 11: 그라운딩 시스템 프롬프트 지침

**Files:**
- Modify: `agent/app/prompts.py`, `web/src/lib/agentConfig.ts`

- [ ] **Step 1: 폴백 프롬프트 수정** — `agent/app/prompts.py` `SYSTEM_PROMPT`의 원칙 목록에 한 줄 추가(추천 원칙 뒤):

```
9. 성분·복용량·상호작용·안전과 관련된 안내를 하기 전에는 retrieve_knowledge 도구로 근거를 검색하고, 검색된 내용에 기반해 답하세요. 근거가 없으면 단정하지 말고 대면 약사 상담을 권하세요.
```

- [ ] **Step 2: web 기본 프롬프트 동기화** — `web/src/lib/agentConfig.ts` `DEFAULTS.system_prompt`의 동일 위치에 같은 9번 원칙을 추가(두 기본값이 어긋나면 안 됨).

- [ ] **Step 3: 임포트/문법 확인**

Run: `cd agent && .venv/bin/python -c "import app.prompts, app.graph; print('ok')"` → `ok`
Run: `cd web && npx tsc --noEmit` → 통과

- [ ] **Step 4: Commit**

```bash
git add agent/app/prompts.py web/src/lib/agentConfig.ts
git commit -m "feat(rag): 그라운딩 시스템 프롬프트 지침(폴백+기본값 동기화)"
```

---

## Task 12: 전체 검증 (E2E)

**Files:** 없음(실행/검증만)

- [ ] **Step 1: 회귀 테스트 (web + agent)**

Run: `cd web && npx vitest run` → 전체 PASS
Run: `cd agent && .venv/bin/python -m pytest -q` → 전체 PASS

- [ ] **Step 2: 색인 (실제 Voyage 키 필요)**

`web/.env`에 `VOYAGE_API_KEY` 채운 뒤:
Run: `cd web && npm run index:products && npm run index:knowledge`
Expected: 제품/원료 청크 적재 로그. 확인: `npx prisma studio`로 `KnowledgeChunk` 행 확인 또는 `sqlite3 prisma/dev.db "select kind, count(*) from KnowledgeChunk group by kind;"`.

- [ ] **Step 3: 서버 기동 + 의미검색 확인**

Run: `make start` (web:3000, agent:8000)
- 상담 화면에서 동의어 사전에 없는 표현 입력: "요즘 축 처지고 기운이 하나도 없어요" → 피로 관련 제품이 추천 카드에 뜨는지.
- API 직접: `curl "localhost:3000/api/agent-tools/search-products?condition=축%20처지고%20기운%20없음"` → 관련 제품 포함.

- [ ] **Step 4: 그라운딩 확인**

- 상담: "와파린 먹는데 오메가3 같이 먹어도 되나요?" → 에이전트가 `retrieve_knowledge` 호출 후 출혈 위험·주의 근거로 답하는지(`make logs`로 도구 호출 확인).
- API 직접: `curl "localhost:3000/api/agent-tools/retrieve-knowledge?q=오메가3%20와파린"` → 오메가3 항목 + `주의사항` 메타.

- [ ] **Step 5: 폴백 확인**

- `web/.env`의 `VOYAGE_API_KEY`를 잠시 비우고 web 재시작 → 상담/검색이 lexical로 정상 동작(에러 없이), `retrieve-knowledge`는 `[]` 반환.

- [ ] **Step 6: 최종 커밋(있으면)**

```bash
git add -A && git commit -m "test(rag): E2E 검증 보정" || echo "변경 없음"
```

---

## Self-Review (작성자 점검 결과)

- **스펙 커버리지:** KnowledgeChunk(Task1), 임베딩 Voyage(Task3), 벡터/코사인(Task2), Phase1 하이브리드 제품검색(Task7-8), Phase2 지식 그라운딩(Task4-6,9-10), 프롬프트 지침(Task11), 폴백(Task5,8,12), 색인 스크립트(Task6-7), 테스트(각 Task), E2E(Task12) — 스펙 항목 모두 매핑됨.
- **타입 일관성:** `embed(texts, inputType)`·`EMBEDDING_MODEL_NAME`·`normalize/serialize/deserialize/cosineTopK`·`upsertChunk(ChunkInput)`·`retrieve(query,kind,k)`·`_fetch_knowledge`·`retrieve_knowledge` 시그니처가 정의 Task와 사용 Task에서 일치.
- **플레이스홀더:** 없음. 단 Task6 seed는 의도적으로 "약사 검수 후 확장" 지시(내용 자체는 출처 명시된 예시 3종 제공).

## Open items (구현 중 확인)
- `tsx` vs `ts-node`: 기존 `npm run seed`가 쓰는 러너를 따른다(Task6 Step3).
- web 테스트의 prisma dev.db 정리 방식: 기존 `web/tests` 패턴을 따른다(KnowledgeChunk는 각 테스트 beforeEach에서 deleteMany).
- pytest async 실행기(pytest-asyncio/anyio): 기존 `agent/tests` 설정을 따른다.
