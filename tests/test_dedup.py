from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from app.db.models import Alert, DuplicateGroup, User
from app.pipeline.dedup import (
    find_matching_item,
    find_raw_duplicate,
    merge_into_item,
)
from app.pipeline.normalize import canonical_url, hamming_distance, normalize_title, simhash64
from app.pipeline.store import create_intelligence_item

from tests.conftest import make_analysis, make_raw_item, make_source


def test_canonical_url_strips_tracking():
    a = canonical_url("https://Example.com/story/?utm_source=x&utm_medium=y&id=7#frag")
    assert a == "https://example.com/story?id=7"


def test_similar_titles_have_close_simhash():
    a = simhash64(normalize_title("OFAC designates five Suezmax tankers over price cap"))
    b = simhash64(normalize_title("OFAC designates five Suezmax tankers over price cap breach"))
    c = simhash64(normalize_title("VLCC freight rates jump in the Atlantic basin"))
    assert hamming_distance(a, b) <= 6
    assert hamming_distance(a, c) > 6


async def test_find_raw_duplicate_by_title(session):
    source = make_source()
    session.add(source)
    await session.flush()
    first = make_raw_item(source, "Tanker seized in enforcement action", "https://a.com/1")
    session.add(first)
    await session.commit()

    from app.pipeline.normalize import sha256_hex

    norm = normalize_title("Tanker seized in enforcement action")
    duplicate = await find_raw_duplicate(session, sha256_hex(norm), simhash64(norm))
    assert duplicate is not None
    assert duplicate.id == first.id


async def test_same_event_key_merges_and_keeps_all_sources(session):
    official = make_source(slug="ofac", name="OFAC", authority_rank=1, category="sanctions")
    press = make_source(slug="press", name="Trade Press", authority_rank=3, category="market")
    session.add_all([official, press])
    await session.flush()

    raw_press = make_raw_item(
        press, "Five tankers hit with sanctions", "https://press.com/1",
        published_at=datetime(2026, 7, 7, 12, 0, tzinfo=timezone.utc),
    )
    session.add(raw_press)
    await session.flush()

    analysis = make_analysis(confidence="Medium")
    item = await create_intelligence_item(session, analysis, raw_press, press, "High")
    await session.commit()

    # Second source reports the same event (same event_key), earlier and official.
    match = await find_matching_item(session, make_analysis())
    assert match is not None and match.id == item.id

    raw_official = make_raw_item(
        official, "Sanctions designations announced", "https://ofac.gov/2",
        published_at=datetime(2026, 7, 7, 9, 0, tzinfo=timezone.utc),
    )
    session.add(raw_official)
    await session.flush()
    await merge_into_item(session, item, raw_official, official)
    await session.commit()

    assert len(item.all_source_urls) == 2
    # Earliest source date wins
    assert item.publication_date.replace(tzinfo=timezone.utc).hour == 9
    # Most authoritative source becomes primary
    assert item.source_name == "OFAC"
    # Two reliable sources -> confidence boosted once
    assert item.confidence == "High"
    group = await session.get(DuplicateGroup, item.duplicate_group_id)
    assert group.member_count == 2
    assert group.confidence_boosted is True
    assert raw_official.status == "merged"

    # A third confirming source must not boost confidence again
    third = make_source(slug="press2", name="Other Press", authority_rank=3, category="market")
    session.add(third)
    await session.flush()
    raw_third = make_raw_item(third, "Sanctions on tankers", "https://other.com/3")
    session.add(raw_third)
    await session.flush()
    await merge_into_item(session, item, raw_third, third)
    assert item.confidence == "High"
    assert len(item.all_source_urls) == 3


async def test_near_identical_headline_same_type_matches(session):
    source = make_source()
    session.add(source)
    await session.flush()
    raw = make_raw_item(source, "VLCC rates surge on tension", "https://x.com/1")
    session.add(raw)
    await session.flush()
    analysis = make_analysis(
        headline="VLCC freight rates surge on Middle East tension",
        update_type="tanker_market",
        event_key="vlcc-rates-surge-2026-07",
    )
    await create_intelligence_item(session, analysis, raw, source, "Medium")
    await session.commit()

    similar = make_analysis(
        headline="VLCC freight rates surge on Middle East tensions",
        update_type="tanker_market",
        event_key="different-key-entirely",
    )
    match = await find_matching_item(session, similar)
    assert match is not None


async def test_alert_unique_constraint_send_once(session):
    source = make_source()
    session.add(source)
    await session.flush()
    raw = make_raw_item(source, "Alert test", "https://x.com/alert")
    session.add(raw)
    await session.flush()
    item = await create_intelligence_item(session, make_analysis(), raw, source, "High")
    user = User(telegram_user_id=42, is_approved=True)
    session.add(user)
    await session.flush()

    session.add(Alert(intelligence_item_id=item.id, user_id=user.id, alert_type="high_materiality"))
    await session.flush()
    session.add(Alert(intelligence_item_id=item.id, user_id=user.id, alert_type="high_materiality"))
    with pytest.raises(IntegrityError):
        await session.flush()
