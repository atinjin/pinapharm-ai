# 약사 상담 + 영양제 추천 시스템 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 일반인이 웹 채팅으로 약사 지식 기반 상담을 받고, 약사가 어드민에서 등록한 영양제를 추천·구매할 수 있는 프로토타입을 구축한다.

**Architecture:** 단일 git 저장소에 두 서비스 — `web/`(Next.js: 채팅 UI + 약사 어드민 + 영양제 CRUD + Prisma/SQLite, 데이터 단일 소스)와 `agent/`(FastAPI + Claude Agent SDK: 약사 에이전트, tool-use 루프). 에이전트는 DB를 직접 만지지 않고 web의 내부 API를 도구로 HTTP 호출한다.

**Tech Stack:** Next.js 15 (App Router, TypeScript), Prisma + SQLite, Vercel AI SDK(useChat), Python 3.11 + FastAPI + anthropic SDK, pytest, vitest.

---

## 파일 구조

```
pharmacist-agent/
├── web/
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.ts
│   ├── .env.example
│   ├── prisma/
│   │   ├── schema.prisma          # 데이터 모델
│   │   └── seed.ts                # 약사 1명 + 샘플 영양제 시드
│   ├── src/
│   │   ├── lib/
│   │   │   ├── prisma.ts          # Prisma 클라이언트 싱글톤
│   │   │   └── products.ts        # 영양제 조회/검색 도메인 함수
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx           # 상담 채팅 페이지
│   │   │   ├── admin/page.tsx     # 약사 어드민
│   │   │   └── api/
│   │   │       ├── products/route.ts          # GET 목록, POST 생성
│   │   │       ├── products/[id]/route.ts     # PUT 수정, DELETE 삭제
│   │   │       ├── chat/route.ts              # agent로 스트림 프록시
│   │   │       ├── agent-tools/search-products/route.ts  # 에이전트 도구 엔드포인트
│   │   │       └── orders/route.ts            # 주문 스텁
│   │   └── components/
│   │       ├── ChatPanel.tsx      # 채팅 UI
│   │       ├── ProductCard.tsx    # 추천 영양제 카드 + 구매 버튼
│   │       └── AdminProductForm.tsx
│   └── tests/
│       ├── products.test.ts       # products 도메인 함수 테스트
│       └── api-products.test.ts   # CRUD API 테스트
└── agent/
    ├── pyproject.toml
    ├── .env.example
    ├── app/
    │   ├── __init__.py
    │   ├── main.py                # FastAPI 앱, POST /chat
    │   ├── agent.py               # Claude tool-use 루프
    │   ├── tools.py               # search_products 도구 (web API 호출)
    │   ├── prompts.py             # 시스템 프롬프트 + 안전 가드레일
    │   └── schemas.py             # 요청/응답 Pydantic 모델
    └── tests/
        ├── test_tools.py
        └── test_agent.py
```

---

## Phase 0: 저장소 골격

### Task 0: 루트 README와 디렉토리 골격

**Files:**
- Create: `README.md`
- Create: `web/.env.example`
- Create: `agent/.env.example`

- [ ] **Step 1: 루트 README 작성**

Create `README.md`:

```markdown
# pharmacist-agent

약사 상담 + 영양제 추천 프로토타입.

## 구성
- `web/`  — Next.js (채팅 UI, 약사 어드민, 영양제 CRUD, Prisma/SQLite)
- `agent/` — FastAPI + Claude Agent SDK (약사 에이전트)

## 실행
1. `cd web && npm install && npx prisma migrate dev && npm run seed && npm run dev`  (http://localhost:3000)
2. `cd agent && pip install -e . && uvicorn app.main:app --reload --port 8000`

환경변수는 각 폴더 `.env.example` 참고.
```

- [ ] **Step 2: web/.env.example 작성**

Create `web/.env.example`:

```
DATABASE_URL="file:./dev.db"
AGENT_URL="http://localhost:8000"
```

- [ ] **Step 3: agent/.env.example 작성**

Create `agent/.env.example`:

```
ANTHROPIC_API_KEY="sk-ant-..."
ANTHROPIC_MODEL="claude-opus-4-8"
WEB_INTERNAL_URL="http://localhost:3000"
```

- [ ] **Step 4: Commit**

```bash
git add README.md web/.env.example agent/.env.example
git commit -m "chore: 저장소 골격과 환경변수 예시"
```

---

## Phase 1: web — 데이터 계층 (Prisma + SQLite)

### Task 1: Next.js 프로젝트 초기화

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/next.config.ts`

- [ ] **Step 1: web 폴더에 Next.js 앱 생성**

Run:
```bash
cd web && npx create-next-app@latest . --typescript --app --src-dir --no-tailwind --eslint --no-turbopack --import-alias "@/*" --use-npm
```
Expected: `web/src/app/`, `web/package.json` 생성됨. 프롬프트가 나오면 기본값 수락.

- [ ] **Step 2: 추가 의존성 설치**

Run:
```bash
cd web && npm install prisma @prisma/client ai @ai-sdk/react zod && npm install -D vitest tsx @types/node
```
Expected: 설치 성공.

- [ ] **Step 3: vitest 설정과 npm 스크립트 추가**

Create `web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```

Modify `web/package.json` — `scripts`에 추가:

```json
"test": "vitest run",
"seed": "tsx prisma/seed.ts",
"db:reset": "prisma migrate reset --force"
```

- [ ] **Step 4: 빌드 확인 후 commit**

Run: `cd web && npm run build`
Expected: 빌드 성공.

```bash
git add web/ && git commit -m "chore: web Next.js 프로젝트 초기화"
```

### Task 2: Prisma 스키마 정의

**Files:**
- Create: `web/prisma/schema.prisma`

- [ ] **Step 1: 스키마 작성**

Create `web/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Pharmacist {
  id        Int       @id @default(autoincrement())
  name      String
  products  Product[]
  createdAt DateTime  @default(now())
}

model Product {
  id            Int      @id @default(autoincrement())
  pharmacist    Pharmacist @relation(fields: [pharmacistId], references: [id])
  pharmacistId  Int
  name          String
  brand         String?
  description   String?
  price         Int       // 원 단위 정수
  ingredients   String?   // 자유 텍스트
  conditionTags String    @default("[]") // JSON 문자열 배열, 예: ["피로","눈건강"]
  imageUrl      String?
  stock         Int       @default(0)
  isActive      Boolean   @default(true)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  recommendations Recommendation[]
  orders          Order[]
}

model Consultation {
  id        Int       @id @default(autoincrement())
  sessionId String
  messages  Message[]
  recommendations Recommendation[]
  createdAt DateTime  @default(now())
}

model Message {
  id             Int          @id @default(autoincrement())
  consultation   Consultation @relation(fields: [consultationId], references: [id])
  consultationId Int
  role           String       // "user" | "assistant"
  content        String
  createdAt      DateTime     @default(now())
}

model Recommendation {
  id             Int          @id @default(autoincrement())
  consultation   Consultation @relation(fields: [consultationId], references: [id])
  consultationId Int
  product        Product      @relation(fields: [productId], references: [id])
  productId      Int
  reason         String?
  createdAt      DateTime     @default(now())
}

model Order {
  id        Int      @id @default(autoincrement())
  product   Product  @relation(fields: [productId], references: [id])
  productId Int
  quantity  Int      @default(1)
  status    String   @default("created") // 프로토타입: 결제 없음
  createdAt DateTime @default(now())
}
```

> `conditionTags`는 SQLite에 배열 타입이 없으므로 JSON 문자열로 저장한다. 도메인 함수에서 parse/stringify를 담당한다.

- [ ] **Step 2: 마이그레이션 생성**

Run:
```bash
cd web && cp .env.example .env && npx prisma migrate dev --name init
```
Expected: `web/prisma/migrations/` 생성, `dev.db` 생성, Prisma Client 생성됨.

- [ ] **Step 3: Commit**

```bash
git add web/prisma/ web/.env.example && git commit -m "feat: Prisma 스키마와 초기 마이그레이션"
```

### Task 3: Prisma 클라이언트 싱글톤

**Files:**
- Create: `web/src/lib/prisma.ts`

- [ ] **Step 1: 싱글톤 작성**

Create `web/src/lib/prisma.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/prisma.ts && git commit -m "feat: Prisma 클라이언트 싱글톤"
```

### Task 4: 영양제 도메인 함수 (TDD)

**Files:**
- Create: `web/src/lib/products.ts`
- Test: `web/tests/products.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `web/tests/products.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { parseTags, stringifyTags, matchesQuery } from "@/lib/products";

describe("conditionTags 직렬화", () => {
  it("JSON 문자열을 배열로 파싱한다", () => {
    expect(parseTags('["피로","눈건강"]')).toEqual(["피로", "눈건강"]);
  });
  it("잘못된 JSON은 빈 배열로 처리한다", () => {
    expect(parseTags("not-json")).toEqual([]);
  });
  it("배열을 JSON 문자열로 직렬화한다", () => {
    expect(stringifyTags(["피로"])).toBe('["피로"]');
  });
});

describe("matchesQuery", () => {
  const product = {
    name: "비타민C 1000",
    description: "피로 회복에 도움",
    conditionTags: '["피로","면역"]',
  };
  it("이름에 키워드가 포함되면 매칭", () => {
    expect(matchesQuery(product, "비타민")).toBe(true);
  });
  it("태그에 키워드가 포함되면 매칭", () => {
    expect(matchesQuery(product, "면역")).toBe(true);
  });
  it("관련 없는 키워드는 비매칭", () => {
    expect(matchesQuery(product, "관절")).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web && npm test`
Expected: FAIL — `parseTags`/`stringifyTags`/`matchesQuery` 미정의.

- [ ] **Step 3: 최소 구현 작성**

Create `web/src/lib/products.ts`:

```ts
import { prisma } from "@/lib/prisma";

export function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function stringifyTags(tags: string[]): string {
  return JSON.stringify(tags);
}

type Searchable = { name: string; description?: string | null; conditionTags: string };

export function matchesQuery(p: Searchable, q: string): boolean {
  const hay = [p.name, p.description ?? "", parseTags(p.conditionTags).join(" ")]
    .join(" ")
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

export async function searchProducts(opts: { condition?: string; keyword?: string }) {
  const all = await prisma.product.findMany({ where: { isActive: true } });
  const terms = [opts.condition, opts.keyword].filter(Boolean) as string[];
  if (terms.length === 0) return all;
  return all.filter((p) => terms.some((t) => matchesQuery(p, t)));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/products.ts web/tests/products.test.ts
git commit -m "feat: 영양제 도메인 함수(태그 직렬화/검색) + 테스트"
```

### Task 5: 시드 데이터

**Files:**
- Create: `web/prisma/seed.ts`

- [ ] **Step 1: 시드 스크립트 작성**

Create `web/prisma/seed.ts`:

```ts
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const pharmacist = await prisma.pharmacist.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, name: "김약사" },
  });

  const products = [
    { name: "비타민C 1000", brand: "헬스랩", price: 18000, ingredients: "비타민C 1000mg", conditionTags: ["피로", "면역"], imageUrl: null, stock: 50, description: "피로 회복과 면역에 도움" },
    { name: "루테인 지아잔틴", brand: "아이케어", price: 25000, ingredients: "루테인 20mg", conditionTags: ["눈건강"], imageUrl: null, stock: 30, description: "눈 건강과 황반 보호" },
    { name: "마그네슘 비타민B", brand: "데일리", price: 15000, ingredients: "마그네슘 350mg", conditionTags: ["피로", "근육경련", "수면"], imageUrl: null, stock: 40, description: "근육 이완과 피로 개선" },
    { name: "오메가3", brand: "씨오일", price: 22000, ingredients: "EPA/DHA 900mg", conditionTags: ["혈행", "관절"], imageUrl: null, stock: 25, description: "혈행 개선과 관절 건강" },
    { name: "유산균 프로바이오틱스", brand: "장건강", price: 30000, ingredients: "100억 CFU", conditionTags: ["장건강", "소화"], imageUrl: null, stock: 35, description: "장 건강과 소화 개선" },
  ];

  for (const p of products) {
    await prisma.product.create({
      data: { ...p, conditionTags: JSON.stringify(p.conditionTags), pharmacistId: pharmacist.id },
    });
  }
  console.log("seeded");
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 2: 시드 실행**

Run: `cd web && npm run seed`
Expected: `seeded` 출력, 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add web/prisma/seed.ts && git commit -m "feat: 약사 1명 + 샘플 영양제 시드"
```

---

## Phase 2: web — API 라우트

### Task 6: products CRUD API (TDD)

**Files:**
- Create: `web/src/app/api/products/route.ts`
- Create: `web/src/app/api/products/[id]/route.ts`
- Test: `web/tests/api-products.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성 (도메인 레벨)**

Create `web/tests/api-products.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createProduct, updateProduct, deleteProduct, listProducts } from "@/lib/products";

describe("products CRUD", () => {
  let createdId: number;

  beforeAll(async () => {
    await prisma.pharmacist.upsert({ where: { id: 1 }, update: {}, create: { id: 1, name: "김약사" } });
  });

  it("상품을 생성한다", async () => {
    const p = await createProduct({ name: "테스트영양제", price: 1000, conditionTags: ["테스트"], pharmacistId: 1 });
    createdId = p.id;
    expect(p.name).toBe("테스트영양제");
    expect(p.conditionTags).toBe('["테스트"]');
  });

  it("상품을 수정한다", async () => {
    const p = await updateProduct(createdId, { price: 2000 });
    expect(p.price).toBe(2000);
  });

  it("목록에 포함된다", async () => {
    const list = await listProducts();
    expect(list.some((x) => x.id === createdId)).toBe(true);
  });

  it("상품을 삭제한다", async () => {
    await deleteProduct(createdId);
    const list = await listProducts();
    expect(list.some((x) => x.id === createdId)).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd web && npm test`
Expected: FAIL — `createProduct`/`updateProduct`/`deleteProduct`/`listProducts` 미정의.

- [ ] **Step 3: 도메인 CRUD 함수를 products.ts에 추가**

Append to `web/src/lib/products.ts`:

```ts
export async function listProducts() {
  return prisma.product.findMany({ orderBy: { createdAt: "desc" } });
}

export async function createProduct(input: {
  name: string; price: number; pharmacistId: number;
  brand?: string; description?: string; ingredients?: string;
  conditionTags?: string[]; imageUrl?: string; stock?: number;
}) {
  const { conditionTags, ...rest } = input;
  return prisma.product.create({
    data: { ...rest, conditionTags: stringifyTags(conditionTags ?? []) },
  });
}

export async function updateProduct(id: number, input: {
  name?: string; price?: number; brand?: string; description?: string;
  ingredients?: string; conditionTags?: string[]; imageUrl?: string;
  stock?: number; isActive?: boolean;
}) {
  const { conditionTags, ...rest } = input;
  return prisma.product.update({
    where: { id },
    data: { ...rest, ...(conditionTags ? { conditionTags: stringifyTags(conditionTags) } : {}) },
  });
}

export async function deleteProduct(id: number) {
  return prisma.product.delete({ where: { id } });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd web && npm test`
Expected: PASS.

- [ ] **Step 5: API 라우트 작성**

Create `web/src/app/api/products/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listProducts, createProduct } from "@/lib/products";

export async function GET() {
  return NextResponse.json(await listProducts());
}

const createSchema = z.object({
  name: z.string().min(1),
  price: z.number().int().nonnegative(),
  brand: z.string().optional(),
  description: z.string().optional(),
  ingredients: z.string().optional(),
  conditionTags: z.array(z.string()).optional(),
  imageUrl: z.string().optional(),
  stock: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const product = await createProduct({ ...parsed.data, pharmacistId: 1 });
  return NextResponse.json(product, { status: 201 });
}
```

Create `web/src/app/api/products/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateProduct, deleteProduct } from "@/lib/products";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  price: z.number().int().nonnegative().optional(),
  brand: z.string().optional(),
  description: z.string().optional(),
  ingredients: z.string().optional(),
  conditionTags: z.array(z.string()).optional(),
  imageUrl: z.string().optional(),
  stock: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  return NextResponse.json(await updateProduct(Number(id), parsed.data));
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await deleteProduct(Number(id));
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: 빌드 확인**

Run: `cd web && npm run build`
Expected: 빌드 성공.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/products.ts web/src/app/api/products/ web/tests/api-products.test.ts
git commit -m "feat: products CRUD 도메인 함수와 API 라우트 + 테스트"
```

### Task 7: 에이전트 도구 엔드포인트

**Files:**
- Create: `web/src/app/api/agent-tools/search-products/route.ts`

- [ ] **Step 1: 라우트 작성**

Create `web/src/app/api/agent-tools/search-products/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { searchProducts, parseTags } from "@/lib/products";

// 에이전트 전용 내부 도구. 증상/키워드로 활성 영양제를 검색해 반환.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const condition = sp.get("condition") ?? undefined;
  const keyword = sp.get("keyword") ?? undefined;
  const products = await searchProducts({ condition, keyword });
  return NextResponse.json(
    products.map((p) => ({
      id: p.id,
      name: p.name,
      brand: p.brand,
      price: p.price,
      description: p.description,
      ingredients: p.ingredients,
      conditionTags: parseTags(p.conditionTags),
      stock: p.stock,
    }))
  );
}
```

- [ ] **Step 2: 수동 검증**

Run (web dev 서버 실행 중에): `curl "http://localhost:3000/api/agent-tools/search-products?condition=피로"`
Expected: 비타민C·마그네슘 등 피로 태그 상품 JSON 배열.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/api/agent-tools/
git commit -m "feat: 에이전트용 영양제 검색 도구 엔드포인트"
```

### Task 8: chat 프록시 + orders 스텁

**Files:**
- Create: `web/src/app/api/chat/route.ts`
- Create: `web/src/app/api/orders/route.ts`

- [ ] **Step 1: chat 프록시 라우트 작성**

Create `web/src/app/api/chat/route.ts`:

```ts
import { NextRequest } from "next/server";

// 클라이언트의 대화 이력을 agent 서비스로 그대로 전달하고 스트림을 중계한다.
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
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch {
    return new Response("상담 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.", { status: 502 });
  }
}
```

- [ ] **Step 2: orders 스텁 라우트 작성**

Create `web/src/app/api/orders/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const schema = z.object({ productId: z.number().int(), quantity: z.number().int().positive().default(1) });

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  // 프로토타입: 결제 없이 주문 기록만 생성
  const order = await prisma.order.create({ data: { ...parsed.data, status: "created" } });
  return NextResponse.json(order, { status: 201 });
}
```

- [ ] **Step 3: 빌드 확인**

Run: `cd web && npm run build`
Expected: 빌드 성공.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/api/chat/ web/src/app/api/orders/
git commit -m "feat: chat 프록시와 orders 스텁 라우트"
```

---

## Phase 3: agent — Python FastAPI 서비스

### Task 9: agent 프로젝트 초기화

**Files:**
- Create: `agent/pyproject.toml`, `agent/app/__init__.py`

- [ ] **Step 1: pyproject.toml 작성**

Create `agent/pyproject.toml`:

```toml
[project]
name = "pharmacist-agent"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.110",
  "uvicorn>=0.29",
  "anthropic>=0.40",
  "httpx>=0.27",
  "pydantic>=2.6",
  "python-dotenv>=1.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-asyncio>=0.23", "respx>=0.21"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
```

- [ ] **Step 2: 패키지 초기화 파일**

Create `agent/app/__init__.py`:

```python
```
(빈 파일)

- [ ] **Step 3: 설치 확인**

Run: `cd agent && python -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"`
Expected: 설치 성공.

- [ ] **Step 4: Commit**

```bash
git add agent/pyproject.toml agent/app/__init__.py
git commit -m "chore: agent FastAPI 프로젝트 초기화"
```

### Task 10: 스키마와 시스템 프롬프트

**Files:**
- Create: `agent/app/schemas.py`
- Create: `agent/app/prompts.py`

- [ ] **Step 1: Pydantic 스키마 작성**

Create `agent/app/schemas.py`:

```python
from pydantic import BaseModel

class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str

class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    session_id: str | None = None
```

- [ ] **Step 2: 시스템 프롬프트 작성**

Create `agent/app/prompts.py`:

```python
SYSTEM_PROMPT = """당신은 친절하고 신중한 약사 상담 도우미입니다. 일반인 상담자의 건강 고민을 듣고, 약사의 지식을 바탕으로 생활 관리와 영양제를 안내합니다.

원칙:
1. 당신은 의료 진단을 하지 않습니다. 증상의 원인을 단정하지 마세요.
2. 발열, 가슴 통증, 호흡곤란, 심한 출혈, 의식저하 등 위험·응급 신호가 보이면 영양제 추천 대신 즉시 병원 방문이나 대면 약사 상담을 권하세요.
3. 영양제는 의약품을 대체하지 않으며 보조적 수단임을 분명히 하세요.
4. 추천이 필요할 때는 반드시 search_products 도구로 이 약국이 취급하는 영양제를 조회한 뒤, 그 결과 안에서만 추천하세요. 취급하지 않는 제품을 지어내지 마세요.
5. 조회 결과가 비어 있으면 솔직히 맞는 제품이 없다고 말하고 약사에게 직접 문의를 권하세요.
6. 답변은 한국어로, 따뜻하고 이해하기 쉽게 합니다. 복용 시 주의사항(기저질환·임신·약물 상호작용 가능성)을 간단히 덧붙이세요.

추천을 제시할 때는 자연스러운 설명과 함께, 추천하는 제품을 명확히 언급하세요."""
```

- [ ] **Step 3: Commit**

```bash
git add agent/app/schemas.py agent/app/prompts.py
git commit -m "feat: agent 스키마와 약사 시스템 프롬프트(안전 가드레일)"
```

### Task 11: search_products 도구 (TDD)

**Files:**
- Create: `agent/app/tools.py`
- Test: `agent/tests/test_tools.py`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `agent/tests/test_tools.py`:

```python
import respx
import httpx
from app.tools import search_products, TOOL_DEFS

@respx.mock
async def test_search_products_calls_web_api():
    route = respx.get("http://web.test/api/agent-tools/search-products").mock(
        return_value=httpx.Response(200, json=[{"id": 1, "name": "비타민C 1000", "price": 18000}])
    )
    result = await search_products({"condition": "피로"}, base_url="http://web.test")
    assert route.called
    assert result[0]["name"] == "비타민C 1000"

def test_tool_defs_shape():
    assert TOOL_DEFS[0]["name"] == "search_products"
    assert "input_schema" in TOOL_DEFS[0]
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd agent && . .venv/bin/activate && pytest tests/test_tools.py -v`
Expected: FAIL — `app.tools` 미존재.

- [ ] **Step 3: 도구 구현**

Create `agent/app/tools.py`:

```python
import os
import httpx

TOOL_DEFS = [
    {
        "name": "search_products",
        "description": "이 약국이 취급하는 영양제를 증상(condition)이나 키워드(keyword)로 검색한다. 추천 전 반드시 호출한다.",
        "input_schema": {
            "type": "object",
            "properties": {
                "condition": {"type": "string", "description": "상담자의 증상/건강 고민, 예: 피로, 눈건강"},
                "keyword": {"type": "string", "description": "제품 키워드, 예: 비타민C"},
            },
        },
    }
]

async def search_products(tool_input: dict, base_url: str | None = None) -> list[dict]:
    base = base_url or os.environ.get("WEB_INTERNAL_URL", "http://localhost:3000")
    params = {k: v for k, v in tool_input.items() if v}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{base}/api/agent-tools/search-products", params=params)
        resp.raise_for_status()
        return resp.json()

async def run_tool(name: str, tool_input: dict) -> list[dict]:
    if name == "search_products":
        return await search_products(tool_input)
    raise ValueError(f"unknown tool: {name}")
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd agent && . .venv/bin/activate && pytest tests/test_tools.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/app/tools.py agent/tests/test_tools.py
git commit -m "feat: search_products 도구 + 테스트"
```

### Task 12: 에이전트 tool-use 루프 (TDD)

**Files:**
- Create: `agent/app/agent.py`
- Test: `agent/tests/test_agent.py`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `agent/tests/test_agent.py`:

```python
from unittest.mock import AsyncMock, patch
from app.agent import run_agent_stream
from app.schemas import ChatMessage

class FakeBlock:
    def __init__(self, type, text=None, name=None, input=None, id=None):
        self.type = type; self.text = text; self.name = name; self.input = input; self.id = id

class FakeResponse:
    def __init__(self, content, stop_reason):
        self.content = content; self.stop_reason = stop_reason

async def test_agent_runs_tool_then_answers():
    # 1차: 도구 호출, 2차: 최종 텍스트
    responses = [
        FakeResponse([FakeBlock("tool_use", name="search_products", input={"condition": "피로"}, id="t1")], "tool_use"),
        FakeResponse([FakeBlock("text", text="비타민C를 추천드려요.")], "end_turn"),
    ]
    fake_client = AsyncMock()
    fake_client.messages.create = AsyncMock(side_effect=responses)

    with patch("app.agent.get_client", return_value=fake_client), \
         patch("app.agent.run_tool", new=AsyncMock(return_value=[{"id": 1, "name": "비타민C 1000"}])):
        chunks = []
        async for c in run_agent_stream([ChatMessage(role="user", content="요즘 피곤해요")]):
            chunks.append(c)
        assert "비타민C" in "".join(chunks)
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd agent && . .venv/bin/activate && pytest tests/test_agent.py -v`
Expected: FAIL — `app.agent` 미존재.

- [ ] **Step 3: 에이전트 루프 구현**

Create `agent/app/agent.py`:

```python
import os
from collections.abc import AsyncIterator
from anthropic import AsyncAnthropic
from app.prompts import SYSTEM_PROMPT
from app.tools import TOOL_DEFS, run_tool
from app.schemas import ChatMessage

def get_client() -> AsyncAnthropic:
    return AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-8")
MAX_TURNS = 5

async def run_agent_stream(messages: list[ChatMessage]) -> AsyncIterator[str]:
    client = get_client()
    convo = [{"role": m.role, "content": m.content} for m in messages]

    for _ in range(MAX_TURNS):
        resp = await client.messages.create(
            model=MODEL,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            tools=TOOL_DEFS,
            messages=convo,
        )

        text_parts = [b.text for b in resp.content if b.type == "text"]
        for t in text_parts:
            yield t

        if resp.stop_reason != "tool_use":
            return

        # 도구 호출 처리
        assistant_content = []
        tool_results = []
        for b in resp.content:
            if b.type == "text":
                assistant_content.append({"type": "text", "text": b.text})
            elif b.type == "tool_use":
                assistant_content.append({"type": "tool_use", "id": b.id, "name": b.name, "input": b.input})
                result = await run_tool(b.name, b.input)
                tool_results.append({"type": "tool_result", "tool_use_id": b.id, "content": str(result)})

        convo.append({"role": "assistant", "content": assistant_content})
        convo.append({"role": "user", "content": tool_results})

    yield "\n(상담을 더 진행하려면 다시 질문해주세요.)"
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd agent && . .venv/bin/activate && pytest tests/test_agent.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/app/agent.py agent/tests/test_agent.py
git commit -m "feat: 에이전트 tool-use 루프 + 테스트"
```

### Task 13: FastAPI 앱과 /chat 스트리밍

**Files:**
- Create: `agent/app/main.py`

- [ ] **Step 1: FastAPI 앱 작성**

Create `agent/app/main.py`:

```python
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from app.schemas import ChatRequest
from app.agent import run_agent_stream

app = FastAPI(title="pharmacist-agent")

@app.get("/health")
async def health():
    return {"ok": True}

@app.post("/chat")
async def chat(req: ChatRequest):
    async def gen():
        try:
            async for chunk in run_agent_stream(req.messages):
                yield chunk
        except Exception:
            yield "\n상담 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
    return StreamingResponse(gen(), media_type="text/plain; charset=utf-8")
```

- [ ] **Step 2: 헬스체크 수동 검증**

Run: `cd agent && . .venv/bin/activate && uvicorn app.main:app --port 8000 &` 그리고 `curl http://localhost:8000/health`
Expected: `{"ok":true}`. 확인 후 `kill %1`.

- [ ] **Step 3: Commit**

```bash
git add agent/app/main.py
git commit -m "feat: FastAPI 앱과 /chat 스트리밍 엔드포인트"
```

---

## Phase 4: web — UI

### Task 14: 약사 어드민 페이지

**Files:**
- Create: `web/src/components/AdminProductForm.tsx`
- Create: `web/src/app/admin/page.tsx`

- [ ] **Step 1: 상품 등록 폼 컴포넌트 작성**

Create `web/src/components/AdminProductForm.tsx`:

```tsx
"use client";
import { useState } from "react";

export function AdminProductForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", price: "", brand: "", description: "", ingredients: "", conditionTags: "", stock: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        price: Number(form.price || 0),
        brand: form.brand || undefined,
        description: form.description || undefined,
        ingredients: form.ingredients || undefined,
        conditionTags: form.conditionTags ? form.conditionTags.split(",").map((s) => s.trim()).filter(Boolean) : [],
        stock: Number(form.stock || 0),
      }),
    });
    setForm({ name: "", price: "", brand: "", description: "", ingredients: "", conditionTags: "", stock: "" });
    onCreated();
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 8, maxWidth: 480 }}>
      <input required placeholder="제품명" value={form.name} onChange={set("name")} />
      <input required type="number" placeholder="가격(원)" value={form.price} onChange={set("price")} />
      <input placeholder="브랜드" value={form.brand} onChange={set("brand")} />
      <input placeholder="성분" value={form.ingredients} onChange={set("ingredients")} />
      <input placeholder="적용 증상 태그(쉼표로 구분)" value={form.conditionTags} onChange={set("conditionTags")} />
      <input type="number" placeholder="재고" value={form.stock} onChange={set("stock")} />
      <textarea placeholder="설명" value={form.description} onChange={set("description")} />
      <button type="submit">등록</button>
    </form>
  );
}
```

- [ ] **Step 2: 어드민 페이지 작성**

Create `web/src/app/admin/page.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { AdminProductForm } from "@/components/AdminProductForm";

type Product = { id: number; name: string; brand: string | null; price: number; stock: number; conditionTags: string; isActive: boolean };

export default function AdminPage() {
  const [products, setProducts] = useState<Product[]>([]);

  async function load() {
    const res = await fetch("/api/products");
    setProducts(await res.json());
  }
  useEffect(() => { load(); }, []);

  async function remove(id: number) {
    await fetch(`/api/products/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <main style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h1>영양제 상품 관리</h1>
      <AdminProductForm onCreated={load} />
      <h2 style={{ marginTop: 24 }}>등록된 영양제 ({products.length})</h2>
      <ul style={{ display: "grid", gap: 8, padding: 0, listStyle: "none" }}>
        {products.map((p) => (
          <li key={p.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <strong>{p.name}</strong> {p.brand && `· ${p.brand}`} — {p.price.toLocaleString()}원 (재고 {p.stock})
            <br />
            <small>태그: {JSON.parse(p.conditionTags || "[]").join(", ")}</small>
            <button onClick={() => remove(p.id)} style={{ marginLeft: 12 }}>삭제</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 3: 빌드 확인**

Run: `cd web && npm run build`
Expected: 빌드 성공.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/AdminProductForm.tsx web/src/app/admin/
git commit -m "feat: 약사 어드민 영양제 관리 페이지"
```

### Task 15: 상담 채팅 페이지 + 추천 카드

**Files:**
- Create: `web/src/components/ProductCard.tsx`
- Create: `web/src/components/ChatPanel.tsx`
- Modify: `web/src/app/page.tsx`

- [ ] **Step 1: 추천 카드 컴포넌트 작성**

Create `web/src/components/ProductCard.tsx`:

```tsx
"use client";
import { useState } from "react";

export type RecProduct = { id: number; name: string; brand?: string | null; price: number; description?: string | null };

export function ProductCard({ p }: { p: RecProduct }) {
  const [bought, setBought] = useState(false);
  async function buy() {
    await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: p.id, quantity: 1 }),
    });
    setBought(true);
  }
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, minWidth: 200 }}>
      <strong>{p.name}</strong> {p.brand && `· ${p.brand}`}
      <div>{p.price.toLocaleString()}원</div>
      {p.description && <small>{p.description}</small>}
      <div>
        <button onClick={buy} disabled={bought}>{bought ? "주문됨" : "구매"}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 채팅 패널 작성 (텍스트 스트리밍 + 추천 상품 조회)**

Create `web/src/components/ChatPanel.tsx`:

```tsx
"use client";
import { useState } from "react";
import { ProductCard, RecProduct } from "@/components/ProductCard";

type Msg = { role: "user" | "assistant"; content: string };

export function ChatPanel() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [recs, setRecs] = useState<RecProduct[]>([]);
  const [loading, setLoading] = useState(false);

  async function send() {
    if (!input.trim()) return;
    const next: Msg[] = [...messages, { role: "user", content: input }];
    setMessages(next);
    setInput("");
    setLoading(true);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: next }),
    });

    let acc = "";
    setMessages([...next, { role: "assistant", content: "" }]);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      acc += decoder.decode(value);
      setMessages([...next, { role: "assistant", content: acc }]);
    }
    setLoading(false);

    // 답변에 근거해 추천 후보를 조회(간단화: 사용자 마지막 메시지를 조건으로 검색)
    const r = await fetch(`/api/agent-tools/search-products?condition=${encodeURIComponent(input)}`);
    if (r.ok) setRecs(await r.json());
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, minHeight: 240 }}>
        {messages.map((m, i) => (
          <p key={i}><strong>{m.role === "user" ? "나" : "약사"}:</strong> {m.content}</p>
        ))}
        {loading && <p><em>약사가 답변 중…</em></p>}
      </div>
      {recs.length > 0 && (
        <div>
          <h3>추천 영양제</h3>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {recs.map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          style={{ flex: 1 }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="건강 고민을 입력하세요 (예: 요즘 너무 피곤해요)"
        />
        <button onClick={send} disabled={loading}>보내기</button>
      </div>
    </div>
  );
}
```

> 추천 카드는 프로토타입 단순화를 위해 사용자 마지막 입력을 조건으로 영양제를 재조회해 표시한다. (에이전트 답변과 동일 데이터 소스를 사용)

- [ ] **Step 3: 메인 페이지 교체**

Replace `web/src/app/page.tsx` 전체 내용:

```tsx
import { ChatPanel } from "@/components/ChatPanel";

export default function Home() {
  return (
    <main style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 720, margin: "0 auto" }}>
      <h1>약사 상담</h1>
      <p style={{ color: "#666" }}>건강 고민을 말씀해주세요. 약사가 상담하고 맞는 영양제를 추천해드립니다.</p>
      <ChatPanel />
      <p style={{ marginTop: 24, fontSize: 12, color: "#999" }}>
        본 상담은 의료 진단이 아니며, 영양제는 의약품을 대체하지 않습니다.
      </p>
    </main>
  );
}
```

- [ ] **Step 4: 빌드 확인**

Run: `cd web && npm run build`
Expected: 빌드 성공.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ProductCard.tsx web/src/components/ChatPanel.tsx web/src/app/page.tsx
git commit -m "feat: 상담 채팅 페이지와 추천 영양제 카드"
```

---

## Phase 5: 통합 검증

### Task 16: 엔드투엔드 수동 검증과 실행 문서화

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 두 서비스 실행**

Run (터미널 2개):
```bash
# 터미널 A
cd web && npm run dev
# 터미널 B
cd agent && . .venv/bin/activate && export $(grep -v '^#' .env | xargs) && uvicorn app.main:app --reload --port 8000
```
사전: `cp agent/.env.example agent/.env` 후 `ANTHROPIC_API_KEY` 실제 값 입력.

- [ ] **Step 2: 어드민에서 영양제 확인**

브라우저 `http://localhost:3000/admin` 접속.
Expected: 시드된 영양제 5종 표시. 신규 등록/삭제 동작.

- [ ] **Step 3: 채팅 상담 검증**

브라우저 `http://localhost:3000` 에서 "요즘 너무 피곤하고 눈이 침침해요" 입력.
Expected: 약사 답변이 스트리밍되고, 추천 영양제 카드(비타민C·마그네슘·루테인 등)가 표시됨. "구매" 클릭 시 "주문됨"으로 바뀜.

- [ ] **Step 4: 안전 가드레일 검증**

"가슴이 심하게 아프고 숨쉬기 힘들어요" 입력.
Expected: 영양제 추천 대신 병원/대면 약사 방문 권유 응답.

- [ ] **Step 5: README에 검증 절차 추가 후 commit**

`README.md`에 위 실행/검증 절차를 정리해 추가.

```bash
git add README.md
git commit -m "docs: 엔드투엔드 실행/검증 절차"
```

---

## 자체 점검 결과 (Self-Review)

- **스펙 커버리지**: 채팅 상담(Task 12·13·15), 약사 어드민 등록(Task 14), 영양제 CRUD(Task 6), 에이전트 독립 서비스(Phase 3), 도구가 web API 호출(Task 7·11), 추천·구매(Task 15·8), 안전 가드레일(Task 10·16 Step4), 데이터 모델(Task 2) 모두 태스크로 매핑됨.
- **플레이스홀더**: 모든 코드 스텝에 실제 코드 포함. TBD 없음.
- **타입 일관성**: `conditionTags`는 DB에선 JSON 문자열, 도메인 함수에서 parse/stringify, API/도구 응답에선 배열로 일관 처리. `searchProducts`/`run_tool`/`run_agent_stream` 시그니처가 호출부와 일치.
- **알려진 단순화**: 추천 카드는 사용자 마지막 입력 재조회 방식(에이전트가 실제 호출한 productId 파싱은 확장 과제). 대화는 stateless. 결제 없음. — 모두 스펙의 프로토타입 범위와 일치.
