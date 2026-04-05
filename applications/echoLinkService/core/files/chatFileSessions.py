from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from core.files.localFileCache import CHATS_CACHE

_log = logging.getLogger(__name__)

_SESSION_ID_RE = re.compile(r"^[a-zA-Z0-9._-]{12,160}$")


def utc_now_iso_z() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace(
        "+00:00", "Z"
    )


def _session_path(session_id: str) -> Path:
    return CHATS_CACHE / f"{session_id}.json"


def create_chat_session_file() -> dict[str, str]:
    CHATS_CACHE.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    short = uuid.uuid4().hex[:12]
    session_id = f"{stamp}_{short}"
    path = _session_path(session_id)
    doc: dict[str, Any] = {
        "schemaVersion": 1,
        "sessionId": session_id,
        "startedAt": utc_now_iso_z(),
        "endedAt": None,
        "interimPt": None,
        "messages": [],
    }
    path.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {
        "sessionId": session_id,
        "relativePath": f"files/cache/chats/{session_id}.json",
    }


def _validate_session_id(session_id: str) -> None:
    if not _SESSION_ID_RE.match(session_id):
        raise ValueError("invalid session id")


def list_chat_sessions() -> list[dict[str, Any]]:
    CHATS_CACHE.mkdir(parents=True, exist_ok=True)
    paths = list(CHATS_CACHE.glob("*.json"))
    paths.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    out: list[dict[str, Any]] = []
    for path in paths:
        stem = path.stem
        if not _SESSION_ID_RE.match(stem):
            continue
        try:
            raw = path.read_text(encoding="utf-8")
            doc = json.loads(raw)
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(doc, dict):
            continue
        messages = doc.get("messages")
        msg_count = len(messages) if isinstance(messages, list) else 0
        out.append(
            {
                "sessionId": str(doc.get("sessionId") or stem),
                "fileName": path.name,
                "startedAt": doc.get("startedAt"),
                "endedAt": doc.get("endedAt"),
                "messageCount": msg_count,
            }
        )
    return out


def read_chat_session(session_id: str) -> dict[str, Any]:
    _validate_session_id(session_id)
    path = _session_path(session_id)
    if not path.is_file():
        raise FileNotFoundError(session_id)
    try:
        raw = path.read_text(encoding="utf-8")
        doc = json.loads(raw)
    except (OSError, json.JSONDecodeError) as e:
        _log.warning("chat session read failed %s: %s", path, e)
        raise FileNotFoundError(session_id) from e
    if not isinstance(doc, dict):
        raise ValueError("corrupt chat file")
    return doc


def write_chat_session_snapshot(
    session_id: str,
    messages: list[dict[str, Any]],
    interim_pt: str | None,
    ended_at: str | None,
) -> None:
    _validate_session_id(session_id)
    path = _session_path(session_id)
    if not path.is_file():
        raise FileNotFoundError(session_id)
    try:
        raw = path.read_text(encoding="utf-8")
        doc = json.loads(raw)
    except (OSError, json.JSONDecodeError) as e:
        _log.warning("chat session read failed %s: %s", path, e)
        raise FileNotFoundError(session_id) from e
    if not isinstance(doc, dict):
        raise ValueError("corrupt chat file")
    doc["messages"] = messages
    doc["interimPt"] = interim_pt if interim_pt else None
    if ended_at:
        doc["endedAt"] = ended_at
    path.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
