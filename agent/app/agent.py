import os
import json
from collections.abc import AsyncIterator
from anthropic import AsyncAnthropic
from app.prompts import SYSTEM_PROMPT
from app.tools import TOOL_DEFS, run_tool
from app.schemas import ChatMessage


def get_client() -> AsyncAnthropic:
    return AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-8")
MAX_TURNS = 5
# 스트림 끝에 에이전트가 조회한 추천 제품 ID를 클라이언트로 전달하는 구분자
RECO_MARKER = "<<<RECO>>>"


def _collect_ids(result) -> list[int]:
    ids = []
    if isinstance(result, list):
        for item in result:
            if isinstance(item, dict) and "id" in item:
                ids.append(item["id"])
    return ids


async def run_agent_stream(messages: list[ChatMessage]) -> AsyncIterator[str]:
    client = get_client()
    convo: list[dict] = [{"role": m.role, "content": m.content} for m in messages]
    recommended_ids: list[int] = []
    done = False

    for _ in range(MAX_TURNS):
        async with client.messages.stream(
            model=MODEL,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            tools=TOOL_DEFS,
            messages=convo,
        ) as stream:
            async for text in stream.text_stream:
                yield text
            resp = await stream.get_final_message()

        if resp.stop_reason != "tool_use":
            done = True
            break

        assistant_content = []
        tool_results = []
        for b in resp.content:
            if b.type == "text":
                assistant_content.append({"type": "text", "text": b.text})
            elif b.type == "tool_use":
                assistant_content.append({"type": "tool_use", "id": b.id, "name": b.name, "input": b.input})
                result = await run_tool(b.name, b.input)
                if b.name == "search_products":
                    for pid in _collect_ids(result):
                        if pid not in recommended_ids:
                            recommended_ids.append(pid)
                tool_results.append({"type": "tool_result", "tool_use_id": b.id, "content": str(result)})

        convo.append({"role": "assistant", "content": assistant_content})
        convo.append({"role": "user", "content": tool_results})

    if not done:
        yield "\n(상담을 더 진행하려면 다시 질문해주세요.)"

    # 추천 제품 ID trailer (클라이언트가 우측 패널에 사용)
    yield f"\n{RECO_MARKER}{json.dumps({'ids': recommended_ids})}"
