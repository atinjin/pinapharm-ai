# pham-consult — 구현 현황 및 로드맵

> 약사 상담 + 영양제 추천 프로토타입. 일반인이 웹 채팅으로 약사 지식 기반 상담을 받고,
> 약사가 어드민에서 등록한 영양제를 상담 결과에 맞춰 추천·구매하는 시스템.

- **작성일:** 2026-06-16 (갱신: 2026-06-17 — RAG 구현 반영)
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

### 5. RAG 검색·그라운딩 (Voyage 임베딩)

- **Phase 1 — 제품 의미검색**: `searchProducts`를 하이브리드(의미∪lexical)로 — 동의어 사전에 없는 표현도 매칭. 추천 카드·적재 흐름은 유지.
- **Phase 2 — 원료 지식 그라운딩**: `retrieve_knowledge` 도구 + `/api/agent-tools/retrieve-knowledge`로 식약처 원료 인정정보(기능성·주의사항·상호작용)를 검색해 답변 근거로 주입.
- `KnowledgeChunk`(SQLite BLOB 벡터) + Node 코사인 top-k, 임베딩 실패 시 lexical 폴백. 색인 스크립트 `index:products`/`index:knowledge`.
- 설계·계획: [spec](superpowers/specs/2026-06-16-rag-consultation-design.md) · [plan](superpowers/plans/2026-06-16-rag-consultation.md)

### 데이터 모델 (Prisma)
`Pharmacist` · `Product` · `Consultation` · `Message` · `Recommendation` · `Order` ·
`Customer` · `Identity` · `HealthProfile` · `AgentSetting` · `ConsultationSkill` · `KnowledgeChunk`

---

## 🚧 구현 예정 (계획)

우선순위 순. 체크박스는 미구현 항목.

### A. 보안 · 운영 (우선순위 높음)
- [ ] **어드민 인증/접근 제어** — 현재 `/admin`과 `/api/admin/*`이 완전 공개. 프롬프트·스킬·상품을 누구나 수정 가능
- [ ] GitHub Dependabot 취약점(moderate 1건) 해결
- [ ] 비밀키·환경변수 관리 점검(`.env` 노출 경로, 운영 분리)

### B. 어드민 고도화
- [ ] 프롬프트·스킬 **버전 관리 + 롤백**
- [ ] 변경 이력 / 감사 로그(누가 언제 무엇을 바꿨는지)
- [ ] 스킬 본문 **마크다운 프리뷰**, 스킬 동작 테스트(드라이런)

### C. 테스트 보강
- [ ] `agent-settings` / `skills` / `agent-config` 라우트 테스트 (현재 어드민 신규 API 테스트 부재)
- [ ] 어드민 UI 통합 테스트(탭·모달·검색/정렬/페이징)
- [ ] `load_consultation_skill` 도구의 에이전트 통합 테스트

### D. 상담 품질
- [x] **RAG** — 제품 의미검색 + 식약처 원료 지식 그라운딩 ✅ (위 "5. RAG 검색·그라운딩" 참고)
- [ ] (RAG 운영) Voyage 결제수단 등록 후 제품 전량 색인 + 원료 코퍼스 20~30종 약사 검수 확장
- [ ] 멀티에이전트 / 다단계 추론
- [ ] **eval 하네스** — 상담 품질·안전 가드레일 회귀 평가

### E. 커머스
- [ ] 실제 결제·주문 플로우(현재 기록만) + 재고 차감 연동
- [ ] 주문 상태 관리 / 알림

### F. 확장성
- [ ] 상품 검색·정렬·페이징을 **서버사이드**로 전환(현재 클라이언트 — 수백 건은 OK, 수천 건 대비)

---

## 알려진 차이 / 메모

- README의 "대화는 stateless" 기술은 현재 코드와 다름 — **세션 메모리·건강 프로필 개인화가 이미 구현됨**(추후 README 갱신 필요).
- 에이전트 설정·상담 스킬의 폴백 기본값은 `agent/app/prompts.py`(+`triage.py`)와 `web/src/lib/agentConfig.ts`의 `DEFAULTS`에 **이중으로** 존재 — 한쪽만 바꾸면 어긋날 수 있으니 동시 수정.
