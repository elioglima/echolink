from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.files.chatFileSessions import (
    create_chat_session_file,
    list_chat_sessions,
    read_chat_session,
    utc_now_iso_z,
    write_chat_session_snapshot,
)

router = APIRouter(prefix="/chats", tags=["chats"])


@router.get("/sessions")
def get_chat_sessions_list() -> list[dict[str, Any]]:
    return list_chat_sessions()


@router.get("/sessions/{session_id}")
def get_chat_session_detail(session_id: str) -> dict[str, Any]:
    try:
        return read_chat_session(session_id)
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=404, detail="Sessão de chat não encontrada"
        ) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


class ChatSessionSnapshotBody(BaseModel):
    messages: list[dict[str, Any]] = Field(default_factory=list)
    interimPt: str | None = None
    ended: bool = False


@router.post("/sessions")
def post_chat_session() -> dict[str, str]:
    return create_chat_session_file()


@router.put("/sessions/{session_id}")
def put_chat_session(session_id: str, body: ChatSessionSnapshotBody) -> dict[str, str]:
    try:
        write_chat_session_snapshot(
            session_id,
            body.messages,
            body.interimPt,
            utc_now_iso_z() if body.ended else None,
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail="Sessão de chat não encontrada") from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": "true", "sessionId": session_id}
