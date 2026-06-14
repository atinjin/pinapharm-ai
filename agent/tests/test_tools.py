import respx
import httpx
from app.tools import _fetch_products, search_products

@respx.mock
async def test_fetch_products_calls_web_api():
    route = respx.get("http://web.test/api/agent-tools/search-products").mock(
        return_value=httpx.Response(200, json=[{"id": 1, "name": "비타민C 1000", "price": 18000}])
    )
    result = await _fetch_products(condition="피로", base_url="http://web.test")
    assert route.called
    assert result[0]["name"] == "비타민C 1000"

@respx.mock
async def test_fetch_products_omits_empty_params():
    route = respx.get("http://web.test/api/agent-tools/search-products").mock(
        return_value=httpx.Response(200, json=[])
    )
    await _fetch_products(condition="피로", keyword="", base_url="http://web.test")
    assert route.calls.last.request.url.params.get("keyword") is None

def test_search_products_is_langchain_tool():
    # bind_tools에 넘길 수 있는 LangChain 도구여야 한다
    assert search_products.name == "search_products"
    assert "condition" in search_products.args
