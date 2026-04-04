import base64
import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field, field_validator

from core.voiceTranslation.eleven_labs_voice_display import (
    get_elevenlabs_voice_display_bundle,
)
from core.voiceTranslation.voiceTranslationPipeline import (
    get_voice_translation_status,
    list_elevenlabs_voices,
    run_voice_translation_pt_to_en_mp3,
    run_voice_translation_pt_to_en_mp3_and_text,
)

_log = logging.getLogger(__name__)

router = APIRouter(prefix="/voiceTranslation", tags=["voiceTranslation"])


class VoiceTranslationSynthesizeBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=8000)
    includeTranslatedText: bool = False
    elevenLabsVoiceId: str | None = Field(default=None, max_length=96)

    @field_validator("elevenLabsVoiceId", mode="before")
    @classmethod
    def strip_voice_id(cls, v: Any) -> str | None:
        if v is None:
            return None
        if not isinstance(v, str):
            return None
        t = v.strip()
        return t if t else None


@router.get("/status")
def voice_translation_status() -> dict[str, Any]:
    return get_voice_translation_status()


@router.get("/voiceDisplay")
def voice_translation_voice_display() -> dict[str, Any]:
    return get_elevenlabs_voice_display_bundle()


@router.get("/voices")
def voice_translation_voices() -> list[dict[str, str]]:
    st = get_voice_translation_status()
    if not st.get("ttsReady"):
        raise HTTPException(
            status_code=503,
            detail="ElevenLabs não configurado (ELEVENLABS_API_KEY e voz padrão).",
        )
    try:
        return list_elevenlabs_voices()
    except RuntimeError as e:
        _log.warning("voiceTranslation voices failed %s", e)
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.post("/synthesize")
def voice_translation_synthesize(body: VoiceTranslationSynthesizeBody) -> Response:
    st = get_voice_translation_status()
    if not st["ready"]:
        raise HTTPException(
            status_code=503,
            detail={
                "message": (
                    "Configure AWS (credenciais + Translate) e ElevenLabs "
                    "(ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID)."
                ),
                **st,
            },
        )
    try:
        _log.info(
            "voiceTranslation POST /synthesize pt_chars=%d",
            len(body.text),
        )
        if body.includeTranslatedText:
            mp3, en = run_voice_translation_pt_to_en_mp3_and_text(
                body.text, body.elevenLabsVoiceId
            )
        else:
            mp3 = run_voice_translation_pt_to_en_mp3(
                body.text, body.elevenLabsVoiceId
            )
            en = ""
    except ValueError as e:
        _log.warning("voiceTranslation synthesize bad_request %s", e)
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        _log.warning("voiceTranslation synthesize failed %s", e)
        raise HTTPException(status_code=502, detail=str(e)) from e
    if body.includeTranslatedText:
        return JSONResponse(
            {
                "translatedText": en,
                "audioBase64": base64.b64encode(mp3).decode("ascii"),
            }
        )
    return Response(content=mp3, media_type="audio/mpeg")
