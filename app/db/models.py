"""Database models.

Postgres-first (JSONB, indexes) with a fully working SQLite fallback for
local development — the JSON type degrades gracefully via with_variant.
"""
from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Index,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

PortableJSON = JSON().with_variant(JSONB(), "postgresql")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class VesselType(str, enum.Enum):
    VLCC = "VLCC"
    AFRAMAX = "Aframax"
    SUEZMAX = "Suezmax"
    PRODUCT_TANKER = "Product Tanker"
    OTHER_OIL_TANKER = "Other Oil Tanker"
    UNKNOWN = "Unknown"


class UpdateType(str, enum.Enum):
    SANCTIONS = "sanctions"
    INSURANCE = "insurance"
    PI = "pi"
    HM = "hm"
    WAR_RISK = "war_risk"
    TANKER_MARKET = "tanker_market"
    FREIGHT = "freight"
    SHIPBUILDING = "shipbuilding"
    PORT = "port"
    ROUTE = "route"
    GEOPOLITICAL = "geopolitical"
    REGULATION = "regulation"


class Materiality(str, enum.Enum):
    HIGH = "High"
    MEDIUM = "Medium"
    LOW = "Low"


class Confidence(str, enum.Enum):
    HIGH = "High"
    MEDIUM = "Medium"
    LOW = "Low"


class Classification(str, enum.Enum):
    OFFICIAL = "Official legal/regulatory information"
    CONFIRMED = "Confirmed fact"
    INTERPRETATION = "Market interpretation"
    ASSUMPTION = "Assumption"
    UNVERIFIED = "Rumor or unverified"


class RawItemStatus(str, enum.Enum):
    NEW = "new"
    PREFILTERED_OUT = "prefiltered_out"
    ANALYZED = "analyzed"
    REJECTED_BY_AI = "rejected_by_ai"
    MERGED = "merged"
    ANALYSIS_FAILED = "analysis_failed"
    ERROR = "error"


class SubscriptionTopic(str, enum.Enum):
    URGENT_HIGH = "urgent_high"
    DAILY_BRIEF = "daily_brief"
    WEEKLY_REPORT = "weekly_report"
    SANCTIONS = "sanctions"
    PI = "pi"
    HM = "hm"
    WAR_RISK = "war_risk"
    TANKER_MARKET = "tanker_market"
    VLCC = "vlcc"
    AFRAMAX = "aframax"
    SUEZMAX = "suezmax"
    SHIPBUILDING = "shipbuilding"
    PORT_DISRUPTION = "port_disruption"
    FREIGHT = "freight"
    ROUTE_DISRUPTION = "route_disruption"
    GEOPOLITICAL = "geopolitical"


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Source(TimestampMixin, Base):
    __tablename__ = "sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    url: Mapped[str] = mapped_column(String(1000))
    feed_url: Mapped[str | None] = mapped_column(String(1000))
    fetch_method: Mapped[str] = mapped_column(String(20), default="rss")  # rss | html | api
    category: Mapped[str] = mapped_column(String(40))  # sanctions|insurance|market|shipbuilding|ports
    # 1 = official regulator ... 5 = aggregator/secondary; lower = more authoritative
    authority_rank: Mapped[int] = mapped_column(Integer, default=3)
    country: Mapped[str | None] = mapped_column(String(80))
    language: Mapped[str] = mapped_column(String(10), default="en")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    robots_ok: Mapped[bool] = mapped_column(Boolean, default=True)
    fetch_interval_minutes: Mapped[int] = mapped_column(Integer, default=60)
    last_fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0)

    raw_items: Mapped[list[RawItem]] = relationship(back_populates="source")


class RawItem(TimestampMixin, Base):
    __tablename__ = "raw_items"
    __table_args__ = (
        Index("ix_raw_items_status", "status"),
        Index("ix_raw_items_published_at", "published_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("sources.id"), index=True)
    external_id: Mapped[str | None] = mapped_column(String(500))
    url: Mapped[str] = mapped_column(String(1500))
    canonical_url_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    title: Mapped[str] = mapped_column(Text)
    title_norm_hash: Mapped[str] = mapped_column(String(64), index=True)
    title_simhash: Mapped[str | None] = mapped_column(String(20), index=True)
    # Bounded excerpt/abstract only — never the full article body.
    snippet: Mapped[str | None] = mapped_column(Text)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    language: Mapped[str | None] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(30), default=RawItemStatus.NEW.value)
    prefilter_score: Mapped[float | None] = mapped_column(Float)
    error_detail: Mapped[str | None] = mapped_column(Text)

    source: Mapped[Source] = relationship(back_populates="raw_items")


class DuplicateGroup(TimestampMixin, Base):
    __tablename__ = "duplicate_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_key: Mapped[str] = mapped_column(String(300), index=True)
    earliest_published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    most_authoritative_source_id: Mapped[int | None] = mapped_column(ForeignKey("sources.id"))
    member_count: Mapped[int] = mapped_column(Integer, default=1)
    confidence_boosted: Mapped[bool] = mapped_column(Boolean, default=False)


class IntelligenceItem(TimestampMixin, Base):
    __tablename__ = "intelligence_items"
    __table_args__ = (
        Index("ix_intel_update_type", "update_type"),
        Index("ix_intel_vessel_type", "vessel_type"),
        Index("ix_intel_materiality", "materiality"),
        Index("ix_intel_publication_date", "publication_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    publication_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    source_name: Mapped[str] = mapped_column(String(200))
    source_url: Mapped[str] = mapped_column(String(1500))
    # All confirming source links when duplicates are merged: [{name, url, published_at}]
    all_source_urls: Mapped[list | None] = mapped_column(PortableJSON, default=list)
    headline: Mapped[str] = mapped_column(Text)
    original_language: Mapped[str | None] = mapped_column(String(10))
    region: Mapped[str | None] = mapped_column(String(120))
    country: Mapped[str | None] = mapped_column(String(120))
    sector: Mapped[str | None] = mapped_column(String(120))
    vessel_type: Mapped[str] = mapped_column(String(30), default=VesselType.UNKNOWN.value)
    update_type: Mapped[str] = mapped_column(String(30))

    companies_mentioned: Mapped[list | None] = mapped_column(PortableJSON, default=list)
    vessels_mentioned: Mapped[list | None] = mapped_column(PortableJSON, default=list)
    imo_numbers: Mapped[list | None] = mapped_column(PortableJSON, default=list)
    shipowners: Mapped[list | None] = mapped_column(PortableJSON, default=list)
    operators: Mapped[list | None] = mapped_column(PortableJSON, default=list)
    charterers: Mapped[list | None] = mapped_column(PortableJSON, default=list)
    insurers: Mapped[list | None] = mapped_column(PortableJSON, default=list)
    brokers: Mapped[list | None] = mapped_column(PortableJSON, default=list)
    regulators: Mapped[list | None] = mapped_column(PortableJSON, default=list)
    ports: Mapped[list | None] = mapped_column(PortableJSON, default=list)
    shipyards: Mapped[list | None] = mapped_column(PortableJSON, default=list)

    key_facts: Mapped[list | None] = mapped_column(PortableJSON, default=list)
    summary: Mapped[str] = mapped_column(Text)
    why_it_matters: Mapped[str | None] = mapped_column(Text)
    impact_on_oil_transportation: Mapped[str | None] = mapped_column(Text)
    impact_on_pi: Mapped[str | None] = mapped_column(Text)
    impact_on_hm: Mapped[str | None] = mapped_column(Text)
    impact_on_war_risk: Mapped[str | None] = mapped_column(Text)
    sanctions_or_compliance_implications: Mapped[str | None] = mapped_column(Text)
    practical_business_implications: Mapped[str | None] = mapped_column(Text)
    recommended_review_points: Mapped[list | None] = mapped_column(PortableJSON, default=list)
    # Optional AI-produced tables for report sections: [{title, columns, rows}]
    report_tables: Mapped[list | None] = mapped_column(PortableJSON, default=list)

    # Russian publication version (default Telegram output language).
    headline_ru: Mapped[str | None] = mapped_column(Text)
    summary_ru: Mapped[str | None] = mapped_column(Text)
    key_facts_ru: Mapped[list | None] = mapped_column(PortableJSON, default=list)
    why_it_matters_ru: Mapped[str | None] = mapped_column(Text)
    impact_on_oil_transportation_ru: Mapped[str | None] = mapped_column(Text)
    impact_on_pi_ru: Mapped[str | None] = mapped_column(Text)
    impact_on_hm_ru: Mapped[str | None] = mapped_column(Text)
    impact_on_war_risk_ru: Mapped[str | None] = mapped_column(Text)
    sanctions_or_compliance_implications_ru: Mapped[str | None] = mapped_column(Text)
    practical_business_implications_ru: Mapped[str | None] = mapped_column(Text)
    recommended_review_points_ru: Mapped[list | None] = mapped_column(PortableJSON, default=list)
    publication_ready_ru: Mapped[bool] = mapped_column(Boolean, default=False)

    materiality: Mapped[str] = mapped_column(String(10))
    confidence: Mapped[str] = mapped_column(String(10))
    classification: Mapped[str] = mapped_column(String(60))

    duplicate_group_id: Mapped[int | None] = mapped_column(
        ForeignKey("duplicate_groups.id"), index=True
    )
    primary_raw_item_id: Mapped[int | None] = mapped_column(ForeignKey("raw_items.id"))
    # Lower-cased concatenation of headline + entities for /search
    search_text: Mapped[str | None] = mapped_column(Text)

    duplicate_group: Mapped[DuplicateGroup | None] = relationship()


class Entity(TimestampMixin, Base):
    __tablename__ = "entities"
    __table_args__ = (UniqueConstraint("normalized_name", "entity_type", name="uq_entity"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(300))
    normalized_name: Mapped[str] = mapped_column(String(300), index=True)
    # company|vessel|imo|port|insurer|pi_club|regulator|shipyard|country|broker
    entity_type: Mapped[str] = mapped_column(String(30), index=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    mention_count: Mapped[int] = mapped_column(Integer, default=1)


class IntelligenceItemEntity(Base):
    __tablename__ = "intelligence_item_entities"
    __table_args__ = (UniqueConstraint("intelligence_item_id", "entity_id", name="uq_item_entity"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    intelligence_item_id: Mapped[int] = mapped_column(
        ForeignKey("intelligence_items.id"), index=True
    )
    entity_id: Mapped[int] = mapped_column(ForeignKey("entities.id"), index=True)


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    telegram_user_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True)
    username: Mapped[str | None] = mapped_column(String(120))
    first_name: Mapped[str | None] = mapped_column(String(120))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    # Private bot: only approved users (or admins) may interact.
    is_approved: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    language_code: Mapped[str | None] = mapped_column(String(10))
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    subscriptions: Mapped[list[Subscription]] = relationship(back_populates="user")


class Subscription(TimestampMixin, Base):
    __tablename__ = "subscriptions"
    __table_args__ = (UniqueConstraint("user_id", "topic", name="uq_user_topic"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    topic: Mapped[str] = mapped_column(String(30))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    user: Mapped[User] = relationship(back_populates="subscriptions")


class Alert(TimestampMixin, Base):
    __tablename__ = "alerts"
    __table_args__ = (
        UniqueConstraint(
            "intelligence_item_id", "user_id", "alert_type", name="uq_alert_once"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    intelligence_item_id: Mapped[int] = mapped_column(
        ForeignKey("intelligence_items.id"), index=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    alert_type: Mapped[str] = mapped_column(String(30), default="high_materiality")
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    telegram_message_id: Mapped[int | None] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(20), default="sent")  # sent|failed|skipped


class Report(TimestampMixin, Base):
    __tablename__ = "reports"
    __table_args__ = (Index("ix_reports_type_period", "report_type", "period_end"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    report_type: Mapped[str] = mapped_column(String(10))  # daily | weekly
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    content_md_en: Mapped[str] = mapped_column(Text)
    content_md_ru: Mapped[str | None] = mapped_column(Text)
    generated_language_versions: Mapped[list | None] = mapped_column(PortableJSON, default=list)
    telegram_summary: Mapped[str | None] = mapped_column(Text)  # English
    telegram_summary_ru: Mapped[str | None] = mapped_column(Text)
    item_count: Mapped[int] = mapped_column(Integer, default=0)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    status: Mapped[str] = mapped_column(String(20), default="generated")  # generated|sent|failed

    @property
    def publication_content(self) -> str:
        """Russian is the default publication language; English is the fallback."""
        return self.content_md_ru or self.content_md_en

    @property
    def publication_summary(self) -> str | None:
        return self.telegram_summary_ru or self.telegram_summary

    @property
    def publication_language(self) -> str:
        return "ru" if self.content_md_ru else "en"


class MonitoringRun(TimestampMixin, Base):
    __tablename__ = "monitoring_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    trigger: Mapped[str] = mapped_column(String(20), default="schedule")  # schedule|manual|api
    sources_checked: Mapped[int] = mapped_column(Integer, default=0)
    sources_failed: Mapped[int] = mapped_column(Integer, default=0)
    items_fetched: Mapped[int] = mapped_column(Integer, default=0)
    items_new: Mapped[int] = mapped_column(Integer, default=0)
    items_prefiltered_out: Mapped[int] = mapped_column(Integer, default=0)
    items_analyzed: Mapped[int] = mapped_column(Integer, default=0)
    items_high: Mapped[int] = mapped_column(Integer, default=0)
    items_medium: Mapped[int] = mapped_column(Integer, default=0)
    items_low: Mapped[int] = mapped_column(Integer, default=0)
    alerts_sent: Mapped[int] = mapped_column(Integer, default=0)
    llm_calls: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="running")  # running|success|partial|failed
    error_detail: Mapped[str | None] = mapped_column(Text)
