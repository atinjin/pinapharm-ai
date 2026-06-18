# 어드민 고도화 설계 — 버전 관리·롤백·diff + 프리뷰·매칭·드라이런

- **작성일:** 2026-06-19
- **상태:** 설계 승인 (브레인스토밍 산출물)
- **관련:** [docs/ROADMAP.md](../../ROADMAP.md) B. 어드민 고도화

## Context / 문제

어드민에서 **에이전트 설정(프롬프트·페르소나), 상담 스킬, 지식 문서**가 라이브로 편집되어 상담 품질에 직접 영향을 준다. 그러나 (1) 잘못 편집해도 **되돌릴 방법이 없고**, (2) 스킬·문서 본문의 결과를 **저장 전에 확인할 수단이 없다**. 편집 안전망(버전·롤백·diff)과 미리보기(마크다운·매칭·LLM 드라이런)를 추가한다.

## Goals / Non-goals

**Goals**
- 설정·스킬·지식 문서 편집을 버전으로 보존, 이력 조회, **diff 검토 후 롤백**.
- 스킬·지식 문서 본문 **마크다운 프리뷰**, 스킬 **매칭 미리보기**(결정적), 스킬 **LLM 드라이런**(에이전트 1회 호출).

**Non-goals(후속)**: 버전 보존 캡/정리 정책, 두 임의 버전 간 diff(기본은 현재↔선택), 제품 버전화, 어드민 인증.

---

## A. 버전 관리 + 롤백 + diff

### 모델 — [web/prisma/schema.prisma](../../../web/prisma/schema.prisma)
```prisma
model Revision {
  id         Int      @id @default(autoincrement())
  entityType String   // "agentSetting" | "skill" | "knowledgeDocument"
  entityId   String   // agentSetting: key / skill: id / doc: id
  snapshot   String   // 저장 시점 엔터티 내용 JSON
  summary    String?  // 짧은 요약(선택)
  createdAt  DateTime @default(now())
  @@index([entityType, entityId])
}
```
마이그레이션 `npx prisma migrate dev`.

### lib (순환 방지 모듈 분리)
- `web/src/lib/revisions.ts` (prisma만): `recordRevision(entityType, entityId, snapshot, summary?)`, `listRevisions(entityType, entityId)`, `getRevision(id)`.
- 저장 경로에서 **best-effort 스냅샷**(기록 실패가 저장을 막지 않음):
  - [agentConfig.ts](../../../web/src/lib/agentConfig.ts) `setAgentSettings`: 변경된 각 키에 대해 `recordRevision("agentSetting", key, { value })`.
  - [skills.ts](../../../web/src/lib/skills.ts) `createSkill`/`updateSkill`: `recordRevision("skill", id, { name, description, body, isActive })`.
  - [knowledge.ts](../../../web/src/lib/knowledge.ts) `createDocument` · [knowledgeAdmin.ts](../../../web/src/lib/knowledgeAdmin.ts) `updateDocument`: `recordRevision("knowledgeDocument", id, { category, title, body, source })`.
- `web/src/lib/rollback.ts`: `rollbackRevision(id)` — `getRevision` 스냅샷을 엔터티에 재적용(설정=키 값 복원 / 스킬=필드 복원 / 지식문서=본문 복원→**재청킹·재임베딩**) 후 롤백을 새 Revision으로 기록. 엔터티 update lib + recordRevision을 import(누수 없는 단방향: entity→revisions, rollback→entity·revisions).

### API — `web/src/app/api/admin/revisions/`
- `GET /?entityType=&entityId=` 목록, `GET /[id]` 스냅샷, `POST /[id]/rollback`.

### Diff 뷰 + UI
- 재사용 `RevisionHistory(entityType, entityId, currentSnapshot)` 모달: 버전 목록(시각·요약) + 버전 선택 시 **현재 내용 ↔ 선택 버전** 본문 **diff(jsdiff `diffLines`)** 렌더(추가/삭제 색상) → "이 버전으로 롤백"(확인).
- 비교 필드: 설정=`value`, 스킬=`body`(+ name·description 변경 표기), 문서=`body`(+ title·source).
- 의존성: `diff`(jsdiff) devDependency 1개 추가. diff 계산은 클라이언트(스냅샷 2개 비교).
- 연결: [AdminSkillItem](../../../web/src/components/AdminSkillItem.tsx)·[AdminKnowledgeItem](../../../web/src/components/AdminKnowledgeItem.tsx)에 "이력" 버튼, [AdminAgentSettings](../../../web/src/components/AdminAgentSettings.tsx)에 키별 "이력".

---

## B. 프리뷰 + 매칭 + LLM 드라이런

- **마크다운 프리뷰**: 기존 의존성 `react-markdown` 재사용. 스킬 폼·지식 문서 폼에 "미리보기" 토글 → 본문 렌더(기존 `.chat-md` 스타일 재사용).
- **스킬 매칭 미리보기**: `web/src/lib/skillMatch.ts` `scoreSkills(query, skills)` — `name+description` 토큰 겹침 점수. 스킬 페이지 "매칭 테스트" 패널: 질의 → 활성 스킬 랭킹·매칭 토큰 표시(LLM 없음·결정적).
- **스킬 LLM 드라이런**:
  - 에이전트 신규 `POST /skill-dryrun { query, skill_body, skill_name? }` ([agent/app/main.py](../../../agent/app/main.py)): 페르소나(config) + "이 상담 스킬 절차를 적용해 답하라\n{skill_body}" 시스템 메시지 + 샘플 질의로 **1회(one-shot, 도구·그래프 없이) Claude 호출** → `{ response }`. 키 없으면 502/안내.
  - web 프록시 `POST /api/admin/skills/dryrun { skillId, query }` → 스킬 본문 조회 후 `AGENT_URL/skill-dryrun` 호출 → 응답 전달(실패 시 안전 메시지).
  - UI: 스킬 패널 "LLM 드라이런" — 질의 입력 → Claude 응답 미리보기(로딩). 비용·비결정적 명시.

---

## 에러 처리
- 스냅샷 기록·롤백 재임베딩은 best-effort(저장/롤백을 막지 않음, 실패는 로그/표시).
- 드라이런/매칭: 에이전트·키 미가용 시 안전한 오류 문구. 채팅/검색 등 기존 기능에 영향 없음.

## 테스트
- **lib**: `recordRevision`/`listRevisions`/`getRevision`, `rollbackRevision`(타입별 재적용: 설정·스킬·지식문서), `scoreSkills` 랭킹(prisma/embeddings는 mock).
- **API**: revisions 목록·롤백, skills/dryrun 프록시(agent mock), 매칭.
- **agent**: `/skill-dryrun`(ChatAnthropic mock) 응답·키 없음 폴백.
- **UI**: diff 렌더, 마크다운 프리뷰 토글.

## E2E 검증
- 스킬 수정 → 이력에 버전 누적 → diff로 변경 확인 → 이전 버전 롤백 → 반영 확인.
- 지식 문서 본문 수정·롤백 → 재청킹·재임베딩 확인.
- 스킬 폼 마크다운 프리뷰, 매칭 테스트(질의→후보), LLM 드라이런(키 있을 때 응답 / 없을 때 안내).
- web `npx vitest run`·`tsc`, agent `pytest` 그린.

## 범위 밖
버전 diff 두 임의 버전 비교, 보존 캡, 제품 버전화, 어드민 인증, 드라이런 스트리밍.
