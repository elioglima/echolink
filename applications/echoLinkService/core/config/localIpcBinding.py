from __future__ import annotations

import logging
import os
import platform
from dataclasses import dataclass

_log = logging.getLogger(__name__)


@dataclass(frozen=True)
class EchoLinkListenConfig:
    mode: str
    host: str
    port: int
    uds_path: str | None


def echo_link_uds_path_from_env() -> str | None:
    raw = os.environ.get("ECHO_LINK_UDS_PATH", "").strip()
    return raw or None


def echo_link_named_pipe_hint_from_env() -> str | None:
    raw = os.environ.get("ECHO_LINK_NAMED_PIPE", "").strip()
    return raw or None


def resolve_listen_config() -> EchoLinkListenConfig:
    uds = echo_link_uds_path_from_env()
    if uds and platform.system() == "Windows":
        _log.warning(
            "ECHO_LINK_UDS_PATH is not supported for the Python listener on Windows; using TCP."
        )
        uds = None
    if uds:
        return EchoLinkListenConfig(
            mode="unix",
            host="",
            port=0,
            uds_path=uds,
        )
    h = os.environ.get("ECHO_LINK_BIND_HOST", "127.0.0.1").strip() or "127.0.0.1"
    raw_p = os.environ.get("ECHO_LINK_BIND_PORT", "8765").strip() or "8765"
    try:
        p = int(raw_p)
    except ValueError:
        p = 8765
    return EchoLinkListenConfig(mode="tcp", host=h, port=p, uds_path=None)


def uvicorn_run_kwargs(listen: EchoLinkListenConfig, reload: bool) -> dict[str, object]:
    kw: dict[str, object] = {
        "app": "core.api.server:app",
        "reload": reload,
    }
    if listen.mode == "unix" and listen.uds_path:
        kw["uds"] = listen.uds_path
    else:
        kw["host"] = listen.host
        kw["port"] = listen.port
    return kw
