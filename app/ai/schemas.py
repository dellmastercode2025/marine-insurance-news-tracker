"""Pydantic schema for structured AI analysis output.

Every field is required (nullable where data may legitimately be absent) so the
schema is compatible with OpenAI strict structured outputs. The model is
instructed to write "not available in source" rather than invent facts.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

VesselTypeLiteral = Literal[
    "VLCC", "Aframax", "Suezmax", "Product Tanker", "Other Oil Tanker", "Unknown"
]
UpdateTypeLiteral = Literal[
    "sanctions",
    "insurance",
    "pi",
    "hm",
    "war_risk",
    "tanker_market",
    "freight",
    "shipbuilding",
    "port",
    "route",
    "geopolitical",
    "regulation",
]
LevelLiteral = Literal["High", "Medium", "Low"]
ClassificationLiteral = Literal[
    "Official legal/regulatory information",
    "Confirmed fact",
    "Market interpretation",
    "Assumption",
    "Rumor or unverified",
]


class ReportTable(BaseModel):
    """Compact table the AI may attach when tabular form improves clarity."""

    title: str
    columns: list[str]
    rows: list[list[str]]


class EntityBundle(BaseModel):
    companies: list[str]
    vessels: list[str]
    imo_numbers: list[str]
    shipowners: list[str]
    operators: list[str]
    charterers: list[str]
    insurers: list[str]
    pi_clubs: list[str]
    brokers: list[str]
    regulators: list[str]
    ports: list[str]
    shipyards: list[str]
    countries: list[str]


class InsuranceImplications(BaseModel):
    pi: str = Field(description='P&I impact, or "not available in source"')
    hm: str = Field(description='Hull & Machinery impact, or "not available in source"')
    war_risk: str = Field(description='War risk impact, or "not available in source"')
    cargo: str = Field(description='Cargo-insurance impact, or "not available in source"')


class AnalysisResult(BaseModel):
    """Structured intelligence extracted from one raw source item."""

    is_relevant: bool = Field(
        description="True only if directly relevant to oil/product tanker transportation, "
        "tanker markets, tanker shipbuilding, marine insurance for oil tankers, or "
        "sanctions affecting oil shipping. LNG/gas items are NOT relevant."
    )
    rejection_reason: str | None = Field(
        description="If is_relevant is false: one short sentence explaining why (e.g. 'LNG carrier topic')."
    )
    headline: str
    summary: str = Field(description="2-4 factual sentences. What happened. No filler.")
    key_facts: list[str] = Field(description="Bullet-level hard facts from the source only.")
    update_type: UpdateTypeLiteral
    vessel_type: VesselTypeLiteral
    region: str | None
    country: str | None
    sector: str | None
    original_language: str | None = Field(description="ISO 639-1 code of source text, e.g. 'en'.")
    materiality: LevelLiteral
    confidence: LevelLiteral
    classification: ClassificationLiteral
    entities: EntityBundle
    why_it_matters: str
    impact_on_oil_transportation: str
    insurance_implications: InsuranceImplications
    sanctions_compliance_implications: str
    practical_business_implications: str
    recommended_review_points: list[str]
    report_tables: list[ReportTable] = Field(
        description="Optional compact tables ONLY when tabular form adds clarity; else empty list."
    )
    event_key: str = Field(
        description="Short normalized slug identifying the underlying real-world event for "
        "deduplication, e.g. 'ofac-designation-2026-07-suezmax-shadow-fleet'. Same event "
        "reported by different outlets must produce the same slug."
    )


class TranslationResult(BaseModel):
    """Polished Russian publication version of an intelligence item.

    Business Russian, faithful to the original: no added facts, no softened
    risks, no removed uncertainty. Standard maritime/insurance abbreviations
    (P&I, H&M, VLCC, IMO, OFAC, OFSI, EU, UK, US) stay in English.
    Where the original says "not available in source", the Russian version
    says "не указано в источнике".
    """

    headline_ru: str
    summary_ru: str
    key_facts_ru: list[str]
    why_it_matters_ru: str
    impact_on_oil_transportation_ru: str
    impact_on_pi_ru: str
    impact_on_hm_ru: str
    impact_on_war_risk_ru: str
    sanctions_or_compliance_implications_ru: str
    practical_business_implications_ru: str
    recommended_review_points_ru: list[str]
