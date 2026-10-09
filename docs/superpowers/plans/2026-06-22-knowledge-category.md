# 지식 카테고리 관리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지식 문서 카테고리를 DB 테이블로 관리하고, 약사가 어드민에서 카테고리를 추가·수정·삭제(삭제 시 문서 "미분류" 이동)할 수 있게 한다.

**Architecture:** `KnowledgeCategory` Prisma 모델 추가(FK 없이 `KnowledgeDocument.category`는 String 유지). `lib/knowledgeCategories.ts` 도메인 → 4개 API 라우트 → AdminCategoryManager UI + 기존 폼·필터 드롭다운 전환.

**Tech Stack:** Next.js 16 (App Router, async params), Prisma 6/SQLite, zod, vitest, Tailwind CSS.

## Global Constraints

- Pharmacist 시드: `{ data: { name: "약사" } }` only (email 필드 없음).
- Next.js 16 async params: `{ params }: { params: Promise<{ id: string }> }` → `const { id } = await params`.
- 어드민 API 인증 없음 (로드맵 A에서 추가 예정).
- 커밋 말미: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. `--no-verify` 금지.
- 테스트: `cd /Users/atinjin/repository/pham-consult/web && npm test`.
- tsc: `cd /Users/atinjin/repository/pham-consult/web && npx tsc --noEmit`.
- Git은 repo root `/Users/atinjin/repository/pham-consult`에서 실행.
- "미분류"는 보호 카테고리 — 삭제·이름 변경 불가.
- 기존 테스트 156개 전체 유지.

## File Map

| 파일 | 역할 |
|------|------|
| `web/prisma/schema.prisma` | KnowledgeCategory 모델 추가 |
| `web/prisma/migrations/…` | 마이그레이션 SQL (테이블 생성 + 미분류 시드) |
| `web/src/lib/knowledgeCategories.ts` | 도메인: listCategories, createCategory, updateCategory, deleteCategory, CategoryError |
| `web/tests/knowledgeCategories.test.ts` | 도메인 단위 테스트 |
| `web/src/app/api/admin/knowledge-categories/route.ts` | GET 목록, POST 생성 |
| `web/src/app/api/admin/knowledge-categories/[id]/route.ts` | PUT 수정, DELETE 삭제 |
| `web/tests/knowledge-categories-api.test.ts` | API 테스트 |
| `web/src/components/AdminCategoryManager.tsx` | 카테고리 관리 UI (신규) |
| `web/src/components/AdminKnowledgeForm.tsx` | category input → select 전환 |
| `web/src/app/admin/knowledge/page.tsx` | 카테고리 필터 select + 관리 버튼 추가 |

---

## Task 1: KnowledgeCategory 스키마 + 마이그레이션

**Files:**
- Modify: `web/prisma/schema.prisma`
- Create: `web/prisma/migrations/…_knowledge_category/migration.sql` (자동 생성 후 편집)

**Interfaces:**
- Produces: `KnowledgeCategory { id, name, description?, icon?, color?, displayOrder, createdAt, updatedAt }`

- [ ] **Step 1: schema.prisma에 모델 추가**

`web/prisma/schema.prisma`의 `model KnowledgeDocument` 바로 위에 추가:

```prisma
model KnowledgeCategory {
  id           Int      @id @default(autoincrement())
  name         String   @unique
  description  String?
  icon         String?
  color        String?
  displayOrder Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

- [ ] **Step 2: 마이그레이션 실행**

```bash
cd /Users/atinjin/repository/pham-consult/web
npx prisma migrate dev --name knowledge_category
```

Expected: "migration created and applied" — NOT reset 프롬프트. 리셋 요청이 뜨면 STOP.

- [ ] **Step 3: 마이그레이션 SQL에 미분류 시드 삽입**

방금 생성된 마이그레이션 파일(`web/prisma/migrations/…_knowledge_category/migration.sql`) 끝에 추가:

```sql
-- 보호 카테고리 미분류 시드
INSERT INTO "KnowledgeCategory" ("name", "displayOrder", "createdAt", "updatedAt")
VALUES ('미분류', 9999, datetime('now'), datetime('now'));
```

그 다음 마이그레이션을 실제 DB에 재적용:

```bash
npx prisma migrate deploy
```

Expected: "1 migration applied" (또는 "already applied" — 이미 적용된 경우 SQLite 파일을 삭제하고 `migrate dev` 재실행).

> **Note:** 개발 환경에서는 `prisma/dev.db`를 삭제하고 `npx prisma migrate dev`를 다시 실행하는 것이 가장 깔끔하다. 기존 데이터가 없다면 이 방법으로 진행.

- [ ] **Step 4: tsc 확인**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: 커밋**

```bash
cd /Users/atinjin/repository/pham-consult
git add web/prisma/schema.prisma web/prisma/migrations/
git commit -m "feat(knowledge): KnowledgeCategory 스키마 + 마이그레이션

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 도메인 (`knowledgeCategories.ts`) + 테스트

**Files:**
- Create: `web/src/lib/knowledgeCategories.ts`
- Create: `web/tests/knowledgeCategories.test.ts`

**Interfaces:**
- Consumes: `prisma` (기존)
- Produces:
  - `CategoryError` (class, `.code: "NOT_FOUND" | "PROTECTED" | "DUPLICATE_NAME"`)
  - `categoryStatus(code): number` — NOT_FOUND→404, PROTECTED→403, DUPLICATE_NAME→409
  - `CategoryRow { id, name, description, icon, color, displayOrder, docCount, createdAt, updatedAt }`
  - `CategoryInput { name, description?, icon?, color?, displayOrder? }`
  - `listCategories(): Promise<CategoryRow[]>`
  - `createCategory(input: CategoryInput): Promise<KnowledgeCategory>`
  - `updateCategory(id: number, input: Partial<CategoryInput>): Promise<KnowledgeCategory>`
  - `deleteCategory(id: number): Promise<{ movedCount: number }>`

- [ ] **Step 1: 실패 테스트 작성**

`web/tests/knowledgeCategories.test.ts` 생성:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  CategoryError,
} from "@/lib/knowledgeCategories";

vi.mock("@/lib/embeddings", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0, 1])),
  EMBEDDING_MODEL_NAME: "test-model",
}));

import { createDocument } from "@/lib/knowledge";

beforeEach(async () => {
  await prisma.knowledgeChunk.deleteMany();
  await prisma.knowledgeDocument.deleteMany();
  await prisma.knowledgeCategory.deleteMany();
  await prisma.knowledgeCategory.create({
    data: { name: "미분류", displayOrder: 9999 },
  });
});

// ─── listCategories ──────────────────────────────────────────────
describe("listCategories", () => {
  it("빈 상태에서 미분류만 반환", async () => {
    const rows = await listCategories();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("미분류");
    expect(rows[0].docCount).toBe(0);
  });

  it("문서 수를 카테고리별로 집계", async () => {
    await prisma.knowledgeCategory.create({ data: { name: "성분", displayOrder: 0 } });
    await prisma.knowledgeCategory.create({ data: { name: "참고", displayOrder: 1 } });
    await createDocument({ category: "성분", title: "비타민C", body: "항산화" });
    await createDocument({ category: "성분", title: "아연", body: "면역" });
    await createDocument({ category: "참고", title: "논문", body: "연구 결과" });

    const rows = await listCategories();
    const 성분 = rows.find((r) => r.name === "성분")!;
    const 참고 = rows.find((r) => r.name === "참고")!;
    expect(성분.docCount).toBe(2);
    expect(참고.docCount).toBe(1);
  });

  it("displayOrder ASC로 정렬", async () => {
    await prisma.knowledgeCategory.create({ data: { name: "Z카테", displayOrder: 10 } });
    await prisma.knowledgeCategory.create({ data: { name: "A카테", displayOrder: 0 } });
    const rows = await listCategories();
    const names = rows.filter((r) => r.name !== "미분류").map((r) => r.name);
    expect(names[0]).toBe("A카테");
  });
});

// ─── createCategory ──────────────────────────────────────────────
describe("createCategory", () => {
  it("정상 생성", async () => {
    const cat = await createCategory({
      name: "성분",
      description: "원료 관련",
      icon: "🌿",
      color: "bg-emerald-100 text-emerald-700",
      displayOrder: 1,
    });
    expect(cat.name).toBe("성분");
    expect(cat.icon).toBe("🌿");
  });

  it("중복 이름 → DUPLICATE_NAME", async () => {
    await createCategory({ name: "성분" });
    await expect(createCategory({ name: "성분" })).rejects.toMatchObject({
      code: "DUPLICATE_NAME",
    });
  });
});

// ─── updateCategory ──────────────────────────────────────────────
describe("updateCategory", () => {
  it("이름·아이콘·색상·설명·순서 수정", async () => {
    const cat = await createCategory({ name: "구카테", displayOrder: 0 });
    const updated = await updateCategory(cat.id, {
      name: "신카테",
      icon: "💊",
      color: "bg-blue-100 text-blue-700",
      description: "설명",
      displayOrder: 5,
    });
    expect(updated.name).toBe("신카테");
    expect(updated.icon).toBe("💊");
    expect(updated.displayOrder).toBe(5);
  });

  it("이름 변경 시 해당 카테고리 문서 cascade 업데이트", async () => {
    await prisma.knowledgeCategory.create({ data: { name: "구카테" } });
    await createDocument({ category: "구카테", title: "문서1", body: "내용" });
    await createDocument({ category: "구카테", title: "문서2", body: "내용" });

    const cat = await prisma.knowledgeCategory.findUnique({ where: { name: "구카테" } });
    await updateCategory(cat!.id, { name: "신카테" });

    const docs = await prisma.knowledgeDocument.findMany({ where: { category: "신카테" } });
    expect(docs).toHaveLength(2);
    const old = await prisma.knowledgeDocument.findMany({ where: { category: "구카테" } });
    expect(old).toHaveLength(0);
  });

  it("'미분류' 카테고리 이름 변경 → PROTECTED", async () => {
    const cat = await prisma.knowledgeCategory.findUnique({ where: { name: "미분류" } });
    await expect(updateCategory(cat!.id, { name: "다른이름" })).rejects.toMatchObject({
      code: "PROTECTED",
    });
  });

  it("다른 카테고리를 '미분류'로 이름 변경 → PROTECTED", async () => {
    const cat = await createCategory({ name: "성분" });
    await expect(updateCategory(cat.id, { name: "미분류" })).rejects.toMatchObject({
      code: "PROTECTED",
    });
  });

  it("없는 id → NOT_FOUND", async () => {
    await expect(updateCategory(999999, { name: "X" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ─── deleteCategory ──────────────────────────────────────────────
describe("deleteCategory", () => {
  it("문서 없는 카테고리 삭제, movedCount=0", async () => {
    const cat = await createCategory({ name: "빈카테" });
    const result = await deleteCategory(cat.id);
    expect(result.movedCount).toBe(0);
    const gone = await prisma.knowledgeCategory.findUnique({ where: { id: cat.id } });
    expect(gone).toBeNull();
  });

  it("문서 있는 카테고리 삭제 → 문서 '미분류'로 이동", async () => {
    await prisma.knowledgeCategory.create({ data: { name: "성분" } });
    await createDocument({ category: "성분", title: "루테인", body: "눈 건강" });
    await createDocument({ category: "성분", title: "아연", body: "면역" });

    const cat = await prisma.knowledgeCategory.findUnique({ where: { name: "성분" } });
    const result = await deleteCategory(cat!.id);
    expect(result.movedCount).toBe(2);

    const moved = await prisma.knowledgeDocument.findMany({ where: { category: "미분류" } });
    expect(moved).toHaveLength(2);
  });

  it("'미분류' 삭제 → PROTECTED", async () => {
    const cat = await prisma.knowledgeCategory.findUnique({ where: { name: "미분류" } });
    await expect(deleteCategory(cat!.id)).rejects.toMatchObject({ code: "PROTECTED" });
  });

  it("없는 id → NOT_FOUND", async () => {
    await expect(deleteCategory(999999)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
cd /Users/atinjin/repository/pham-consult/web
npm test -- knowledgeCategories
```

Expected: FAIL — `listCategories` 등 미정의.

- [ ] **Step 3: 도메인 구현**

`web/src/lib/knowledgeCategories.ts` 생성:

```ts
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export class CategoryError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "PROTECTED" | "DUPLICATE_NAME",
    message: string
  ) {
    super(message);
    this.name = "CategoryError";
  }
}

export function categoryStatus(code: CategoryError["code"]): number {
  const map: Record<CategoryError["code"], number> = {
    NOT_FOUND: 404,
    PROTECTED: 403,
    DUPLICATE_NAME: 409,
  };
  return map[code];
}

export type CategoryRow = {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  displayOrder: number;
  docCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CategoryInput = {
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  displayOrder?: number;
};

export async function listCategories(): Promise<CategoryRow[]> {
  const [cats, counts] = await Promise.all([
    prisma.knowledgeCategory.findMany({ orderBy: { displayOrder: "asc" } }),
    prisma.knowledgeDocument.groupBy({ by: ["category"], _count: { id: true } }),
  ]);
  const countMap = Object.fromEntries(counts.map((c) => [c.category, c._count.id]));
  return cats.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    icon: c.icon,
    color: c.color,
    displayOrder: c.displayOrder,
    docCount: countMap[c.name] ?? 0,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));
}

export async function createCategory(input: CategoryInput) {
  try {
    return await prisma.knowledgeCategory.create({
      data: {
        name: input.name,
        description: input.description,
        icon: input.icon,
        color: input.color,
        displayOrder: input.displayOrder ?? 0,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new CategoryError("DUPLICATE_NAME", `'${input.name}' 카테고리가 이미 존재합니다.`);
    }
    throw e;
  }
}

export async function updateCategory(id: number, input: Partial<CategoryInput>) {
  return prisma.$transaction(async (tx) => {
    const cat = await tx.knowledgeCategory.findUnique({ where: { id } });
    if (!cat) throw new CategoryError("NOT_FOUND", "카테고리를 찾을 수 없습니다.");

    if (input.name !== undefined) {
      if (cat.name === "미분류") {
        throw new CategoryError("PROTECTED", "미분류 카테고리는 이름을 변경할 수 없습니다.");
      }
      if (input.name === "미분류") {
        throw new CategoryError("PROTECTED", "미분류는 시스템 카테고리 이름입니다.");
      }
      if (input.name !== cat.name) {
        await tx.knowledgeDocument.updateMany({
          where: { category: cat.name },
          data: { category: input.name },
        });
      }
    }

    try {
      return await tx.knowledgeCategory.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          icon: input.icon,
          color: input.color,
          displayOrder: input.displayOrder,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new CategoryError("DUPLICATE_NAME", `'${input.name}' 카테고리가 이미 존재합니다.`);
      }
      throw e;
    }
  });
}

export async function deleteCategory(id: number): Promise<{ movedCount: number }> {
  return prisma.$transaction(async (tx) => {
    const cat = await tx.knowledgeCategory.findUnique({ where: { id } });
    if (!cat) throw new CategoryError("NOT_FOUND", "카테고리를 찾을 수 없습니다.");
    if (cat.name === "미분류") {
      throw new CategoryError("PROTECTED", "미분류 카테고리는 삭제할 수 없습니다.");
    }
    const moved = await tx.knowledgeDocument.updateMany({
      where: { category: cat.name },
      data: { category: "미분류" },
    });
    await tx.knowledgeCategory.delete({ where: { id } });
    return { movedCount: moved.count };
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
cd /Users/atinjin/repository/pham-consult/web
npm test -- knowledgeCategories
```

Expected: 13개 all green.

- [ ] **Step 5: tsc 확인**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: 커밋**

```bash
cd /Users/atinjin/repository/pham-consult
git add web/src/lib/knowledgeCategories.ts web/tests/knowledgeCategories.test.ts
git commit -m "feat(knowledge): 카테고리 도메인(listCategories·create·update·delete)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 어드민 API 라우트 + 테스트

**Files:**
- Create: `web/src/app/api/admin/knowledge-categories/route.ts`
- Create: `web/src/app/api/admin/knowledge-categories/[id]/route.ts`
- Create: `web/tests/knowledge-categories-api.test.ts`

**Interfaces:**
- Consumes: `listCategories`, `createCategory`, `updateCategory`, `deleteCategory`, `CategoryError`, `categoryStatus`
- Produces: `GET /api/admin/knowledge-categories`, `POST /api/admin/knowledge-categories`, `PUT /api/admin/knowledge-categories/[id]`, `DELETE /api/admin/knowledge-categories/[id]`

- [ ] **Step 1: 실패 테스트 작성**

`web/tests/knowledge-categories-api.test.ts` 생성:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { GET, POST } from "@/app/api/admin/knowledge-categories/route";
import { PUT, DELETE } from "@/app/api/admin/knowledge-categories/[id]/route";

vi.mock("@/lib/embeddings", () => ({
  embed: vi.fn(async (texts: string[]) => texts.map(() => [0, 1])),
  EMBEDDING_MODEL_NAME: "test-model",
}));

import { createDocument } from "@/lib/knowledge";

beforeEach(async () => {
  await prisma.knowledgeChunk.deleteMany();
  await prisma.knowledgeDocument.deleteMany();
  await prisma.knowledgeCategory.deleteMany();
  await prisma.knowledgeCategory.create({ data: { name: "미분류", displayOrder: 9999 } });
});

function get(url: string) {
  return new NextRequest(url);
}
function post(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
function put(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
function del(url: string) {
  return new NextRequest(url, { method: "DELETE" });
}
const ctx = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

describe("GET /api/admin/knowledge-categories", () => {
  it("200 + rows 배열(미분류 포함)", async () => {
    const res = await GET(get("http://localhost/api/admin/knowledge-categories"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.rows.some((r: { name: string }) => r.name === "미분류")).toBe(true);
  });

  it("docCount 집계 포함", async () => {
    await prisma.knowledgeCategory.create({ data: { name: "성분" } });
    await createDocument({ category: "성분", title: "비타민C", body: "항산화" });
    const res = await GET(get("http://localhost/api/admin/knowledge-categories"));
    const body = await res.json();
    const 성분 = body.rows.find((r: { name: string }) => r.name === "성분");
    expect(성분.docCount).toBe(1);
  });
});

describe("POST /api/admin/knowledge-categories", () => {
  it("정상 생성 → 201", async () => {
    const res = await POST(
      post("http://localhost/api/admin/knowledge-categories", {
        name: "신규",
        icon: "💊",
        color: "bg-blue-100 text-blue-700",
        displayOrder: 1,
      })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("신규");
  });

  it("중복 이름 → 409", async () => {
    await prisma.knowledgeCategory.create({ data: { name: "성분" } });
    const res = await POST(
      post("http://localhost/api/admin/knowledge-categories", { name: "성분" })
    );
    expect(res.status).toBe(409);
  });

  it("빈 name → 400", async () => {
    const res = await POST(
      post("http://localhost/api/admin/knowledge-categories", { name: "" })
    );
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/admin/knowledge-categories/[id]", () => {
  it("정상 수정 → 200", async () => {
    const cat = await prisma.knowledgeCategory.create({ data: { name: "구카테" } });
    const res = await PUT(
      put(`http://localhost/api/admin/knowledge-categories/${cat.id}`, { name: "신카테", icon: "🌿" }),
      ctx(cat.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("신카테");
  });

  it("'미분류' 이름 변경 → 403", async () => {
    const cat = await prisma.knowledgeCategory.findUnique({ where: { name: "미분류" } });
    const res = await PUT(
      put(`http://localhost/api/admin/knowledge-categories/${cat!.id}`, { name: "다른이름" }),
      ctx(cat!.id)
    );
    expect(res.status).toBe(403);
  });

  it("없는 id → 404", async () => {
    const res = await PUT(
      put("http://localhost/api/admin/knowledge-categories/999999", { name: "X" }),
      ctx(999999)
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/admin/knowledge-categories/[id]", () => {
  it("docCount=0 → 200 { movedCount: 0 }", async () => {
    const cat = await prisma.knowledgeCategory.create({ data: { name: "빈카테" } });
    const res = await DELETE(
      del(`http://localhost/api/admin/knowledge-categories/${cat.id}`),
      ctx(cat.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.movedCount).toBe(0);
  });

  it("docCount>0 → 200 { movedCount: N } + 문서 미분류 이동", async () => {
    await prisma.knowledgeCategory.create({ data: { name: "성분" } });
    await createDocument({ category: "성분", title: "루테인", body: "눈" });
    const cat = await prisma.knowledgeCategory.findUnique({ where: { name: "성분" } });
    const res = await DELETE(
      del(`http://localhost/api/admin/knowledge-categories/${cat!.id}`),
      ctx(cat!.id)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.movedCount).toBe(1);
  });

  it("'미분류' 삭제 → 403", async () => {
    const cat = await prisma.knowledgeCategory.findUnique({ where: { name: "미분류" } });
    const res = await DELETE(
      del(`http://localhost/api/admin/knowledge-categories/${cat!.id}`),
      ctx(cat!.id)
    );
    expect(res.status).toBe(403);
  });

  it("없는 id → 404", async () => {
    const res = await DELETE(
      del("http://localhost/api/admin/knowledge-categories/999999"),
      ctx(999999)
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
cd /Users/atinjin/repository/pham-consult/web
npm test -- knowledge-categories-api
```

Expected: FAIL — 라우트 모듈 없음.

- [ ] **Step 3: `GET + POST` 라우트 구현**

`web/src/app/api/admin/knowledge-categories/route.ts` 생성:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listCategories, createCategory, CategoryError, categoryStatus } from "@/lib/knowledgeCategories";

export async function GET() {
  const rows = await listCategories();
  return NextResponse.json({ rows });
}

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  displayOrder: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    const cat = await createCategory(parsed.data);
    return NextResponse.json(cat, { status: 201 });
  } catch (e) {
    if (e instanceof CategoryError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: categoryStatus(e.code) });
    return NextResponse.json({ error: "카테고리 생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}
```

- [ ] **Step 4: `PUT + DELETE` 라우트 구현**

`web/src/app/api/admin/knowledge-categories/[id]/route.ts` 생성:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateCategory, deleteCategory, CategoryError, categoryStatus } from "@/lib/knowledgeCategories";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  displayOrder: z.number().int().optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    const cat = await updateCategory(Number(id), parsed.data);
    return NextResponse.json(cat);
  } catch (e) {
    if (e instanceof CategoryError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: categoryStatus(e.code) });
    return NextResponse.json({ error: "카테고리 수정 중 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const result = await deleteCategory(Number(id));
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof CategoryError)
      return NextResponse.json({ error: e.message, code: e.code }, { status: categoryStatus(e.code) });
    return NextResponse.json({ error: "카테고리 삭제 중 오류가 발생했습니다." }, { status: 500 });
  }
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd /Users/atinjin/repository/pham-consult/web
npm test -- knowledge-categories-api
```

Expected: 11개 all green.

- [ ] **Step 6: 전체 테스트 + tsc**

```bash
npm test
npx tsc --noEmit
```

Expected: 전체 green (169+ tests), tsc clean.

- [ ] **Step 7: 커밋**

```bash
cd /Users/atinjin/repository/pham-consult
git add web/src/app/api/admin/knowledge-categories/ web/tests/knowledge-categories-api.test.ts
git commit -m "feat(knowledge): 카테고리 API(GET·POST·PUT·DELETE)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: 어드민 UI

**Files:**
- Create: `web/src/components/AdminCategoryManager.tsx`
- Modify: `web/src/components/AdminKnowledgeForm.tsx`
- Modify: `web/src/app/admin/knowledge/page.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/knowledge-categories`, `POST`, `PUT /[id]`, `DELETE /[id]`
- No new test file (UI 컴포넌트 테스트 범위 밖).

- [ ] **Step 1: `AdminCategoryManager.tsx` 생성**

`web/src/components/AdminCategoryManager.tsx` 생성:

```tsx
"use client";
import { useCallback, useEffect, useState } from "react";

export type CategoryRow = {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  displayOrder: number;
  docCount: number;
};

const CATEGORY_COLORS = [
  { label: "없음", value: "" },
  { label: "에메랄드", value: "bg-emerald-100 text-emerald-700" },
  { label: "파랑", value: "bg-blue-100 text-blue-700" },
  { label: "보라", value: "bg-violet-100 text-violet-700" },
  { label: "주황", value: "bg-orange-100 text-orange-700" },
  { label: "분홍", value: "bg-pink-100 text-pink-700" },
  { label: "회색", value: "bg-slate-100 text-slate-600" },
];

const field =
  "w-full rounded-xl border border-white/60 bg-white/70 px-3 py-2 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:bg-white";

export function AdminCategoryManager({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string; description: string; icon: string; color: string; displayOrder: string;
  }>({ name: "", description: "", icon: "", color: "", displayOrder: "0" });
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [newForm, setNewForm] = useState({
    name: "", description: "", icon: "", color: "", displayOrder: "0",
  });
  const [newError, setNewError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/admin/knowledge-categories");
    const data = await res.json();
    setRows(data.rows ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function startEdit(row: CategoryRow) {
    setEditingId(row.id);
    setEditForm({
      name: row.name,
      description: row.description ?? "",
      icon: row.icon ?? "",
      color: row.color ?? "",
      displayOrder: String(row.displayOrder),
    });
    setDeletingId(null);
  }

  async function saveEdit(id: number) {
    setBusy(true);
    await fetch(`/api/admin/knowledge-categories/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editForm.name.trim() || undefined,
        description: editForm.description || null,
        icon: editForm.icon || null,
        color: editForm.color || null,
        displayOrder: Number(editForm.displayOrder),
      }),
    });
    setBusy(false);
    setEditingId(null);
    await load();
    onChanged?.();
  }

  async function confirmDelete(id: number) {
    setBusy(true);
    await fetch(`/api/admin/knowledge-categories/${id}`, { method: "DELETE" });
    setBusy(false);
    setDeletingId(null);
    await load();
    onChanged?.();
  }

  async function addCategory() {
    if (!newForm.name.trim()) { setNewError("이름을 입력하세요."); return; }
    setNewError("");
    setBusy(true);
    const res = await fetch("/api/admin/knowledge-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newForm.name.trim(),
        description: newForm.description || undefined,
        icon: newForm.icon || undefined,
        color: newForm.color || undefined,
        displayOrder: Number(newForm.displayOrder),
      }),
    });
    setBusy(false);
    if (res.ok) {
      setNewForm({ name: "", description: "", icon: "", color: "", displayOrder: "0" });
      await load();
      onChanged?.();
    } else {
      const d = await res.json();
      setNewError(d.error ?? "생성 실패");
    }
  }

  if (loading) return <p className="py-6 text-center text-sm text-slate-400">불러오는 중…</p>;

  return (
    <div className="grid gap-4">
      {/* 카테고리 목록 */}
      <ul className="grid gap-2">
        {rows.map((row) => {
          const isProtected = row.name === "미분류";
          const isEditing = editingId === row.id;
          const isDeleting = deletingId === row.id;

          return (
            <li key={row.id} className="rounded-xl border border-slate-200/70 bg-white px-4 py-3">
              {isEditing ? (
                <div className="grid gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={editForm.name}
                      onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="이름"
                      disabled={isProtected}
                      className={field}
                    />
                    <input
                      value={editForm.icon}
                      onChange={(e) => setEditForm((f) => ({ ...f, icon: e.target.value }))}
                      placeholder="이모지 (예: 💊)"
                      maxLength={2}
                      className={field}
                    />
                  </div>
                  <input
                    value={editForm.description}
                    onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="설명 (선택)"
                    className={field}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={editForm.color}
                      onChange={(e) => setEditForm((f) => ({ ...f, color: e.target.value }))}
                      className={field}
                    >
                      {CATEGORY_COLORS.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      value={editForm.displayOrder}
                      onChange={(e) => setEditForm((f) => ({ ...f, displayOrder: e.target.value }))}
                      placeholder="정렬 순서"
                      className={field}
                    />
                  </div>
                  {editForm.color && (
                    <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${editForm.color}`}>
                      {editForm.icon} {editForm.name || "미리보기"}
                    </span>
                  )}
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setEditingId(null)}
                      className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-500"
                    >
                      취소
                    </button>
                    <button
                      onClick={() => saveEdit(row.id)}
                      disabled={busy}
                      className="rounded-full bg-indigo-600 px-4 py-1 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      저장
                    </button>
                  </div>
                </div>
              ) : isDeleting ? (
                <div>
                  {row.docCount > 0 ? (
                    <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
                      <span className="font-semibold">'{row.name}'</span> 카테고리의 문서{" "}
                      <span className="font-semibold">{row.docCount}개</span>가 '미분류'로 이동됩니다.
                      계속하시겠습니까?
                    </p>
                  ) : (
                    <p className="mb-3 text-[13px] text-slate-600">
                      '{row.name}' 카테고리를 삭제하시겠습니까?
                    </p>
                  )}
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setDeletingId(null)}
                      className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-500"
                    >
                      취소
                    </button>
                    <button
                      onClick={() => confirmDelete(row.id)}
                      disabled={busy}
                      className="rounded-full bg-rose-500 px-4 py-1 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex-1 flex items-center gap-2 min-w-0">
                    {row.color ? (
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${row.color}`}>
                        {row.icon} {row.name}
                      </span>
                    ) : (
                      <span className="text-sm font-semibold text-slate-700">
                        {row.icon ? `${row.icon} ` : ""}{row.name}
                      </span>
                    )}
                    {row.description && (
                      <span className="truncate text-[12px] text-slate-400">{row.description}</span>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                    {row.docCount}개
                  </span>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => startEdit(row)}
                      className="rounded-full border border-slate-200 px-2.5 py-1 text-[12px] text-slate-500 hover:bg-slate-50"
                    >
                      수정
                    </button>
                    <button
                      onClick={() => { if (!isProtected) setDeletingId(row.id); }}
                      disabled={isProtected}
                      title={isProtected ? "시스템 카테고리는 삭제할 수 없습니다" : undefined}
                      className="rounded-full border border-slate-200 px-2.5 py-1 text-[12px] text-rose-500 hover:bg-rose-50 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* 새 카테고리 추가 */}
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-4">
        <p className="mb-2 text-[12px] font-semibold text-slate-500">새 카테고리 추가</p>
        <div className="grid gap-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              value={newForm.name}
              onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="이름 *"
              className={field}
            />
            <input
              value={newForm.icon}
              onChange={(e) => setNewForm((f) => ({ ...f, icon: e.target.value }))}
              placeholder="이모지 (예: 💊)"
              maxLength={2}
              className={field}
            />
          </div>
          <input
            value={newForm.description}
            onChange={(e) => setNewForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="설명 (선택)"
            className={field}
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={newForm.color}
              onChange={(e) => setNewForm((f) => ({ ...f, color: e.target.value }))}
              className={field}
            >
              {CATEGORY_COLORS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            <input
              type="number"
              value={newForm.displayOrder}
              onChange={(e) => setNewForm((f) => ({ ...f, displayOrder: e.target.value }))}
              placeholder="정렬 순서"
              className={field}
            />
          </div>
          {newForm.color && newForm.name && (
            <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${newForm.color}`}>
              {newForm.icon} {newForm.name}
            </span>
          )}
          {newError && <p className="text-[12px] text-rose-500">{newError}</p>}
          <button
            onClick={addCategory}
            disabled={busy}
            className="rounded-full bg-slate-800 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
          >
            {busy ? "추가 중…" : "카테고리 추가"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `AdminKnowledgeForm.tsx` category input → select 전환**

`web/src/components/AdminKnowledgeForm.tsx`에서 다음을 변경한다.

**import 추가 (파일 상단):**
```tsx
import { useEffect } from "react";
```
→ 기존 `import { useState } from "react"` 를 아래로 교체:
```tsx
import { useEffect, useState } from "react";
```

**state 추가** (`const editing = !!initial;` 바로 아래):
```tsx
  const [catOptions, setCatOptions] = useState<{ id: number; name: string; icon: string | null }[]>([]);
```

**useEffect 추가** (기존 `const [seededId, setSeededId]` 위에):
```tsx
  useEffect(() => {
    fetch("/api/admin/knowledge-categories")
      .then((r) => r.json())
      .then((d) => setCatOptions(d.rows ?? []))
      .catch(() => {});
  }, []);
```

**category input 교체** (`<input placeholder="카테고리 …" …` 줄을 아래로 교체):
```tsx
          {catOptions.length > 0 ? (
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
              {catOptions.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.icon ? `${c.icon} ` : ""}{c.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              placeholder="카테고리"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={field}
            />
          )}
```

- [ ] **Step 3: `/admin/knowledge/page.tsx` 카테고리 필터 + 관리 버튼 추가**

`web/src/app/admin/knowledge/page.tsx`에서 다음을 변경한다.

**import 추가** (파일 상단 기존 import 블록 끝에):
```tsx
import { AdminCategoryManager } from "@/components/AdminCategoryManager";
```

**state 추가** (`const [q, setQ] = useState("")` 아래):
```tsx
  const [catOptions, setCatOptions] = useState<{ id: number; name: string; icon: string | null }[]>([]);
  const [catMgrOpen, setCatMgrOpen] = useState(false);
```

**catOptions 로드 useEffect 추가** (기존 `useEffect(() => { load(); }, [load])` 아래):
```tsx
  const loadCats = useCallback(async () => {
    const res = await fetch("/api/admin/knowledge-categories");
    const data = await res.json();
    setCatOptions(data.rows ?? []);
  }, []);

  useEffect(() => { loadCats(); }, [loadCats]);
```

**"+ 지식 문서 추가" 버튼 옆에 "카테고리 관리" 버튼 추가** (기존 버튼 div를 아래로 교체):
```tsx
      <div className="mb-6 flex flex-wrap gap-2">
        <button
          onClick={() => {
            setEditDoc(null);
            setFormOpen(true);
          }}
          className="rounded-full accent px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/30 transition hover:opacity-90 active:scale-95"
        >
          + 지식 문서 추가
        </button>
        <button
          onClick={() => setCatMgrOpen(true)}
          className="glass rounded-full px-5 py-2.5 text-sm font-medium text-slate-600 transition hover:-translate-y-0.5 hover:bg-white/70"
        >
          카테고리 관리
        </button>
      </div>
```

**카테고리 관리 Modal 추가** (`<AdminKnowledgeForm …` 바로 아래):
```tsx
      <Modal open={catMgrOpen} title="카테고리 관리" onClose={() => setCatMgrOpen(false)}>
        <AdminCategoryManager onChanged={() => { loadCats(); load(); }} />
      </Modal>
```

**카테고리 필터 input → select 전환** (기존 `<input placeholder="카테고리" …` 줄을 아래로 교체):
```tsx
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={`${field} sm:w-48`}
          aria-label="카테고리"
        >
          <option value="">전체 카테고리</option>
          {catOptions.map((c) => (
            <option key={c.id} value={c.name}>
              {c.icon ? `${c.icon} ` : ""}{c.name}
            </option>
          ))}
        </select>
```

- [ ] **Step 4: tsc 확인**

```bash
cd /Users/atinjin/repository/pham-consult/web
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: 전체 테스트**

```bash
npm test
```

Expected: 전체 green (169+ tests).

- [ ] **Step 6: 커밋**

```bash
cd /Users/atinjin/repository/pham-consult
git add web/src/components/AdminCategoryManager.tsx web/src/components/AdminKnowledgeForm.tsx web/src/app/admin/knowledge/page.tsx
git commit -m "feat(knowledge): 카테고리 관리 UI + 문서 폼/필터 드롭다운 전환

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ KnowledgeCategory 모델 (Task 1)
- ✅ 마이그레이션 + 미분류 시드 (Task 1)
- ✅ listCategories (docCount 집계, displayOrder 정렬) (Task 2)
- ✅ createCategory (중복→DUPLICATE_NAME) (Task 2)
- ✅ updateCategory (cascade, 미분류 보호, 이름→미분류 차단) (Task 2)
- ✅ deleteCategory (미분류 이동, 미분류 보호, movedCount) (Task 2)
- ✅ CategoryError + categoryStatus (Task 2)
- ✅ GET/POST/PUT/DELETE API (Task 3)
- ✅ AdminCategoryManager (목록·수정·삭제경고·추가) (Task 4)
- ✅ AdminKnowledgeForm category → select (Task 4)
- ✅ knowledge page 카테고리 필터 → select (Task 4)
- ✅ knowledge page "카테고리 관리" 버튼 + Modal (Task 4)
- ✅ 색상 팔레트 CATEGORY_COLORS (Task 4)

**2. Placeholder scan:** 없음.

**3. Type consistency:**
- `CategoryRow` — Task 2에서 정의, Task 3 API는 직접 사용 (rows 배열).
- `AdminCategoryManager`의 로컬 `CategoryRow` 타입은 클라이언트 전용 (Prisma 미포함) — lib의 `CategoryRow`와 구조 동일, `docCount` 포함. 서버 타입을 클라이언트에 import하면 Prisma가 번들에 들어가므로 의도적 분리.
- `catOptions` 타입 (`{ id, name, icon | null }`)이 knowledge page와 AdminKnowledgeForm 양쪽에서 일관.
- `categoryStatus` 반환값이 API 라우트에서 HTTP status로 직접 사용 — 일관.
