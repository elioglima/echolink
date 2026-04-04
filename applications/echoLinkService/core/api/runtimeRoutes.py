from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from core.files.runtimeState import get_runtime_snapshot, set_panel_capture_active

router = APIRouter(prefix="/runtime", tags=["runtime"])


class PanelCaptureBody(BaseModel):
    captureActive: bool


@router.get("")
def read_runtime() -> dict[str, Any]:
    return get_runtime_snapshot()


@router.post("/capture")
def post_panel_capture(body: PanelCaptureBody) -> dict[str, Any]:
    set_panel_capture_active(body.captureActive)
    return get_runtime_snapshot()
