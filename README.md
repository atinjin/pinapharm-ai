# pharmacist-agent

약사 상담 + 영양제 추천 프로토타입.

일반인이 웹 채팅으로 약사 지식 기반 상담을 받고, 약사가 어드민에서 등록한 영양제를
상담 결과에 맞춰 추천·구매할 수 있는 시스템입니다.

## 구성

```
pharmacist-agent/
├── web/      Next.js 16  : 채팅 UI + 약사 어드민 + 영양제 CRUD + Prisma/SQLite (데이터 단일 소스)
├── agent/    FastAPI      : 약사 에이전트 (Claude tool-use 루프, Python 3.13)
└── docs/     설계 문서 / 구현 플랜
```

- **에이전트는 DB를 직접 만지지 않습니다.** 영양제 조회는 `search_products` 도구로
  web의 내부 API(`/api/agent-tools/search-products`)를 HTTP 호출합니다.
- 향후 RAG·다단계 추론·멀티에이전트는 `agent/` 서비스 안에서 확장합니다.

## 사전 준비

- Node.js 20+ / npm
- Python 3.11+ (개발은 3.13 사용)
- Anthropic API 키 (실제 상담 응답에 필요)

## 실행

### 1) web (포트 3000)
```bash
cd web
cp -n .env.example .env          # DATABASE_URL, AGENT_URL
npm install
npx prisma migrate dev           # SQLite 스키마 생성
npm run seed                     # 약사 1명 + 샘플 영양제 5종
npm run dev                      # http://localhost:3000
```

### 2) agent (포트 8000)
```bash
cd agent
python3.13 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
cp -n .env.example .env           # ANTHROPIC_API_KEY 를 실제 값으로 채울 것
uvicorn app.main:app --reload --port 8000
```

> `.env`의 `ANTHROPIC_API_KEY`가 없으면 채팅은 "상담 처리 중 오류" 메시지로
> 우아하게 실패합니다(배선은 정상). 실제 상담 응답을 보려면 키를 채우세요.

## 사용

- **상담 채팅**: http://localhost:3000 — 건강 고민을 입력하면 약사 에이전트가 상담하고,
  취급 영양제를 추천합니다. 추천 카드의 "구매"로 주문(프로토타입: 결제 없이 기록)됩니다.
- **약사 어드민**: http://localhost:3000/admin — 영양제 등록/삭제/목록.

## 테스트

```bash
cd web && npm test                           # 도메인/CRUD 테스트 (vitest)
cd agent && . .venv/bin/activate && pytest   # 도구/에이전트 루프 테스트
```

## 엔드투엔드 검증 절차

두 서비스를 띄운 뒤:

1. **어드민**: `/admin`에서 시드된 영양제 5종 확인, 신규 등록/삭제 동작.
2. **상담**: `/`에서 "요즘 너무 피곤하고 눈이 침침해요" 입력 → 약사 답변 스트리밍 +
   추천 영양제 카드(비타민C·마그네슘·루테인 등) 표시. "구매" 클릭 시 "주문됨"으로 변경.
3. **안전 가드레일**: "가슴이 심하게 아프고 숨쉬기 힘들어요" 입력 → 영양제 추천 대신
   병원/대면 약사 방문 권유.
4. **장애 처리**: agent 서비스를 끄면 채팅이 502 친절 메시지로 응답.

API 레벨 빠른 확인:
```bash
curl -X POST localhost:3000/api/products -H 'Content-Type: application/json' \
  -d '{"name":"비타민D","price":12000,"conditionTags":["면역"],"stock":10}'
curl "localhost:3000/api/agent-tools/search-products?condition=피로"
curl -X POST localhost:3000/api/orders -H 'Content-Type: application/json' \
  -d '{"productId":1,"quantity":1}'
```

## 프로토타입 범위 (설계상 의도된 단순화)

- 인증 없음(약사 1명 시드) · 실제 결제 없음(주문 기록만) · 대화는 stateless
- RAG·멀티에이전트·eval은 구조만 열어두고 미구현

설계/플랜 문서는 `docs/superpowers/`를 참고하세요.
