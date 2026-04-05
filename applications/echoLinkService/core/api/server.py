from contextlib import asynccontextmanager
from typing import AsyncGenerator

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.api.configRoutes import router as config_router
from core.api.runtimeRoutes import router as runtime_router
from core.api.micRoutes import router as mic_router
from core.api.sttRoutes import router as stt_router
from core.api.vocabularyCacheRoutes import router as vocabulary_cache_router
from core.api.voiceTranslationRoutes import router as voice_translation_router
from core.api.chatRoutes import router as chat_router
from core.files.localFileCache import ensure_cache_dirs
from core.config.localIpcBinding import resolve_listen_config
from core.files.runtimeState import mark_server_started, mark_server_stopped


def apply_echo_link_aws_profile_env() -> None:
    plink = os.environ.get("ECHO_LINK_AWS_PROFILE", "").strip()
    if plink:
        os.environ["AWS_PROFILE"] = plink
    elif not os.environ.get("AWS_PROFILE", "").strip():
        os.environ["AWS_PROFILE"] = "dev-neocoode"


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    apply_echo_link_aws_profile_env()
    ensure_cache_dirs()
    lc = resolve_listen_config()
    mark_server_started(lc.host, lc.port, uds_path=lc.uds_path, listen_mode=lc.mode)
    try:
        yield
    finally:
        mark_server_stopped()


app = FastAPI(title="EchoLink Service", lifespan=lifespan)

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

app.include_router(config_router)
app.include_router(runtime_router)
app.include_router(mic_router)
app.include_router(stt_router)
app.include_router(vocabulary_cache_router)
app.include_router(voice_translation_router)
app.include_router(chat_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "echoLink"}


@app.get("/capture/info")
def capture_info() -> dict[str, str]:
    return {
        "configPath": "/config",
        "configReloadFromFilesPath": "/config/reload-from-files",
        "websocketPath": "/ws/mic",
        "sttWebsocketPath": "/ws/stt",
        "voiceTranslationPath": "/voiceTranslation",
        "vocabularyCacheIndexPath": "/vocabulary/cache/index",
        "vocabularyCacheVoicePath": "/vocabulary/cache/voices/{hashId}",
        "fileCacheRoot": "files/cache",
        "fileCacheConfigs": "files/cache/configs",
        "fileCacheVocabulary": "files/cache/vocabulary",
        "fileCacheRuntime": "files/cache/runtime",
        "fileCacheChats": "files/cache/chats",
        "chatsSessionsPath": "/chats/sessions",
        "runtimeStatePath": "files/cache/runtime/state.json",
        "runtimePath": "/runtime",
        "runtimeCapturePath": "/runtime/capture",
        "hint": "Mic chunks as binary; STT expects PCM s16le mono 16 kHz on /ws/stt.",
    }
