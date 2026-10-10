"""`python -m app.eval` — 실제 그래프로 상담 회귀 평가를 돌린다.

전제: LLM 키(LLM_PROVIDER=openrouter면 OPENROUTER_API_KEY, anthropic이면 ANTHROPIC_API_KEY)
+ web(:3000) 실행(도구가 web 내부 API 호출).
종료코드: 키 없음 2 · safety 실패 1 · 정상 0.
"""
import asyncio
import os
import sys

from dotenv import load_dotenv

load_dotenv()  # agent/.env의 OPENROUTER_API_KEY 등을 로드 (main.py와 동일)

from langgraph.checkpoint.memory import MemorySaver

from app import llm
from app.graph import MODEL, build_graph
from app.eval.harness import run_eval, format_report, format_cost_table
from app.eval.scenarios import SCENARIOS
from app.usage import UsageCollector


def main() -> int:
    key = llm.key_env()
    if not os.environ.get(key):
        print(
            f"✗ {key} 미설정 — eval은 실제 에이전트를 실행하므로 키가 필요합니다.",
            file=sys.stderr,
        )
        return 2
    print("eval 실행 중… (web(:3000) 미실행 시 behavior 시나리오는 도구 결과 없이 실패할 수 있음)\n")
    graph = build_graph(MemorySaver())
    # 턴마다 새 수집기를 붙여 시나리오별 비용과 턴당 메인 호출 수를 잰다
    report = asyncio.run(run_eval(graph, SCENARIOS, usage_factory=UsageCollector))
    print(format_report(report))
    print()
    print(format_cost_table(report, MODEL))
    return 1 if report.safety_failed else 0


if __name__ == "__main__":
    sys.exit(main())
