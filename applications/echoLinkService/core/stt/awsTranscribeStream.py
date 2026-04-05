from __future__ import annotations

import asyncio
import logging
import os
from typing import TYPE_CHECKING

from amazon_transcribe.client import TranscribeStreamingClient
from amazon_transcribe.handlers import TranscriptResultStreamHandler
from amazon_transcribe.model import TranscriptEvent

from core.stt.sttTranscriptQuality import stt_final_text_passes_quality_gate

if TYPE_CHECKING:
    from fastapi import WebSocket

_log = logging.getLogger(__name__)

_AWS_AUDIO_CHUNK_MAX = 32000


def _aws_region() -> str:
    return os.environ.get("AWS_REGION", "us-east-1").strip() or "us-east-1"


def _transcribe_language_code() -> str:
    return os.environ.get("ECHO_LINK_TRANSCRIBE_LANGUAGE", "pt-BR").strip() or "pt-BR"


def _transcribe_stabilization_kwargs() -> dict[str, object]:
    raw = os.environ.get(
        "ECHO_LINK_TRANSCRIBE_PARTIAL_STABILITY", "low"
    ).strip().lower()
    if raw in ("off", "false", "0", "no"):
        return {"enable_partial_results_stabilization": False}
    level = raw if raw in ("low", "medium", "high") else "low"
    return {
        "enable_partial_results_stabilization": True,
        "partial_results_stability": level,
    }


async def run_transcribe_streaming_ws(websocket: WebSocket) -> None:
    region = _aws_region()
    lang = _transcribe_language_code()

    client = TranscribeStreamingClient(region=region)
    try:
        stream = await client.start_stream_transcription(
            language_code=lang,
            media_sample_rate_hz=16000,
            media_encoding="pcm",
            **_transcribe_stabilization_kwargs(),
        )
    except Exception as e:
        _log.warning("transcribe start failed: %s", e)
        await websocket.send_json(
            {
                "type": "error",
                "message": f"Amazon Transcribe: {e}",
            },
        )
        await websocket.close(code=4000)
        return

    class _Handler(TranscriptResultStreamHandler):
        def __init__(self, transcript_result_stream: object, ws: WebSocket) -> None:
            super().__init__(transcript_result_stream)
            self._ws = ws

        async def handle_transcript_event(self, transcript_event: TranscriptEvent) -> None:
            for result in transcript_event.transcript.results:
                alts = result.alternatives
                if not alts:
                    continue
                text = (alts[0].transcript or "").strip()
                if not text:
                    continue
                if not result.is_partial and not stt_final_text_passes_quality_gate(
                    text
                ):
                    continue
                payload: dict[str, str | bool] = {
                    "type": "partial" if result.is_partial else "final",
                    "text": text,
                }
                try:
                    await self._ws.send_json(payload)
                except Exception:
                    return

    handler = _Handler(stream.output_stream, websocket)
    await websocket.send_json({"type": "ready"})

    async def pump_audio() -> None:
        try:
            while True:
                message = await websocket.receive()
                if message["type"] == "websocket.disconnect":
                    break
                if message["type"] != "websocket.receive":
                    continue
                data = message.get("bytes")
                if not data:
                    continue
                offset = 0
                while offset < len(data):
                    chunk = data[offset : offset + _AWS_AUDIO_CHUNK_MAX]
                    offset += len(chunk)
                    await stream.input_stream.send_audio_event(audio_chunk=chunk)
        finally:
            try:
                await stream.input_stream.end_stream()
            except Exception:
                pass

    try:
        await asyncio.gather(pump_audio(), handler.handle_events())
    except Exception as e:
        _log.warning("transcribe session error: %s", e)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
