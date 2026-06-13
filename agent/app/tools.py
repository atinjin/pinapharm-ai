import os
import httpx

TOOL_DEFS = [
    {
        "name": "search_products",
        "description": "이 약국이 취급하는 영양제를 증상(condition)이나 키워드(keyword)로 검색한다. 추천 전 반드시 호출한다.",
        "input_schema": {
            "type": "object",
            "properties": {
                "condition": {"type": "string", "description": "상담자의 증상/건강 고민, 예: 피로, 눈건강"},
                "keyword": {"type": "string", "description": "제품 키워드, 예: 비타민C"},
            },
        },
    }
]


async def search_products(tool_input: dict, base_url: str | None = None) -> list[dict]:
    base = base_url or os.environ.get("WEB_INTERNAL_URL", "http://localhost:3000")
    params = {k: v for k, v in tool_input.items() if v}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{base}/api/agent-tools/search-products", params=params)
        resp.raise_for_status()
        return resp.json()


async def run_tool(name: str, tool_input: dict) -> list[dict]:
    if name == "search_products":
        return await search_products(tool_input)
    raise ValueError(f"unknown tool: {name}")
