from app.pipeline.materiality import apply_materiality_rules, boost_confidence

from tests.conftest import make_analysis


def test_official_sanctions_floor_high():
    analysis = make_analysis(
        update_type="sanctions",
        classification="Official legal/regulatory information",
        materiality="Low",
    )
    assert apply_materiality_rules(analysis) == "High"


def test_war_risk_floor_high():
    analysis = make_analysis(update_type="war_risk", materiality="Medium")
    assert apply_materiality_rules(analysis) == "High"


def test_official_pi_circular_floor_high():
    analysis = make_analysis(
        update_type="pi",
        classification="Official legal/regulatory information",
        materiality="Medium",
    )
    assert apply_materiality_rules(analysis) == "High"


def test_market_interpretation_keeps_ai_level():
    analysis = make_analysis(
        update_type="tanker_market",
        classification="Market interpretation",
        materiality="Medium",
        headline="Analysts expect firmer VLCC rates",
        summary="Commentary on rate direction.",
    )
    assert apply_materiality_rules(analysis) == "Medium"


def test_rumor_never_high():
    analysis = make_analysis(
        update_type="tanker_market",
        classification="Rumor or unverified",
        materiality="High",
        headline="Unconfirmed report of major charter deal",
        summary="Rumored fixture.",
    )
    assert apply_materiality_rules(analysis) == "Medium"


def test_enforcement_vocabulary_floors_confirmed_items():
    analysis = make_analysis(
        update_type="geopolitical",
        classification="Confirmed fact",
        materiality="Low",
        headline="Authorities seize tanker over sanctions enforcement",
        summary="A tanker was detained in an enforcement action.",
    )
    assert apply_materiality_rules(analysis) == "High"


def test_confidence_boost_caps_at_high():
    assert boost_confidence("Low") == "Medium"
    assert boost_confidence("Medium") == "High"
    assert boost_confidence("High") == "High"
