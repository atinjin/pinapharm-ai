import os
import httpx
from langchain_core.tools import tool

from app.config_client import fetch_skill_body


async def _fetch_products(
    condition: str = "",
    keyword: str = "",
    ingredients: list[str] | None = None,
    form: str = "",
    min_dose: float | None = None,
    max_dose: float | None = None,
    exclude_allergens: list[str] | None = None,
    base_url: str | None = None,
) -> list[dict]:
    """이 약국 영양제를 구조화 기준으로 조회하는 순수 HTTP 호출."""
    base = base_url or os.environ.get("WEB_INTERNAL_URL", "http://localhost:3000")
    params: dict[str, str] = {}
    if condition:
        params["condition"] = condition
    if keyword:
        params["keyword"] = keyword
    if form:
        params["form"] = form
    if ingredients:
        params["ingredients"] = ",".join(ingredients)
    if exclude_allergens:
        params["excludeAllergens"] = ",".join(exclude_allergens)
    if min_dose is not None:
        params["minDose"] = str(min_dose)
    if max_dose is not None:
        params["maxDose"] = str(max_dose)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{base}/api/agent-tools/search-products", params=params)
        resp.raise_for_status()
        return resp.json()


@tool
async def search_products(
    condition: str = "",
    keyword: str = "",
    ingredients: list[str] | None = None,
    form: str = "",
    min_dose: float | None = None,
    max_dose: float | None = None,
    exclude_allergens: list[str] | None = None,
) -> list[dict]:
    """이 약국이 취급하는 영양제를 구조화 기준으로 검색한다. 대화 맥락·건강 프로필을 바탕으로 채운다:
    condition(증상 예: 피로·눈건강), keyword(예: 비타민C), ingredients(원하는 성분 목록 예: ["마그네슘"]),
    form(제형 예: 정/캡슐/액상/분말), min_dose·max_dose(용량 범위, 제품 표기 단위 기준),
    exclude_allergens(상담자 알레르기·제외 성분 목록). 추천 전 반드시 호출하고, 결과 안에서만 추천한다."""
    return await _fetch_products(
        condition=condition,
        keyword=keyword,
        ingredients=ingredients,
        form=form,
        min_dose=min_dose,
        max_dose=max_dose,
        exclude_allergens=exclude_allergens,
    )


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
