import os

import uvicorn


def run() -> None:
    reload = os.environ.get("ECHO_LINK_RELOAD", "1") == "1"
    host = os.environ.get("ECHO_LINK_BIND_HOST", "127.0.0.1").strip() or "127.0.0.1"
    raw_port = os.environ.get("ECHO_LINK_BIND_PORT", "8765").strip() or "8765"
    try:
        port = int(raw_port)
    except ValueError:
        port = 8765
    uvicorn.run(
        "core.api.server:app",
        host=host,
        port=port,
        reload=reload,
    )


if __name__ == "__main__":
    run()
