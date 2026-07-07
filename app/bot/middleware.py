"""Private-bot access control + per-update DB session.

The bot is private by default: only Telegram user IDs listed in
ADMIN_TELEGRAM_USER_IDS, or users an admin has approved with /approve,
may interact. Everyone else receives an access-restricted message.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery, Message, TelegramObject
from sqlalchemy import select

from app.config import get_settings
from app.db.engine import get_session_factory
from app.db.models import Subscription, SubscriptionTopic, User

log = logging.getLogger(__name__)

ACCESS_DENIED_TEXT = (
    "Access restricted. Please contact the administrator.\n"
    "Доступ ограничен. Обратитесь к администратору."
)

DEFAULT_TOPICS_ON = [topic.value for topic in SubscriptionTopic]


async def ensure_default_subscriptions(session, user: User) -> None:
    existing = {
        s.topic
        for s in (
            await session.scalars(select(Subscription).where(Subscription.user_id == user.id))
        ).all()
    }
    for topic in DEFAULT_TOPICS_ON:
        if topic not in existing:
            session.add(Subscription(user_id=user.id, topic=topic, enabled=True))


class AccessControlMiddleware(BaseMiddleware):
    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        tg_user = data.get("event_from_user")
        if tg_user is None:
            return None

        settings = get_settings()
        session_factory = get_session_factory()
        async with session_factory() as session:
            user = await session.scalar(
                select(User).where(User.telegram_user_id == tg_user.id)
            )
            is_admin = tg_user.id in settings.admin_ids

            if user is None:
                user = User(
                    telegram_user_id=tg_user.id,
                    username=tg_user.username,
                    first_name=tg_user.first_name,
                    is_admin=is_admin,
                    is_approved=is_admin,
                    language_code=tg_user.language_code,
                )
                session.add(user)
                await session.flush()
                if is_admin:
                    await ensure_default_subscriptions(session, user)
                await session.commit()
            else:
                user.is_admin = is_admin or user.is_admin
                user.username = tg_user.username
                user.last_seen_at = datetime.now(timezone.utc)
                if is_admin and not user.is_approved:
                    user.is_approved = True
                    await ensure_default_subscriptions(session, user)
                await session.commit()

            if not (user.is_admin or user.is_approved):
                log.info("Denied access to telegram user %s (@%s)", tg_user.id, tg_user.username)
                if isinstance(event, Message):
                    await event.answer(ACCESS_DENIED_TEXT)
                elif isinstance(event, CallbackQuery):
                    await event.answer(ACCESS_DENIED_TEXT, show_alert=True)
                return None

            data["session"] = session
            data["db_user"] = user
            return await handler(event, data)
