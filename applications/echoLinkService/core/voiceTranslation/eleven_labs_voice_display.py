from __future__ import annotations

import json
import os
from typing import Any

_VOICE_LABEL_BY_ID: dict[str, str] = {
    "hpp4J3VqNfWAUOO0d1Us": "Bella",
    "bIHbv24MWmeRgasZH58o": "Will - Relaxed Optimist",
}

_FALLBACK_VOICE_OPTIONS: list[dict[str, str]] = [
    {"value": "bIHbv24MWmeRgasZH58o", "label": "Will - Relaxed Optimist"},
    {"value": "hpp4J3VqNfWAUOO0d1Us", "label": "Bella"},
]


def _merge_labels_from_env(base: dict[str, str]) -> dict[str, str]:
    raw = os.environ.get("ECHO_LINK_ELEVENLABS_VOICE_LABELS_JSON", "").strip()
    if not raw:
        return base
    try:
        extra = json.loads(raw)
    except json.JSONDecodeError:
        return base
    if not isinstance(extra, dict):
        return base
    out = dict(base)
    for k, v in extra.items():
        if not isinstance(k, str) or not isinstance(v, str):
            continue
        ks, vs = k.strip(), v.strip()
        if ks and vs:
            out[ks] = vs
    return out


def _merge_fallback_from_env(
    base: list[dict[str, str]],
) -> list[dict[str, str]]:
    raw = os.environ.get("ECHO_LINK_ELEVENLABS_VOICE_FALLBACK_JSON", "").strip()
    if not raw:
        return [dict(x) for x in base]
    try:
        extra = json.loads(raw)
    except json.JSONDecodeError:
        return [dict(x) for x in base]
    if not isinstance(extra, list):
        return [dict(x) for x in base]
    parsed: list[dict[str, str]] = []
    for item in extra:
        if not isinstance(item, dict):
            continue
        val = item.get("value")
        lab = item.get("label")
        if isinstance(val, str) and isinstance(lab, str):
            vs, ls = val.strip(), lab.strip()
            if vs and ls:
                parsed.append({"value": vs, "label": ls})
    return parsed if parsed else [dict(x) for x in base]


def get_elevenlabs_voice_display_bundle() -> dict[str, Any]:
    return {
        "voiceLabels": _merge_labels_from_env(dict(_VOICE_LABEL_BY_ID)),
        "fallbackVoiceOptions": _merge_fallback_from_env(_FALLBACK_VOICE_OPTIONS),
    }
