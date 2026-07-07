"""Cheap keyword relevance pre-filter run before any LLM call.

Purpose: discard obviously irrelevant items (LNG/gas, containers, dry bulk,
general news) so the LLM analyzes only plausible candidates. The LLM makes the
final relevance decision; this stage is deliberately permissive for items from
sanctions/insurance sources where headlines rarely say "tanker".
"""
from __future__ import annotations

import dataclasses
import re

# Hard-exclusion vocabulary: LNG/gas and clearly non-tanker segments.
EXCLUDE_TERMS = [
    "lng", "liquefied natural gas", "lpg", "liquefied petroleum gas",
    "gas carrier", "gas tanker", "fsru", "methane carrier", "natural gas",
    "gas field", "gas pipeline", "gas project", "regasification",
    "container", "boxship", "teu", "dry bulk", "bulker", "bulk carrier",
    "capesize", "panamax grain", "cruise ship", "cruise line", "ferry",
    "yacht", "offshore wind", "fishing vessel", "ro-ro", "car carrier",
]

# Terms that rescue an item despite an exclusion hit (mixed-topic stories).
TANKER_CONTEXT_TERMS = [
    "oil tanker", "crude tanker", "product tanker", "vlcc", "suezmax",
    "aframax", "crude oil", "petroleum product", "oil cargo", "oil shipment",
]

# Relevance vocabulary with weights.
INCLUDE_TERMS: dict[str, float] = {
    # vessel classes / oil transport
    "vlcc": 3.0, "suezmax": 3.0, "aframax": 3.0, "ulcc": 3.0,
    "oil tanker": 3.0, "crude tanker": 3.0, "product tanker": 3.0,
    "tanker": 2.0, "crude oil": 2.0, "petroleum product": 2.0,
    "oil cargo": 2.0, "oil export": 2.0, "oil shipment": 2.0, "oil price cap": 3.0,
    "shadow fleet": 3.0, "dark fleet": 3.0, "sts transfer": 2.0,
    # freight market
    "freight rate": 2.0, "worldscale": 3.0, "charter rate": 2.0,
    "time charter": 1.5, "spot rate": 1.5, "tonne-mile": 1.5, "baltic exchange": 1.5,
    # insurance
    "p&i": 3.0, "protection and indemnity": 3.0, "hull and machinery": 3.0,
    "hull & machinery": 3.0, "war risk": 3.0, "marine insurance": 2.5,
    "reinsurance": 1.5, "insurer": 1.5, "underwriter": 1.5, "club circular": 2.5,
    # sanctions / compliance
    "sanction": 2.0, "ofac": 2.5, "ofsi": 2.5, "sdn list": 3.0,
    "designation": 1.5, "price cap": 2.0, "embargo": 2.0, "export control": 1.5,
    "enforcement action": 2.0, "general licence": 2.0, "general license": 2.0,
    # shipbuilding
    "newbuild": 2.0, "shipyard": 1.5, "keel laying": 1.5, "vessel delivery": 1.5,
    "scrapping": 1.5, "demolition sale": 2.0, "orderbook": 2.0,
    # routes / chokepoints
    "suez canal": 2.0, "panama canal": 1.5, "strait of hormuz": 2.5,
    "bab el-mandeb": 2.5, "red sea": 2.0, "black sea": 2.0, "bosphorus": 2.0,
    "turkish straits": 2.5, "persian gulf": 2.0, "caspian": 2.0, "cpc": 1.5,
    "novorossiysk": 2.0, "houthi": 2.0,
    # general maritime signal (low weight — needs company)
    "vessel": 0.5, "maritime": 0.5, "shipping": 0.5, "shipowner": 1.0,
    "charterer": 1.5, "flag state": 1.0, "port state": 1.0, "imo number": 2.0,
}

PASS_THRESHOLD = 2.0
# Official/insurance sources get a lower bar: their items are often relevant
# even when headlines lack tanker vocabulary (e.g. "OFAC issues General License 8").
TRUSTED_CATEGORY_THRESHOLD = 0.5
TRUSTED_CATEGORIES = {"sanctions", "insurance"}

_MARITIME_HINT = re.compile(
    r"vessel|ship|maritime|tanker|oil|petroleum|marine|port|cargo|fleet|hull|p&i|freight",
    re.IGNORECASE,
)


@dataclasses.dataclass
class PrefilterResult:
    passed: bool
    score: float
    reason: str


def prefilter(title: str, snippet: str | None, source_category: str) -> PrefilterResult:
    text = f"{title} {snippet or ''}".lower()

    excluded = [term for term in EXCLUDE_TERMS if term in text]
    if excluded:
        rescued = any(term in text for term in TANKER_CONTEXT_TERMS)
        if not rescued:
            return PrefilterResult(False, 0.0, f"excluded term: {excluded[0]}")

    score = sum(weight for term, weight in INCLUDE_TERMS.items() if term in text)

    if source_category in TRUSTED_CATEGORIES:
        # Trusted regulators/insurers: require only a faint maritime/oil signal.
        if score >= TRUSTED_CATEGORY_THRESHOLD or _MARITIME_HINT.search(text):
            return PrefilterResult(True, score, "trusted source category")
        return PrefilterResult(False, score, "no maritime signal in trusted source item")

    if score >= PASS_THRESHOLD:
        return PrefilterResult(True, score, "keyword score")
    return PrefilterResult(False, score, f"score {score:.1f} below threshold")
