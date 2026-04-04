from typing import Any

from fastapi import APIRouter

from core.config.serviceConfig import (
    EchoLinkConfigPatch,
    get_echo_link_config,
    patch_echo_link_config,
    reload_echo_link_config_from_files,
)

router = APIRouter(prefix="/config", tags=["config"])


@router.get("")
def read_config() -> dict[str, Any]:
    return get_echo_link_config()


@router.patch("")
def update_config(body: EchoLinkConfigPatch) -> dict[str, Any]:
    raw = body.model_dump(exclude_unset=True, exclude_none=True)
    return patch_echo_link_config(raw)


@router.post("/reload-from-files")
def reload_config_from_files() -> dict[str, Any]:
    return reload_echo_link_config_from_files()
