import os
from collections.abc import AsyncIterator
from anthropic import AsyncAnthropic
from app.prompts import SYSTEM_PROMPT
from app.tools import TOOL_DEFS, run_tool
from app.schemas import ChatMessage


def get_client() -> AsyncAnthropic:
    return AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-8")
MAX_TURNS = 5


async def run_agent_stream(messages: list[ChatMessage]) -> AsyncIterator[str]:
    client = get_client()
    convo: list[dict] = [{"role": m.role, "content": m.content} for m in messages]

    for _ in range(MAX_TURNS):
        resp = await client.messages.create(
            model=MODEL,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            tools=TOOL_DEFS,
            messages=convo,
        )

        text_parts = [b.text for b in resp.content if b.type == "text"]
        for t in text_parts:
            yield t

        if resp.stop_reason != "tool_use":
            return

        assistant_content = []
        tool_results = []
        for b in resp.content:
            if b.type == "text":
                assistant_content.append({"type": "text", "text": b.text})
            elif b.type == "tool_use":
                assistant_content.append({"type": "tool_use", "id": b.id, "name": b.name, "input": b.input})
                result = await run_tool(b.name, b.input)
                tool_results.append({"type": "tool_result", "tool_use_id": b.id, "content": str(result)})

        convo.append({"role": "assistant", "content": assistant_content})
        convo.append({"role": "user", "content": tool_results})

    yield "\n(상담을 더 진행하려면 다시 질문해주세요.)"
