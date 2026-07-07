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
    SubscriptionTopic.URGENT_HIGH.value: "🚨 Срочные уведомления (High)",
    SubscriptionTopic.DAILY_BRIEF.value: "📄 Ежедневная сводка",
    SubscriptionTopic.WEEKLY_REPORT.value: "📊 Еженедельный отчет",
    SubscriptionTopic.SANCTIONS.value: "⚖️ Санкции",
    SubscriptionTopic.PI.value: "🛡 P&I",
    SubscriptionTopic.HM.value: "🔧 Hull & Machinery",
    SubscriptionTopic.WAR_RISK.value: "💥 Военные риски",
    SubscriptionTopic.TANKER_MARKET.value: "🛢 Рынок нефтяных танкеров",
    SubscriptionTopic.VLCC.value: "🚢 VLCC",
    SubscriptionTopic.AFRAMAX.value: "🚢 Aframax",
    SubscriptionTopic.SUEZMAX.value: "🚢 Suezmax",
    SubscriptionTopic.SHIPBUILDING.value: "🏗 Судостроение",
    SubscriptionTopic.PORT_DISRUPTION.value: "⚓ Портовые сбои",
    SubscriptionTopic.FREIGHT.value: "📈 Фрахтовый рынок",
    SubscriptionTopic.ROUTE_DISRUPTION.value: "🗺 Маршрутные сбои",
    SubscriptionTopic.GEOPOLITICAL.value: "🌍 Геополитические риски",
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
    "<b>Настройка уведомлений</b>\n\n"
    "Нажмите на тему, чтобы включить или отключить ее. Срочные уведомления "
    "отправляются только по событиям высокой существенности (High) в включенных темах."
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
        "Уведомления отключены (срочные уведомления, ежедневная сводка, "
        "еженедельный отчет). Включить снова можно в /settings."
    )


@router.callback_query(F.data.startswith("sub:"))
async def cb_toggle(callback: CallbackQuery, session: AsyncSession, db_user: User) -> None:
    topic = callback.data.split(":", 1)[1]
    if topic not in TOPIC_LABELS:
        await callback.answer("Неизвестная тема")
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
        f"{TOPIC_LABELS[topic]}: {'вкл' if sub.enabled else 'выкл'}"
    )
