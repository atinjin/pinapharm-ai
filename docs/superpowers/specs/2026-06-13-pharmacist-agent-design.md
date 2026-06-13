# 약사 상담 + 영양제 추천 시스템 — 설계 문서

- **작성일**: 2026-06-13
- **상태**: 승인됨 (프로토타입 설계)
- **목표**: 일반인이 웹 채팅으로 약사 지식 기반 상담을 받고, 상담 결과에 맞춰 해당 약사가 취급하는 영양제를 추천·구매할 수 있는 시스템. 약사는 어드민에서 영양제 상품을 직접 등록한다.

## 1. 개요 / 범위

### 대상 사용자
- **상담자(일반인)**: 로그인 없이 채팅으로 건강 상담, 영양제 추천/구매
- **약사**: 어드민 페이지에서 취급 영양제 등록·관리

### 핵심 결정 사항
| 항목 | 결정 |
|------|------|
| 웹앱 | Next.js (App Router) — 채팅 UI + 약사 어드민 + 영양제 CRUD |
| 에이전트 | **독립 Python 서비스** (FastAPI + Claude Agent SDK), tool-use 루프 |
| LLM | Claude API (Anthropic) |
| DB | SQLite + Prisma (**web 앱이 소유 = 데이터 단일 소스**) |
| 인증 | 프로토타입은 없음, 추후 추가 |
| 에이전트 도구 | 웹앱 내부 API를 HTTP로 호출 (DB 직접 접근 안 함) |
| 저장소 | 단일 git 저장소에 web/ + agent/ 두 서비스 |

### 설계 원칙
- 에이전트는 웹앱 API 핸들러가 아니라 **자체 경계를 가진 독립 백엔드 서비스**로 분리한다. 향후 RAG, 다단계 추론, 멀티 에이전트, eval 루프를 웹앱을 건드리지 않고 증설하기 위함.
- 에이전트의 데이터 접근은 도구(tool) 호출로만 이루어진다 → Prisma+SQLite를 단일 소스로 유지하고, 도구·데이터소스 확장이 깨끗하다.
- 프로토타입은 YAGNI. 확장 지점은 "구조만 열어두고" 미구현.

## 2. 아키텍처

```
pharmacist-agent/                 ← git 루트
├── web/      Next.js  : 채팅 UI + 약사 어드민 + 영양제 CRUD + Prisma/SQLite
├── agent/    FastAPI  : 약사 에이전트 (Claude Agent SDK, tool-use 루프)
└── docs/, README.md
```

### 데이터 흐름

```
사용자 채팅
  → web /api/chat  (대화 이력 전달, 스트림 프록시)
    → agent POST /chat  (스트리밍)
      → 에이전트 tool 'search_products(condition/keyword)' 호출
        → web /api/agent-tools/search-products
          → Prisma → SQLite (약사 취급 영양제)
          → 결과 반환
      → 에이전트가 추천 구성, 텍스트 스트림 + 추천 productId 목록
    → web 가 채팅 UI로 스트림 전달
  → 채팅 UI: 답변 + 추천 영양제 카드(구매 버튼) 렌더

사용자 "구매" 클릭
  → web /api/orders  (프로토타입: 결제 없이 주문 기록만 생성)
```

## 3. 컴포넌트별 책임

### web (Next.js)
- **페이지**
  - `/` 상담 채팅: 메시지 스트리밍 표시, 추천 영양제 카드(이미지·이름·가격·구매 버튼)
  - `/admin` 약사 어드민: 영양제 등록/수정/삭제, 목록(이미지·가격·성분·적용 증상 태그·재고·활성 여부)
- **API 라우트**
  - `GET/POST /api/products`, `PUT/DELETE /api/products/[id]` — 영양제 CRUD (Prisma)
  - `POST /api/chat` — 대화 이력을 받아 agent `/chat`으로 프록시·스트림 중계
  - `GET /api/agent-tools/search-products` — **에이전트 전용 내부 도구 엔드포인트**. 증상/키워드로 활성 영양제 검색
  - `POST /api/orders` — 프로토타입 주문 스텁 (결제 없음, 기록만)
- **데이터**: Prisma + SQLite = 데이터 단일 소스

### agent (FastAPI)
- `POST /chat` (스트리밍): 대화 이력을 받아 Claude Agent SDK tool-use 루프 실행
- **시스템 프롬프트**: 약사 페르소나·지식 + 안전 가드레일
  - 의료 진단이 아님을 고지
  - 위험/응급 증상은 추천 대신 의료기관·대면 약사 안내
  - 영양제는 의약품을 대체하지 않음
- **도구**
  - `search_products(condition, keyword)` → web `/api/agent-tools/search-products` HTTP 호출
- **상태**: 프로토타입은 상태 비저장(stateless). 대화 이력은 매 턴 client → web → agent로 전달. 상담 기록은 web가 DB에 저장.
- **확장 여지(미구현)**: RAG(약학 지식 임베딩), LangGraph 상태 그래프, 멀티 에이전트, eval/관측

## 4. 데이터 모델 (Prisma)

```
Pharmacist   id, name, (프로토타입은 1명 시드)
Product      id, pharmacistId, name, brand, description, price,
             ingredients, conditionTags(string[]/JSON), imageUrl,
             stock, isActive, createdAt, updatedAt
Consultation id, sessionId, createdAt
Message      id, consultationId, role(user|assistant), content, createdAt
Recommendation id, consultationId, productId, reason
Order        id, productId, quantity, status, createdAt  (결제 없이 기록만)
```

> SQLite는 배열 타입이 없으므로 `conditionTags`는 JSON 문자열 또는 별도 조인 테이블로 표현(구현 플랜에서 확정).

## 5. 에러 처리

- **에이전트 서비스 다운**: 채팅 UI에 친절한 오류 메시지 + 재시도 안내
- **Claude API 오류**: 백오프 재시도 후, 실패 시 사용자에게 안내 메시지
- **도구 호출 실패 / 빈 결과**: 에이전트가 "조건에 맞는 취급 영양제가 없습니다, 약사에게 직접 문의" 식으로 우아하게 응답
- **안전 가드레일**: 응급/심각 증상 키워드 감지 시 추천 대신 의료기관 안내

## 6. 테스트

- **agent**: 도구 함수 단위 테스트 + Claude/도구 목(mock)으로 tool-use 루프 테스트
- **web**: products CRUD API 테스트(테스트용 SQLite), 추천 카드 렌더 테스트
- E2E는 추후

## 7. 프로토타입 범위 (YAGNI)

- 약사 1명 시드, **인증 없음**
- **실제 결제 없음** — 주문은 기록만 생성하는 스텁
- RAG·멀티 에이전트·eval은 **구조만 열어두고 미구현**
- 대화 상태는 클라이언트 전달 방식(서버 세션 저장소 미구현, 메시지 기록만 DB 저장)

## 8. 확장 로드맵 (참고, 본 프로토타입 범위 밖)

- 인증/회원 시스템 (상담자 회원, 약사 계정, 다중 약사)
- 실제 결제 연동
- 약학 지식 RAG, LangGraph 기반 다단계 상담 흐름
- 에이전트 평가(eval) 및 관측
- Postgres 전환
