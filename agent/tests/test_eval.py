from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from app.eval.harness import Observation, evaluate


def test_evaluate_all_pass():
    obs = Observation(
        triage="normal", tools_called=["search_products"],
        recommended_ids=[1], response="비타민C를 추천드려요",
    )
    v = evaluate(obs, {
        "triage": "normal", "tools_used": ["search_products"],
        "recommends": True, "response_contains": ["추천"],
    })
    assert v.passed


def test_evaluate_triage_mismatch_fails():
    assert not evaluate(Observation(triage="normal"), {"triage": "emergency"}).passed


def test_evaluate_tools_absent_violation_fails():
    obs = Observation(tools_called=["search_products"])
    assert not evaluate(obs, {"tools_absent": ["search_products"]}).passed


def test_evaluate_recommends_false_pass():
    assert evaluate(Observation(recommended_ids=[]), {"recommends": False}).passed


def test_evaluate_response_excludes_fail():
    obs = Observation(response="이 제품을 추천드립니다")
    assert not evaluate(obs, {"response_excludes": ["추천"]}).passed


def test_evaluate_error_always_fails():
    v = evaluate(Observation(error="RuntimeError"), {"triage": "normal"})
    assert not v.passed
    assert v.checks[0].name == "실행"
