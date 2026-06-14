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

@respx.mock
async def test_fetch_health_profile_calls_web_api():
    route = respx.get("http://web.test/api/agent-tools/health-profile").mock(
        return_value=httpx.Response(200, json={"conditions": ["고혈압"], "medications": []})
    )
    from app.tools import _fetch_health_profile
    result = await _fetch_health_profile("sess-1", base_url="http://web.test")
    assert route.called
    assert route.calls.last.request.url.params.get("session_id") == "sess-1"
    assert result["conditions"] == ["고혈압"]

@respx.mock
async def test_save_health_profile_posts_session_and_fields():
    import json as _json
    route = respx.post("http://web.test/api/agent-tools/health-profile").mock(
        return_value=httpx.Response(200, json={"medications": ["혈압약"]})
    )
    from app.tools import _save_health_profile
    await _save_health_profile("sess-2", base_url="http://web.test", medications=["혈압약"], ageBand="")
    body = _json.loads(route.calls.last.request.content)
    assert body["session_id"] == "sess-2"
    assert body["medications"] == ["혈압약"]
    assert "ageBand" not in body  # 빈 값은 제외

def test_health_profile_tools_are_langchain_tools():
    from app.tools import get_health_profile, save_health_profile
    assert get_health_profile.name == "get_health_profile"
    assert save_health_profile.name == "save_health_profile"
    assert "medications" in save_health_profile.args
