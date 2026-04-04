from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_log = logging.getLogger(__name__)

_SERVICE_ROOT = Path(__file__).resolve().parents[2]
RUNTIME_DIR = _SERVICE_ROOT / "files" / "cache" / "runtime"
RUNTIME_STATE_PATH = RUNTIME_DIR / "state.json"

_lock = threading.Lock()
_ws_mic = 0
_ws_stt = 0
_started_at: str | None = None
_bind_host: str | None = None
_bind_port: int | None = None
_panel_capture_active = False
_panel_capture_started_at: str | None = None
_panel_capture_stopped_at: str | None = None


def _iso_now() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _write_json(path: Path, data: dict[str, Any]) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        tmp.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        tmp.replace(path)
    except OSError as e:
        _log.warning("runtime state write failed %s: %s", path, e)
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def _snapshot_unlocked() -> dict[str, Any]:
    return {
        "status": "running",
        "startedAt": _started_at,
        "stoppedAt": None,
        "pid": os.getpid(),
        "host": _bind_host,
        "port": _bind_port,
        "activeWebSockets": {"mic": _ws_mic, "stt": _ws_stt},
        "panelCaptureActive": _panel_capture_active,
        "panelCaptureStartedAt": _panel_capture_started_at,
        "panelCaptureStoppedAt": _panel_capture_stopped_at,
        "updatedAt": _iso_now(),
    }


def _flush_unlocked() -> None:
    if _bind_host is None:
        return
    _write_json(RUNTIME_STATE_PATH, _snapshot_unlocked())


def service_bind_from_env() -> tuple[str, int]:
    h = os.environ.get("ECHO_LINK_BIND_HOST", "127.0.0.1").strip() or "127.0.0.1"
    raw_p = os.environ.get("ECHO_LINK_BIND_PORT", "8765").strip() or "8765"
    try:
        p = int(raw_p)
    except ValueError:
        p = 8765
    return h, p


def mark_server_started(host: str, port: int) -> None:
    global _started_at, _bind_host, _bind_port
    global _ws_mic, _ws_stt
    global _panel_capture_active, _panel_capture_started_at, _panel_capture_stopped_at
    with _lock:
        _bind_host = host
        _bind_port = port
        _started_at = _iso_now()
        _ws_mic = 0
        _ws_stt = 0
        _panel_capture_active = False
        _panel_capture_started_at = None
        _panel_capture_stopped_at = None
        _flush_unlocked()


def mark_server_stopped() -> None:
    global _bind_host, _bind_port, _panel_capture_active
    global _ws_mic, _ws_stt
    with _lock:
        stopped_at = _iso_now()
        last_started = _started_at
        host = _bind_host
        port = _bind_port
        _bind_host = None
        _bind_port = None
        _ws_mic = 0
        _ws_stt = 0
        _panel_capture_active = False
        blob = {
            "status": "stopped",
            "startedAt": last_started,
            "stoppedAt": stopped_at,
            "pid": None,
            "host": host,
            "port": port,
            "activeWebSockets": {"mic": 0, "stt": 0},
            "panelCaptureActive": False,
            "panelCaptureStartedAt": _panel_capture_started_at,
            "panelCaptureStoppedAt": _panel_capture_stopped_at,
            "updatedAt": stopped_at,
        }
        _write_json(RUNTIME_STATE_PATH, blob)


def ws_mic_enter() -> None:
    global _ws_mic
    with _lock:
        _ws_mic += 1
        _flush_unlocked()


def ws_mic_leave() -> None:
    global _ws_mic
    with _lock:
        _ws_mic = max(0, _ws_mic - 1)
        _flush_unlocked()


def ws_stt_enter() -> None:
    global _ws_stt
    with _lock:
        _ws_stt += 1
        _flush_unlocked()


def ws_stt_leave() -> None:
    global _ws_stt
    with _lock:
        _ws_stt = max(0, _ws_stt - 1)
        _flush_unlocked()


def set_panel_capture_active(active: bool) -> None:
    global _panel_capture_active, _panel_capture_started_at, _panel_capture_stopped_at
    with _lock:
        now = _iso_now()
        _panel_capture_active = active
        if active:
            _panel_capture_started_at = now
        else:
            _panel_capture_stopped_at = now
        _flush_unlocked()


def get_runtime_snapshot() -> dict[str, Any]:
    with _lock:
        if _bind_host is None:
            data = _read_json_file(RUNTIME_STATE_PATH)
            if isinstance(data, dict) and data.get("status") == "stopped":
                return dict(data)
            return {
                "status": "stopped",
                "startedAt": None,
                "stoppedAt": None,
                "pid": None,
                "host": None,
                "port": None,
                "activeWebSockets": {"mic": 0, "stt": 0},
                "panelCaptureActive": False,
                "panelCaptureStartedAt": None,
                "panelCaptureStoppedAt": None,
                "updatedAt": _iso_now(),
            }
        return dict(_snapshot_unlocked())


def _read_json_file(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    return data
