import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from app.agent import stream_events
from app.graph import build_graph, _chat_model
from app.config_client import get_config
from app.schemas import ChatRequest, SkillDryrunRequest

logger = logging.getLogger("agent.main")
DB_PATH = os.environ.get("AGENT_MEMORY_DB", "agent_memory.sqlite")


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with AsyncSqliteSaver.from_conn_string(DB_PATH) as saver:
        app.state.graph = build_graph(saver)
        yield


app = FastAPI(title="pharmacist-agent", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/chat")
async def chat(req: ChatRequest):
    return EventSourceResponse(stream_events(app.state.graph, req.message, req.session_id))


@app.post("/skill-dryrun")
async def skill_dryrun(req: SkillDryrunRequest):
    """샘플 질의에 이 스킬 본문을 주입해 1회(도구·그래프 없이) Claude 응답을 미리본다."""
    try:
        cfg = await get_config()
        persona = cfg.get("persona", "")
        system = f"{persona}\n\n아래 상담 스킬 절차를 적용해 사용자에게 답하세요:\n{req.skill_body}"
        resp = await _chat_model().ainvoke(
            [SystemMessage(content=system), HumanMessage(content=req.query)]
        )
        text = resp.content if isinstance(resp.content, str) else str(resp.content)
        return {"response": text}
    except Exception as e:
        logger.error("skill-dryrun 실패: %s", type(e).__name__)  # 트레이스백 미노출(키/내부 정보 보호)
        return JSONResponse(status_code=502, content={"error": "드라이런 사용 불가 (키/에이전트 확인)"})
