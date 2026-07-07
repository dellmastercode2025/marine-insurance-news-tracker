"""Load demo intelligence data so bot commands show output immediately.

Usage:  python -m scripts.seed_sample_data
Safe to re-run (skips if sample data already present). Uses DATABASE_URL.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.ai.schemas import (
    AnalysisResult,
    EntityBundle,
    InsuranceImplications,
    TranslationResult,
)
from app.ai.translator import apply_translation
from app.db.engine import get_session_factory, init_db
from app.db.models import MonitoringRun, RawItem, Source
from app.db.seed import seed_sources
from app.pipeline.materiality import apply_materiality_rules
from app.pipeline.normalize import normalize_title, sha256_hex, simhash64
from app.pipeline.store import create_intelligence_item

NOW = datetime.now(timezone.utc)


def _entities(**kw) -> EntityBundle:
    base = dict(
        companies=[], vessels=[], imo_numbers=[], shipowners=[], operators=[],
        charterers=[], insurers=[], pi_clubs=[], brokers=[], regulators=[],
        ports=[], shipyards=[], countries=[],
    )
    base.update(kw)
    return EntityBundle(**base)


def _insurance(pi="not available in source", hm="not available in source",
               war_risk="not available in source", cargo="not available in source"):
    return InsuranceImplications(pi=pi, hm=hm, war_risk=war_risk, cargo=cargo)


SAMPLES: list[dict] = [
    dict(
        title="OFAC designates 14 shadow-fleet tankers carrying Russian crude",
        url="https://example.org/sample/ofac-shadow-fleet",
        hours_ago=3,
        analysis=dict(
            headline="OFAC designates 14 shadow-fleet tankers carrying Russian crude",
            summary="OFAC added 14 crude tankers (mostly Aframax and Suezmax) to the SDN list "
            "for transporting Russian oil above the price cap. Two management companies in "
            "the UAE were also designated.",
            key_facts=[
                "14 tankers designated (Aframax/Suezmax)",
                "Two UAE-based managers designated",
                "Price-cap violation cited as basis",
            ],
            update_type="sanctions",
            vessel_type="Aframax",
            region="Black Sea",
            country="United States",
            sector="Oil transportation",
            original_language="en",
            materiality="High",
            confidence="High",
            classification="Official legal/regulatory information",
            entities=_entities(
                vessels=["SAMPLE VOYAGER", "SAMPLE PIONEER"],
                imo_numbers=["9700001", "9700002"],
                regulators=["OFAC", "US Treasury"],
                countries=["United States", "Russia", "United Arab Emirates"],
            ),
            why_it_matters="Designated tankers lose access to Western insurance, ports and "
            "services; counterparties risk secondary sanctions exposure.",
            impact_on_oil_transportation="Removes ~1.5m dwt from sanctioned-trade capacity; "
            "tightens Aframax availability in the Black Sea.",
            insurance_implications=_insurance(
                pi="P&I cover terminates for designated vessels under sanctions clauses",
                war_risk="not available in source",
            ),
            sanctions_compliance_implications="Immediate screening of counterparties and "
            "chartered tonnage against the new SDN entries is required.",
            practical_business_implications="Fixtures involving listed managers must be "
            "reviewed; payments may be blocked.",
            recommended_review_points=[
                "Screen fleet and counterparty lists against new SDN entries",
                "Check open charters for designated managers",
            ],
            report_tables=[],
            event_key="sample-ofac-shadow-fleet-designation",
        ),
    ),
    dict(
        title="Joint War Committee expands Red Sea listed area after tanker attack",
        url="https://example.org/sample/jwc-red-sea",
        hours_ago=8,
        analysis=dict(
            headline="Joint War Committee expands Red Sea listed area after tanker attack",
            summary="The Joint War Committee widened the Red Sea/Gulf of Aden listed area "
            "following a missile attack on a product tanker, triggering additional war risk "
            "premium notifications for transits.",
            key_facts=["Listed area expanded", "Product tanker attacked", "AP notifications required"],
            update_type="war_risk",
            vessel_type="Product Tanker",
            region="Red Sea",
            country=None,
            sector="Marine insurance",
            original_language="en",
            materiality="High",
            confidence="High",
            classification="Confirmed fact",
            entities=_entities(
                insurers=["Joint War Committee"],
                ports=[],
                countries=["Yemen"],
            ),
            why_it_matters="War risk additional premiums for Red Sea transits will rise; "
            "some owners may reroute via the Cape, extending tonne-miles.",
            impact_on_oil_transportation="Longer routes and higher costs for product flows "
            "between the Gulf and Europe.",
            insurance_implications=_insurance(
                war_risk="Additional premium and 48-hour notification now apply to the wider area",
                hm="H&M underwriters may follow with trading warranties",
            ),
            sanctions_compliance_implications="not available in source",
            practical_business_implications="Voyage cost calculations and CP war risk clauses "
            "need updating for affected fixtures.",
            recommended_review_points=[
                "Review war risk AP terms for Red Sea transits",
                "Check charter party war risk clauses (CONWARTIME/VOYWAR)",
            ],
            report_tables=[],
            event_key="sample-jwc-red-sea-expansion",
        ),
    ),
    dict(
        title="VLCC rates jump 25% as Middle East fixing accelerates",
        url="https://example.org/sample/vlcc-rates",
        hours_ago=12,
        analysis=dict(
            headline="VLCC rates jump 25% as Middle East fixing accelerates",
            summary="VLCC spot earnings on MEG-China rose about 25% week-on-week on heavy "
            "fixing activity and tightening position lists.",
            key_facts=["MEG-China TCE up ~25% w/w", "Position list tightening"],
            update_type="freight",
            vessel_type="VLCC",
            region="Persian Gulf",
            country=None,
            sector="Tanker market",
            original_language="en",
            materiality="Medium",
            confidence="Medium",
            classification="Market interpretation",
            entities=_entities(),
            why_it_matters="Sustained VLCC strength lifts the whole crude tanker complex and "
            "signals firm crude demand into Asia.",
            impact_on_oil_transportation="Higher freight costs for long-haul crude movements.",
            insurance_implications=_insurance(),
            sanctions_compliance_implications="not available in source",
            practical_business_implications="Charterers should expect firmer offers; owners "
            "may hold tonnage for better rates.",
            recommended_review_points=["Reassess freight budgets for Q3 VLCC liftings"],
            report_tables=[],
            event_key="sample-vlcc-rates-jump",
        ),
    ),
    dict(
        title="Korean yard books six Suezmax newbuilds for 2028 delivery",
        url="https://example.org/sample/suezmax-order",
        hours_ago=30,
        analysis=dict(
            headline="Korean yard books six Suezmax newbuilds for 2028 delivery",
            summary="A Korean shipyard signed six Suezmax crude carriers for 2028 delivery; "
            "the order takes the Suezmax orderbook to about 12% of the trading fleet.",
            key_facts=["Six Suezmax newbuilds ordered", "Delivery 2028", "Orderbook ~12% of fleet"],
            update_type="shipbuilding",
            vessel_type="Suezmax",
            region="Asia",
            country="South Korea",
            sector="Shipbuilding",
            original_language="en",
            materiality="Medium",
            confidence="High",
            classification="Confirmed fact",
            entities=_entities(shipyards=["Sample Heavy Industries"], countries=["South Korea"]),
            why_it_matters="Growing orderbook adds medium-term supply pressure to the Suezmax "
            "segment from 2028.",
            impact_on_oil_transportation="No near-term effect; fleet capacity grows from 2028.",
            insurance_implications=_insurance(),
            sanctions_compliance_implications="not available in source",
            practical_business_implications="Owners weighing Suezmax orders face longer "
            "berth queues and firm newbuild prices.",
            recommended_review_points=["Track Suezmax orderbook-to-fleet ratio quarterly"],
            report_tables=[],
            event_key="sample-suezmax-newbuild-order",
        ),
    ),
    dict(
        title="P&I club issues circular on sanctions compliance for tanker STS operations",
        url="https://example.org/sample/pi-circular-sts",
        hours_ago=50,
        analysis=dict(
            headline="P&I club issues circular on sanctions compliance for tanker STS operations",
            summary="A major P&I club circulated updated due-diligence expectations for "
            "ship-to-ship transfers involving crude cargoes, including AIS continuity checks.",
            key_facts=["Updated STS due-diligence guidance", "AIS continuity checks expected"],
            update_type="pi",
            vessel_type="Other Oil Tanker",
            region=None,
            country=None,
            sector="Marine insurance",
            original_language="en",
            materiality="High",
            confidence="High",
            classification="Official legal/regulatory information",
            entities=_entities(pi_clubs=["Sample P&I Club"]),
            why_it_matters="Cover may be prejudiced where STS due diligence is not documented; "
            "club expectations become de facto market standard.",
            impact_on_oil_transportation="Extra documentation burden for STS-heavy trades.",
            insurance_implications=_insurance(
                pi="Failure to follow guidance may prejudice P&I cover for STS incidents"
            ),
            sanctions_compliance_implications="Clubs align cover with sanctions due diligence; "
            "AIS gaps become a cover risk.",
            practical_business_implications="Operations teams must retain STS risk assessments "
            "and AIS records.",
            recommended_review_points=["Update STS SOPs to match club guidance"],
            report_tables=[],
            event_key="sample-pi-circular-sts",
        ),
    ),
    dict(
        title="Turkish Straits transits delayed up to 5 days by fog and inspection backlog",
        url="https://example.org/sample/turkish-straits-delays",
        hours_ago=70,
        analysis=dict(
            headline="Turkish Straits transits delayed up to 5 days by fog and inspection backlog",
            summary="Tanker transits through the Bosphorus face delays of 3-5 days due to fog "
            "closures and a P&I confirmation-letter inspection backlog.",
            key_facts=["3-5 day Bosphorus delays", "Fog closures", "Letter checks add queue time"],
            update_type="port",
            vessel_type="Suezmax",
            region="Turkish Straits",
            country="Turkey",
            sector="Oil transportation",
            original_language="en",
            materiality="Medium",
            confidence="Medium",
            classification="Confirmed fact",
            entities=_entities(ports=["Istanbul (Bosphorus)"], countries=["Turkey"]),
            why_it_matters="Delays tie up tonnage and add demurrage exposure on Black Sea "
            "crude and CPC liftings.",
            impact_on_oil_transportation="Effective supply reduction for Suezmax/Aframax in "
            "the Black Sea basin while queues persist.",
            insurance_implications=_insurance(),
            sanctions_compliance_implications="not available in source",
            practical_business_implications="Laycan planning and demurrage provisions need "
            "buffer for strait delays.",
            recommended_review_points=["Add transit-delay buffers to Black Sea voyage plans"],
            report_tables=[],
            event_key="sample-turkish-straits-delays",
        ),
    ),
]


RU_TRANSLATIONS: dict[str, dict] = {
    "sample-ofac-shadow-fleet-designation": dict(
        headline_ru="OFAC вносит в санкционный список 14 танкеров теневого флота с российской нефтью",
        summary_ru="OFAC добавил в список SDN 14 нефтяных танкеров (преимущественно Aframax и "
        "Suezmax) за перевозку российской нефти выше ценового потолка. Также внесены две "
        "судоходные управляющие компании из ОАЭ.",
        key_facts_ru=[
            "Внесено 14 танкеров (Aframax/Suezmax)",
            "Внесены два менеджера из ОАЭ",
            "Основание — нарушение ценового потолка",
        ],
        why_it_matters_ru="Внесенные танкеры теряют доступ к западному страхованию, портам и "
        "услугам; контрагенты несут риск вторичных санкций.",
        impact_on_oil_transportation_ru="Выводит около 1,5 млн dwt из тоннажа для подсанкционных "
        "перевозок; сокращает доступность Aframax в Черном море.",
        impact_on_pi_ru="Покрытие P&I прекращается для внесенных судов согласно санкционным оговоркам",
        impact_on_hm_ru="не указано в источнике",
        impact_on_war_risk_ru="не указано в источнике",
        sanctions_or_compliance_implications_ru="Требуется немедленная проверка контрагентов и "
        "зафрахтованного тоннажа по новым записям SDN.",
        practical_business_implications_ru="Сделки с внесенными менеджерами требуют пересмотра; "
        "платежи могут быть заблокированы.",
        recommended_review_points_ru=[
            "Проверить флот и списки контрагентов по новым записям SDN",
            "Проверить действующие чартеры на участие внесенных менеджеров",
        ],
    ),
    "sample-jwc-red-sea-expansion": dict(
        headline_ru="JWC расширяет зону военных рисков в Красном море после атаки на танкер",
        summary_ru="Joint War Committee (JWC) расширил зону повышенного риска в Красном море и "
        "Аденском заливе после ракетной атаки на продуктовый танкер; для транзитов требуется "
        "уведомление и дополнительная премия по военным рискам.",
        key_facts_ru=["Зона расширена", "Атакован продуктовый танкер", "Требуются уведомления и AP"],
        why_it_matters_ru="Дополнительные премии по военным рискам для транзитов через Красное море "
        "вырастут; часть судовладельцев может перенаправить суда вокруг мыса Доброй Надежды.",
        impact_on_oil_transportation_ru="Удлинение маршрутов и рост затрат для перевозок "
        "нефтепродуктов между Заливом и Европой.",
        impact_on_pi_ru="не указано в источнике",
        impact_on_hm_ru="Страховщики H&M могут ввести навигационные ограничения (warranties)",
        impact_on_war_risk_ru="Для расширенной зоны действуют дополнительная премия и "
        "уведомление за 48 часов",
        sanctions_or_compliance_implications_ru="не указано в источнике",
        practical_business_implications_ru="Необходимо обновить расчеты рейсовых затрат и "
        "оговорки о военных рисках в чартерах.",
        recommended_review_points_ru=[
            "Проверить условия AP по военным рискам для транзитов через Красное море",
            "Проверить оговорки CONWARTIME/VOYWAR в чартерах",
        ],
    ),
    "sample-vlcc-rates-jump": dict(
        headline_ru="Ставки VLCC выросли на 25% на фоне активного фрахтования на Ближнем Востоке",
        summary_ru="Спотовые доходы VLCC на направлении Персидский залив — Китай выросли примерно "
        "на 25% за неделю на фоне высокой активности фрахтования и сокращения списка свободных судов.",
        key_facts_ru=["TCE Персидский залив — Китай +25% за неделю", "Список свободных судов сокращается"],
        why_it_matters_ru="Устойчивый рост в сегменте VLCC поддерживает весь рынок нефтяных танкеров "
        "и указывает на уверенный спрос на нефть в Азии.",
        impact_on_oil_transportation_ru="Рост фрахтовых затрат на дальнемагистральные перевозки нефти.",
        impact_on_pi_ru="не указано в источнике",
        impact_on_hm_ru="не указано в источнике",
        impact_on_war_risk_ru="не указано в источнике",
        sanctions_or_compliance_implications_ru="не указано в источнике",
        practical_business_implications_ru="Фрахтователям следует ожидать более высоких ставок; "
        "судовладельцы могут придерживать тоннаж.",
        recommended_review_points_ru=["Пересмотреть фрахтовые бюджеты на погрузки VLCC в 3 квартале"],
    ),
    "sample-suezmax-newbuild-order": dict(
        headline_ru="Корейская верфь получила заказ на шесть новостроев Suezmax с поставкой в 2028 году",
        summary_ru="Корейская верфь подписала контракт на шесть танкеров Suezmax с поставкой в 2028 "
        "году; портфель заказов Suezmax достигает около 12% действующего флота.",
        key_facts_ru=["Заказано шесть новостроев Suezmax", "Поставка в 2028 году", "Портфель заказов ~12% флота"],
        why_it_matters_ru="Рост портфеля заказов создает среднесрочное давление предложения в "
        "сегменте Suezmax с 2028 года.",
        impact_on_oil_transportation_ru="Краткосрочного эффекта нет; вместимость флота растет с 2028 года.",
        impact_on_pi_ru="не указано в источнике",
        impact_on_hm_ru="не указано в источнике",
        impact_on_war_risk_ru="не указано в источнике",
        sanctions_or_compliance_implications_ru="не указано в источнике",
        practical_business_implications_ru="Для новых заказов Suezmax — длинные очереди стапелей и "
        "высокие цены на новострои.",
        recommended_review_points_ru=["Ежеквартально отслеживать отношение портфеля заказов Suezmax к флоту"],
    ),
    "sample-pi-circular-sts": dict(
        headline_ru="Клуб P&I выпустил циркуляр о санкционном комплаенсе при STS-операциях танкеров",
        summary_ru="Крупный клуб P&I разослал обновленные требования к due diligence при перевалке "
        "нефти с судна на судно (STS), включая проверку непрерывности сигнала AIS.",
        key_facts_ru=["Обновлены требования к due diligence при STS", "Ожидается проверка непрерывности AIS"],
        why_it_matters_ru="Покрытие может быть поставлено под сомнение при недокументированном "
        "due diligence по STS; ожидания клуба становятся фактическим рыночным стандартом.",
        impact_on_oil_transportation_ru="Дополнительная документарная нагрузка для перевозок с "
        "интенсивными STS-операциями.",
        impact_on_pi_ru="Несоблюдение рекомендаций может поставить под угрозу покрытие P&I при "
        "инцидентах во время STS",
        impact_on_hm_ru="не указано в источнике",
        impact_on_war_risk_ru="не указано в источнике",
        sanctions_or_compliance_implications_ru="Клубы увязывают покрытие с санкционным due "
        "diligence; разрывы AIS становятся риском для покрытия.",
        practical_business_implications_ru="Операционные службы должны хранить оценки рисков STS "
        "и записи AIS.",
        recommended_review_points_ru=["Обновить процедуры STS в соответствии с рекомендациями клуба"],
    ),
    "sample-turkish-straits-delays": dict(
        headline_ru="Задержки транзита через Турецкие проливы достигают 5 суток из-за тумана и проверок",
        summary_ru="Транзиты танкеров через Босфор задерживаются на 3–5 суток из-за закрытий по "
        "туману и очереди на проверку подтверждающих писем P&I.",
        key_facts_ru=["Задержки в Босфоре 3–5 суток", "Закрытия из-за тумана", "Проверки писем удлиняют очередь"],
        why_it_matters_ru="Задержки связывают тоннаж и увеличивают риск демереджа по отгрузкам "
        "черноморской нефти и CPC.",
        impact_on_oil_transportation_ru="Фактическое сокращение предложения Suezmax/Aframax в "
        "Черноморском бассейне на время очередей.",
        impact_on_pi_ru="не указано в источнике",
        impact_on_hm_ru="не указано в источнике",
        impact_on_war_risk_ru="не указано в источнике",
        sanctions_or_compliance_implications_ru="не указано в источнике",
        practical_business_implications_ru="Планирование лейкенов и условия демереджа требуют "
        "запаса на задержки в проливах.",
        recommended_review_points_ru=["Заложить буфер на транзитные задержки в рейсовые планы по Черному морю"],
    ),
}


async def main() -> None:
    await init_db()
    factory = get_session_factory()
    async with factory() as session:
        await seed_sources(session)

        existing = await session.scalar(
            select(RawItem.id).where(RawItem.url.like("https://example.org/sample/%")).limit(1)
        )
        if existing:
            print("Sample data already present — nothing to do.")
            return

        demo_source = await session.scalar(select(Source).where(Source.slug == "sample-demo"))
        if demo_source is None:
            demo_source = Source(
                name="Sample Demo Source",
                slug="sample-demo",
                url="https://example.org/sample",
                fetch_method="rss",
                category="market",
                authority_rank=3,
                enabled=False,  # never fetched — demo data only
            )
            session.add(demo_source)
            await session.flush()

        run = MonitoringRun(trigger="manual", status="success", sources_checked=1)
        session.add(run)

        for sample in SAMPLES:
            published = NOW - timedelta(hours=sample["hours_ago"])
            norm = normalize_title(sample["title"])
            raw = RawItem(
                source_id=demo_source.id,
                url=sample["url"],
                canonical_url_hash=sha256_hex(sample["url"]),
                title=sample["title"],
                title_norm_hash=sha256_hex(norm),
                title_simhash=str(simhash64(norm)),
                snippet=sample["analysis"]["summary"],
                published_at=published,
                language="en",
                status="analyzed",
            )
            session.add(raw)
            await session.flush()

            analysis = AnalysisResult(is_relevant=True, rejection_reason=None, **sample["analysis"])
            materiality = apply_materiality_rules(analysis)
            item = await create_intelligence_item(session, analysis, raw, demo_source, materiality)
            item.detected_at = published
            translation_fields = RU_TRANSLATIONS.get(sample["analysis"]["event_key"])
            if translation_fields:
                apply_translation(item, TranslationResult(**translation_fields))
            run.items_fetched += 1
            run.items_new += 1
            counter = {"High": "items_high", "Medium": "items_medium", "Low": "items_low"}[materiality]
            setattr(run, counter, getattr(run, counter) + 1)

        run.finished_at = NOW
        await session.commit()
        print(f"Seeded {len(SAMPLES)} sample intelligence items.")


if __name__ == "__main__":
    asyncio.run(main())
