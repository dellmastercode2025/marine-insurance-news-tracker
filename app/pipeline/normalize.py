"""Metadata normalization: canonical URLs, title hashes, simhash, snippets."""
from __future__ import annotations

import hashlib
import re
from html import unescape
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

_TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "fbclid", "gclid", "mc_cid", "mc_eid", "ref", "source",
}

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
_WORD_RE = re.compile(r"[a-z0-9]+")


def canonical_url(url: str) -> str:
    parsed = urlparse(url.strip())
    query = [(k, v) for k, v in parse_qsl(parsed.query) if k.lower() not in _TRACKING_PARAMS]
    path = parsed.path.rstrip("/") or "/"
    return urlunparse(
        (parsed.scheme.lower(), parsed.netloc.lower(), path, "", urlencode(query), "")
    )


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def normalize_title(title: str) -> str:
    text = _WS_RE.sub(" ", unescape(title)).strip().lower()
    return re.sub(r"[^\w\s]", "", text)


def clean_snippet(raw: str | None, max_chars: int) -> str | None:
    """Strip HTML and bound the excerpt — we never store full article bodies."""
    if not raw:
        return None
    text = _WS_RE.sub(" ", unescape(_TAG_RE.sub(" ", raw))).strip()
    if len(text) > max_chars:
        text = text[: max_chars - 1].rsplit(" ", 1)[0] + "…"
    return text or None


def simhash64(text: str) -> int:
    """Simple 64-bit simhash over word tokens (near-duplicate titles)."""
    weights = [0] * 64
    for token in _WORD_RE.findall(text.lower()):
        digest = hashlib.md5(token.encode("utf-8")).digest()
        value = int.from_bytes(digest[:8], "big")
        for bit in range(64):
            weights[bit] += 1 if (value >> bit) & 1 else -1
    result = 0
    for bit in range(64):
        if weights[bit] > 0:
            result |= 1 << bit
    return result


def hamming_distance(a: int, b: int) -> int:
    return bin(a ^ b).count("1")
