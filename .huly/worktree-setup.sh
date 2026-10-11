#!/bin/bash
# bot-worktree가 새 worktree를 만든 직후 호출한다. Usage: worktree-setup.sh <repo> <worktree>
# 커밋되지 않는 로컬 파일 복사 + 봇별 포트·키 설정 + 의존성 설치.
# 포트·키 설정만 다시 적용하려면: worktree-setup.sh <repo> <worktree> --env-only
set -euo pipefail
REPO="$1"; WT="$2"; MODE="${3:-}"
BOT="$(basename "$WT")"

set_env() { # set_env <file> <KEY> <value> — 같은 키 줄을 지우고 새 값으로 붙인다
  local f="$1" k="$2" v="$3"
  { grep -v "^${k}=" "$f" 2>/dev/null || true; echo "${k}=\"${v}\""; } > "$f.tmp"
  mv "$f.tmp" "$f"; chmod 600 "$f"
}

if [ "$MODE" != "--env-only" ]; then
  for f in agent/.env web/.env; do
    [ -f "$REPO/$f" ] && cp "$REPO/$f" "$WT/$f"
  done
fi

# 봇은 서비스 키 대신 개발·검증용 OpenRouter 키를 쓴다(키별 사용 한도 분리).
# agent/.env.bots.local(gitignore됨)에 OPENROUTER_API_KEY=... 한 줄을 두면 worktree의 agent/.env 값을 그것으로 바꾼다.
BOTS_ENV="$REPO/agent/.env.bots.local"
if [ -f "$BOTS_ENV" ] && grep -q '^OPENROUTER_API_KEY=' "$BOTS_ENV"; then
  KEY="$(grep '^OPENROUTER_API_KEY=' "$BOTS_ENV" | head -1 | cut -d= -f2- | tr -d '"')"
  set_env "$WT/agent/.env" OPENROUTER_API_KEY "$KEY"
fi

# 본 작업 폴더의 서버(3000·8000)와 겹치지 않게 봇마다 포트를 나눈다.
case "$BOT" in
  qa-bot) WEB_PORT=3100; AGENT_PORT=8100 ;;
  dev-bot) WEB_PORT=3200; AGENT_PORT=8200 ;;
  research-bot) WEB_PORT=3300; AGENT_PORT=8300 ;;
  design-bot) WEB_PORT=3400; AGENT_PORT=8400 ;;
  *) WEB_PORT=3900; AGENT_PORT=8900 ;;
esac
printf 'WEB_PORT  := %s\nAGENT_PORT:= %s\n' "$WEB_PORT" "$AGENT_PORT" > "$WT/.ports.mk"
set_env "$WT/web/.env" AGENT_URL "http://localhost:${AGENT_PORT}"
set_env "$WT/agent/.env" WEB_INTERNAL_URL "http://localhost:${WEB_PORT}"

[ "$MODE" = "--env-only" ] && exit 0

# web 테스트는 test.db를 쓰지만, 서버 실행·eval은 dev.db를 쓰므로 worktree마다 사본을 둔다.
[ -f "$REPO/web/prisma/dev.db" ] && cp "$REPO/web/prisma/dev.db" "$WT/web/prisma/dev.db"
(cd "$WT/agent" && uv sync --python 3.13 --extra dev -q)
(cd "$WT/web" && npm ci --silent && npx prisma generate >/dev/null)
