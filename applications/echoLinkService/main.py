import logging
import os
from pathlib import Path

import uvicorn

from core.config.localIpcBinding import resolve_listen_config, uvicorn_run_kwargs

_SERVICE_ROOT = Path(__file__).resolve().parent
_DEFAULT_RELOAD_EXCLUDES = [str(_SERVICE_ROOT / "files" / "cache")]


def run() -> None:
    logging.basicConfig(level=logging.INFO)
    reload_enabled = os.environ.get("ECHO_LINK_RELOAD", "1") == "1"
    if reload_enabled:
        logging.getLogger("watchfiles.main").setLevel(logging.WARNING)
    listen = resolve_listen_config()
    kw = uvicorn_run_kwargs(listen, reload_enabled)
    if reload_enabled:
        raw = os.environ.get("ECHO_LINK_RELOAD_EXCLUDES", "").strip()
        if raw:
            kw["reload_excludes"] = [p.strip() for p in raw.split(",") if p.strip()]
        else:
            kw["reload_excludes"] = list(_DEFAULT_RELOAD_EXCLUDES)
    uvicorn.run(**kw)


if __name__ == "__main__":
    run()
