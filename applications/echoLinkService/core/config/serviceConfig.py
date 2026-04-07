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

_MIXER_STRIP_ORDER_DEFAULT = ["ch1", "ch2", "ch3", "output"]
_MIXER_STRIP_IDS = frozenset({"ch1", "ch2", "ch3", "output"})


def _mixer_strip_order(v: Any) -> list[str]:
    if not isinstance(v, list):
        return list(_MIXER_STRIP_ORDER_DEFAULT)
    seen: set[str] = set()
    out: list[str] = []
    for x in v:
        if not isinstance(x, str) or x not in _MIXER_STRIP_IDS:
            return list(_MIXER_STRIP_ORDER_DEFAULT)
        if x in seen:
            continue
        seen.add(x)
        out.append(x)
    if len(out) == 4 and len(seen) == 4:
        return out
    if len(out) == 3 and seen == {"ch1", "ch2", "output"}:
        i = out.index("output")
        return [*out[:i], "ch3", *out[i:]]
    return list(_MIXER_STRIP_ORDER_DEFAULT)


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
    tertiaryChannelMixGainPercent: int = Field(default=100, ge=0, le=150)
    outputChannelMixGainPercent: int = Field(default=100, ge=0, le=150)
    inputDeviceAliases: dict[str, str] = Field(default_factory=dict)
    outputDeviceAliases: dict[str, str] = Field(default_factory=dict)
    speechReceiveLanguage: str = "pt-BR"
    speechTransformLanguage: str = "en-US"
    speechLanguagesEnabled: bool = True
    selectedInputDeviceId: str = Field(default="", max_length=512)
    selectedSecondaryInputDeviceId: str = Field(default="", max_length=512)
    selectedTertiaryInputDeviceId: str = Field(default="", max_length=512)
    selectedOutputDeviceId: str = Field(default="", max_length=512)
    selectedElevenLabsVoiceId: str = Field(
        default="bIHbv24MWmeRgasZH58o", max_length=96
    )
    voiceTranslationEnabled: bool = True
    pipelineMasterOutputEnabled: bool = True
    pipelineMonitorEnabled: bool = False
    pipelineMonitorGainPercent: int = Field(default=12, ge=1, le=100)
    sidebarSection: str = "audioIn"
    audioInLayoutMode: str = "mixer"
    audioInDetailScope: str = "both"
    audioInChannelTab: str = "microphone"
    mixerChannel1Active: bool = True
    mixerChannel2Active: bool = False
    mixerChannel3Active: bool = False
    mixerChannel1Muted: bool = False
    mixerChannel2Muted: bool = False
    mixerChannel3Muted: bool = False
    mixerOutputMuted: bool = False
    mixerChannel1RouteMaster: bool = True
    mixerChannel1RouteMonitor: bool = True
    mixerChannel2RouteMaster: bool = True
    mixerChannel2RouteMonitor: bool = True
    mixerChannel3RouteMaster: bool = True
    mixerChannel3RouteMonitor: bool = True
    mixerStripOrder: list[str] = Field(
        default_factory=lambda: list(_MIXER_STRIP_ORDER_DEFAULT)
    )

    @field_validator("mixerStripOrder", mode="before")
    @classmethod
    def mixer_strip_order(cls, v: Any) -> list[str]:
        return _mixer_strip_order(v)

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

    @field_validator("sidebarSection", mode="before")
    @classmethod
    def sidebar_section(cls, v: Any) -> str:
        if isinstance(v, str) and v in (
            "audioIn",
            "monitor",
            "vocabulary",
            "chats",
            "info",
        ):
            return v
        return "audioIn"

    @field_validator("audioInLayoutMode", mode="before")
    @classmethod
    def audio_in_layout(cls, v: Any) -> str:
        if isinstance(v, str) and v in ("mixer", "detail"):
            return v
        return "mixer"

    @field_validator("audioInDetailScope", mode="before")
    @classmethod
    def audio_in_detail_scope(cls, v: Any) -> str:
        if isinstance(v, str) and v in (
            "both",
            "microphone",
            "systemAudio",
            "media",
        ):
            return v
        return "both"

    @field_validator("audioInChannelTab", mode="before")
    @classmethod
    def audio_in_channel_tab(cls, v: Any) -> str:
        if isinstance(v, str) and v in ("microphone", "systemAudio", "media"):
            return v
        return "microphone"


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
    tertiaryChannelMixGainPercent: int | None = Field(
        default=None, ge=0, le=150
    )
    outputChannelMixGainPercent: int | None = Field(
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
    selectedTertiaryInputDeviceId: str | None = Field(
        default=None, max_length=512
    )
    selectedOutputDeviceId: str | None = Field(default=None, max_length=512)
    selectedElevenLabsVoiceId: str | None = Field(default=None, max_length=96)
    voiceTranslationEnabled: bool | None = None
    pipelineMasterOutputEnabled: bool | None = None
    pipelineMonitorEnabled: bool | None = None
    pipelineMonitorGainPercent: int | None = Field(default=None, ge=1, le=100)
    sidebarSection: str | None = None
    audioInLayoutMode: str | None = None
    audioInDetailScope: str | None = None
    audioInChannelTab: str | None = None
    mixerChannel1Active: bool | None = None
    mixerChannel2Active: bool | None = None
    mixerChannel3Active: bool | None = None
    mixerChannel1Muted: bool | None = None
    mixerChannel2Muted: bool | None = None
    mixerChannel3Muted: bool | None = None
    mixerOutputMuted: bool | None = None
    mixerChannel1RouteMaster: bool | None = None
    mixerChannel1RouteMonitor: bool | None = None
    mixerChannel2RouteMaster: bool | None = None
    mixerChannel2RouteMonitor: bool | None = None
    mixerChannel3RouteMaster: bool | None = None
    mixerChannel3RouteMonitor: bool | None = None
    mixerStripOrder: list[str] | None = None

    @field_validator("mixerStripOrder", mode="before")
    @classmethod
    def mixer_strip_order_patch(cls, v: Any) -> list[str] | None:
        if v is None:
            return None
        return _mixer_strip_order(v)

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
