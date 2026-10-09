#!/bin/bash
# bot-worktree가 새 worktree를 만든 직후 호출한다. Usage: worktree-setup.sh <repo> <worktree>
# 커밋되지 않는 로컬 파일 복사 + 의존성 설치.
set -euo pipefail
REPO="$1"; WT="$2"
for f in agent/.env web/.env; do
  [ -f "$REPO/$f" ] && cp "$REPO/$f" "$WT/$f"
done
# web 테스트는 DATABASE_URL(file:./dev.db)을 그대로 쓰므로 worktree마다 사본을 둔다.
[ -f "$REPO/web/prisma/dev.db" ] && cp "$REPO/web/prisma/dev.db" "$WT/web/prisma/dev.db"
(cd "$WT/agent" && uv sync --python 3.13 --extra dev -q)
(cd "$WT/web" && npm ci --silent && npx prisma generate >/dev/null)
