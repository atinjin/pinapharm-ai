# RAG 적용 설계 — 상담 품질 향상

- **작성일:** 2026-06-16
- **상태:** 설계 승인 대기 (브레인스토밍 산출물)
- **관련:** [docs/ROADMAP.md](../../ROADMAP.md) D. 상담 품질

## Context / 문제

상담 에이전트(맑은 약사)의 답변 품질을 높이고자 RAG를 적용한다. 현재 두 가지 약점이 있다.

1. **제품 매칭이 어휘적**: `searchProducts`([web/src/lib/products.ts](../../../web/src/lib/products.ts))는 부분일치 + 하드코딩된 12개 증상 동의어 사전에 의존한다. 사전에 없는 표현은 못 잡는다.
2. **답변 근거 부재**: 성분·주의사항·상호작용 같은 안내가 모델의 파라미터 기억에 의존 → 그럴듯하지만 틀릴 수 있다(할루시네이션).

RAG로 (1) 제품 추천 매칭을 **의미 기반**으로 올리고, (2) 답변을 **권위 있는 원료 지식에 그라운딩**한다.

## Goals / Non-goals

**Goals**
- 제품 의미검색(Phase 1)과 원료 지식 그라운딩(Phase 2)을 한 스펙으로.
- 기존 아키텍처 원칙 유지: 임베딩·벡터·검색은 **web**에 두고, 에이전트는 **도구로만** 호출.
- 임베딩 실패 시에도 채팅이 끊기지 않는 graceful degradation.

**Non-goals (이번 범위 밖)**
- 리랭커(`rerank-2`), `sqlite-vec`/외부 벡터 DB(규모 커지면 후속), 식약처 API 원료 자동 확장, MFDS description 트렁케이션 확대.

## 결정 사항

| 항목 | 결정 | 근거 |
|---|---|---|
| 범위 | Phase 1(제품 의미검색) + Phase 2(원료 지식 그라운딩) | 동일 배관 재사용 |
| 임베딩 | **Voyage `voyage-3.5-lite`** (1024차원, `input_type` document/query) | 한국어 검색 품질·Anthropic 스택 정합성, env로 교체 가능 |
| 벡터 저장/검색 | SQLite에 임베딩 저장 + **Node 코사인 직접 계산**(정규화 후 dot) | 네이티브 확장 불필요, 현 규모(~150청크)에 충분 |
| 통합 | **도구 호출**(기존 search_products 패턴) | 아키텍처 일관·토큰 절약 |

## 아키텍처

```
[색인] 제품/원료 텍스트 → Voyage(embed, input_type=document) → KnowledgeChunk.embedding 저장(web)
[질의] agent ──tool──▶ web /api/agent-tools/* → Voyage(embed, input_type=query)
                                              → 코사인 top-k → 결과 반환 → ToolMessage 주입
```

임베딩·벡터·검색 = **web(Node)**. 에이전트는 도구로만 접근(기존 `/api/agent-tools/*` 패턴).

## 데이터 모델 — [web/prisma/schema.prisma](../../../web/prisma/schema.prisma)

제품·원료 두 용도를 한 테이블로 통합:

```prisma
model KnowledgeChunk {
  id        Int      @id @default(autoincrement())
  kind      String   // "product" | "ingredient"
  refId     String?  // product: productId(문자열) / ingredient: 원료명
  title     String
  text      String   // 임베딩 대상 텍스트
  metadata  String   @default("{}") // product: {price,stock,brand} / ingredient: {주의사항,상호작용,일일섭취량,출처}
  embedding Bytes    // 정규화된 Float32 벡터 직렬화(1024 → 4096 bytes)
  model     String   // 임베딩 모델명(재색인 추적)
  updatedAt DateTime @updatedAt

  @@index([kind])
}
```

저장 시 벡터를 L2 정규화 → 질의 시 dot product = 코사인. 마이그레이션 `npx prisma migrate dev`.

## 컴포넌트

### 1. 임베딩 레이어 — `web/src/lib/embeddings.ts`
- `embed(texts: string[], inputType: "document"|"query"): Promise<number[][]>`
- Voyage REST 호출(`POST https://api.voyageai.com/v1/embeddings`, `VOYAGE_API_KEY`), `EMBEDDING_PROVIDER`/`EMBEDDING_MODEL`/`EMBEDDING_DIM` env로 추상화.
- 반환 벡터는 정규화해서 사용. 실패 시 throw(호출부가 폴백 처리).
- `web/src/lib/vectors.ts`: `serialize`/`deserialize`(Float32 ↔ Bytes), `cosineTopK(queryVec, chunks, k)`.

### 2. Phase 1 — 제품 의미검색 (하이브리드)
- `searchProducts`를 하이브리드로: 질의(`condition`+`keyword`) 임베딩 → product 청크 코사인 top-k ∪ 기존 lexical/동의어 매칭 → 활성 제품 dedup·랭킹 후 반환.
- **`/api/agent-tools/search-products` 시그니처·추천 카드·DB 적재 흐름은 그대로** — 매칭 품질만 향상.
- **폴백**: 임베딩 실패 또는 미색인 시 기존 lexical 경로(현재 동작 유지).

### 3. Phase 2 — 원료 지식 그라운딩
- 코퍼스: `web/data/ingredient-knowledge.json` — 흔한 건강기능식품 원료 20~30종. 각 항목 `{ 원료명, 기능성, 주의사항, 상호작용, 일일섭취량, 출처 }`. **식약처 원료 인정정보에서 큐레이션 + 약사 검수**(LLM 생성 금지). `text`=항목 텍스트 연결, `metadata`=구조화 필드.
- 엔드포인트 `GET /api/agent-tools/retrieve-knowledge?q=&k=4`: 질의 임베딩 → kind=ingredient 코사인 top-k → `[{ title, text, metadata, score }]`.
- 에이전트 도구 `retrieve_knowledge(query, k=4)`([agent/app/tools.py](../../../agent/app/tools.py)) → 위 엔드포인트 호출. [graph.py](../../../agent/app/graph.py) `bind_tools`에 추가 + `tools_node`에 `elif name == "retrieve_knowledge"` 디스패치.
- 시스템 프롬프트 지침: "성분·복용·상호작용·안전 안내 전 `retrieve_knowledge`로 근거를 확인하라" — 편집 가능한 기본 프롬프트([web/src/lib/agentConfig.ts](../../../web/src/lib/agentConfig.ts) `DEFAULTS.system_prompt`)와 폴백([agent/app/prompts.py](../../../agent/app/prompts.py))에 동시 반영.

### 4. 색인
- `npm run index:products`: 활성 제품 전체 → 청크 백필(name+description+ingredients+tags 임베딩).
- `npm run index:knowledge`: seed json 로드 → 임베딩 → kind=ingredient upsert.
- 쓰기 훅: `createProduct`/`updateProduct`/`createManyProducts`에서 해당 청크 **best-effort** upsert(try/catch, 비차단 — Voyage 장애 시 CRUD는 정상, lexical 폴백). 색인의 source of truth는 백필 스크립트.

## 설정 (env)
`web/.env`: `VOYAGE_API_KEY`, `EMBEDDING_PROVIDER=voyage`, `EMBEDDING_MODEL=voyage-3.5-lite`, `EMBEDDING_DIM=1024`. `.env.example`에 추가.

## 에러 처리
- 임베딩 API 실패: 제품검색 → lexical 폴백, 지식검색 → 빈 결과(도구가 "근거 없음" 반환). 채팅 절대 안 끊김.
- 미색인 상태: 동일하게 폴백.
- 모델 불일치(`model` 컬럼) 청크는 무시 또는 재색인 안내.

## 테스트
- **web 단위**: `vectors`(정규화·cosineTopK), 하이브리드 병합·lexical 폴백, 임베딩 provider mock.
- **web 통합**: `/api/agent-tools/retrieve-knowledge` 시드 데이터로 기대 랭킹, `/api/agent-tools/search-products` 의미검색+폴백.
- **agent**: `tools.py` `retrieve_knowledge`가 엔드포인트 호출(httpx mock), `graph` `tools_node` 디스패치.

## 마일스톤
1. `embeddings.ts`+`vectors.ts` + `KnowledgeChunk` 모델·마이그레이션.
2. 색인 스크립트(products 백필 + knowledge seed).
3. Phase 1: 하이브리드 `searchProducts` + 폴백.
4. Phase 2: `retrieve-knowledge` 엔드포인트 + 에이전트 도구 + 프롬프트 지침.
5. 테스트 + E2E 검증.

## E2E 검증
- web `npm run index:products && npm run index:knowledge` → 청크 적재 확인.
- 의미검색: "기운이 하나도 없고 축 처져요"(동의어 사전에 없는 표현) → 피로 관련 제품이 추천 카드에 뜨는지.
- 그라운딩: "와파린 먹는데 오메가3 괜찮아요?" → 에이전트가 `retrieve_knowledge` 호출 후 출혈 위험·주의 근거로 답하는지(SSE·로그 확인).
- 폴백: `VOYAGE_API_KEY` 제거 후에도 lexical 추천·정상 응답.

## 안전 주의
원료 지식 seed는 **반드시 식약처 인정정보 등 권위 출처에서 큐레이션하고 약사가 검수**한다. LLM으로 생성하면 방지하려는 할루시네이션을 그대로 주입하게 된다. 각 청크에 `출처`를 명시.

## 향후 (범위 밖)
- `rerank-2`로 top-k 품질↑, `sqlite-vec`/외부 벡터 DB로 확장, 식약처 API로 원료 코퍼스 자동 확장, MFDS description 트렁케이션 확대로 제품 텍스트 강화.
