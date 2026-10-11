# CLAUDE.md

## 프로젝트 관리: Plane

이 저장소는 Plane으로 관리한다. 역할·상태 흐름·메인 에이전트의 일·작업 항목 템플릿·작업자 실행 방법은 **글로벌 CLAUDE.md의 "프로젝트 관리: Plane"** 규칙을 따른다. 여기에는 이 저장소만의 차이만 적는다.

- 좌표: `.plane/config` — 워크스페이스 `atinova`, 프로젝트 `PINAPM`(작업 키 `PINAPM-<번호>`).
- 2026-10-10에 이전 워크스페이스 `pina-pharm`(프로젝트 `PINAPHARM`)에서 옮겨 왔다. 번호는 그대로라 커밋 메시지의 `PINAPHARM-N`은 `PINAPM-N`과 같은 작업이다.
- 봇 worktree: `/Users/atinjin/repository/pinapharm-ai-wt/<봇>`. 새 worktree는 `.plane/worktree-setup.sh`가 `agent/.env`·`web/.env`·`web/prisma/dev.db`를 복사하고 `uv sync`(Python 3.13)·`npm ci`·`prisma generate`를 실행한다.
- dev-bot 담당 범위는 `web/`, `agent/`.

### 이 저장소의 작업 규칙

- dev-bot은 자기 worktree 안에서 `git switch -c cost/prN-... main`으로 브랜치를 만든다.
- 테스트 명령(작업 설명에 worktree 기준 상대 경로로 쓴다): `agent/.venv/bin/pytest`, `cd web && npm test`. dev/qa 봇에 줄 도구 예: `"Bash(npm test:*)"`, `"Bash(uv run pytest:*)"`.
- web 테스트는 worktree마다 복사된 `web/prisma/dev.db`를 쓴다. 마이그레이션은 그 사본에만 적용된다.
- `make start`(포트 3000·8000)는 한 번에 한 곳에서만 띄운다. 봇이 서버를 띄웠으면 같은 worktree에서 `make stop`으로 내린다.
- 의존성(`uv.lock`, `package-lock.json`)이 바뀌었으면 worktree에서 `uv sync --extra dev`, `npm ci`를 다시 실행한다.
