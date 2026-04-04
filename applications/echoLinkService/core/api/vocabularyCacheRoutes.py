from typing import Any

from fastapi import APIRouter

from core.files.localFileCache import (
    read_vocabulary_index,
    read_vocabulary_voice_document,
)

router = APIRouter(prefix="/vocabulary/cache", tags=["vocabularyCache"])


@router.get("/index")
def read_vocabulary_cache_index() -> dict[str, Any]:
    return read_vocabulary_index()


@router.get("/voices/{hash_id}")
def read_vocabulary_cache_voice(hash_id: str) -> dict[str, Any]:
    return read_vocabulary_voice_document(hash_id)
