import os
import httpx
from langchain_core.tools import tool

from app.config_client import fetch_skill_body


async def _fetch_products(
    condition: str = "",
    keyword: str = "",
    base_url: str | None = None,
) -> list[dict]:
    """이 약국이 취급하는 영양제를 condition/keyword로 조회하는 순수 HTTP 호출."""
    base = base_url or os.environ.get("WEB_INTERNAL_URL", "http://localhost:3000")
    params = {k: v for k, v in {"condition": condition, "keyword": keyword}.items() if v}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{base}/api/agent-tools/search-products", params=params)
        resp.raise_for_status()
        return resp.json()


@tool
async def search_products(condition: str = "", keyword: str = "") -> list[dict]:
    """이 약국이 취급하는 영양제를 증상(condition)이나 키워드(keyword)로 검색한다.
    추천 전 반드시 호출한다. condition 예: 피로, 눈건강 / keyword 예: 비타민C."""
    return await _fetch_products(condition=condition, keyword=keyword)


async def _fetch_health_profile(session_id: str, base_url: str | None = None) -> dict:
    """저장된 건강 프로필을 web에서 조회하는 순수 HTTP 호출."""
    base = base_url or os.environ.get("WEB_INTERNAL_URL", "http://localhost:3000")
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{base}/api/agent-tools/health-profile", params={"session_id": session_id}
        )
        resp.raise_for_status()
        return resp.json()


async def _save_health_profile(session_id: str, base_url: str | None = None, **fields) -> dict:
    """건강 프로필을 web에 부분 병합 저장하는 순수 HTTP 호출. 빈 값은 제외한다."""
    base = base_url or os.environ.get("WEB_INTERNAL_URL", "http://localhost:3000")
    payload = {"session_id": session_id}
    for k, v in fields.items():
        if v not in (None, "", []):
            payload[k] = v
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(f"{base}/api/agent-tools/health-profile", json=payload)
        resp.raise_for_status()
        return resp.json()


@tool
async def get_health_profile() -> dict:
    """상담자의 저장된 건강 프로필(연령대·기저질환·복용약·알레르기·임신/수유 등)을 조회한다.
    상담 시작 시 호출해 이미 아는 정보는 다시 묻지 말고 안전 점검에 활용한다.
    (실제 호출은 그래프의 tools_node가 session_id를 주입해 수행한다.)"""
    return {}


@tool
async def save_health_profile(
    ageBand: str = "",
    sex: str = "",
    conditions: list[str] | None = None,
    medications: list[str] | None = None,
    allergies: list[str] | None = None,
    pregnancy: str = "",
    notes: str = "",
) -> dict:
    """대화에서 알게 된 상담자의 지속적 건강 사실을 저장한다. 알게 된 항목만 전달한다.
    일시적 증상이 아니라 연령대(ageBand)·기저질환(conditions)·복용 중인 약(medications)·
    알레르기(allergies)·임신/수유(pregnancy) 같은 지속 정보만 기록한다.
    (실제 호출은 그래프의 tools_node가 session_id를 주입해 수행한다.)"""
    return {}


async def _fetch_knowledge(query: str = "", k: int = 4, base_url: str | None = None) -> list[dict]:
    """원료 지식을 web 내부 API에서 의미검색하는 순수 HTTP 호출."""
    base = base_url or os.environ.get("WEB_INTERNAL_URL", "http://localhost:3000")
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{base}/api/agent-tools/retrieve-knowledge", params={"q": query, "k": k}
        )
        resp.raise_for_status()
        return resp.json()


@tool
async def retrieve_knowledge(query: str, k: int = 4) -> list[dict]:
    """건강기능식품 원료의 기능성·주의사항·상호작용 근거를 검색한다.
    성분·복용·상호작용·안전 안내를 하기 전에 호출해 검색된 근거에 기반해 답한다."""
    return await _fetch_knowledge(query=query, k=k)


@tool
async def load_consultation_skill(name: str) -> str:
    """시스템 프롬프트의 '사용 가능한 상담 스킬' 목록에 있는 상담 절차를 name으로 불러온다.
    해당 상담 상황에 들어가면 절차를 따르기 전에 호출해 본문을 확인한다."""
    return await fetch_skill_body(name)
