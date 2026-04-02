import os

import uvicorn


def run() -> None:
    reload = os.environ.get("ECHO_LINK_RELOAD", "1") == "1"
    uvicorn.run(
        "core.api.server:app",
        host="127.0.0.1",
        port=8765,
        reload=reload,
    )


if __name__ == "__main__":
    run()
