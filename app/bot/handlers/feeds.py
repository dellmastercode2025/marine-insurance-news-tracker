"""Feed/list commands and /search."""
from __future__ import annotations

from aiogram import Router
from aiogram.filters import Command, CommandObject
from aiogram.types import Message
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.bot.formatting import chunk_message, high_item_block, items_list_message
from app.db.models import IntelligenceItem

router = Router(name="feeds")

LIST_LIMIT = 10


async def query_items(
    session: AsyncSession,
    *,
    update_types: list[str] | None = None,
    vessel_type: str | None = None,
    materiality: str | None = None,
    search: str | None = None,
    limit: int = LIST_LIMIT,
) -> list[IntelligenceItem]:
    stmt = select(IntelligenceItem)
    if update_types:
        stmt = stmt.where(IntelligenceItem.update_type.in_(update_types))
    if vessel_type:
        stmt = stmt.where(IntelligenceItem.vessel_type == vessel_type)
    if materiality:
        stmt = stmt.where(IntelligenceItem.materiality == materiality)
    if search:
        stmt = stmt.where(IntelligenceItem.search_text.like(f"%{search.lower()}%"))
    stmt = stmt.order_by(
        desc(func.coalesce(IntelligenceItem.publication_date, IntelligenceItem.detected_at))
    ).limit(limit)
    return list((await session.scalars(stmt)).all())


async def _send_list(message: Message, title: str, items: list[IntelligenceItem]) -> None:
    for chunk in chunk_message(items_list_message(title, items)):
        await message.answer(chunk, disable_web_page_preview=True)


@router.message(Command("latest"))
async def cmd_latest(message: Message, session: AsyncSession) -> None:
    items = await query_items(session)
    await _send_list(message, "Latest intelligence", items)


@router.message(Command("high"))
async def cmd_high(message: Message, session: AsyncSession) -> None:
    items = await query_items(session, materiality="High")
    if not items:
        await message.answer("No high-materiality items yet.")
        return
    blocks = [high_item_block(item) for item in items]
    for chunk in chunk_message("🚨 <b>High-materiality updates</b>\n\n" + "\n\n".join(blocks)):
        await message.answer(chunk, disable_web_page_preview=True)


@router.message(Command("sanctions"))
async def cmd_sanctions(message: Message, session: AsyncSession) -> None:
    items = await query_items(session, update_types=["sanctions", "regulation"])
    await _send_list(message, "Sanctions & compliance", items)


@router.message(Command("insurance"))
async def cmd_insurance(message: Message, session: AsyncSession) -> None:
    items = await query_items(session, update_types=["insurance", "pi", "hm", "war_risk"])
    await _send_list(message, "Marine insurance", items)


@router.message(Command("pi"))
async def cmd_pi(message: Message, session: AsyncSession) -> None:
    items = await query_items(session, update_types=["pi"])
    await _send_list(message, "P&I", items)


@router.message(Command("hm"))
async def cmd_hm(message: Message, session: AsyncSession) -> None:
    items = await query_items(session, update_types=["hm"])
    await _send_list(message, "Hull & Machinery", items)


@router.message(Command("warrisk"))
async def cmd_warrisk(message: Message, session: AsyncSession) -> None:
    items = await query_items(session, update_types=["war_risk"])
    await _send_list(message, "War risk", items)


@router.message(Command("market"))
async def cmd_market(message: Message, session: AsyncSession) -> None:
    items = await query_items(session, update_types=["tanker_market", "freight"])
    await _send_list(message, "Tanker market", items)


@router.message(Command("vlcc"))
async def cmd_vlcc(message: Message, session: AsyncSession) -> None:
    items = await query_items(session, vessel_type="VLCC")
    await _send_list(message, "VLCC", items)


@router.message(Command("aframax"))
async def cmd_aframax(message: Message, session: AsyncSession) -> None:
    items = await query_items(session, vessel_type="Aframax")
    await _send_list(message, "Aframax", items)


@router.message(Command("suezmax"))
async def cmd_suezmax(message: Message, session: AsyncSession) -> None:
    items = await query_items(session, vessel_type="Suezmax")
    await _send_list(message, "Suezmax", items)


@router.message(Command("shipbuilding"))
async def cmd_shipbuilding(message: Message, session: AsyncSession) -> None:
    items = await query_items(session, update_types=["shipbuilding"])
    await _send_list(message, "Shipbuilding (oil tankers)", items)


@router.message(Command("ports"))
async def cmd_ports(message: Message, session: AsyncSession) -> None:
    items = await query_items(session, update_types=["port", "route", "geopolitical"])
    await _send_list(message, "Port & route disruptions", items)


@router.message(Command("search"))
async def cmd_search(message: Message, session: AsyncSession, command: CommandObject) -> None:
    keyword = (command.args or "").strip()
    if not keyword:
        await message.answer(
            "Usage: /search &lt;keyword&gt;\n"
            "Search by company, vessel, IMO number, insurer, P&amp;I club, port, "
            "regulator, shipyard, country or topic."
        )
        return
    items = await query_items(session, search=keyword)
    await _send_list(message, f"Search: {keyword}", items)
