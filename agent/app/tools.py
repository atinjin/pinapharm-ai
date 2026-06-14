import os
import httpx
from langchain_core.tools import tool


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
