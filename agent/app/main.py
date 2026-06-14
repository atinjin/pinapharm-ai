import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from sse_starlette.sse import EventSourceResponse
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from app.agent import stream_events
from app.graph import build_graph
from app.schemas import ChatRequest

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
