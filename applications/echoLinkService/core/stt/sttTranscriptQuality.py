from __future__ import annotations

import os
import unicodedata

_DEFAULT_SHORT_PHRASE_KEYS = frozenset(
    {"alo", "oi", "sim", "nao", "bom", "ok"}
)


def _env_positive_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        v = int(raw, 10)
        return max(0, v)
    except ValueError:
        return default


def _letter_count(text: str) -> int:
    return sum(1 for c in text if c.isalpha())


def _word_tokens(text: str) -> list[str]:
    return [w for w in text.split() if any(c.isalpha() for c in w)]


def _alpha_key_from_token(token: str) -> str:
    lowered = unicodedata.normalize("NFD", token.lower())
    return "".join(
        c for c in lowered if c.isalpha() and not unicodedata.combining(c)
    )


def _short_phrase_allowlist_keys() -> frozenset[str]:
    keys = set(_DEFAULT_SHORT_PHRASE_KEYS)
    raw = os.environ.get("ECHO_LINK_STT_SHORT_PHRASE_ALLOWLIST", "").strip()
    if raw:
        for part in raw.split(","):
            p = part.strip()
            if p:
                keys.add(_alpha_key_from_token(p))
    return frozenset(keys)


def stt_final_text_passes_quality_gate(text: str) -> bool:
    if os.environ.get("ECHO_LINK_STT_SKIP_FINAL_QUALITY_GATE", "").strip().lower() in (
        "1",
        "true",
        "yes",
    ):
        return True
    t = text.strip()
    if not t:
        return False
    letters = _letter_count(t)
    words = _word_tokens(t)
    min_single = _env_positive_int("ECHO_LINK_STT_FINAL_MIN_LETTERS_SINGLE_WORD", 5)
    min_multi = _env_positive_int("ECHO_LINK_STT_FINAL_MIN_LETTERS_MULTI_WORD", 4)
    min_words_for_multi = _env_positive_int(
        "ECHO_LINK_STT_FINAL_MIN_WORDS_FOR_MULTI_RULE", 2
    )
    if len(words) >= min_words_for_multi:
        return letters >= min_multi
    if len(words) == 1:
        if _alpha_key_from_token(words[0]) in _short_phrase_allowlist_keys():
            return True
    return letters >= min_single
