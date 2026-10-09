import json
import logging
from collections.abc import AsyncIterator

from langchain_core.messages import HumanMessage

from app.redaction import redact_pii
from app.usage import UsageCollector

logger = logging.getLogger("agent.stream")
# 연결이 끊겨 web이 usage 이벤트를 못 받는 경우를 대비한 보조 원장(JSON 한 줄)
usage_logger = logging.getLogger("agent.usage")

_STREAM_NODES = {"agent", "finalize"}


def _text_of(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"
        )
    return ""


def _usage_event(collector: UsageCollector, session_id: str, status: str) -> dict | None:
    summary = collector.summary()
    if summary is None:
        return None
    usage_logger.info(json.dumps({"session_id": session_id, "status": status, **summary}, ensure_ascii=False))
    return {"event": "usage", "data": json.dumps(summary)}


async def stream_events(graph, message: str, session_id: str) -> AsyncIterator[dict]:
    """그래프 실행을 SSE 이벤트 dict({event, data}) 스트림으로 변환한다."""
    collector = UsageCollector()
    # 콜백은 contextvar보다 결정적이도록 config에 명시해 모든 노드의 LLM 호출로 전파시킨다
    config = {"configurable": {"thread_id": session_id}, "callbacks": [collector]}
    inp = {"messages": [HumanMessage(content=redact_pii(message))], "recommended_ids": [], "seen_product_ids": [], "tool_turns": 0}
    # 한 턴에 LLM 호출이 여러 번이면 각 응답 텍스트가 이어 붙으므로, 메시지가 바뀌는 곳에 줄바꿈을 넣는다
    last_msg_id = None
    try:
        async for mode, chunk in graph.astream(inp, config, stream_mode=["messages", "custom"]):
            if mode == "messages":
                msg, meta = chunk
                if meta.get("langgraph_node") in _STREAM_NODES:
                    text = _text_of(msg.content)
                    if text:
                        if last_msg_id is not None and msg.id != last_msg_id:
                            text = "\n\n" + text
                        last_msg_id = msg.id
                        yield {"event": "token", "data": json.dumps({"text": text})}
            elif mode == "custom":
                t = chunk.get("type")
                if t == "recommendations":
                    yield {"event": "recommendations", "data": json.dumps({"ids": chunk["ids"]})}
                elif t == "emergency":
                    yield {"event": "emergency", "data": json.dumps({"message": chunk["message"]})}
                elif t == "plan":
                    yield {"event": "plan", "data": json.dumps({"steps": chunk["steps"]})}
    except Exception:
        logger.exception("agent 스트림 처리 실패")
        # 실패한 턴도 과금되므로 error 직전에 usage를 보낸다
        usage = _usage_event(collector, session_id, "error")
        if usage:
            yield usage
        yield {"event": "error", "data": json.dumps({"message": "상담 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."})}
        return
    usage = _usage_event(collector, session_id, "done")
    if usage:
        yield usage
    yield {"event": "done", "data": "{}"}
