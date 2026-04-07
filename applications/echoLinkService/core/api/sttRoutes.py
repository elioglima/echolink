import asyncio
import json
import os
import time
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.files.runtimeState import ws_stt_enter, ws_stt_leave
from core.stt.sttTranscriptQuality import (
    stt_final_text_passes_quality_gate,
    stt_partial_worth_sending,
)


def _stt_engine() -> str:
    raw = os.environ.get("ECHO_LINK_STT_ENGINE", "aws").strip().lower() or "aws"
    return raw if raw in ("aws", "vosk") else "aws"


def _min_word_confidence() -> float:
    raw = os.environ.get("VOSK_MIN_WORD_CONFIDENCE", "0.5").strip()
    try:
        v = float(raw)
        return max(0.0, min(1.0, v))
    except ValueError:
        return 0.5


def _min_word_confidence_floor() -> float:
    raw = os.environ.get("VOSK_MIN_WORD_CONFIDENCE_FLOOR", "0.22").strip()
    try:
        v = float(raw)
        return max(0.0, min(1.0, v))
    except ValueError:
        return 0.22


def _resolve_silence_commit_ms_query(raw: str | None) -> int:
    default_ms = 1200
    if raw is None or str(raw).strip() == "":
        return default_ms
    try:
        v = int(str(raw).strip())
    except ValueError:
        return default_ms
    if v <= 0:
        return default_ms
    return max(700, min(4000, v))


def _stt_final_is_reliable(result_obj: dict[str, Any]) -> bool:
    words = result_obj.get("result")
    if not isinstance(words, list) or len(words) == 0:
        return True
    confs: list[float] = []
    for w in words:
        if not isinstance(w, dict):
            continue
        c = w.get("conf")
        if c is None:
            continue
        try:
            confs.append(float(c))
        except (TypeError, ValueError):
            continue
    if not confs:
        return True
    if max(confs) < _min_word_confidence():
        return False
    if len(confs) >= 2 and min(confs) < _min_word_confidence_floor():
        return False
    return True

router = APIRouter(tags=["stt"])

_stt_model: Any = None


def _load_vosk_model() -> Any | None:
    global _stt_model
    if _stt_model is not None:
        return _stt_model
    path = os.environ.get("VOSK_MODEL_PATH", "").strip()
    if not path or not os.path.isdir(path):
        return None
    try:
        from vosk import Model
    except ImportError:
        return None
    try:
        _stt_model = Model(path)
    except OSError:
        return None
    return _stt_model


@router.get("/stt/status")
def stt_status() -> dict[str, Any]:
    engine = _stt_engine()
    if engine == "vosk":
        path = os.environ.get("VOSK_MODEL_PATH", "").strip()
        configured = bool(path and os.path.isdir(path))
        model = _load_vosk_model() if configured else None
        return {
            "engine": "vosk",
            "configured": configured,
            "modelPath": path if configured else None,
            "ready": model is not None,
        }
    region = os.environ.get("AWS_REGION", "us-east-1").strip() or "us-east-1"
    lang = os.environ.get("ECHO_LINK_TRANSCRIBE_LANGUAGE", "pt-BR").strip() or "pt-BR"
    profile = os.environ.get("AWS_PROFILE", "").strip() or None
    return {
        "engine": "aws",
        "configured": True,
        "ready": True,
        "region": region,
        "languageCode": lang,
        "awsProfile": profile,
    }


async def _run_vosk_stt_stream(websocket: WebSocket, silence_ms: int) -> None:
    model = _load_vosk_model()
    if model is None:
        await websocket.send_json(
            {
                "type": "error",
                "message": (
                    "STT não configurado. Instale vosk (pip), baixe um modelo em "
                    "https://alphacephei.com/vosk/models e defina VOSK_MODEL_PATH "
                    "para a pasta descompactada (ex.: vosk-model-small-pt-0.3)."
                ),
            }
        )
        await websocket.close(code=4000)
        return
    from vosk import KaldiRecognizer

    rec = KaldiRecognizer(model, 16000)
    try:
        rec.SetWords(True)
    except Exception:
        pass

    stop_event = asyncio.Event()
    lock = asyncio.Lock()
    pending_partial = ""
    last_partial_mono = 0.0
    last_final_sent_text = ""
    last_final_sent_mono = 0.0

    async def send_final_to_client(text: str) -> None:
        nonlocal last_final_sent_text, last_final_sent_mono
        t = text.strip()
        if not t:
            return
        now = time.monotonic()
        if t == last_final_sent_text and now - last_final_sent_mono < 0.7:
            return
        last_final_sent_text = t
        last_final_sent_mono = now
        try:
            await websocket.send_json({"type": "final", "text": t})
        except Exception:
            return

    async def silence_watch() -> None:
        nonlocal pending_partial, last_partial_mono
        while not stop_event.is_set():
            await asyncio.sleep(0.08)
            if stop_event.is_set():
                break
            text_to_send: str | None = None
            reliable_ok = True
            async with lock:
                if not pending_partial:
                    continue
                if time.monotonic() - last_partial_mono < silence_ms / 1000.0:
                    continue
                fallback_partial = pending_partial.strip()
                pending_partial = ""
                fr_obj: dict[str, Any] = {}
                vosk_text = ""
                try:
                    fr_raw = rec.FinalResult()
                    if fr_raw:
                        parsed = json.loads(fr_raw)
                        if isinstance(parsed, dict):
                            fr_obj = parsed
                            vosk_text = (fr_obj.get("text") or "").strip()
                except Exception:
                    fr_obj = {}
                    vosk_text = ""
                text_to_send = vosk_text if vosk_text else fallback_partial
                if vosk_text:
                    reliable_ok = _stt_final_is_reliable(fr_obj)
                else:
                    reliable_ok = stt_partial_worth_sending(fallback_partial)
                try:
                    rec.Reset()
                except Exception:
                    pass
            if (
                text_to_send
                and reliable_ok
                and stt_final_text_passes_quality_gate(text_to_send)
            ):
                await send_final_to_client(text_to_send)

    async def receive_audio() -> None:
        nonlocal pending_partial, last_partial_mono
        try:
            await websocket.send_json({"type": "ready"})
            while True:
                message = await websocket.receive()
                if message["type"] == "websocket.disconnect":
                    break
                if message["type"] != "websocket.receive":
                    continue
                data = message.get("bytes")
                if not data:
                    continue
                async with lock:
                    if rec.AcceptWaveform(data):
                        res = json.loads(rec.Result())
                        text = (res.get("text") or "").strip()
                        pending_partial = ""
                        if (
                            text
                            and _stt_final_is_reliable(res)
                            and stt_final_text_passes_quality_gate(text)
                        ):
                            await send_final_to_client(text)
                    else:
                        partial = json.loads(rec.PartialResult())
                        text = (partial.get("partial") or "").strip()
                        if text and stt_partial_worth_sending(text):
                            pending_partial = text
                            last_partial_mono = time.monotonic()
                            await websocket.send_json(
                                {"type": "partial", "text": text}
                            )
                        else:
                            pending_partial = ""
        except WebSocketDisconnect:
            pass
        finally:
            stop_event.set()
            try:
                async with lock:
                    final = json.loads(rec.FinalResult())
                    text = (final.get("text") or "").strip()
                    if (
                        text
                        and _stt_final_is_reliable(final)
                        and stt_final_text_passes_quality_gate(text)
                    ):
                        await send_final_to_client(text)
            except Exception:
                pass

    await asyncio.gather(receive_audio(), silence_watch())


@router.websocket("/ws/stt")
async def stt_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    ws_stt_enter()
    silence_ms = _resolve_silence_commit_ms_query(
        websocket.query_params.get("phraseSilenceCutMs")
    )
    try:
        if _stt_engine() == "aws":
            from core.stt.awsTranscribeStream import run_transcribe_streaming_ws

            await run_transcribe_streaming_ws(websocket)
            return
        await _run_vosk_stt_stream(websocket, silence_ms=silence_ms)
    finally:
        ws_stt_leave()

