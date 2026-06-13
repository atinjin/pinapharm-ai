# pharmacist-agent

약사 상담 + 영양제 추천 프로토타입.

## 구성
- `web/`  — Next.js (채팅 UI, 약사 어드민, 영양제 CRUD, Prisma/SQLite)
- `agent/` — FastAPI + Claude Agent SDK (약사 에이전트)

## 실행
1. `cd web && npm install && npx prisma migrate dev && npm run seed && npm run dev`  (http://localhost:3000)
2. `cd agent && pip install -e . && uvicorn app.main:app --reload --port 8000`

환경변수는 각 폴더 `.env.example` 참고.
