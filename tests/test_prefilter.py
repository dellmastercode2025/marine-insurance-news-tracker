from app.pipeline.prefilter import prefilter


def test_lng_items_are_excluded():
    result = prefilter("Samsung wins order for six LNG carriers", None, "shipbuilding")
    assert not result.passed
    assert "lng" in result.reason


def test_natural_gas_excluded():
    result = prefilter("Natural gas pipeline project approved", None, "market")
    assert not result.passed


def test_gas_carrier_excluded_even_with_shipping_words():
    result = prefilter("Shipyard delivers new gas carrier to owner", None, "shipbuilding")
    assert not result.passed


def test_lng_item_rescued_by_tanker_context():
    # Mixed story: mentions LNG but is about crude tankers
    result = prefilter(
        "Owner swaps LNG newbuild slots for VLCC crude oil tanker orders", None, "shipbuilding"
    )
    assert result.passed


def test_vlcc_market_news_passes():
    assert prefilter("VLCC freight rate surge on Middle East tension", None, "market").passed


def test_pi_insurance_news_passes():
    assert prefilter("P&I club issues circular on war risk cover", None, "insurance").passed


def test_container_news_excluded():
    result = prefilter("Container line orders ten boxships", None, "market")
    assert not result.passed


def test_generic_news_below_threshold():
    result = prefilter("Company announces quarterly earnings", None, "market")
    assert not result.passed


def test_trusted_sanctions_source_low_bar():
    result = prefilter(
        "OFAC issues General License 8", "Authorizes certain oil transactions", "sanctions"
    )
    assert result.passed


def test_trusted_source_without_maritime_signal_rejected():
    result = prefilter(
        "Treasury announces new appointments", "Personnel changes at department", "sanctions"
    )
    assert not result.passed


def test_snippet_contributes_to_score():
    result = prefilter(
        "Market wrap",
        "Aframax and Suezmax freight rates firmed in the Mediterranean",
        "market",
    )
    assert result.passed
