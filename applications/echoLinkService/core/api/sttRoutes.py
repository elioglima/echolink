import json
import os
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.files.runtimeState import ws_stt_enter, ws_stt_leave
from core.stt.sttTranscriptQuality import stt_final_text_passes_quality_gate


def _stt_engine() -> str:
    raw = os.environ.get("ECHO_LINK_STT_ENGINE", "aws").strip().lower() or "aws"
    return raw if raw in ("aws", "vosk") else "aws"


def _min_word_confidence() -> float:
    raw = os.environ.get("VOSK_MIN_WORD_CONFIDENCE", "0.4").strip()
    try:
        v = float(raw)
        return max(0.0, min(1.0, v))
    except ValueError:
        return 0.4


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
    return max(confs) >= _min_word_confidence()

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


async def _run_vosk_stt_stream(websocket: WebSocket) -> None:
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
            if rec.AcceptWaveform(data):
                res = json.loads(rec.Result())
                text = (res.get("text") or "").strip()
                if (
                    text
                    and _stt_final_is_reliable(res)
                    and stt_final_text_passes_quality_gate(text)
                ):
                    await websocket.send_json({"type": "final", "text": text})
            else:
                partial = json.loads(rec.PartialResult())
                text = (partial.get("partial") or "").strip()
                if text:
                    await websocket.send_json({"type": "partial", "text": text})
    except WebSocketDisconnect:
        pass
    finally:
        try:
            final = json.loads(rec.FinalResult())
            text = (final.get("text") or "").strip()
            if (
                text
                and _stt_final_is_reliable(final)
                and stt_final_text_passes_quality_gate(text)
            ):
                await websocket.send_json({"type": "final", "text": text})
        except Exception:
            pass


@router.websocket("/ws/stt")
async def stt_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    ws_stt_enter()
    try:
        if _stt_engine() == "aws":
            from core.stt.awsTranscribeStream import run_transcribe_streaming_ws

            await run_transcribe_streaming_ws(websocket)
            return
        await _run_vosk_stt_stream(websocket)
    finally:
        ws_stt_leave()

