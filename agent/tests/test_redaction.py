from app.redaction import redact_pii


def test_masks_mobile_phone():
    assert redact_pii("제 번호는 010-1234-5678이에요") == "제 번호는 [전화번호]이에요"
    assert redact_pii("01012345678로 연락주세요") == "[전화번호]로 연락주세요"


def test_masks_landline():
    assert redact_pii("매장 02-123-4567") == "매장 [전화번호]"


def test_masks_rrn():
    assert redact_pii("주민번호 900101-1234567") == "주민번호 [주민등록번호]"
    assert redact_pii("9001011234567") == "[주민등록번호]"


def test_masks_email():
    assert redact_pii("메일은 hong@example.com 입니다") == "메일은 [이메일] 입니다"


def test_masks_multiple_in_one_message():
    out = redact_pii("저는 홍길동, 010-9876-5432, a.b+1@gmail.com 입니다")
    assert "010-9876-5432" not in out
    assert "a.b+1@gmail.com" not in out
    assert "[전화번호]" in out and "[이메일]" in out


def test_leaves_clean_text_unchanged():
    text = "요즘 피곤한데 비타민C 1000mg 추천해줘"
    assert redact_pii(text) == text
