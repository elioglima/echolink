from __future__ import annotations

import copy
import logging
import threading
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.files.localFileCache import (
    read_echo_link_config_slices,
    write_echo_link_config_slices,
)

_log = logging.getLogger(__name__)

ALLOWED_SPEECH_LANG = frozenset({"pt-BR", "en-US"})
ALIAS_KEY_MAX = 512
ALIAS_VALUE_MAX = 96

_lock = threading.Lock()


def _sanitize_aliases(v: Any) -> dict[str, str]:
    if not isinstance(v, dict):
        return {}
    out: dict[str, str] = {}
    for k, val in v.items():
        if not isinstance(k, str) or len(k) > ALIAS_KEY_MAX:
            continue
        if not isinstance(val, str):
            continue
        t = val.strip()[:ALIAS_VALUE_MAX]
        if t:
            out[k] = t
    return out


def _speech_lang(v: Any, fallback: str) -> str:
    if isinstance(v, str) and v in ALLOWED_SPEECH_LANG:
        return v
    return fallback


class EchoLinkConfigModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    audioChunkMs: int = Field(default=1190, ge=50, le=4000)
    transcriptionStartDelayMs: int = Field(default=2100, ge=0, le=15000)
    phraseSilenceCutMs: int = Field(default=1200, ge=0, le=15000)
    inputSensitivity: int = Field(default=2959, ge=10, le=5000)
    primaryChannelMixGainPercent: int = Field(default=100, ge=0, le=150)
    secondaryChannelMixGainPercent: int = Field(default=100, ge=0, le=150)
    inputDeviceAliases: dict[str, str] = Field(default_factory=dict)
    outputDeviceAliases: dict[str, str] = Field(default_factory=dict)
    speechReceiveLanguage: str = "pt-BR"
    speechTransformLanguage: str = "en-US"
    speechLanguagesEnabled: bool = True
    selectedInputDeviceId: str = Field(default="", max_length=512)
    selectedSecondaryInputDeviceId: str = Field(default="", max_length=512)
    selectedOutputDeviceId: str = Field(default="", max_length=512)
    selectedElevenLabsVoiceId: str = Field(
        default="bIHbv24MWmeRgasZH58o", max_length=96
    )
    voiceTranslationEnabled: bool = True
    pipelineMonitorEnabled: bool = False
    pipelineMonitorGainPercent: int = Field(default=12, ge=1, le=100)

    @field_validator("inputDeviceAliases", "outputDeviceAliases", mode="before")
    @classmethod
    def aliases(cls, v: Any) -> dict[str, str]:
        return _sanitize_aliases(v)

    @field_validator("speechReceiveLanguage", mode="before")
    @classmethod
    def recv_lang(cls, v: Any) -> str:
        return _speech_lang(v, "pt-BR")

    @field_validator("speechTransformLanguage", mode="before")
    @classmethod
    def transform_lang(cls, v: Any) -> str:
        return _speech_lang(v, "en-US")


class EchoLinkConfigPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    audioChunkMs: int | None = Field(default=None, ge=50, le=4000)
    transcriptionStartDelayMs: int | None = Field(default=None, ge=0, le=15000)
    phraseSilenceCutMs: int | None = Field(default=None, ge=0, le=15000)
    inputSensitivity: int | None = Field(default=None, ge=10, le=5000)
    primaryChannelMixGainPercent: int | None = Field(
        default=None, ge=0, le=150
    )
    secondaryChannelMixGainPercent: int | None = Field(
        default=None, ge=0, le=150
    )
    inputDeviceAliases: dict[str, str] | None = None
    outputDeviceAliases: dict[str, str] | None = None
    speechReceiveLanguage: str | None = None
    speechTransformLanguage: str | None = None
    speechLanguagesEnabled: bool | None = None
    selectedInputDeviceId: str | None = Field(default=None, max_length=512)
    selectedSecondaryInputDeviceId: str | None = Field(
        default=None, max_length=512
    )
    selectedOutputDeviceId: str | None = Field(default=None, max_length=512)
    selectedElevenLabsVoiceId: str | None = Field(default=None, max_length=96)
    voiceTranslationEnabled: bool | None = None
    pipelineMonitorEnabled: bool | None = None
    pipelineMonitorGainPercent: int | None = Field(default=None, ge=1, le=100)

    @field_validator("inputDeviceAliases", "outputDeviceAliases", mode="before")
    @classmethod
    def aliases_patch(cls, v: Any) -> dict[str, str] | None:
        if v is None:
            return None
        return _sanitize_aliases(v)

    @field_validator("speechReceiveLanguage", mode="before")
    @classmethod
    def recv_lang_patch(cls, v: Any) -> str | None:
        if v is None:
            return None
        return _speech_lang(v, "pt-BR")

    @field_validator("speechTransformLanguage", mode="before")
    @classmethod
    def transform_lang_patch(cls, v: Any) -> str | None:
        if v is None:
            return None
        return _speech_lang(v, "en-US")


def _build_initial_state() -> dict[str, Any]:
    base = EchoLinkConfigModel().model_dump()
    cached = read_echo_link_config_slices()
    if not cached:
        return base
    merged = {**base, **cached}
    try:
        return EchoLinkConfigModel.model_validate(merged).model_dump()
    except Exception as e:
        _log.warning("echo link config cache ignored: %s", e)
        return base


_state: dict[str, Any] = _build_initial_state()


def get_echo_link_config() -> dict[str, Any]:
    with _lock:
        return copy.deepcopy(_state)


def reload_echo_link_config_from_files() -> dict[str, Any]:
    global _state
    base = EchoLinkConfigModel().model_dump()
    cached = read_echo_link_config_slices()
    merged = {**base, **cached} if cached else base
    try:
        validated = EchoLinkConfigModel.model_validate(merged)
    except Exception as e:
        _log.warning("reload from file cache failed: %s", e)
        with _lock:
            return copy.deepcopy(_state)
    with _lock:
        _state = validated.model_dump()
        write_echo_link_config_slices(_state)
        return copy.deepcopy(_state)


def patch_echo_link_config(payload: dict[str, Any]) -> dict[str, Any]:
    global _state
    patch = EchoLinkConfigPatch.model_validate(payload)
    delta = patch.model_dump(exclude_unset=True, exclude_none=True)
    with _lock:
        current = EchoLinkConfigModel.model_validate(_state)
        merged = {**current.model_dump(), **delta}
        validated = EchoLinkConfigModel.model_validate(merged)
        _state = validated.model_dump()
        write_echo_link_config_slices(_state)
        return copy.deepcopy(_state)
