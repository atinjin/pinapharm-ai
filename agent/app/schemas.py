from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    session_id: str


class SkillDryrunRequest(BaseModel):
    query: str
    skill_body: str
    skill_name: str = ""
