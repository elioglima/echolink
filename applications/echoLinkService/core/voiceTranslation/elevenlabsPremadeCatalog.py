from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

_log = logging.getLogger(__name__)

_SERVICE_ROOT = Path(__file__).resolve().parents[2]
_PREMADE_PATH = _SERVICE_ROOT / "files" / "cache" / "elevenlabs" / "premadeVoices.json"


def _read_premade_raw() -> dict[str, Any] | None:
    if not _PREMADE_PATH.is_file():
        return None
    try:
        data = json.loads(_PREMADE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        _log.warning("elevenlabs premade read failed %s: %s", _PREMADE_PATH, e)
        return None
    return data if isinstance(data, dict) else None


def load_premade_gender_sigla_by_voice_id() -> dict[str, str]:
    raw = _read_premade_raw()
    if not raw:
        return {}
    voices = raw.get("voices")
    if not isinstance(voices, list):
        return {}
    out: dict[str, str] = {}
    for item in voices:
        if not isinstance(item, dict):
            continue
        vid = str(item.get("voiceId") or "").strip()
        g = str(item.get("gender") or "").strip().lower()
        if not vid:
            continue
        if g == "male":
            out[vid] = "H"
        elif g == "female":
            out[vid] = "F"
    return out


def load_premade_gender_sigla_by_voice_id_lowercase() -> dict[str, str]:
    return {k.lower(): v for k, v in load_premade_gender_sigla_by_voice_id().items()}


def load_premade_voice_labels() -> dict[str, str]:
    raw = _read_premade_raw()
    if not raw:
        return {}
    voices = raw.get("voices")
    if not isinstance(voices, list):
        return {}
    out: dict[str, str] = {}
    for item in voices:
        if not isinstance(item, dict):
            continue
        vid = str(item.get("voiceId") or "").strip()
        name = str(item.get("name") or "").strip()
        desc = str(item.get("description") or "").strip()
        if not vid or not name:
            continue
        out[vid] = f"{name} - {desc}" if desc else name
    return out


def load_premade_fallback_voice_options() -> list[dict[str, str]]:
    raw = _read_premade_raw()
    if not raw:
        return []
    voices = raw.get("voices")
    if not isinstance(voices, list):
        return []
    rows: list[dict[str, str]] = []
    for item in voices:
        if not isinstance(item, dict):
            continue
        vid = str(item.get("voiceId") or "").strip()
        name = str(item.get("name") or "").strip()
        desc = str(item.get("description") or "").strip()
        g = str(item.get("gender") or "").strip().lower()
        if not vid or not name:
            continue
        label = f"{name} - {desc}" if desc else name
        row: dict[str, str] = {"value": vid, "label": label}
        if g == "male":
            row["genderSigla"] = "H"
        elif g == "female":
            row["genderSigla"] = "F"
        rows.append(row)
    rows.sort(key=lambda x: x["label"].lower())
    return rows
