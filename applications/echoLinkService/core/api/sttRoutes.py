import json
import os
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

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
    path = os.environ.get("VOSK_MODEL_PATH", "").strip()
    configured = bool(path and os.path.isdir(path))
    model = _load_vosk_model() if configured else None
    return {
        "configured": configured,
        "modelPath": path if configured else None,
        "ready": model is not None,
    }


@router.websocket("/ws/stt")
async def stt_stream(websocket: WebSocket) -> None:
    await websocket.accept()
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
                if text:
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
            if text:
                await websocket.send_json({"type": "final", "text": text})
        except Exception:
            pass

