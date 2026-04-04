from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

_log = logging.getLogger(__name__)

_SERVICE_ROOT = Path(__file__).resolve().parents[2]
FILES_ROOT = _SERVICE_ROOT / "files"
CACHE_ROOT = FILES_ROOT / "cache"
VOCABULARY_CACHE = CACHE_ROOT / "vocabulary"
VOCABULARY_INDEX_PATH = VOCABULARY_CACHE / "index.json"
VOCABULARY_VOICES_DIR = VOCABULARY_CACHE / "voices"
CONFIGS_CACHE = CACHE_ROOT / "configs"
CONFIG_INPUT_AUDIO_PATH = CONFIGS_CACHE / "inputAudio.json"
CONFIG_OUTPUT_AUDIO_PATH = CONFIGS_CACHE / "outputAudio.json"
CONFIG_PARAMETERS_PATH = CONFIGS_CACHE / "parameters.json"
CONFIG_SETTINGS_PATH = CONFIGS_CACHE / "settings.json"


def ensure_cache_dirs() -> None:
    VOCABULARY_VOICES_DIR.mkdir(parents=True, exist_ok=True)
    CONFIGS_CACHE.mkdir(parents=True, exist_ok=True)


def _read_json_file(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
    except (OSError, json.JSONDecodeError) as e:
        _log.warning("localFileCache read failed %s: %s", path, e)
        return None
    if not isinstance(data, dict):
        return None
    return data


def _write_json_file(path: Path, data: dict[str, Any]) -> None:
    ensure_cache_dirs()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        tmp.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        tmp.replace(path)
    except OSError as e:
        _log.warning("localFileCache write failed %s: %s", path, e)
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def _vocabulary_hash_id_safe(raw: str) -> str:
    return "".join(c for c in raw if c.isalnum())[:64]


def _vocabulary_normalize_gender(raw: Any) -> str:
    if raw == "male" or raw == "female" or raw == "unspecified":
        return raw
    if raw == "man":
        return "male"
    if raw == "woman":
        return "female"
    return "unspecified"


def _vocabulary_normalize_index_voice(item: Any) -> dict[str, str] | None:
    if not isinstance(item, dict):
        return None
    raw_hid = item.get("hashId") or item.get("voiceId") or item.get("slug")
    if not isinstance(raw_hid, str):
        return None
    hid = _vocabulary_hash_id_safe(raw_hid)
    if not hid:
        return None
    name = item.get("name")
    if not isinstance(name, str) or not name.strip():
        name = hid
    return {
        "hashId": hid,
        "name": name.strip(),
        "gender": _vocabulary_normalize_gender(item.get("gender")),
    }


def read_vocabulary_index() -> dict[str, Any]:
    data = _read_json_file(VOCABULARY_INDEX_PATH)
    if not data:
        return {"voices": []}
    raw_voices = data.get("voices")
    if not isinstance(raw_voices, list):
        return {"voices": [], **{k: v for k, v in data.items() if k != "voices"}}
    voices: list[dict[str, str]] = []
    for item in raw_voices:
        norm = _vocabulary_normalize_index_voice(item)
        if norm:
            voices.append(norm)
    return {**{k: v for k, v in data.items() if k != "voices"}, "voices": voices}


def read_vocabulary_voice_document(hash_id: str) -> dict[str, Any]:
    safe = _vocabulary_hash_id_safe(hash_id)
    if not safe:
        return {
            "hashId": "",
            "name": "",
            "gender": "unspecified",
            "entries": [],
        }
    path = VOCABULARY_VOICES_DIR / f"{safe}.json"
    data = _read_json_file(path)
    if not data:
        return {
            "hashId": safe,
            "name": "",
            "gender": "unspecified",
            "entries": [],
        }
    entries = data.get("entries")
    if not isinstance(entries, list):
        entries = []
    clean_entries = [e for e in entries if isinstance(e, dict)]
    raw_file_hid = data.get("hashId") or data.get("voiceSlug") or safe
    file_hid = (
        _vocabulary_hash_id_safe(raw_file_hid)
        if isinstance(raw_file_hid, str)
        else safe
    ) or safe
    name = data.get("name")
    if not isinstance(name, str) or not name.strip():
        name = file_hid
    return {
        "hashId": file_hid,
        "name": name.strip(),
        "gender": _vocabulary_normalize_gender(data.get("gender")),
        "entries": clean_entries,
    }


def read_vocabulary_voice_entries(hash_id: str) -> list[dict[str, Any]]:
    return read_vocabulary_voice_document(hash_id)["entries"]


def write_vocabulary_index(data: dict[str, Any]) -> None:
    _write_json_file(VOCABULARY_INDEX_PATH, data)


def write_vocabulary_voice_document(
    hash_id: str,
    name: str,
    gender: str,
    entries: list[dict[str, Any]],
) -> None:
    safe = _vocabulary_hash_id_safe(hash_id)
    if not safe:
        return
    g = _vocabulary_normalize_gender(gender)
    nm = name.strip() if name.strip() else safe
    _write_json_file(
        VOCABULARY_VOICES_DIR / f"{safe}.json",
        {"hashId": safe, "name": nm, "gender": g, "entries": entries},
    )


def write_vocabulary_voice_entries(hash_id: str, entries: list[dict[str, Any]]) -> None:
    doc = read_vocabulary_voice_document(hash_id)
    write_vocabulary_voice_document(
        hash_id,
        str(doc.get("name") or hash_id),
        str(doc.get("gender") or "unspecified"),
        entries,
    )


def read_echo_link_config_slices() -> dict[str, Any]:
    ensure_cache_dirs()
    merged: dict[str, Any] = {}
    for path in (
        CONFIG_PARAMETERS_PATH,
        CONFIG_SETTINGS_PATH,
        CONFIG_INPUT_AUDIO_PATH,
        CONFIG_OUTPUT_AUDIO_PATH,
    ):
        part = _read_json_file(path)
        if part:
            merged.update(part)
    return merged


def write_echo_link_config_slices(state: dict[str, Any]) -> None:
    input_audio = {
        k: state[k]
        for k in (
            "selectedInputDeviceId",
            "inputDeviceAliases",
            "audioChunkMs",
            "transcriptionStartDelayMs",
            "phraseSilenceCutMs",
            "inputSensitivity",
        )
        if k in state
    }
    output_audio = {
        k: state[k]
        for k in (
            "selectedOutputDeviceId",
            "outputDeviceAliases",
            "pipelineMonitorEnabled",
            "pipelineMonitorGainPercent",
            "speechReceiveLanguage",
            "speechTransformLanguage",
            "speechLanguagesEnabled",
            "selectedElevenLabsVoiceId",
            "voiceTranslationEnabled",
        )
        if k in state
    }
    parameters = {}
    settings: dict[str, Any] = {}
    _write_json_file(CONFIG_INPUT_AUDIO_PATH, input_audio)
    _write_json_file(CONFIG_OUTPUT_AUDIO_PATH, output_audio)
    _write_json_file(CONFIG_PARAMETERS_PATH, parameters)
    _write_json_file(CONFIG_SETTINGS_PATH, settings)
