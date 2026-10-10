#!/bin/bash
# bot-worktree가 새 worktree를 만든 직후 호출한다. Usage: worktree-setup.sh <repo> <worktree>
# 커밋되지 않는 로컬 파일 복사 + 의존성 설치.
set -euo pipefail
REPO="$1"; WT="$2"
for f in agent/.env web/.env; do
  [ -f "$REPO/$f" ] && cp "$REPO/$f" "$WT/$f"
done
# 봇은 서비스 키 대신 개발·검증용 OpenRouter 키를 쓴다(키별 사용 한도 분리).
# agent/.env.bots.local(gitignore됨)에 OPENROUTER_API_KEY=... 한 줄을 두면 worktree의 agent/.env 값을 그것으로 바꾼다.
BOTS_ENV="$REPO/agent/.env.bots.local"
if [ -f "$BOTS_ENV" ] && grep -q '^OPENROUTER_API_KEY=' "$BOTS_ENV"; then
  grep -v '^OPENROUTER_API_KEY=' "$WT/agent/.env" > "$WT/agent/.env.tmp" || true
  grep '^OPENROUTER_API_KEY=' "$BOTS_ENV" >> "$WT/agent/.env.tmp"
  mv "$WT/agent/.env.tmp" "$WT/agent/.env"
  chmod 600 "$WT/agent/.env"
fi
# web 테스트는 DATABASE_URL(file:./dev.db)을 그대로 쓰므로 worktree마다 사본을 둔다.
[ -f "$REPO/web/prisma/dev.db" ] && cp "$REPO/web/prisma/dev.db" "$WT/web/prisma/dev.db"
(cd "$WT/agent" && uv sync --python 3.13 --extra dev -q)
(cd "$WT/web" && npm ci --silent && npx prisma generate >/dev/null)
