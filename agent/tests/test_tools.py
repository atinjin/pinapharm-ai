import respx
import httpx
from app.tools import search_products, TOOL_DEFS

@respx.mock
async def test_search_products_calls_web_api():
    route = respx.get("http://web.test/api/agent-tools/search-products").mock(
        return_value=httpx.Response(200, json=[{"id": 1, "name": "비타민C 1000", "price": 18000}])
    )
    result = await search_products({"condition": "피로"}, base_url="http://web.test")
    assert route.called
    assert result[0]["name"] == "비타민C 1000"

def test_tool_defs_shape():
    assert TOOL_DEFS[0]["name"] == "search_products"
    assert "input_schema" in TOOL_DEFS[0]
