import json
import logging
from collections.abc import AsyncIterator

from langchain_core.messages import HumanMessage

from app.redaction import redact_pii

logger = logging.getLogger("agent.stream")

_STREAM_NODES = {"agent", "finalize"}


def _text_of(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"
        )
    return ""


async def stream_events(graph, message: str, session_id: str) -> AsyncIterator[dict]:
    """그래프 실행을 SSE 이벤트 dict({event, data}) 스트림으로 변환한다."""
    config = {"configurable": {"thread_id": session_id}}
    inp = {"messages": [HumanMessage(content=redact_pii(message))], "recommended_ids": [], "tool_turns": 0}
    try:
        async for mode, chunk in graph.astream(inp, config, stream_mode=["messages", "custom"]):
            if mode == "messages":
                msg, meta = chunk
                if meta.get("langgraph_node") in _STREAM_NODES:
                    text = _text_of(msg.content)
                    if text:
                        yield {"event": "token", "data": json.dumps({"text": text})}
            elif mode == "custom":
                t = chunk.get("type")
                if t == "recommendations":
                    yield {"event": "recommendations", "data": json.dumps({"ids": chunk["ids"]})}
                elif t == "emergency":
                    yield {"event": "emergency", "data": json.dumps({"message": chunk["message"]})}
                elif t == "plan":
                    yield {"event": "plan", "data": json.dumps({"steps": chunk["steps"]})}
        yield {"event": "done", "data": "{}"}
    except Exception:
        logger.exception("agent 스트림 처리 실패")
        yield {"event": "error", "data": json.dumps({"message": "상담 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."})}
