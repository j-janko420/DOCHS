"""DOCHS-specific helpers: AI-suggested column matching for schedule imports.

The model only proposes which DOCHS field each spreadsheet column holds. Its
answer is untrusted: it is parsed, checked against the fixed list of fields
below and cut to one use per field, and the user still reviews every match in
the web app before anything is imported. No door data is created here.
"""

import json
import re

# Keep in sync with TARGETS in dochs/src/core/importer.ts (a DOCHS test checks this).
TARGETS: dict[str, str] = {
    "mark": "Door mark / number",
    "doorType": "Door type",
    "quantity": "Quantity",
    "floor": "Floor / level",
    "room": "Room",
    "location": "Location",
    "fromRoom": "From room",
    "toRoom": "To room",
    "configuration": "Single / double / sliding",
    "leaves": "Number of leaves",
    "description": "Door description (hint)",
    "performance": "Fire / acoustic (combined)",
    "fireRating": "Fire rating",
    "acousticRating": "Acoustic rating",
    "openingWidth": "S.O. width",
    "openingHeight": "S.O. height",
    "doorWidth": "Door (leaf) width",
    "doorHeight": "Door (leaf) height",
    "leafThickness": "Leaf thickness",
    "leafMaterial": "Leaf material",
    "frameMaterial": "Frame material",
    "finish": "Finish",
    "hardwareSet": "Hardware set",
    "handing": "Handing",
    "sourceRef": "Source / drawing ref",
    "remarks": "Remarks (can be several)",
}

SYSTEM = (
    "You match the columns of a building door schedule to the fields of a door database. "
    "Answer with JSON only, no other text."
)


def build_messages(headers: list[str], samples: list[list[str]]) -> list[dict[str, str]]:
    fields = "\n".join(f"- {key}: {label}" for key, label in TARGETS.items())
    columns = []
    for i, header in enumerate(headers):
        values = [row[i] for row in samples if i < len(row) and row[i].strip()][:3]
        columns.append({"index": i, "header": header, "examples": values})
    user = (
        "Fields (use the key, or an empty string when a column matches none):\n"
        f"{fields}\n\n"
        "Columns of the uploaded schedule, with example values:\n"
        f"{json.dumps(columns, ensure_ascii=False)}\n\n"
        "Rules: each field except remarks may be used once; leave a column empty when unsure; "
        "a column holding a door's width or height is doorWidth / doorHeight unless it says structural or opening.\n"
        f'Reply exactly as {{"mapping": [one key or "" per column, {len(headers)} entries in column order], "notes": [short strings]}}.'
    )
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]


def parse_mapping(text: str, n_cols: int) -> tuple[list[str], list[str]]:
    """Validate the model's answer. Anything not on the field list becomes ''."""
    notes: list[str] = []
    match = re.search(r"\{.*\}", text, re.S)
    if not match:
        return [""] * n_cols, ["The AI answer contained no JSON; nothing suggested."]
    try:
        data = json.loads(match.group(0))
    except ValueError:
        return [""] * n_cols, ["The AI answer was not valid JSON; nothing suggested."]
    raw = data.get("mapping") if isinstance(data, dict) else None
    if not isinstance(raw, list):
        return [""] * n_cols, ["The AI answer had no mapping list; nothing suggested."]
    if len(raw) != n_cols:
        notes.append(f"The AI returned {len(raw)} entries for {n_cols} columns; extra or missing entries ignored.")
    mapping: list[str] = []
    used: set[str] = set()
    for i in range(n_cols):
        value = raw[i] if i < len(raw) else ""
        key = value if isinstance(value, str) else ""
        if key and key not in TARGETS:
            notes.append(f"Column {i + 1}: unknown field {key!r} ignored.")
            key = ""
        if key and key != "remarks" and key in used:
            notes.append(f"Column {i + 1}: {key} already used; left empty.")
            key = ""
        if key:
            used.add(key)
        mapping.append(key)
    model_notes = data.get("notes") if isinstance(data, dict) else None
    if isinstance(model_notes, list):
        notes.extend(str(n)[:300] for n in model_notes[:10])
    return mapping, notes


# ---------- transcription for new-project intake ----------

ROLE_HINT = {
    "layout": "a door layout (floor plan). List every door mark / tag exactly as printed, one per line, then any legend lines and the drawing title block lines (project, client, level, drawing number).",
    "schedule": "a door schedule. Reproduce the table: one line per row, cells separated by a TAB character, header row first. Also give any project details printed above the table as 'Label: value' lines.",
    "hardware": "a hardware / ironmongery schedule. For each set write its heading line (e.g. 'Set: HW-01 description'), a 'Doors: ...' line if doors are listed, then one line per item: quantity, TAB, item, TAB, model / reference, TAB, finish, TAB, manufacturer.",
}

def extract_instruction(role: str) -> str:
    return (
        f"This file is {ROLE_HINT[role]}\n"
        "Transcribe only what is printed. Do not add, infer, correct or complete any value; leave an unreadable value as [?]. "
        "No commentary, no markdown, no code fences: output the transcription only."
    )

def clean_transcription(text: str) -> tuple[str, list[str]]:
    """Strip code fences the model may add anyway; report unreadable values."""
    notes: list[str] = []
    t = re.sub(r"^```[a-zA-Z]*\n|\n```\s*$", "", text.strip())
    lines = [ln.rstrip() for ln in t.splitlines()]
    unreadable = sum(ln.count("[?]") for ln in lines)
    if unreadable:
        notes.append(f"{unreadable} value(s) could not be read and are marked [?].")
    return "\n".join(lines)[:400_000], notes
