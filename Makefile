# pham-consult — 개발 서버 실행/중지
#   make start    두 서버(web+agent) 백그라운드 실행
#   make stop     두 서버 중지
#   make restart  재시작
#   make status   상태 확인
#   make logs     로그 실시간 보기
#   make web / make agent   개별 실행

WEB_DIR   := web
AGENT_DIR := agent
WEB_PORT  := 3000
AGENT_PORT:= 8000
PID_DIR   := .pids
LOG_DIR   := .logs

.DEFAULT_GOAL := help

.PHONY: help start stop restart status logs web agent setup

help:
	@echo "pham-consult 개발 서버"
	@echo "  make start    web(:$(WEB_PORT)) + agent(:$(AGENT_PORT)) 실행"
	@echo "  make stop     두 서버 중지"
	@echo "  make restart  재시작"
	@echo "  make status   상태 확인"
	@echo "  make logs     로그 보기 (Ctrl-C 종료)"
	@echo "  make web      web 만 실행"
	@echo "  make agent    agent 만 실행"
	@echo "  make setup    의존성 설치(web npm, agent venv)"

start: agent web
	@sleep 1
	@echo ""
	@echo "✓ web    http://localhost:$(WEB_PORT)"
	@echo "✓ agent  http://localhost:$(AGENT_PORT)"
	@echo "  로그: make logs / 중지: make stop"

web:
	@mkdir -p $(PID_DIR) $(LOG_DIR)
	@if lsof -ti:$(WEB_PORT) >/dev/null 2>&1; then \
		echo "• web 이미 실행 중 (:$(WEB_PORT))"; \
	else \
		nohup npm --prefix $(WEB_DIR) run dev > $(LOG_DIR)/web.log 2>&1 & echo $$! > $(PID_DIR)/web.pid; \
		echo "• web 시작 (pid $$(cat $(PID_DIR)/web.pid)) → $(LOG_DIR)/web.log"; \
	fi

agent:
	@mkdir -p $(PID_DIR) $(LOG_DIR)
	@if [ ! -x $(AGENT_DIR)/.venv/bin/uvicorn ]; then \
		echo "✗ agent venv 없음. 먼저 'make setup' 실행"; exit 1; \
	fi
	@if lsof -ti:$(AGENT_PORT) >/dev/null 2>&1; then \
		echo "• agent 이미 실행 중 (:$(AGENT_PORT))"; \
	else \
		( cd $(AGENT_DIR) && nohup .venv/bin/uvicorn app.main:app --port $(AGENT_PORT) > ../$(LOG_DIR)/agent.log 2>&1 & echo $$! ) > $(PID_DIR)/agent.pid; \
		echo "• agent 시작 (pid $$(cat $(PID_DIR)/agent.pid)) → $(LOG_DIR)/agent.log"; \
	fi

stop:
	@web=$$(lsof -ti:$(WEB_PORT) 2>/dev/null); \
	if [ -n "$$web" ]; then kill $$web 2>/dev/null; echo "• web 중지 (:$(WEB_PORT))"; else echo "• web 미실행"; fi
	@ag=$$(lsof -ti:$(AGENT_PORT) 2>/dev/null); \
	if [ -n "$$ag" ]; then kill $$ag 2>/dev/null; echo "• agent 중지 (:$(AGENT_PORT))"; else echo "• agent 미실행"; fi
	@# 포트가 완전히 해제될 때까지 대기, 남으면 강제 종료
	@for i in 1 2 3 4 5; do \
		w=$$(lsof -ti:$(WEB_PORT) 2>/dev/null); a=$$(lsof -ti:$(AGENT_PORT) 2>/dev/null); \
		[ -z "$$w$$a" ] && break; sleep 1; \
	done
	@for p in $(WEB_PORT) $(AGENT_PORT); do rem=$$(lsof -ti:$$p 2>/dev/null); [ -n "$$rem" ] && kill -9 $$rem 2>/dev/null || true; done
	@rm -f $(PID_DIR)/web.pid $(PID_DIR)/agent.pid

restart: stop start

status:
	@printf "web   (:$(WEB_PORT)) : "; if lsof -ti:$(WEB_PORT) >/dev/null 2>&1; then echo "● 실행 중 (pid $$(lsof -ti:$(WEB_PORT) | tr '\n' ' '))"; else echo "○ 중지"; fi
	@printf "agent (:$(AGENT_PORT)) : "; if lsof -ti:$(AGENT_PORT) >/dev/null 2>&1; then echo "● 실행 중 (pid $$(lsof -ti:$(AGENT_PORT) | tr '\n' ' '))"; else echo "○ 중지"; fi

logs:
	@mkdir -p $(LOG_DIR)
	@touch $(LOG_DIR)/web.log $(LOG_DIR)/agent.log
	@tail -n 20 -f $(LOG_DIR)/web.log $(LOG_DIR)/agent.log

setup:
	@echo "• web 의존성 설치"; npm --prefix $(WEB_DIR) install
	@echo "• agent venv 설치"; cd $(AGENT_DIR) && python3.13 -m venv .venv && . .venv/bin/activate && pip install -q -e ".[dev]"
	@echo "✓ setup 완료. 'make start' 로 실행하세요."
