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


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _tiny_word_ratio_exceeded(words: list[str], max_ratio: float) -> bool:
    if len(words) < 3:
        return False
    tiny = 0
    for w in words:
        n = len(_alpha_key_from_token(w))
        if n <= 2:
            tiny += 1
    return (tiny / len(words)) > max_ratio


def stt_partial_worth_sending(text: str) -> bool:
    if os.environ.get("ECHO_LINK_STT_SKIP_PARTIAL_GATE", "").strip().lower() in (
        "1",
        "true",
        "yes",
    ):
        return True
    t = text.strip()
    if not t:
        return False
    letters = _letter_count(t)
    if letters < 6:
        return False
    words = _word_tokens(t)
    max_ratio = _env_float("ECHO_LINK_STT_PARTIAL_MAX_TINY_WORD_RATIO", 0.5)
    if _tiny_word_ratio_exceeded(words, max_ratio):
        return False
    return True


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
    max_tiny = _env_float("ECHO_LINK_STT_FINAL_MAX_TINY_WORD_RATIO", 0.42)
    if _tiny_word_ratio_exceeded(words, max_tiny):
        return False
    if len(words) >= min_words_for_multi:
        need = max(min_multi, 6 if len(words) == 2 else 10)
        return letters >= need
    if len(words) == 1:
        if _alpha_key_from_token(words[0]) in _short_phrase_allowlist_keys():
            return True
    return letters >= min_single
