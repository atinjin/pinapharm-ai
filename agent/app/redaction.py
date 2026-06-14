import re

# LLM 전송 전 마스킹할 한국 PII 패턴.
# 이메일 → 주민등록번호 → 전화번호 순서로 적용한다(긴/특이 패턴을 먼저 소비).
_PATTERNS = [
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[이메일]"),
    (re.compile(r"\b\d{6}[-\s]?\d{7}\b"), "[주민등록번호]"),
    (re.compile(r"0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}"), "[전화번호]"),
]


def redact_pii(text: str) -> str:
    """LLM에 보내기 전 한국 PII(이메일·주민등록번호·전화번호)를 마스킹한다."""
    for pattern, placeholder in _PATTERNS:
        text = pattern.sub(placeholder, text)
    return text
