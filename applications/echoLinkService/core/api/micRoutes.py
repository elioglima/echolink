from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.files.runtimeState import ws_mic_enter, ws_mic_leave

router = APIRouter(tags=["capture"])


@router.websocket("/ws/mic")
async def mic_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    ws_mic_enter()
    total_bytes = 0
    chunk_count = 0
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
            total_bytes += len(data)
            chunk_count += 1
            if chunk_count == 1 or chunk_count % 4 == 0:
                await websocket.send_json(
                    {
                        "ok": True,
                        "totalBytes": total_bytes,
                        "chunks": chunk_count,
                    }
                )
    except WebSocketDisconnect:
        pass
    finally:
        ws_mic_leave()
