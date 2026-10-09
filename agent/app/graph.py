import json
import os
from typing import Annotated, Literal, TypedDict

from langchain_anthropic import ChatAnthropic
from langchain_anthropic.chat_models import convert_to_anthropic_tool
from langchain_core.messages import AIMessage, AnyMessage, BaseMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langgraph.config import get_stream_writer
from langgraph.graph import START, END, StateGraph
from langgraph.graph.message import add_messages

from app import llm, triage
from app.planner import make_plan
from app.prompts import EMERGENCY_MESSAGE
from app.config_client import get_config, build_system_prompt, fetch_skill_body
from app.tools import (
    _fetch_products,
    _fetch_health_profile,
    _save_health_profile,
    _fetch_knowledge,
    search_products,
    recommend_products,
    get_health_profile,
    save_health_profile,
    load_consultation_skill,
    retrieve_knowledge,
)

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-8")
MAX_TOOL_TURNS = 4
# 1,024에서 추천 답변이 문장 중간에 잘린 사례가 있었다
MAIN_MAX_TOKENS = 2048
# 상한을 올린 만큼 출력 비용이 늘지 않도록 간결하게 답하게 한다. 어드민 프롬프트와 무관하게 항상 붙는다.
RESPONSE_STYLE = (
    "## 답변 형식\n"
    "- 핵심 결론을 먼저 말하세요.\n"
    "- 추천 제품은 최대 3개, 제품마다 추천 이유는 1~2문장으로 쓰세요.\n"
    "- 제품을 권할 때는 답변과 함께 recommend_products로 권한 제품만 지정하세요.\n"
    "- 주의사항은 꼭 필요한 것만 짧게 덧붙이세요.\n"
    "- 전체 답변은 대략 600자 이내를 권장합니다."
)
# finalize는 도구를 쓸 수 없는 마지막 호출이다. 추가 작업을 약속하면 그 약속이 다음 턴까지 이어진다.
FINALIZE_INSTRUCTION = (
    "## 이번 답변에서 마무리\n"
    "이번 턴에는 더 이상 도구를 사용할 수 없습니다(검색·조회·저장 모두 불가). "
    "지금까지 확인한 결과만으로 이번 답변에서 상담을 마무리하세요. "
    "\"다시 검색해 보겠습니다\", \"확인해 보겠습니다\", \"기록해 두겠습니다\"처럼 앞으로 할 작업을 약속하지 마세요. "
    "확인한 제품이 있으면 그중에서 추천하고, 결과가 부족하면 확인된 범위와 한계를 솔직히 말한 뒤 "
    "일반적인 안내와 함께 약사 상담을 권하세요."
)
# agent와 finalize가 같은 도구 정의를 보내야 tools 계층 프리픽스가 일치한다
AGENT_TOOLS = [
    search_products, recommend_products, get_health_profile, save_health_profile,
    load_consultation_skill, retrieve_knowledge,
]
# 카드는 답변에서 권한 제품만 보여 준다. RESPONSE_STYLE의 "최대 3개"와 맞춘다.
MAX_RECOMMENDATIONS = 3


class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    recommended_ids: list[int]
    # 이번 턴에 search_products로 본 제품 id. recommend_products는 이 안의 id만 카드로 보낸다.
    seen_product_ids: list[int]
    tool_turns: int
    triage: str
    plan: list


def _chat_model() -> ChatAnthropic:
    return llm.chat_model(MODEL, max_tokens=MAIN_MAX_TOKENS)


def _last_human_text(state: AgentState) -> str:
    m = next((m for m in reversed(state["messages"]) if m.type == "human"), None)
    return m.content if m else ""


async def triage_node(state: AgentState) -> dict:
    decision = await triage.classify(_last_human_text(state))
    return {"triage": decision}


def route_triage(state: AgentState) -> Literal["plan", "emergency"]:
    return "emergency" if state.get("triage") == "emergency" else "plan"


async def plan_node(state: AgentState) -> dict:
    steps = await make_plan(_last_human_text(state))
    writer = get_stream_writer()
    writer({"type": "plan", "steps": [s["title"] for s in steps]})
    return {"plan": steps}


def _plan_checklist(state: AgentState) -> str:
    steps = state.get("plan") or []
    if not steps:
        return ""
    lines = ["## 상담 계획", "아래 계획을 참고하되, 대화 흐름에 맞게 유연하게 진행하세요(체크리스트, 강제 아님):"]
    for s in steps:
        hint = f" (도구: {s['tool']})" if s.get("tool") else ""
        lines.append(f"- {s['title']}{hint}")
    lines.append(
        "프로필 조회 결과가 비어 있더라도 거기서 멈추거나 되묻기만 하지 말고, "
        "추천이 필요한 상담이면 같은 턴에 search_products로 제품을 찾아 추천까지 마치세요."
    )
    return "\n".join(lines)


def _llm_view(messages: list[BaseMessage]) -> list[BaseMessage]:
    """모델에 보낼 이력 사본. 뒤에 ToolMessage가 없는 tool_use는 tool_calls와 content 블록 모두에서 뺀다.

    langchain-anthropic은 content의 tool_use 블록을 tool_calls와 무관하게 내보내므로 둘 다 지워야 한다.
    체크포인트 원본은 수정하지 않는다.
    """
    answered: set[str] = set()
    view: list[BaseMessage] = []
    for m in reversed(messages):
        if isinstance(m, ToolMessage):
            answered.add(m.tool_call_id)
        elif isinstance(m, AIMessage):
            m = _strip_unanswered(m, answered)
            if m is None:
                continue
        view.append(m)
    view.reverse()
    return view


def _strip_unanswered(m: AIMessage, answered: set[str]) -> AIMessage | None:
    blocks = m.content if isinstance(m.content, list) else []
    call_ids = {c["id"] for c in m.tool_calls} | {
        b["id"] for b in blocks if isinstance(b, dict) and b.get("type") == "tool_use"
    }
    if call_ids <= answered:
        return m
    tool_calls = [c for c in m.tool_calls if c["id"] in answered]
    content = m.content
    if isinstance(content, list):
        content = [
            b for b in content
            if not (isinstance(b, dict) and b.get("type") == "tool_use" and b.get("id") not in answered)
        ]
    if not content and not tool_calls:
        # 빈 assistant 메시지는 API가 거절하므로 통째로 뺀다
        return None
    return m.model_copy(update={"content": content, "tool_calls": tool_calls})


def _system_prompt(cfg: dict, state: AgentState) -> str:
    # agent와 finalize가 공유하는 프리픽스. 순서가 같아야 캐시가 맞는다.
    system = f"{build_system_prompt(cfg)}\n\n{RESPONSE_STYLE}"
    checklist = _plan_checklist(state)
    if checklist:
        system = f"{system}\n\n{checklist}"
    return system


async def agent_node(state: AgentState) -> dict:
    cfg = await get_config()
    model = _chat_model().bind_tools(AGENT_TOOLS)
    system = _system_prompt(cfg, state)
    resp = await model.ainvoke([SystemMessage(content=system)] + _llm_view(state["messages"]))
    return {"messages": [resp]}


async def tools_node(state: AgentState, config: RunnableConfig) -> dict:
    last = state["messages"][-1]
    writer = get_stream_writer()
    session_id = config["configurable"]["thread_id"]
    tool_messages: list[ToolMessage] = []
    ids = list(state["recommended_ids"])
    seen = list(state.get("seen_product_ids") or [])
    for call in last.tool_calls:
        name = call["name"]
        try:
            if name == "search_products":
                products = await _fetch_products(**call["args"])
                content = json.dumps(products, ensure_ascii=False)
                for p in products:
                    if isinstance(p, dict) and "id" in p and p["id"] not in seen:
                        seen.append(p["id"])
            elif name == "recommend_products":
                # 이번 턴 검색 결과에 없는 id(모델이 지어낸 id)는 카드로 보내지 않는다
                for pid in call["args"].get("product_ids") or []:
                    if len(ids) >= MAX_RECOMMENDATIONS:
                        break
                    if pid in seen and pid not in ids:
                        ids.append(pid)
                content = f"추천 카드 {len(ids)}개 표시"
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
        "seen_product_ids": seen,
        "tool_turns": state["tool_turns"] + 1,
    }


def route_after_agent(state: AgentState) -> Literal["tools", "__end__"]:
    # tool_calls가 있으면 한도와 무관하게 항상 실행해 tool_use/tool_result 짝을 맞춘다
    last = state["messages"][-1]
    if not getattr(last, "tool_calls", None):
        return END
    return "tools"


def _has_text(m: AIMessage) -> bool:
    if isinstance(m.content, str):
        return bool(m.content.strip())
    return any(
        isinstance(b, dict) and b.get("type") == "text" and b.get("text", "").strip()
        for b in m.content
    )


def route_after_tools(state: AgentState) -> Literal["agent", "finalize", "__end__"]:
    if state["tool_turns"] >= MAX_TOOL_TURNS:
        return "finalize"
    # 답변 본문과 추천 지정을 한 메시지로 보냈으면 이미 답했다. 다시 부르면 군더더기 문장만 덧붙는다.
    last_ai = next((m for m in reversed(state["messages"]) if isinstance(m, AIMessage)), None)
    if (
        last_ai is not None
        and last_ai.tool_calls
        and all(c["name"] == "recommend_products" for c in last_ai.tool_calls)
        and _has_text(last_ai)
    ):
        return END
    return "agent"


def _finalize_tools() -> list[dict]:
    # bind_tools와 같은 변환 함수를 써야 payload의 tools 블록이 agent 경로와 같아진다
    return [convert_to_anthropic_tool(t) for t in AGENT_TOOLS]


async def finalize_node(state: AgentState) -> dict:
    cfg = await get_config()
    # agent와 같은 프리픽스를 유지하도록 끝에 덧붙인다
    system = f"{_system_prompt(cfg, state)}\n\n{FINALIZE_INSTRUCTION}"
    # 이력에 tool 블록이 있으므로 도구 정의는 넘기되, tool_choice none으로 호출은 막는다
    resp = await _chat_model().ainvoke(
        [SystemMessage(content=system)] + _llm_view(state["messages"]),
        tools=_finalize_tools(),
        tool_choice={"type": "none"},
    )
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
    g.add_node("plan", plan_node)
    g.add_node("agent", agent_node)
    g.add_node("tools", tools_node)
    g.add_node("finalize", finalize_node)
    g.add_node("emergency", emergency_node)

    g.add_edge(START, "triage")
    g.add_conditional_edges("triage", route_triage, {"plan": "plan", "emergency": "emergency"})
    g.add_edge("plan", "agent")
    g.add_conditional_edges("agent", route_after_agent, {"tools": "tools", END: END})
    g.add_conditional_edges("tools", route_after_tools, {"agent": "agent", "finalize": "finalize", END: END})
    g.add_edge("finalize", END)
    g.add_edge("emergency", END)
    return g.compile(checkpointer=checkpointer)
