import pytest
from pydantic import ValidationError

from app.ai.analyzer import AnalysisFailed, analyze_raw_item
from app.ai.client import LLMError
from app.ai.schemas import AnalysisResult

from tests.conftest import FakeLLM, make_analysis, make_raw_item, make_source


def test_valid_analysis_parses():
    analysis = make_analysis()
    assert analysis.update_type == "sanctions"
    assert analysis.vessel_type == "Suezmax"
    assert analysis.classification == "Official legal/regulatory information"


def test_invalid_materiality_rejected():
    with pytest.raises(ValidationError):
        make_analysis(materiality="Critical")


def test_invalid_vessel_type_rejected():
    with pytest.raises(ValidationError):
        make_analysis(vessel_type="LNG Carrier")


def test_invalid_update_type_rejected():
    with pytest.raises(ValidationError):
        make_analysis(update_type="lng_market")


def test_schema_has_all_required_fields():
    schema = AnalysisResult.model_json_schema()
    assert set(schema["properties"]) == set(schema["required"])  # OpenAI strict mode


async def test_analyzer_retries_once_then_succeeds(session):
    source = make_source()
    session.add(source)
    await session.flush()
    item = make_raw_item(source, "VLCC rates surge", "https://example.com/a")
    session.add(item)
    await session.flush()

    fake = FakeLLM(results=[LLMError("malformed"), make_analysis()])
    result = await analyze_raw_item(fake, item, source)
    assert result.is_relevant
    assert fake.structured_calls == 2


async def test_analyzer_fails_after_two_attempts(session):
    source = make_source()
    session.add(source)
    await session.flush()
    item = make_raw_item(source, "VLCC rates surge", "https://example.com/b")
    session.add(item)
    await session.flush()

    fake = FakeLLM(results=[LLMError("bad json"), LLMError("bad json again")])
    with pytest.raises(AnalysisFailed) as excinfo:
        await analyze_raw_item(fake, item, source)
    assert "bad json" in excinfo.value.detail
    assert fake.structured_calls == 2
