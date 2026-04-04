from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.api.micRoutes import router as mic_router
from core.api.sttRoutes import router as stt_router

app = FastAPI(title="EchoLink Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:3000",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(mic_router)
app.include_router(stt_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "echoLink"}


@app.get("/capture/info")
def capture_info() -> dict[str, str]:
    return {
        "websocketPath": "/ws/mic",
        "sttWebsocketPath": "/ws/stt",
        "hint": "Mic chunks as binary; STT expects PCM s16le mono 16 kHz on /ws/stt.",
    }
