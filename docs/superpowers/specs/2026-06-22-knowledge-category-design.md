# 지식 카테고리 관리 설계

- **작성일:** 2026-06-22
- **로드맵:** B. 어드민 고도화 → 지식 카테고리 관리
- **선행:** 지식 베이스 CRUD(완료). `KnowledgeDocument.category`가 자유 문자열.
- **후속:** 없음 (독립 피처)

## 목적

지식 문서의 카테고리를 DB 테이블로 관리해 일관성을 확보한다. 약사가 어드민에서 카테고리를 추가·수정·삭제하고, 문서 모달과 목록 필터는 드롭다운으로 전환한다. 카테고리별 이모지·색상·설명·정렬 순서를 지정해 시각적으로 구분한다.

## 결정 사항

- **계층 구조 없음(YAGNI)**: SQLite + Prisma에서 재귀 쿼리 미지원 + 현재 규모에서 불필요. 나중에 `parentId` 컬럼 추가로 확장 가능.
- **String 참조 유지**: `KnowledgeDocument.category`를 FK로 바꾸지 않고 String 그대로. 마이그레이션이 단순하고 "미분류" 이동 로직이 직관적.
- **"미분류" 보호**: 삭제·이름 변경 불가인 시스템 카테고리. 다른 카테고리 삭제 시 해당 문서들의 착지점.
- **삭제 정책**: 카테고리 삭제 시 해당 문서들을 "미분류"로 일괄 이동 + 경고 확인 (docCount > 0이면 "N개 문서가 '미분류'로 이동됩니다" 경고).
- **아이콘/색상**: 이모지(`icon String?`) + Tailwind 클래스(`color String?`). 업로드 인프라 불필요.
- **시드**: 마이그레이션 시 기존 DB의 distinct category 값 자동 시드 + "미분류" 추가.

## 데이터 모델 (Prisma)

```prisma
model KnowledgeCategory {
  id           Int      @id @default(autoincrement())
  name         String   @unique
  description  String?
  icon         String?  // 이모지, 예: "💊"
  color        String?  // Tailwind 클래스 쌍, 예: "bg-emerald-100 text-emerald-700"
  displayOrder Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

`KnowledgeDocument`는 변경 없음 — `category String @default("general")` 그대로.

마이그레이션 스크립트(`prisma/seed-categories.ts` 또는 migration SQL 내 INSERT):
```sql
-- 기존 distinct category 값 시드
INSERT OR IGNORE INTO KnowledgeCategory (name, displayOrder, createdAt, updatedAt)
SELECT DISTINCT category, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM KnowledgeDocument;
-- 보호 카테고리 보장
INSERT OR IGNORE INTO KnowledgeCategory (name, displayOrder, createdAt, updatedAt)
VALUES ('미분류', 9999, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
```

## 도메인 (`web/src/lib/knowledgeCategories.ts`)

```ts
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
  description?: string;
  icon?: string;
  color?: string;
  displayOrder?: number;
};
```

### 함수

**`listCategories(): Promise<CategoryRow[]>`**
- `prisma.knowledgeCategory.findMany({ orderBy: { displayOrder: "asc" } })`
- `docCount`는 `prisma.knowledgeDocument.groupBy({ by: ["category"], _count: true })`로 집계 후 `name`으로 join.

**`createCategory(input: CategoryInput): Promise<KnowledgeCategory>`**
- name unique 위반 시 Prisma `P2002` → `DUPLICATE_NAME` 에러.

**`updateCategory(id: number, input: Partial<CategoryInput>): Promise<KnowledgeCategory>`**
- 대상 카테고리 조회. 없으면 `NOT_FOUND`.
- `input.name`이 "미분류"로의 변경 시도 → `PROTECTED` (다른 카테고리의 이름을 "미분류"로 바꾸는 것 차단).
- 대상 카테고리가 "미분류"이고 `input.name`이 있으면 → `PROTECTED`.
- `prisma.knowledgeCategory.update`.
- **이름 변경 시 cascade**: `input.name`이 있고 기존 이름과 다르면 `prisma.knowledgeDocument.updateMany({ where: { category: oldName }, data: { category: input.name } })`. 트랜잭션으로 묶음.

**`deleteCategory(id: number): Promise<{ movedCount: number }>`**
- 대상 카테고리 조회. 없으면 `NOT_FOUND`.
- name === "미분류" → `PROTECTED`.
- `prisma.$transaction`: 1) `knowledgeDocument.updateMany({ where: { category: name }, data: { category: "미분류" } })` → movedCount; 2) `knowledgeCategory.delete`.
- `{ movedCount }` 반환.

### 에러

기존 지식 베이스 관행(단순 throw, HTTP 상태 직접 매핑):
```ts
export class CategoryError extends Error {
  constructor(public code: "NOT_FOUND" | "PROTECTED" | "DUPLICATE_NAME", message: string) {
    super(message);
  }
}
```
- `NOT_FOUND` → 404
- `PROTECTED` → 403
- `DUPLICATE_NAME` → 409

## API (`web/src/app/api/admin/knowledge-categories/`)

모두 어드민 전용, 인증 없음(로드맵 A).

### `GET /api/admin/knowledge-categories`

```ts
// route.ts
import { listCategories } from "@/lib/knowledgeCategories";
export async function GET() {
  const rows = await listCategories();
  return NextResponse.json({ rows });
}
```

### `POST /api/admin/knowledge-categories`

```ts
const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  displayOrder: z.number().int().optional(),
});
// DUPLICATE_NAME → 409, validation error → 400
```

### `PUT /api/admin/knowledge-categories/[id]`

```ts
const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  displayOrder: z.number().int().optional(),
});
// NOT_FOUND → 404, PROTECTED → 403, DUPLICATE_NAME → 409
```

### `DELETE /api/admin/knowledge-categories/[id]`

body 없음. `{ movedCount: number }` 반환.
- NOT_FOUND → 404, PROTECTED → 403

## 어드민 UI

### `AdminKnowledgeForm.tsx` 변경

- category `<input>` → `<select>` (컴포넌트 마운트 시 `GET /api/admin/knowledge-categories` fetch)
- 각 option: `{icon} {name}` 형식
- fetch 실패 시 기존 text input fallback

### `/admin/knowledge/page.tsx` 변경

- 카테고리 필터 `<input>` → `<select>` (같은 API, "전체" 옵션 포함)
- "카테고리 관리" 버튼 (지식 베이스 탭 우상단 또는 필터 행 옆)
- 버튼 클릭 → `<Modal>` (기존 Modal 컴포넌트)로 `<AdminCategoryManager>` 렌더

### `AdminCategoryManager.tsx` (신규)

**목록 행 (per category):**
```
[icon] [color 배지: name] [description 회색] [docCount 배지] [수정] [삭제]
```
- "미분류": 삭제 버튼 비활성 + 이름 수정 불가 표시 (자물쇠 아이콘 또는 회색 처리)

**수정 인라인 폼 (행 내 토글):**
- 이름 input, 설명 input, 이모지 input (단일 문자 안내), 색상 select 또는 input, 순서 number input
- 저장 / 취소

**삭제 확인:**
- `docCount === 0`: 간단한 `confirm()`형 인라인 경고
- `docCount > 0`: `"'{name}' 카테고리의 문서 {docCount}개가 '미분류'로 이동됩니다. 계속하시겠습니까?"` 인라인 경고 박스 → 확인 버튼

**하단 "새 카테고리 추가" 폼:**
- 이름(필수) · 설명 · 이모지 · 색상 · 순서 입력
- 추가 버튼 → POST → 목록 갱신

**색상 선택 옵션 (사전 정의 팔레트):**
```ts
export const CATEGORY_COLORS = [
  { label: "에메랄드", value: "bg-emerald-100 text-emerald-700" },
  { label: "파랑", value: "bg-blue-100 text-blue-700" },
  { label: "보라", value: "bg-violet-100 text-violet-700" },
  { label: "주황", value: "bg-orange-100 text-orange-700" },
  { label: "분홍", value: "bg-pink-100 text-pink-700" },
  { label: "회색", value: "bg-slate-100 text-slate-600" },
];
```
select에서 선택 → 배지 미리보기.

## 테스트 (vitest)

### `tests/knowledgeCategories.test.ts`

```ts
// beforeEach: KnowledgeDocument, KnowledgeCategory 전체 삭제 후 "미분류" 시드
```

- `listCategories`: 빈 목록 반환; docCount 정확히 집계
- `createCategory`: 정상 생성; name 중복 → DUPLICATE_NAME
- `updateCategory`: 이름·설명·아이콘·색상 변경 정상; 이름 변경 시 문서 cascade; "미분류" 이름 변경 → PROTECTED; 없는 id → NOT_FOUND
- `deleteCategory`: docCount=0 삭제 정상; docCount>0 → 문서 "미분류"로 이동 + movedCount 반환; "미분류" 삭제 → PROTECTED; 없는 id → NOT_FOUND

### `tests/knowledge-categories-api.test.ts`

- `GET` → 200 + rows 배열
- `POST` 정상 → 201; 중복 name → 409; 빈 name → 400
- `PUT /[id]` 정상 → 200; 없는 id → 404; "미분류" name 변경 → 403
- `DELETE /[id]` docCount=0 → 200 `{ movedCount: 0 }`; docCount>0 → 200 `{ movedCount: N }`; "미분류" → 403; 없는 id → 404

## 범위 밖

- 계층 카테고리 (parent/child)
- 카테고리별 접근 권한
- 이미지/썸네일 업로드
- 카테고리 드래그앤드롭 정렬 (displayOrder 수동 입력으로 대체)
- 지식 문서 API의 `category` 필드를 `categoryId`로 전환 (String 참조 방식 유지)
