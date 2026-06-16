import json
import os
from typing import Annotated, Literal, TypedDict

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import AIMessage, AnyMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langgraph.config import get_stream_writer
from langgraph.graph import START, END, StateGraph
from langgraph.graph.message import add_messages

from app import triage
from app.prompts import EMERGENCY_MESSAGE
from app.config_client import get_config, build_system_prompt, fetch_skill_body
from app.tools import (
    _fetch_products,
    _fetch_health_profile,
    _save_health_profile,
    _fetch_knowledge,
    search_products,
    get_health_profile,
    save_health_profile,
    load_consultation_skill,
    retrieve_knowledge,
)

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
    cfg = await get_config()
    model = _chat_model().bind_tools(
        [search_products, get_health_profile, save_health_profile, load_consultation_skill, retrieve_knowledge]
    )
    system = build_system_prompt(cfg)
    resp = await model.ainvoke([SystemMessage(content=system)] + state["messages"])
    return {"messages": [resp]}


async def tools_node(state: AgentState, config: RunnableConfig) -> dict:
    last = state["messages"][-1]
    writer = get_stream_writer()
    session_id = config["configurable"]["thread_id"]
    tool_messages: list[ToolMessage] = []
    ids = list(state["recommended_ids"])
    for call in last.tool_calls:
        name = call["name"]
        try:
            if name == "search_products":
                products = await _fetch_products(**call["args"])
                content = json.dumps(products, ensure_ascii=False)
                for p in products:
                    if isinstance(p, dict) and "id" in p and p["id"] not in ids:
                        ids.append(p["id"])
            elif name == "get_health_profile":
                profile = await _fetch_health_profile(session_id)
                content = json.dumps(profile, ensure_ascii=False)
            elif name == "save_health_profile":
                saved = await _save_health_profile(session_id, **call["args"])
                content = json.dumps(saved, ensure_ascii=False)
            elif name == "load_consultation_skill":
                content = await fetch_skill_body(**call["args"])
            elif name == "retrieve_knowledge":
                knowledge = await _fetch_knowledge(**call["args"])
                content = json.dumps(knowledge, ensure_ascii=False)
            else:
                content = f"알 수 없는 도구: {name}"
        except Exception:
            content = "도구 실행 중 오류가 발생했습니다. 결과를 가져오지 못했습니다."
        tool_messages.append(
            ToolMessage(content=content, tool_call_id=call["id"], name=name)
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
    cfg = await get_config()
    system = build_system_prompt(cfg)
    resp = await _chat_model().ainvoke([SystemMessage(content=system)] + state["messages"])
    return {"messages": [resp]}


async def emergency_node(state: AgentState) -> dict:
    cfg = await get_config()
    message = cfg.get("emergencyMessage") or EMERGENCY_MESSAGE
    writer = get_stream_writer()
    writer({"type": "emergency", "message": message})
    return {"messages": [AIMessage(content=message)]}


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
