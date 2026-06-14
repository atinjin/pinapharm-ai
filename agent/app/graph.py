import json
import os
from typing import Annotated, Literal, TypedDict

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import AIMessage, AnyMessage, SystemMessage, ToolMessage
from langgraph.config import get_stream_writer
from langgraph.graph import START, END, StateGraph
from langgraph.graph.message import add_messages

from app import triage
from app.prompts import SYSTEM_PROMPT, EMERGENCY_MESSAGE
from app.tools import _fetch_products, search_products

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-8")
MAX_TOOL_TURNS = 4


class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    recommended_ids: list[int]
    tool_turns: int
    triage: str


def _chat_model() -> ChatAnthropic:
    return ChatAnthropic(model=MODEL, max_tokens=1024)


def _last_human_text(state: AgentState) -> str:
    m = next((m for m in reversed(state["messages"]) if m.type == "human"), None)
    return m.content if m else ""


async def triage_node(state: AgentState) -> dict:
    decision = await triage.classify(_last_human_text(state))
    return {"triage": decision}


def route_triage(state: AgentState) -> Literal["agent", "emergency"]:
    return "emergency" if state.get("triage") == "emergency" else "agent"


async def agent_node(state: AgentState) -> dict:
    model = _chat_model().bind_tools([search_products])
    resp = await model.ainvoke([SystemMessage(content=SYSTEM_PROMPT)] + state["messages"])
    return {"messages": [resp]}


async def tools_node(state: AgentState) -> dict:
    last = state["messages"][-1]
    writer = get_stream_writer()
    tool_messages: list[ToolMessage] = []
    ids = list(state["recommended_ids"])
    for call in last.tool_calls:
        try:
            products = await _fetch_products(**call["args"])
            content = json.dumps(products, ensure_ascii=False)
            for p in products:
                if isinstance(p, dict) and "id" in p and p["id"] not in ids:
                    ids.append(p["id"])
        except Exception:
            content = "검색 중 오류가 발생했습니다. 결과를 가져오지 못했습니다."
        tool_messages.append(
            ToolMessage(content=content, tool_call_id=call["id"], name=call["name"])
        )
    if ids != state["recommended_ids"]:
        writer({"type": "recommendations", "ids": ids})
    return {
        "messages": tool_messages,
        "recommended_ids": ids,
        "tool_turns": state["tool_turns"] + 1,
    }


def route_after_agent(state: AgentState) -> Literal["tools", "finalize", "__end__"]:
    last = state["messages"][-1]
    if not getattr(last, "tool_calls", None):
        return END
    if state["tool_turns"] >= MAX_TOOL_TURNS:
        return "finalize"
    return "tools"


async def finalize_node(state: AgentState) -> dict:
    resp = await _chat_model().ainvoke([SystemMessage(content=SYSTEM_PROMPT)] + state["messages"])
    return {"messages": [resp]}


async def emergency_node(state: AgentState) -> dict:
    writer = get_stream_writer()
    writer({"type": "emergency", "message": EMERGENCY_MESSAGE})
    return {"messages": [AIMessage(content=EMERGENCY_MESSAGE)]}


def build_graph(checkpointer):
    g = StateGraph(AgentState)
    g.add_node("triage", triage_node)
    g.add_node("agent", agent_node)
    g.add_node("tools", tools_node)
    g.add_node("finalize", finalize_node)
    g.add_node("emergency", emergency_node)

    g.add_edge(START, "triage")
    g.add_conditional_edges("triage", route_triage, {"agent": "agent", "emergency": "emergency"})
    g.add_conditional_edges(
        "agent", route_after_agent, {"tools": "tools", "finalize": "finalize", END: END}
    )
    g.add_edge("tools", "agent")
    g.add_edge("finalize", END)
    g.add_edge("emergency", END)
    return g.compile(checkpointer=checkpointer)
