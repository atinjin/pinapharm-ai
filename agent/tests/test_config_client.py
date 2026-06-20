from app.config_client import DEFAULT_CONFIG
from app.prompts import PLAN_SYSTEM


def test_default_config_has_plan_prompt():
    assert DEFAULT_CONFIG["planPrompt"] == PLAN_SYSTEM
