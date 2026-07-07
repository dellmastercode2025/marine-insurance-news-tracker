"""High-materiality alert dispatch.

Only High items trigger urgent alerts. The alerts table's unique constraint
(intelligence_item_id, user_id, alert_type) guarantees each user is alerted at
most once per intelligence item, including across duplicate-group merges.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Alert, IntelligenceItem, Subscription, SubscriptionTopic, User
from app.bot.formatting import high_alert_message

log = logging.getLogger(__name__)

# Map an item's update_type / vessel_type to subscription topics.
UPDATE_TYPE_TOPICS = {
    "sanctions": [SubscriptionTopic.SANCTIONS],
    "regulation": [SubscriptionTopic.SANCTIONS],
    "insurance": [SubscriptionTopic.PI, SubscriptionTopic.HM, SubscriptionTopic.WAR_RISK],
    "pi": [SubscriptionTopic.PI],
    "hm": [SubscriptionTopic.HM],
    "war_risk": [SubscriptionTopic.WAR_RISK],
    "tanker_market": [SubscriptionTopic.TANKER_MARKET],
    "freight": [SubscriptionTopic.FREIGHT, SubscriptionTopic.TANKER_MARKET],
    "shipbuilding": [SubscriptionTopic.SHIPBUILDING],
    "port": [SubscriptionTopic.PORT_DISRUPTION],
    "route": [SubscriptionTopic.ROUTE_DISRUPTION],
    "geopolitical": [SubscriptionTopic.GEOPOLITICAL],
}

VESSEL_TYPE_TOPICS = {
    "VLCC": SubscriptionTopic.VLCC,
    "Aframax": SubscriptionTopic.AFRAMAX,
    "Suezmax": SubscriptionTopic.SUEZMAX,
}


def topics_for_item(item: IntelligenceItem) -> set[str]:
    topics = {t.value for t in UPDATE_TYPE_TOPICS.get(item.update_type, [])}
    vessel_topic = VESSEL_TYPE_TOPICS.get(item.vessel_type)
    if vessel_topic:
        topics.add(vessel_topic.value)
    return topics


async def send_high_alert(session: AsyncSession, item: IntelligenceItem) -> int:
    """Send the alert to every eligible user. Returns number of alerts sent."""
    from app.bot.bot import get_bot  # deferred: pipeline can run without a bot

    bot = get_bot()
    if bot is None:
        log.info("No bot instance available — skipping alert for item %s", item.id)
        return 0

    item_topics = topics_for_item(item)
    users = (
        await session.scalars(
            select(User).where(User.is_active.is_(True), User.is_approved.is_(True))
        )
    ).all()

    sent = 0
    text = high_alert_message(item)
    for user in users:
        subs = {
            s.topic: s.enabled
            for s in (
                await session.scalars(
                    select(Subscription).where(Subscription.user_id == user.id)
                )
            ).all()
        }
        if not subs.get(SubscriptionTopic.URGENT_HIGH.value, False):
            continue
        # Topic filter: skip if the user disabled every topic this item maps to.
        if item_topics and not any(subs.get(t, False) for t in item_topics):
            continue

        alert = Alert(
            intelligence_item_id=item.id,
            user_id=user.id,
            alert_type="high_materiality",
            status="sent",
        )
        session.add(alert)
        try:
            await session.flush()  # unique constraint = send-once guard
        except IntegrityError:
            await session.rollback()
            continue

        try:
            message = await bot.send_message(
                user.telegram_user_id, text, disable_web_page_preview=True
            )
            alert.sent_at = datetime.now(timezone.utc)
            alert.telegram_message_id = message.message_id
            sent += 1
        except Exception as exc:  # noqa: BLE001 - one blocked user must not stop the rest
            alert.status = "failed"
            log.warning("Alert send failed to user %s: %s", user.telegram_user_id, exc)
        await session.commit()
        await asyncio.sleep(0.05)  # stay under Telegram rate limits
    return sent
