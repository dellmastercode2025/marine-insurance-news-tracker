"""/subscribe, /settings, /unsubscribe — inline-keyboard topic toggles."""
from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot.middleware import ensure_default_subscriptions
from app.db.models import Subscription, SubscriptionTopic, User

router = Router(name="subscriptions")

TOPIC_LABELS: dict[str, str] = {
    SubscriptionTopic.URGENT_HIGH.value: "🚨 Urgent high-materiality alerts",
    SubscriptionTopic.DAILY_BRIEF.value: "📄 Daily briefing",
    SubscriptionTopic.WEEKLY_REPORT.value: "📊 Weekly report",
    SubscriptionTopic.SANCTIONS.value: "⚖️ Sanctions",
    SubscriptionTopic.PI.value: "🛡 P&I",
    SubscriptionTopic.HM.value: "🔧 Hull & Machinery",
    SubscriptionTopic.WAR_RISK.value: "💥 War risk",
    SubscriptionTopic.TANKER_MARKET.value: "🛢 Oil tanker market",
    SubscriptionTopic.VLCC.value: "🚢 VLCC",
    SubscriptionTopic.AFRAMAX.value: "🚢 Aframax",
    SubscriptionTopic.SUEZMAX.value: "🚢 Suezmax",
    SubscriptionTopic.SHIPBUILDING.value: "🏗 Shipbuilding",
    SubscriptionTopic.PORT_DISRUPTION.value: "⚓ Port disruption",
    SubscriptionTopic.FREIGHT.value: "📈 Freight market",
    SubscriptionTopic.ROUTE_DISRUPTION.value: "🗺 Route disruption",
    SubscriptionTopic.GEOPOLITICAL.value: "🌍 Geopolitical risk",
}


async def _subscription_map(session: AsyncSession, user: User) -> dict[str, Subscription]:
    await ensure_default_subscriptions(session, user)
    await session.commit()
    subs = (
        await session.scalars(select(Subscription).where(Subscription.user_id == user.id))
    ).all()
    return {s.topic: s for s in subs}


def _keyboard(subs: dict[str, Subscription]) -> InlineKeyboardMarkup:
    rows = []
    for topic, label in TOPIC_LABELS.items():
        enabled = subs[topic].enabled if topic in subs else False
        mark = "✅" if enabled else "☐"
        rows.append(
            [InlineKeyboardButton(text=f"{mark} {label}", callback_data=f"sub:{topic}")]
        )
    return InlineKeyboardMarkup(inline_keyboard=rows)


SETTINGS_TEXT = (
    "<b>Alert preferences</b>\n\n"
    "Tap a topic to toggle it. Urgent alerts are sent only for High-materiality "
    "items in topics you keep enabled."
)


@router.message(Command("settings"))
@router.message(Command("subscribe"))
async def cmd_settings(message: Message, session: AsyncSession, db_user: User) -> None:
    subs = await _subscription_map(session, db_user)
    await message.answer(SETTINGS_TEXT, reply_markup=_keyboard(subs))


@router.message(Command("unsubscribe"))
async def cmd_unsubscribe(message: Message, session: AsyncSession, db_user: User) -> None:
    subs = await _subscription_map(session, db_user)
    for topic in (
        SubscriptionTopic.URGENT_HIGH.value,
        SubscriptionTopic.DAILY_BRIEF.value,
        SubscriptionTopic.WEEKLY_REPORT.value,
    ):
        if topic in subs:
            subs[topic].enabled = False
    await session.commit()
    await message.answer(
        "Alerts disabled (urgent alerts, daily briefing, weekly report). "
        "Use /settings to re-enable at any time."
    )


@router.callback_query(F.data.startswith("sub:"))
async def cb_toggle(callback: CallbackQuery, session: AsyncSession, db_user: User) -> None:
    topic = callback.data.split(":", 1)[1]
    if topic not in TOPIC_LABELS:
        await callback.answer("Unknown topic")
        return
    subs = await _subscription_map(session, db_user)
    sub = subs.get(topic)
    if sub is None:
        sub = Subscription(user_id=db_user.id, topic=topic, enabled=True)
        session.add(sub)
        subs[topic] = sub
    else:
        sub.enabled = not sub.enabled
    await session.commit()
    if callback.message:
        await callback.message.edit_reply_markup(reply_markup=_keyboard(subs))
    await callback.answer(
        f"{TOPIC_LABELS[topic]}: {'on' if sub.enabled else 'off'}"
    )
