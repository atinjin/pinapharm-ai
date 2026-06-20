# pham-consult — 구현 현황 및 로드맵

> 약사 상담 + 영양제 추천 프로토타입. 일반인이 웹 채팅으로 약사 지식 기반 상담을 받고,
> 약사가 어드민에서 등록한 영양제를 상담 결과에 맞춰 추천·구매하는 시스템.

- **작성일:** 2026-06-16 (갱신: 2026-06-19 — RAG 2단계 진화 + 어드민 고도화 반영)
- **실행/테스트 방법:** [README.md](../README.md)
- **설계 스펙:** [docs/superpowers/specs/](superpowers/)

## 아키텍처 요약

```
web/    Next.js 16 + Prisma/SQLite   채팅 UI · 약사 어드민 · 영양제 CRUD · 데이터 단일 소스
agent/  FastAPI + LangGraph (Claude) 약사 에이전트 (tool-use 루프, Python 3.13)
```

- 에이전트는 **DB를 직접 만지지 않고**, web 내부 API(`/api/agent-tools/*`, `/api/agent-config`)를 HTTP로 호출한다.
- 설정(프롬프트·페르소나·스킬)은 web DB에 저장하고, 에이전트가 **요청마다(30s TTL 캐시)** 가져와 반영한다.

---

## ✅ 구현 완료

### 1. 상담 에이전트 (`agent/`)
- LangGraph 그래프: `triage → agent ⇄ tools → finalize` / 위험 시 `emergency` 분기
- 응급 분류기(triage)와 안전 가드레일(emergency 메시지)
- 도구: `search_products`, `get_health_profile`, `save_health_profile`, `load_consultation_skill`
- **한국 PII 레닥션**(이메일·주민등록번호·전화번호)을 LLM 전송 전 적용
- SSE 스트리밍 + CRLF(`\r\n\r\n`) 프레임 경계 처리
- 세션 메모리: SQLite checkpointer, `session_id`를 LangGraph `thread_id`로 사용
- **런타임 설정 로딩**: `config_client`(30s TTL 캐시), web 미응답 시 하드코딩 상수로 폴백
- 테스트: `pytest` (graph / tools / triage / redaction / agent / main)

### 2. 웹 · 상담 UI (`web/`)
- 상담 채팅(`ChatPanel`): SSE 파싱, `session_id` localStorage 영속
- 영양제 스토어프론트 + 추천 카드 하이라이트
- `/api/chat` SSE 프록시 + 상담·메시지·추천 DB 적재(장애 시 우아한 실패)
- 주문 기록(`/api/orders`, 프로토타입 — 결제 없이 기록만)
- 데이터 적재: 어드민 단건 등록, CSV 일괄 등록, 식약처 공공 API import
- 내부 에이전트 API: `search-products`, `health-profile`, `skill`, `agent-config`
- 테스트: `vitest` (products / chat / consultations / customers / health-profile / import / agentStream)

### 3. 개인화
- `Customer` / `Identity` / `HealthProfile` 스키마 + `resolveCustomer`(session_id 기반)
- 건강 프로필 get/save(연령대·기저질환·복용약·알레르기·임신/수유) → 상담에 반영

### 4. 어드민 (최근 작업)
- **상품 관리**: 등록/수정/삭제, 가격·재고·진열 토글, CSV 일괄, 식약처 import
- **상품 검색·정렬·페이징**: 제품명·브랜드·증상 태그 검색, 최신/이름/가격/재고 정렬, 20개 단위 페이징
- 신규 등록·CSV 등록을 **모달**로 전환
- 어드민을 **상품 / 에이전트 / 스킬 탭**으로 분리
- **에이전트 설정 편집**: 페르소나·시스템 프롬프트·응급 메시지·분류 프롬프트(`AgentSetting`, 저장 즉시 반영)
- **상담 스킬 등록**: `ConsultationSkill` — Claude Code 스킬 모델(name + description + 본문, 점진적 공개)을 `load_consultation_skill` 도구로 온디맨드 로드

### 5. RAG — 제품 검색 + 지식 그라운딩 (Voyage 임베딩, 두 서비스로 분리)

- **제품 검색**: `searchProducts` 하이브리드(의미∪lexical) + **구조화 필터**(제형·용량·성분·제외 알레르겐, 데이터 있을 때만 불일치 제외·알레르겐은 하드 제외). 에이전트 `search_products` 도구가 대화 맥락·건강 프로필로 구조화 질의를 채움. `Product`에 `form`·`doseAmount`·`doseUnit`·`ingredientsStructured` 추가. 추천 카드·적재 흐름 유지.
- **지식 그라운딩(문서 청킹)**: `KnowledgeDocument` → 문단 우선 청킹 → `KnowledgeChunk`(documentId·임베딩). `retrieve_knowledge`가 청크 top-k를 **출처와 함께** 그라운딩. 긴 문서(논문·기사·약사 노하우) 수용.
- 공통: SQLite BLOB 벡터 + Node 코사인 top-k, 임베딩 실패 시 lexical/빈 결과 폴백. 색인 스크립트 `index:products`/`index:knowledge`.
- 설계·계획: [RAG spec](superpowers/specs/2026-06-16-rag-consultation-design.md) · [RAG plan](superpowers/plans/2026-06-16-rag-consultation.md) · [지식 대시보드 spec](superpowers/specs/2026-06-17-rag-knowledge-dashboard-design.md)

### 6. 어드민 고도화

- **버전 관리 + 롤백 + diff**: 제네릭 `Revision` — 에이전트 설정·상담 스킬·지식 문서 저장 시 스냅샷, 이력 조회, **현재↔선택 버전 diff(jsdiff)** 검토 후 롤백(지식 문서는 재청킹·재임베딩). `/api/admin/revisions/*` + `RevisionHistory` UI.
- **지식 베이스 큐레이션 대시보드**: 문서 CRUD·검수 상태·재임베딩·**검색 테스트**(질의→실제 검색되는 청크 미리보기).
- **마크다운 프리뷰**: 스킬·지식 문서 본문 렌더 토글.
- **스킬 테스트**: 매칭 미리보기(결정적 어휘)·**LLM 드라이런**(에이전트 `/skill-dryrun` 1회 호출).
- 설계: [어드민 고도화 spec](superpowers/specs/2026-06-19-admin-versioning-preview-design.md)

### 데이터 모델 (Prisma)
`Pharmacist` · `Product` · `Consultation` · `Message` · `Recommendation` · `Order` ·
`Customer` · `Identity` · `HealthProfile` · `AgentSetting` · `ConsultationSkill` · `KnowledgeDocument` · `KnowledgeChunk` · `Revision`

---

## 🚧 구현 예정 (계획)

우선순위 순. 체크박스는 미구현 항목.

### A. 보안 · 운영 (우선순위 높음)
- [ ] **어드민 인증/접근 제어** — 현재 `/admin`과 `/api/admin/*`이 완전 공개. 프롬프트·스킬·상품을 누구나 수정 가능
- [ ] GitHub Dependabot 취약점(moderate 1건) 해결
- [ ] 비밀키·환경변수 관리 점검(`.env` 노출 경로, 운영 분리)

### B. 어드민 고도화 ✅ (위 "6. 어드민 고도화" 참고)
- [x] 프롬프트·스킬·지식 문서 **버전 관리 + 롤백 + diff**
- [x] 변경 이력(버전 스냅샷이 이력 역할) — "누가"(사용자 식별)는 인증 도입 후
- [x] 스킬·문서 **마크다운 프리뷰** + 스킬 **매칭 미리보기 / LLM 드라이런**

### C. 테스트 보강
- [ ] `agent-settings` / `skills` / `agent-config` 라우트 테스트 (현재 어드민 신규 API 테스트 부재)
- [ ] 어드민 UI 통합 테스트(탭·모달·검색/정렬/페이징)
- [ ] `load_consultation_skill` 도구의 에이전트 통합 테스트

### D. 상담 품질
- [x] **RAG** — 제품 하이브리드·구조화 검색 + 지식 문서 청킹 그라운딩 ✅ (위 "5. RAG" 참고)
- [ ] (RAG 운영) Voyage 결제수단 등록 후 제품 전량 색인 + 원료/지식 코퍼스 약사 검수 확장
- [x] **다단계 추론 (명시적 플래너)** — `triage` 다음 `plan` 노드가 짧은 상담 계획을 세워 **채팅에 노출**(SSE `event:"plan"`)하고 **시스템 프롬프트 체크리스트로 주입**해 agent 루프를 안내. 계획 실패 시 빈 계획 폴백(무가이드 진행). eval `plan_includes`로 회귀 검증. 설계: [planner plan](superpowers/plans/2026-06-20-planner-reasoning.md)
- [ ] 멀티에이전트(라우터→전문 에이전트) — 단일 에이전트 tool-use 루프로 충분해 보류
- [x] **eval 하네스** — 상담 안전·행동 회귀 평가(결정적 어서션). `make eval` / `python -m app.eval`, safety 시나리오 실패 시 비정상 종료. 설계: [eval spec](superpowers/specs/2026-06-19-eval-harness-design.md) · [plan](superpowers/plans/2026-06-19-eval-harness.md)

### E. 커머스 — 실제 상품 판매
> 현재 상태: 결제 없이 `Order` 기록만 생성(`productId·quantity·status`). 고객 연결·가격 스냅샷·결제·배송·다중상품(line items) 모두 없음. 실판매까지 아래가 필요하다.

#### E1. 결제 (PG 연동)

- [ ] PG 연동 — 포트원(아임포트)/토스페이먼츠 등, 카드·간편결제(네이버·카카오·토스페이)·계좌이체
- [ ] 결제 승인·취소·부분취소·환불 + 웹훅(결제완료 콜백) **서명 검증**, 멱등키로 이중결제 방지
- [ ] 카드정보 비저장(PG 토큰화), **서버측 가격 신뢰**(클라이언트 전송 금액 변조 방지)

#### E2. 장바구니·주문

- [ ] 장바구니(다중 상품·수량) + 주문서(line items)·총액·배송비·할인 계산
- [ ] `Order` 확장: `customerId`·주문번호·**주문시점 가격 스냅샷**·결제정보·배송지 스냅샷 + `OrderItem`(현재 단일 product 한계 해소)
- [ ] 주문 상태 머신: created→paid→preparing→shipped→delivered / cancelled·refunded
- [ ] 재고 차감·복원(주문 시 차감, 취소·결제실패 시 복원), **동시성 오버셀 방지**(트랜잭션/락)

#### E3. 배송

- [ ] 배송지 입력·관리, 배송비 정책(무료배송 임계·도서산간 추가비)
- [ ] 택배사 연동/송장번호 등록, 배송 추적·상태 갱신

#### E4. 구매자 계정·인증 (어드민 인증 A와 별개)

- [ ] 구매자 로그인/회원가입(소셜·이메일) 또는 비회원 주문, 주문내역 조회
- [ ] 현재 `Customer`/`Identity`(session_id 익명)를 결제·본인확인과 연결

#### E5. 법규·규제 (한국 · 약국/건기식) — 실판매의 하드 게이트

- [ ] **판매 품목 한정**: 일반의약품 온라인 판매 불가(약사법) → **건강기능식품/영양제만** 판매, 건기식 판매업 영업신고
- [ ] 통신판매업 신고 + 전자상거래법 고지(사업자정보·신고번호·청약철회/환불정책·이용약관·개인정보처리방침)
- [ ] 건기식 표시·광고 규정 준수(질병 예방·치료 표현 금지) — 상담 답변·상품 상세 카피 점검
- [ ] 개인정보 수집·이용·위탁(PG·택배) 동의, 결제·배송정보 보호

#### E6. 운영·CS

- [ ] 주문 관리 어드민(주문 목록·상태 변경·환불 처리·매출 리포트)
- [ ] 알림(주문확인·배송) — 이메일/SMS/카카오 알림톡
- [ ] 환불·교환·반품(reverse logistics) 프로세스
- [ ] 세금: 부가세·현금영수증/세금계산서

### F. 확장성
- [ ] 상품 검색·정렬·페이징을 **서버사이드**로 전환(현재 클라이언트 — 수백 건은 OK, 수천 건 대비)

---

## 알려진 차이 / 메모

- 에이전트 설정·상담 스킬의 폴백 기본값은 `agent/app/prompts.py`(+`triage.py`)와 `web/src/lib/agentConfig.ts`의 `DEFAULTS`에 **이중으로** 존재 — 한쪽만 바꾸면 어긋날 수 있으니 동시 수정.
- 플래너 프롬프트(`planPrompt`/`PLAN_SYSTEM`)는 현재 **agent 단일 소스**(`prompts.py`·`config_client.DEFAULT_CONFIG`)이며 web `agentConfig.ts`·`/api/agent-config`엔 미반영 — agent가 자체 상수로 폴백. 추후 어드민 편집 UI 도입 시 이중 동기화 대상에 포함해야 함.
- 운영 전제: 버전(`Revision`) 보존 정책 없음(소규모 가정), `AGENT_URL`은 운영자 신뢰(검증 없음), 스킬 매칭 미리보기는 어휘 기반(의미 X). 어드민 인증은 미구현(A 항목).
