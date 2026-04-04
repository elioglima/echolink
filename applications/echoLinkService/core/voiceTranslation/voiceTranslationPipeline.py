from __future__ import annotations

import logging
import os
from typing import Any

import httpx

_log = logging.getLogger(__name__)

_AWS_REGION = os.environ.get("AWS_REGION", "us-east-1").strip() or "us-east-1"
_ELEVEN_BASE = "https://api.elevenlabs.io/v1"
_MAX_TTS_CHARS = 2500


def _eleven_api_key() -> str:
    return os.environ.get("ELEVENLABS_API_KEY", "").strip()


def _eleven_voice_id() -> str:
    return os.environ.get("ELEVENLABS_VOICE_ID", "").strip()


def _eleven_model_id() -> str:
    return (
        os.environ.get("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2").strip()
        or "eleven_multilingual_v2"
    )


def _env_float(name: str, default: float, lo: float, hi: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        v = float(raw)
        return max(lo, min(hi, v))
    except ValueError:
        return default


def _env_bool01(name: str, default: bool) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


def _eleven_voice_settings() -> dict[str, Any]:
    return {
        "stability": _env_float("ELEVENLABS_VOICE_STABILITY", 0.38, 0.0, 1.0),
        "similarity_boost": _env_float("ELEVENLABS_VOICE_SIMILARITY", 0.88, 0.0, 1.0),
        "style": _env_float("ELEVENLABS_VOICE_STYLE", 0.22, 0.0, 1.0),
        "use_speaker_boost": _env_bool01("ELEVENLABS_VOICE_SPEAKER_BOOST", True),
    }


def _eleven_skip_voice_settings() -> bool:
    return os.environ.get("ELEVENLABS_SKIP_VOICE_SETTINGS", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def _aws_credentials_available() -> bool:
    try:
        import boto3

        return boto3.Session().get_credentials() is not None
    except Exception:
        return False


def get_voice_translation_status() -> dict[str, Any]:
    translate_ready = _aws_credentials_available()
    key = _eleven_api_key()
    voice = _eleven_voice_id()
    tts_ready = bool(key and voice)
    tail = voice[-8:] if len(voice) >= 8 else voice
    vs = _eleven_voice_settings()
    return {
        "translateReady": translate_ready,
        "ttsReady": tts_ready,
        "ready": translate_ready and tts_ready,
        "awsRegion": _AWS_REGION,
        "elevenLabsModelId": _eleven_model_id(),
        "elevenLabsVoiceId": voice,
        "elevenLabsVoiceIdLength": len(voice),
        "elevenLabsVoiceIdTail": tail if voice else "",
        "elevenLabsVoiceSettingsActive": not _eleven_skip_voice_settings(),
        "elevenLabsVoiceStability": vs["stability"],
        "elevenLabsVoiceSimilarity": vs["similarity_boost"],
        "elevenLabsVoiceStyle": vs["style"],
        "elevenLabsVoiceSpeakerBoost": vs["use_speaker_boost"],
    }


def _truncate_for_tts(text_en: str) -> str:
    if len(text_en) <= _MAX_TTS_CHARS:
        return text_en
    return text_en[: _MAX_TTS_CHARS - 1] + "\u2026"


def translate_pt_to_en(text: str) -> str:
    import boto3
    from botocore.exceptions import BotoCoreError, ClientError

    client = boto3.client("translate", region_name=_AWS_REGION)
    try:
        out = client.translate_text(
            Text=text,
            SourceLanguageCode="pt",
            TargetLanguageCode="en",
        )
    except (ClientError, BotoCoreError) as e:
        raise RuntimeError(f"Amazon Translate: {e}") from e
    translated = (out.get("TranslatedText") or "").strip()
    if not translated:
        raise RuntimeError("Amazon Translate returned empty text")
    _log.info(
        "voiceTranslation translate ok pt_chars=%d en_chars=%d",
        len(text),
        len(translated),
    )
    return translated


def synthesize_en_speech_mp3(
    text_en: str, voice_id_override: str | None = None
) -> bytes:
    api_key = _eleven_api_key()
    voice_id = (voice_id_override or "").strip() or _eleven_voice_id()
    model_id = _eleven_model_id()
    if not api_key or not voice_id:
        raise RuntimeError("ElevenLabs API key or voice id not configured")
    tail = voice_id[-8:] if len(voice_id) >= 8 else voice_id
    if len(voice_id) > 40:
        _log.warning(
            "elevenlabs voice_id length=%d tail=%s looks like a hash; "
            "use the Voice ID from ElevenLabs Voices settings (usually shorter)",
            len(voice_id),
            tail,
        )
    _log.info(
        "elevenlabs tts request voice_id_len=%d voice_id_tail=%s model=%s en_chars=%d",
        len(voice_id),
        tail,
        model_id,
        len(text_en),
    )
    url = f"{_ELEVEN_BASE}/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": api_key,
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
    }
    body: dict[str, Any] = {"text": text_en, "model_id": model_id}
    if not _eleven_skip_voice_settings():
        body["voice_settings"] = _eleven_voice_settings()
    try:
        with httpx.Client(timeout=120.0) as client:
            r = client.post(url, json=body, headers=headers)
            r.raise_for_status()
            n = len(r.content)
            _log.info("elevenlabs tts ok bytes=%d", n)
            return r.content
    except httpx.HTTPStatusError as e:
        detail = e.response.text[:500] if e.response else ""
        _log.warning(
            "elevenlabs tts http_error status=%s body_prefix=%r",
            e.response.status_code if e.response else "?",
            detail[:200],
        )
        raise RuntimeError(f"ElevenLabs HTTP {e.response.status_code}: {detail}") from e
    except httpx.RequestError as e:
        _log.warning("elevenlabs tts request_error %s", e)
        raise RuntimeError(f"ElevenLabs request failed: {e}") from e


def run_voice_translation_pt_to_en_mp3_and_text(
    pt_text: str, eleven_labs_voice_id: str | None = None
) -> tuple[bytes, str]:
    raw = pt_text.strip()
    if not raw:
        raise ValueError("text is empty")
    _log.info("voiceTranslation pipeline start pt_chars=%d", len(raw))
    en = translate_pt_to_en(raw)
    en = _truncate_for_tts(en)
    mp3 = synthesize_en_speech_mp3(en, eleven_labs_voice_id)
    return mp3, en


def run_voice_translation_pt_to_en_mp3(
    pt_text: str, eleven_labs_voice_id: str | None = None
) -> bytes:
    mp3, _ = run_voice_translation_pt_to_en_mp3_and_text(
        pt_text, eleven_labs_voice_id
    )
    return mp3


def list_elevenlabs_voices() -> list[dict[str, str]]:
    api_key = _eleven_api_key()
    if not api_key:
        raise RuntimeError("ElevenLabs API key not configured")
    try:
        with httpx.Client(timeout=60.0) as client:
            r = client.get(
                f"{_ELEVEN_BASE}/voices",
                headers={"xi-api-key": api_key},
            )
            r.raise_for_status()
            data = r.json()
    except httpx.HTTPStatusError as e:
        detail = e.response.text[:500] if e.response else ""
        raise RuntimeError(f"ElevenLabs voices HTTP {e.response.status_code}: {detail}") from e
    except httpx.RequestError as e:
        raise RuntimeError(f"ElevenLabs voices request failed: {e}") from e
    voices = data.get("voices") if isinstance(data, dict) else None
    if not isinstance(voices, list):
        return []
    out: list[dict[str, str]] = []
    for item in voices:
        if not isinstance(item, dict):
            continue
        vid = str(item.get("voice_id") or "").strip()
        if not vid:
            continue
        name = str(item.get("name") or "").strip() or vid
        out.append({"voice_id": vid, "name": name})
    out.sort(key=lambda x: x["name"].lower())
    return out
