from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from app.schemas import ChatRequest
from app.agent import run_agent_stream

app = FastAPI(title="pharmacist-agent")


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/chat")
async def chat(req: ChatRequest):
    async def gen():
        try:
            async for chunk in run_agent_stream(req.messages):
                yield chunk
        except Exception:
            yield "\n상담 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."

    return StreamingResponse(gen(), media_type="text/plain; charset=utf-8")
