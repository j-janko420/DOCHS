import json
from app.dochs import TARGETS, build_messages, parse_mapping


def test_valid_mapping_passes_through():
    text = json.dumps({"mapping": ["mark", "fireRating", "", "remarks", "remarks"], "notes": ["ok"]})
    mapping, notes = parse_mapping(text, 5)
    assert mapping == ["mark", "fireRating", "", "remarks", "remarks"]
    assert notes == ["ok"]


def test_unknown_and_duplicate_fields_are_dropped():
    text = 'Here you go: {"mapping": ["mark", "mark", "colour", 7]}'
    mapping, notes = parse_mapping(text, 4)
    assert mapping == ["mark", "", "", ""]
    assert any("already used" in n for n in notes)
    assert any("unknown field" in n for n in notes)


def test_wrong_length_and_bad_answers_never_raise():
    mapping, notes = parse_mapping('{"mapping": ["mark"]}', 3)
    assert mapping == ["mark", "", ""]
    assert any("1 entries for 3 columns" in n for n in notes)
    assert parse_mapping("no json here", 2) == (["", ""], ["The AI answer contained no JSON; nothing suggested."])
    assert parse_mapping("{not json}", 1)[0] == [""]
    assert parse_mapping('{"other": 1}', 1)[0] == [""]


def test_prompt_lists_every_field_and_column():
    msgs = build_messages(["Door No", "FR"], [["D-1", "1 HR"], ["D-2", ""]])
    assert msgs[0]["role"] == "system" and msgs[1]["role"] == "user"
    user = msgs[1]["content"]
    for key in TARGETS:
        assert f"- {key}:" in user
    assert '"header": "Door No"' in user and '"1 HR"' in user
    assert "2 entries" in user
