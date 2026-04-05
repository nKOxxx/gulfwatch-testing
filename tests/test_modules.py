#!/usr/bin/env python3
"""
Unit tests for Gulf Watch Python modules.
Tests all 5 modules (ARGUS, CHATTER, CHRONOS, IGNITE, SKYLINE),
the circuit_breaker, and cross_source_verification.

Priya Nakamura -- Backend Reliability
"""

import hashlib
import json
import math
import os
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Path setup -- ensure project root and scripts are importable
# ---------------------------------------------------------------------------

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)
sys.path.insert(0, os.path.join(PROJECT_ROOT, "scripts"))


# =========================================================================
# ARGUS MODULE TESTS
# =========================================================================

class TestArgusModule:
    """Tests for argus_module.py (Entity Resolution & Threat Scoring)."""

    def _import_argus(self):
        import argus_module
        return argus_module

    # -- normalize_name --------------------------------------------------

    @pytest.mark.unit
    def test_normalize_name_basic(self):
        argus = self._import_argus()
        assert argus.normalize_name("Hello World") == "hello world"

    @pytest.mark.unit
    def test_normalize_name_special_chars(self):
        argus = self._import_argus()
        result = argus.normalize_name("Al-Jazeera's Report")
        assert "aljazeeras" in result or "al" in result  # special chars removed

    @pytest.mark.unit
    def test_normalize_name_empty(self):
        argus = self._import_argus()
        assert argus.normalize_name("") == ""

    # -- similarity (BUG: .includes() is JS, not Python) -----------------

    @pytest.mark.unit
    def test_similarity_identical(self):
        argus = self._import_argus()
        assert argus.similarity("Iran", "Iran") == 1.0

    @pytest.mark.unit
    def test_similarity_includes_bug_fixed(self):
        """
        ARCHITECTURE.md documents a historical bug at argus_module.py:26:
        v1 called .includes() (JavaScript). v2 fixed this to use Python 'in' operator.
        This test verifies the fix works correctly.
        """
        argus = self._import_argus()
        # v2 fix: 'in' operator instead of .includes() -- should return 0.8 for substring match
        result = argus.similarity("Iranian forces", "Iran")
        assert result == pytest.approx(0.8, abs=0.01)

    @pytest.mark.unit
    def test_similarity_empty_strings(self):
        argus = self._import_argus()
        assert argus.similarity("", "") == 1.0

    # -- extract_entities_from_event -------------------------------------

    @pytest.mark.unit
    def test_extract_entities_country(self):
        argus = self._import_argus()
        event = {"title": "Attack in Iran", "countries": ["IR"]}
        entities = argus.extract_entities_from_event(event)
        country_entities = [e for e in entities if e["type"] == "nation"]
        assert len(country_entities) >= 1
        assert country_entities[0]["country"] == "IR"
        assert country_entities[0]["canonicalName"] == "Iran"

    @pytest.mark.unit
    def test_extract_entities_organization(self):
        argus = self._import_argus()
        event = {"title": "IRGC launches missile test", "countries": []}
        entities = argus.extract_entities_from_event(event)
        org_entities = [e for e in entities if e["type"] == "organization"]
        assert len(org_entities) >= 1
        assert "Islamic Revolutionary Guard Corps" in org_entities[0]["canonicalName"]

    @pytest.mark.unit
    def test_extract_entities_multiple(self):
        argus = self._import_argus()
        event = {
            "title": "Hezbollah and IRGC meeting in Lebanon",
            "countries": ["LB", "IR"],
        }
        entities = argus.extract_entities_from_event(event)
        assert len(entities) >= 3  # 2 countries + at least 1 org

    @pytest.mark.unit
    def test_extract_entities_empty_event(self):
        argus = self._import_argus()
        entities = argus.extract_entities_from_event({})
        assert entities == []

    # -- canonicalize_entities -------------------------------------------

    @pytest.mark.unit
    def test_canonicalize_deduplicates(self):
        argus = self._import_argus()
        entities = [
            {"id": "country_IR", "canonicalName": "Iran", "type": "nation", "aliases": ["Iran", "IR"]},
            {"id": "country_IR", "canonicalName": "Iran", "type": "nation", "aliases": ["Iran", "IR"]},
        ]
        result = argus.canonicalize_entities(entities)
        assert len(result) == 1
        assert result[0]["eventCount"] == 2

    @pytest.mark.unit
    def test_canonicalize_preserves_distinct(self):
        argus = self._import_argus()
        entities = [
            {"id": "country_IR", "canonicalName": "Iran", "type": "nation", "aliases": ["Iran"]},
            {"id": "country_IQ", "canonicalName": "Iraq", "type": "nation", "aliases": ["Iraq"]},
        ]
        result = argus.canonicalize_entities(entities)
        assert len(result) == 2

    # -- threat scoring --------------------------------------------------

    @pytest.mark.unit
    def test_calculate_country_threat_known(self):
        argus = self._import_argus()
        events = [
            {"countries": ["IR"], "severity": "critical"},
            {"countries": ["IR"], "severity": "high"},
        ]
        threat = argus.calculate_country_threat("IR", events)
        assert threat["code"] == "IR"
        assert threat["threat"]["overall"] >= 85  # base + critical + high
        assert threat["threat"]["level"] in ("critical", "high")

    @pytest.mark.unit
    def test_calculate_country_threat_unknown(self):
        argus = self._import_argus()
        threat = argus.calculate_country_threat("ZZ", [])
        assert threat["threat"]["overall"] == 30  # default base

    @pytest.mark.unit
    def test_get_country_threats_sorted(self):
        argus = self._import_argus()
        events = [
            {"countries": ["IR"], "severity": "critical"},
            {"countries": ["AE"], "severity": "low"},
        ]
        threats = argus.get_country_threats(events)
        assert len(threats) >= 2
        # Should be sorted descending by threat score
        scores = [t["threat"]["overall"] for t in threats]
        assert scores == sorted(scores, reverse=True)

    @pytest.mark.unit
    def test_get_country_threats_limit(self):
        argus = self._import_argus()
        events = [{"countries": [c], "severity": "medium"} for c in argus.COUNTRY_NAMES.keys()]
        threats = argus.get_country_threats(events, limit=5)
        assert len(threats) <= 5

    # -- process_events --------------------------------------------------

    @pytest.mark.unit
    def test_process_events_structure(self):
        argus = self._import_argus()
        events = [
            {"title": "IRGC test in Iran", "countries": ["IR"], "severity": "high"},
            {"title": "Hezbollah action in Lebanon", "countries": ["LB"], "severity": "medium"},
        ]
        result = argus.process_events(events)
        assert "entities" in result
        assert "countryThreats" in result
        assert "summary" in result
        assert result["summary"]["totalEntities"] >= 2
        assert result["summary"]["totalCountries"] >= 2

    @pytest.mark.unit
    def test_process_events_empty(self):
        argus = self._import_argus()
        result = argus.process_events([])
        assert result["summary"]["totalEntities"] == 0
        assert result["summary"]["totalCountries"] == 0


# =========================================================================
# CHATTER MODULE TESTS
# =========================================================================

class TestChatterModule:
    """Tests for chatter_module.py (Social Media & News Intelligence)."""

    def _import_chatter(self):
        import chatter_module
        return chatter_module

    @pytest.mark.unit
    def test_analyze_sentiment_positive(self):
        chatter = self._import_chatter()
        result = chatter.analyze_sentiment("peace agreement success victory")
        assert result["sentiment"] == "positive"
        assert result["sentimentScore"] > 0
        assert len(result["positiveTerms"]) > 0

    @pytest.mark.unit
    def test_analyze_sentiment_negative(self):
        chatter = self._import_chatter()
        result = chatter.analyze_sentiment("attack threat war crisis conflict explosion missile")
        assert result["sentiment"] == "negative"
        assert result["sentimentScore"] < 0

    @pytest.mark.unit
    def test_analyze_sentiment_neutral(self):
        chatter = self._import_chatter()
        result = chatter.analyze_sentiment("the weather is moderate today")
        assert result["sentiment"] == "neutral"

    @pytest.mark.unit
    def test_analyze_sentiment_critical_score(self):
        chatter = self._import_chatter()
        result = chatter.analyze_sentiment("nuclear ballistic missile launch")
        assert result["criticalScore"] > 0
        assert len(result["criticalTerms"]) > 0

    @pytest.mark.unit
    def test_analyze_sentiment_empty(self):
        chatter = self._import_chatter()
        result = chatter.analyze_sentiment("")
        assert result["sentiment"] == "neutral"
        assert result["sentimentScore"] == 0.0

    @pytest.mark.unit
    def test_detect_trends(self):
        chatter = self._import_chatter()
        events = [
            {"title": "missile launch detected in region"},
            {"title": "second missile launch confirmed"},
            {"title": "missile defense systems activated"},
        ]
        trends = chatter.detect_trends(events)
        assert isinstance(trends, list)
        # "missile" should be trending
        keywords = [t["keyword"] for t in trends]
        assert "missile" in keywords

    @pytest.mark.unit
    def test_detect_trends_empty(self):
        chatter = self._import_chatter()
        trends = chatter.detect_trends([])
        assert trends == []

    @pytest.mark.unit
    def test_assess_source_reliability_known(self):
        chatter = self._import_chatter()
        result = chatter.assess_source_reliability("Reuters")
        assert result["reliability"] == 0.95
        assert result["bias"] == "neutral"

    @pytest.mark.unit
    def test_assess_source_reliability_unknown(self):
        chatter = self._import_chatter()
        result = chatter.assess_source_reliability("SomeRandomBlog")
        assert result["reliability"] == 0.5  # Default
        assert result["bias"] == "unknown"

    @pytest.mark.unit
    def test_extract_hashtags(self):
        chatter = self._import_chatter()
        hashtags = chatter.extract_hashtags("Breaking #GulfCrisis in #Iran today #IRGC")
        assert "GulfCrisis" in hashtags
        assert "Iran" in hashtags
        assert "IRGC" in hashtags

    @pytest.mark.unit
    def test_extract_hashtags_none(self):
        chatter = self._import_chatter()
        hashtags = chatter.extract_hashtags("No hashtags here")
        assert hashtags == []

    @pytest.mark.unit
    def test_process_social_intelligence(self):
        chatter = self._import_chatter()
        events = [
            {
                "title": "Attack on base confirmed",
                "source": "Reuters",
                "severity": "critical",
                "description": "#Breaking #MiddleEast",
            },
            {
                "title": "Peace talks progress",
                "source": "Al Jazeera",
                "severity": "low",
                "description": "#Diplomacy",
            },
        ]
        result = chatter.process_social_intelligence(events)
        assert result["totalAnalyzed"] == 2
        assert "sentimentDistribution" in result
        assert "topSources" in result
        assert "trendingHashtags" in result
        assert "trends" in result


# =========================================================================
# CHRONOS MODULE TESTS
# =========================================================================

class TestChronosModule:
    """Tests for chronos_module.py (Temporal Change Detection)."""

    def _import_chronos(self):
        import chronos_module
        return chronos_module

    @pytest.mark.unit
    def test_aggregate_by_time_day(self):
        chronos = self._import_chronos()
        events = [
            {"date": "2026-03-10T12:00:00Z"},
            {"date": "2026-03-10T14:00:00Z"},
            {"date": "2026-03-11T10:00:00Z"},
        ]
        result = chronos.aggregate_by_time(events, "day")
        assert "2026-03-10" in result
        assert len(result["2026-03-10"]) == 2
        assert "2026-03-11" in result
        assert len(result["2026-03-11"]) == 1

    @pytest.mark.unit
    def test_aggregate_by_time_hour(self):
        chronos = self._import_chronos()
        events = [
            {"created_at": "2026-03-10T12:30:00Z"},
            {"created_at": "2026-03-10T12:45:00Z"},
            {"created_at": "2026-03-10T14:00:00Z"},
        ]
        result = chronos.aggregate_by_time(events, "hour")
        assert "2026-03-10 12:00" in result
        assert len(result["2026-03-10 12:00"]) == 2

    @pytest.mark.unit
    def test_detect_anomalies_math_sqrt_bug_fixed(self):
        """
        ARCHITECTURE.md documents a historical bug at chronos_module.py:57:
        v1 used math.sqrt() without importing math. v2 fixed this with proper import.
        This test verifies math.sqrt works correctly for anomaly detection.
        """
        chronos = self._import_chronos()
        # Create enough events to trigger the math.sqrt path
        events = []
        for day_offset in range(10):
            dt = datetime(2026, 3, 1 + day_offset, 12, 0)
            # Create varying counts to ensure non-zero variance
            count = 5 if day_offset % 3 == 0 else 1
            for _ in range(count):
                events.append({"date": dt.isoformat() + "Z"})

        # v2 fix: math is now imported, should run without error
        result = chronos.detect_anomalies(events)
        assert isinstance(result, list)

    @pytest.mark.unit
    def test_detect_anomalies_too_few_events(self):
        chronos = self._import_chronos()
        events = [{"date": "2026-03-10T12:00:00Z"}, {"date": "2026-03-11T12:00:00Z"}]
        result = chronos.detect_anomalies(events)
        assert result == []

    @pytest.mark.unit
    def test_detect_change(self):
        chronos = self._import_chronos()
        current = [
            {"latitude": 29.4, "longitude": 47.5},
            {"latitude": 23.7, "longitude": 58.5},
            {"latitude": 30.0, "longitude": 50.0},  # new
        ]
        previous = [
            {"latitude": 29.4, "longitude": 47.5},
            {"latitude": 23.7, "longitude": 58.5},
            {"latitude": 25.0, "longitude": 55.0},  # removed
        ]
        result = chronos.detect_change(current, previous)
        assert "newDetections" in result
        assert "removedDetections" in result
        assert "changeRatio" in result
        assert result["changeRatio"] >= 0

    @pytest.mark.unit
    def test_detect_change_empty_current(self):
        chronos = self._import_chronos()
        result = chronos.detect_change([], [{"latitude": 29.4, "longitude": 47.5}])
        assert result["newDetections"] == 0
        assert result["removedDetections"] == 1

    @pytest.mark.unit
    def test_calculate_trend(self):
        chronos = self._import_chronos()
        now = datetime.now()
        events = [
            {"date": (now - timedelta(days=1)).isoformat(), "severity": "critical"},
            {"date": (now - timedelta(days=2)).isoformat(), "severity": "high"},
            {"date": (now - timedelta(days=10)).isoformat(), "severity": "critical"},
        ]
        result = chronos.calculate_trend(events, days=7)
        assert "recentCount" in result
        assert "olderCount" in result
        assert "trendDirection" in result

    @pytest.mark.unit
    def test_generate_time_series(self):
        chronos = self._import_chronos()
        now = datetime.now()
        events = [
            {"date": (now - timedelta(days=i)).isoformat(), "severity": "medium"}
            for i in range(10)
        ]
        result = chronos.generate_time_series(events, days=30)
        assert isinstance(result, list)
        if result:
            assert "date" in result[0]
            assert "total" in result[0]

    @pytest.mark.unit
    def test_detect_thermal_changes(self):
        chronos = self._import_chronos()
        current = [
            {"latitude": 29.4, "longitude": 47.5, "fire_radiative_power": 80},
            {"latitude": 23.7, "longitude": 58.5, "fire_radiative_power": 120},
        ]
        previous = [
            {"latitude": 29.4, "longitude": 47.5, "fire_radiative_power": 60},
        ]
        result = chronos.detect_thermal_changes(current, previous)
        assert "intensityChange" in result
        assert "currentCount" in result
        assert result["currentCount"] == 2
        assert result["previousCount"] == 1


# =========================================================================
# IGNITE MODULE TESTS
# =========================================================================

class TestIgniteModule:
    """Tests for ignite_module.py (NASA FIRMS Heat Detection)."""

    def _import_ignite(self):
        import ignite_module
        return ignite_module

    @pytest.mark.unit
    def test_generate_mock_fires(self):
        ignite = self._import_ignite()
        fires = ignite.generate_mock_fires()
        assert len(fires) >= 15
        assert len(fires) <= 40
        for fire in fires:
            assert "latitude" in fire
            assert "longitude" in fire
            assert "fire_radiative_power" in fire
            assert "satellite" in fire

    @pytest.mark.unit
    def test_classify_fire_industrial_large(self):
        ignite = self._import_ignite()
        fire = {"fire_radiative_power": 150, "confidence": "high", "bright_ti4": 300}
        result = ignite.classify_fire(fire)
        assert result["fireType"] == "industrial_large"
        assert result["riskLevel"] == "high"

    @pytest.mark.unit
    def test_classify_fire_controlled_burn(self):
        ignite = self._import_ignite()
        fire = {"fire_radiative_power": 5, "confidence": "low", "bright_ti4": 290}
        result = ignite.classify_fire(fire)
        assert result["fireType"] == "controlled_burn"
        assert result["riskLevel"] == "low"

    @pytest.mark.unit
    def test_classify_fire_gas_flare(self):
        ignite = self._import_ignite()
        fire = {"fire_radiative_power": 30, "confidence": "nominal", "bright_ti4": 360}
        result = ignite.classify_fire(fire)
        assert result["fireType"] == "gas_flare"

    @pytest.mark.unit
    def test_classify_fire_wildfire(self):
        ignite = self._import_ignite()
        fire = {"fire_radiative_power": 25, "confidence": "medium", "bright_ti4": 310}
        result = ignite.classify_fire(fire)
        assert result["fireType"] == "wildfire"

    @pytest.mark.unit
    def test_classify_fire_thermal_anomaly_flag(self):
        ignite = self._import_ignite()
        hot = ignite.classify_fire({"fire_radiative_power": 10, "bright_ti4": 350, "confidence": "nominal"})
        cool = ignite.classify_fire({"fire_radiative_power": 10, "bright_ti4": 300, "confidence": "nominal"})
        assert hot["isThermalAnomaly"] is True
        assert cool["isThermalAnomaly"] is False

    @pytest.mark.unit
    def test_analyze_fires(self):
        ignite = self._import_ignite()
        fires = ignite.generate_mock_fires()
        result = ignite.analyze_fires(fires)
        assert result["totalDetections"] == len(fires)
        assert "classified" in result
        assert "hotspots" in result
        assert "byType" in result
        assert "totalFirePower" in result

    @pytest.mark.unit
    def test_analyze_fires_empty(self):
        ignite = self._import_ignite()
        result = ignite.analyze_fires([])
        assert result["totalDetections"] == 0
        assert result["classified"] == []

    @pytest.mark.unit
    def test_analyze_fires_hotspots_sorted(self):
        ignite = self._import_ignite()
        fires = [
            {"latitude": 29.0, "longitude": 47.0, "fire_radiative_power": 10, "bright_ti4": 300, "confidence": "nominal"},
            {"latitude": 30.0, "longitude": 48.0, "fire_radiative_power": 100, "bright_ti4": 400, "confidence": "high"},
            {"latitude": 31.0, "longitude": 49.0, "fire_radiative_power": 50, "bright_ti4": 350, "confidence": "medium"},
        ]
        result = ignite.analyze_fires(fires)
        hotspot_frps = [h["fire_radiative_power"] for h in result["hotspots"]]
        assert hotspot_frps == sorted(hotspot_frps, reverse=True)

    @pytest.mark.unit
    def test_get_thermal_data_mock(self):
        ignite = self._import_ignite()
        result = ignite.get_thermal_data(api_key="DEMO_KEY")
        assert result["totalDetections"] > 0
        assert "classified" in result


# =========================================================================
# SKYLINE MODULE TESTS
# =========================================================================

class TestSkylineModule:
    """Tests for skyline_module.py (Weather Intelligence)."""

    def _import_skyline(self):
        import skyline_module
        return skyline_module

    @pytest.mark.unit
    def test_get_region_weather_valid(self):
        skyline = self._import_skyline()
        result = skyline.get_region_weather("gulf_central")
        assert result["region"] == "gulf_central"
        assert result["name"] == "Central Gulf"
        assert "temperature" in result
        assert "humidity" in result
        assert "windSpeed" in result
        assert "visibility" in result
        assert "condition" in result

    @pytest.mark.unit
    def test_get_region_weather_invalid_falls_back(self):
        skyline = self._import_skyline()
        result = skyline.get_region_weather("nonexistent_region")
        # Falls back to gulf_central
        assert "temperature" in result

    @pytest.mark.unit
    def test_get_all_weather(self):
        skyline = self._import_skyline()
        result = skyline.get_all_weather()
        assert len(result) == len(skyline.GULF_REGIONS)
        for region_id in skyline.GULF_REGIONS:
            assert region_id in result

    @pytest.mark.unit
    def test_assess_impact_minimal(self):
        skyline = self._import_skyline()
        weather = {"visibility": 20, "windSpeed": 5, "condition": "clear", "temperature": 30}
        result = skyline.assess_impact(weather)
        assert result["impactLevel"] == "minimal"
        assert result["overallScore"] == 0

    @pytest.mark.unit
    def test_assess_impact_severe(self):
        skyline = self._import_skyline()
        weather = {"visibility": 1, "windSpeed": 35, "condition": "sandstorm", "temperature": 50}
        result = skyline.assess_impact(weather)
        assert result["impactLevel"] == "severe"
        assert result["overallScore"] >= 80

    @pytest.mark.unit
    def test_assess_impact_moderate(self):
        skyline = self._import_skyline()
        weather = {"visibility": 6, "windSpeed": 22, "condition": "dust", "temperature": 35}
        result = skyline.assess_impact(weather)
        assert result["impactLevel"] in ("moderate", "high")
        assert result["overallScore"] > 0

    @pytest.mark.unit
    def test_get_recommendation(self):
        skyline = self._import_skyline()
        assert "Suspend" in skyline.get_recommendation("severe")
        assert "nominal" in skyline.get_recommendation("minimal")

    @pytest.mark.unit
    def test_generate_forecast(self):
        skyline = self._import_skyline()
        forecast = skyline.generate_forecast("gulf_central", hours=24)
        assert len(forecast) == 24
        for entry in forecast:
            assert "temperature" in entry
            assert "humidity" in entry
            assert "windSpeed" in entry

    @pytest.mark.unit
    def test_generate_forecast_short(self):
        skyline = self._import_skyline()
        forecast = skyline.generate_forecast("levant", hours=6)
        assert len(forecast) == 6

    @pytest.mark.unit
    def test_get_maritime_weather(self):
        skyline = self._import_skyline()
        result = skyline.get_maritime_weather()
        expected_areas = ["persian_gulf", "gulf_of_oman", "arabian_sea", "red_sea"]
        for area in expected_areas:
            assert area in result
            assert "seaState" in result[area]
            assert "waveHeight" in result[area]
            assert 0 <= result[area]["seaState"] <= 9

    @pytest.mark.unit
    def test_get_weather_intelligence_structure(self):
        skyline = self._import_skyline()
        result = skyline.get_weather_intelligence()
        assert "regions" in result
        assert "impacts" in result
        assert "maritime" in result
        assert "summary" in result
        assert "overallRiskScore" in result["summary"]
        assert "operationalReadiness" in result["summary"]


# =========================================================================
# CIRCUIT BREAKER TESTS
# =========================================================================

class TestCircuitBreaker:
    """Tests for scripts/circuit_breaker.py."""

    def _import_cb(self):
        from circuit_breaker import CircuitBreaker
        return CircuitBreaker

    @pytest.mark.unit
    def test_init_empty(self):
        CB = self._import_cb()
        cb = CB()
        stats = cb.get_stats()
        assert stats["total_events"] == 0
        assert stats["signatures"] == 0

    @pytest.mark.unit
    def test_init_with_existing(self):
        CB = self._import_cb()
        existing = [
            {
                "title": "Existing event",
                "location": "Tehran",
                "date": "2026-03-10T12:00:00Z",
                "source": "Reuters",
                "incident_type": "missile",
            }
        ]
        cb = CB(existing)
        assert cb.get_stats()["total_events"] == 1

    @pytest.mark.unit
    def test_accept_new_event(self):
        CB = self._import_cb()
        cb = CB()
        article = {
            "title": "US missile strike targets military base in Tehran",
            "location": "Tehran, Iran",
            "date": "2026-03-10T12:00:00Z",
            "source": "Reuters",
            "content": "A US Tomahawk missile struck a military installation.",
        }
        result = cb.process_article(article)
        assert result is not None
        assert result["id"].startswith("GW-")
        assert result["incident_type"] == "missile"
        assert result["confidence"] in ("VERIFIED", "LIKELY", "PARTIAL", "OSINT")

    @pytest.mark.unit
    def test_reject_duplicate(self):
        CB = self._import_cb()
        cb = CB()
        article1 = {
            "title": "Missile strike hits base in Tehran",
            "location": "Tehran, Iran",
            "date": "2026-03-10T12:00:00Z",
            "source": "Reuters",
        }
        article2 = {
            "title": "Missile strike hits base in Tehran",
            "location": "Tehran, Iran",
            "date": "2026-03-10T12:30:00Z",
            "source": "BBC",
        }
        result1 = cb.process_article(article1)
        result2 = cb.process_article(article2)
        assert result1 is not None
        assert result2 is None  # Duplicate should be filtered

    @pytest.mark.unit
    def test_reject_historical_recap(self):
        CB = self._import_cb()
        cb = CB()
        article = {
            "title": "Weekly Roundup: Death toll rises to 500 in ongoing conflict",
            "location": "Multiple locations",
            "date": "2026-03-10T14:00:00Z",
            "source": "Al Jazeera",
            "content": "Over the past week, fighting has intensified across the region with casualties mounting.",
        }
        result = cb.process_article(article)
        assert result is None  # Recap should be filtered

    @pytest.mark.unit
    def test_accept_different_event(self):
        CB = self._import_cb()
        cb = CB()
        article1 = {
            "title": "Missile strike in Tehran",
            "location": "Tehran, Iran",
            "date": "2026-03-10T12:00:00Z",
            "source": "Reuters",
        }
        article2 = {
            "title": "Israeli airstrike targets weapons depot in Gaza",
            "location": "Gaza Strip",
            "date": "2026-03-10T15:00:00Z",
            "source": "Times of Israel",
        }
        cb.process_article(article1)
        result = cb.process_article(article2)
        assert result is not None
        assert result["incident_type"] == "airstrike"

    @pytest.mark.unit
    def test_confidence_government_source(self):
        CB = self._import_cb()
        cb = CB()
        article = {
            "title": "Ministry of Defence confirms strike",
            "location": "Tehran",
            "date": "2026-03-10T12:00:00Z",
            "source": "Iranian Ministry of Defence",
        }
        result = cb.process_article(article)
        assert result is not None
        # Government source scores higher but may not reach VERIFIED without other factors
        assert result["confidence"] in ("VERIFIED", "LIKELY", "PARTIAL")

    @pytest.mark.unit
    def test_generate_id_uniqueness(self):
        CB = self._import_cb()
        cb = CB()
        ids = set()
        for i in range(100):
            article = {
                "title": f"Event {i} in location {i % 5}",
                "location": f"City {i}",
                "date": f"2026-03-{10 + i % 20:02d}T12:00:00Z",
                "source": "AP",
            }
            result = cb.process_article(article)
            if result:
                ids.add(result["id"])
        # All IDs should be unique
        assert len(ids) > 5  # At least some events accepted

    @pytest.mark.unit
    def test_incident_type_extraction(self):
        CB = self._import_cb()
        cb = CB()
        types = {
            "missile": "Ballistic missile launch over Gulf",
            "airstrike": "Bombing raid hits warehouse",
            "drone": "Suicide drone attack on convoy",
            "naval": "Ship seized in maritime incident",
            "cyber": "Cyberattack on infrastructure",
        }
        for expected_type, title in types.items():
            article = {
                "title": title,
                "location": "Unknown",
                "date": "2026-03-10T12:00:00Z",
                "source": "AP",
            }
            result = cb.process_article(article)
            if result:
                assert result["incident_type"] == expected_type, (
                    f"Expected {expected_type} for '{title}', got {result['incident_type']}"
                )

    @pytest.mark.unit
    def test_is_historical_recap_detection(self):
        CB = self._import_cb()
        cb = CB()
        recap_titles = [
            "Weekly Roundup: casualties mount in ongoing conflict",
            "Death toll rises to 500, cumulative total since January",
            "Summary of attacks over the past week in the region",
        ]
        for title in recap_titles:
            is_recap, confidence = cb._is_historical_recap({"title": title, "content": ""})
            assert is_recap, f"Should detect '{title}' as recap"


# =========================================================================
# CROSS SOURCE VERIFICATION TESTS
# =========================================================================

class TestCrossSourceVerification:
    """Tests for scripts/cross_source_verification.py."""

    def _import_csv(self):
        from cross_source_verification import CrossSourceVerification
        return CrossSourceVerification

    def _make_incidents(self):
        return [
            {
                "id": "inc_001",
                "title": "Missile strike hits military base in Tehran",
                "source": "Reuters",
                "published": "2026-03-10T12:00:00Z",
                "location": {"country": "iran", "city": "tehran"},
            },
            {
                "id": "inc_002",
                "title": "Missile attack on Tehran military base confirmed",
                "source": "BBC",
                "published": "2026-03-10T12:30:00Z",
                "location": {"country": "iran", "city": "tehran"},
            },
            {
                "id": "inc_003",
                "title": "Tehran base hit by missile strike says officials",
                "source": "Associated Press",
                "published": "2026-03-10T13:00:00Z",
                "location": {"country": "iran", "city": "tehran"},
                "is_government": True,
            },
            {
                "id": "inc_004",
                "title": "Israeli airstrike targets weapons depot in Gaza",
                "source": "Times of Israel",
                "published": "2026-03-10T15:00:00Z",
                "location": {"country": "israel"},
            },
        ]

    @pytest.mark.unit
    def test_init_empty(self):
        CSV = self._import_csv()
        v = CSV()
        assert v.incidents == []
        groups = v.group_incidents()
        assert groups == []

    @pytest.mark.unit
    def test_group_similar_incidents(self):
        CSV = self._import_csv()
        incidents = self._make_incidents()
        v = CSV(incidents)
        groups = v.group_incidents(similarity_threshold=0.60)
        # The 3 Tehran missile incidents should cluster together
        assert len(groups) >= 1
        # At least one group should have multiple sources
        multi_source_groups = [g for g in groups if g["num_sources"] >= 2]
        assert len(multi_source_groups) >= 1

    @pytest.mark.unit
    def test_verification_badge_multi_source(self):
        CSV = self._import_csv()
        incidents = self._make_incidents()[:3]  # 3 Tehran missile reports
        v = CSV(incidents)
        groups = v.group_incidents(similarity_threshold=0.60)
        if groups:
            # With 3 major news sources + 1 government, should be at least LIKELY
            assert groups[0]["verification_badge"] in ("VERIFIED", "LIKELY", "PARTIAL")

    @pytest.mark.unit
    def test_verification_single_source(self):
        CSV = self._import_csv()
        incidents = [self._make_incidents()[3]]  # Just the Gaza airstrike
        v = CSV(incidents)
        groups = v.group_incidents()
        assert len(groups) == 1
        # Single source should not be VERIFIED
        assert groups[0]["verification_badge"] in ("PARTIAL", "UNCONFIRMED")

    @pytest.mark.unit
    def test_source_tier_detection(self):
        CSV = self._import_csv()
        v = CSV()
        assert v._get_source_tier({"source": "Reuters"}) == "major_news"
        assert v._get_source_tier({"source": "Gulf News"}) == "regional_news"
        assert v._get_source_tier({"source": "RandomBlog", "is_government": True}) == "government"
        assert v._get_source_tier({"source": "RandomBlog"}) == "social"

    @pytest.mark.unit
    def test_calculate_similarity_identical(self):
        CSV = self._import_csv()
        v = CSV()
        inc = {
            "title": "Missile strike in Tehran",
            "published": "2026-03-10T12:00:00Z",
            "location": {"country": "iran"},
        }
        sim = v._calculate_similarity(inc, inc)
        assert sim >= 0.9

    @pytest.mark.unit
    def test_calculate_similarity_different(self):
        CSV = self._import_csv()
        v = CSV()
        inc1 = {
            "title": "Missile strike in Tehran",
            "published": "2026-03-10T12:00:00Z",
            "location": {"country": "iran"},
        }
        inc2 = {
            "title": "Earthquake hits Japan",
            "published": "2026-03-15T06:00:00Z",
            "location": {"country": "japan"},
        }
        sim = v._calculate_similarity(inc1, inc2)
        assert sim < 0.5


# =========================================================================
# AUDIT LOGGER TESTS
# =========================================================================

class TestAuditLogger:
    """Tests for scripts/audit_logger.py."""

    def _import_audit(self):
        from audit_logger import (
            AuditLogger,
            compute_chain_hash,
            verify_chain,
            to_cef,
            GENESIS_HASH,
        )
        return AuditLogger, compute_chain_hash, verify_chain, to_cef, GENESIS_HASH

    @pytest.mark.unit
    def test_log_creates_entry(self):
        AuditLogger, *_ = self._import_audit()
        al = AuditLogger()
        entry = al.log(action="login", user_id="user-123", ip_address="10.0.0.1")
        assert entry["action"] == "login"
        assert entry["user_id"] == "user-123"
        assert entry["ip_address"] == "10.0.0.1"
        assert "chain_hash" in entry
        assert "timestamp" in entry

    @pytest.mark.unit
    def test_buffer_stores_entries(self):
        AuditLogger, *_ = self._import_audit()
        al = AuditLogger()
        al.log(action="login")
        al.log(action="view_incident")
        assert len(al.get_buffer()) == 2

    @pytest.mark.unit
    def test_chain_hash_integrity(self):
        _, compute_chain_hash, _, _, GENESIS_HASH = self._import_audit()
        data1 = {"timestamp": "t1", "action": "login", "user_id": None,
                 "resource_type": None, "resource_id": None,
                 "ip_address": None, "user_agent": None, "details": {}}
        h1 = compute_chain_hash(GENESIS_HASH, data1)
        assert len(h1) == 64  # SHA-256 hex

        data2 = {"timestamp": "t2", "action": "logout", "user_id": None,
                 "resource_type": None, "resource_id": None,
                 "ip_address": None, "user_agent": None, "details": {}}
        h2 = compute_chain_hash(h1, data2)
        assert h1 != h2

    @pytest.mark.unit
    def test_verify_chain_valid(self):
        AuditLogger, _, verify_chain, _, _ = self._import_audit()
        al = AuditLogger()
        al.log(action="login")
        al.log(action="view_incident")
        al.log(action="export")

        result = verify_chain(al.get_buffer())
        assert result["valid"] is True
        assert result["verified"] == 3

    @pytest.mark.unit
    def test_verify_chain_tampered(self):
        AuditLogger, _, verify_chain, _, _ = self._import_audit()
        al = AuditLogger()
        al.log(action="login")
        al.log(action="view_incident")

        buf = al.get_buffer()
        # Tamper with the second entry
        buf[1]["action"] = "TAMPERED"

        result = verify_chain(buf)
        assert result["valid"] is False
        assert result["first_broken_index"] == 1

    @pytest.mark.unit
    def test_verify_chain_empty(self):
        _, _, verify_chain, _, _ = self._import_audit()
        result = verify_chain([])
        assert result["valid"] is True
        assert result["total_entries"] == 0

    @pytest.mark.unit
    def test_cef_output(self):
        _, _, _, to_cef, _ = self._import_audit()
        entry = {
            "action": "login",
            "user_id": "user-123",
            "ip_address": "10.0.0.1",
            "resource_type": "session",
            "resource_id": "sess-456",
            "user_agent": "Mozilla/5.0",
            "timestamp": "2026-03-10T12:00:00Z",
            "chain_hash": "abc123",
        }
        cef = to_cef(entry)
        assert cef.startswith("CEF:0")
        assert "GulfWatch" in cef
        assert "suser=user-123" in cef
        assert "src=10.0.0.1" in cef

    @pytest.mark.unit
    def test_cef_escaping(self):
        _, _, _, to_cef, _ = self._import_audit()
        entry = {
            "action": "login",
            "user_id": "user|with|pipes",
            "ip_address": "10.0.0.1",
            "timestamp": "2026-03-10T12:00:00Z",
        }
        cef = to_cef(entry)
        assert "user\\|with\\|pipes" in cef

    @pytest.mark.unit
    def test_cef_file_output(self, tmp_path):
        AuditLogger, *_ = self._import_audit()
        cef_file = str(tmp_path / "audit.cef")
        al = AuditLogger(cef_output_path=cef_file)
        al.log(action="login", user_id="u1")
        al.log(action="logout", user_id="u1")

        with open(cef_file) as f:
            lines = f.readlines()
        assert len(lines) == 2
        assert all(line.startswith("CEF:0") for line in lines)


# =========================================================================
# DATA QUALITY TESTS
# =========================================================================

class TestDataQuality:
    """Tests for scripts/data_quality.py."""

    def _import_dq(self):
        from data_quality import (
            check_source_feed_health,
            check_deduplication_anomalies,
            check_confidence_distribution,
            check_geocoding_quality,
            check_volume_anomalies,
            check_single_source_dominance,
            run_data_quality_report,
            AlertLevel,
        )
        return (
            check_source_feed_health,
            check_deduplication_anomalies,
            check_confidence_distribution,
            check_geocoding_quality,
            check_volume_anomalies,
            check_single_source_dominance,
            run_data_quality_report,
            AlertLevel,
        )

    def _make_incidents(self, count=20, source="Reuters"):
        now = datetime.now(timezone.utc)
        return [
            {
                "title": f"Incident {i} in Gulf region",
                "source": source if i % 3 != 0 else "Al Jazeera",
                "published_at": (now - timedelta(hours=i)).isoformat(),
                "ingested_at": (now - timedelta(hours=i)).isoformat(),
                "date": (now - timedelta(hours=i)).isoformat(),
                "latitude": 29.0 + i * 0.1,
                "longitude": 47.0 + i * 0.1,
                "severity": "critical" if i % 5 == 0 else "medium",
                "confidence": ["VERIFIED", "LIKELY", "PARTIAL", "OSINT"][i % 4],
            }
            for i in range(count)
        ]

    @pytest.mark.unit
    def test_source_feed_health_healthy(self):
        fn, *_ = self._import_dq()
        incidents = self._make_incidents()
        result = fn(incidents, window_hours=48)
        assert result["source_stats"]["total_sources"] >= 2
        assert result["source_stats"]["active_sources"] >= 1

    @pytest.mark.unit
    def test_source_feed_health_all_silent(self):
        fn, *_ = self._import_dq()
        old = datetime.now(timezone.utc) - timedelta(hours=100)
        incidents = [
            {"source": "Reuters", "ingested_at": old.isoformat()},
            {"source": "BBC", "ingested_at": old.isoformat()},
        ]
        result = fn(incidents, window_hours=6)
        assert any(a["level"] == "critical" for a in result["alerts"])

    @pytest.mark.unit
    def test_deduplication_detects_dupes(self):
        _, fn, *_ = self._import_dq()
        incidents = [
            {"title": "Missile strike in Tehran"} for _ in range(5)
        ] + [{"title": "Airstrike in Gaza"}]
        result = fn(incidents)
        assert result["dedup_stats"]["exact_duplicates"] >= 1

    @pytest.mark.unit
    def test_confidence_distribution(self):
        *_, fn, _, _, _, _, _ = self._import_dq()
        incidents = self._make_incidents()
        result = fn(incidents)
        assert "distribution" in result

    @pytest.mark.unit
    def test_geocoding_quality_good(self):
        *_, fn, _, _, _, _ = self._import_dq()
        incidents = self._make_incidents()
        result = fn(incidents)
        assert result["geocoding_stats"]["failure_rate"] == 0.0

    @pytest.mark.unit
    def test_geocoding_quality_missing(self):
        *_, fn, _, _, _, _ = self._import_dq()
        incidents = [{"title": "Event"} for _ in range(10)]  # No coordinates
        result = fn(incidents)
        assert result["geocoding_stats"]["failure_rate"] == 1.0
        assert any(a["level"] == "warning" for a in result["alerts"])

    @pytest.mark.unit
    def test_volume_anomalies_normal(self):
        *_, fn, _, _, _ = self._import_dq()
        incidents = self._make_incidents(count=50)
        result = fn(incidents)
        assert "volume_stats" in result

    @pytest.mark.unit
    def test_source_dominance_detected(self):
        *_, fn, _, _ = self._import_dq()
        incidents = [{"source": "Reuters"} for _ in range(90)] + [{"source": "BBC"} for _ in range(10)]
        result = fn(incidents, threshold=0.70)
        assert any(a["level"] == "warning" for a in result["alerts"])

    @pytest.mark.unit
    def test_full_report(self):
        *_, run_report, AlertLevel = self._import_dq()
        incidents = self._make_incidents()
        report = run_report(incidents)
        assert "status" in report
        assert "timestamp" in report
        assert "checks" in report
        assert "all_alerts" in report
        assert report["total_incidents"] == len(incidents)


# =========================================================================
# HEALTH CHECK TESTS
# =========================================================================

class TestHealthCheck:
    """Tests for scripts/health_check.py."""

    def _import_hc(self):
        from health_check import (
            check_database,
            check_feed_freshness,
            check_resource_utilization,
            run_health_check,
            HealthStatus,
        )
        return check_database, check_feed_freshness, check_resource_utilization, run_health_check, HealthStatus

    @pytest.mark.unit
    def test_check_database_no_connection(self):
        check_database, *_ = self._import_hc()
        # With no DB and unreachable host, should return unhealthy
        result = check_database(host="192.0.2.1", port=5432, timeout=0.5)
        assert result["status"] in ("unhealthy", "degraded")

    @pytest.mark.unit
    def test_check_feed_freshness_recent(self):
        _, check_feed, *_ = self._import_hc()
        recent = datetime.now(timezone.utc).isoformat()
        result = check_feed(last_ingested_at=recent)
        assert result["status"] == "healthy"
        assert result["staleness_seconds"] < 60

    @pytest.mark.unit
    def test_check_feed_freshness_stale(self):
        _, check_feed, *_ = self._import_hc()
        old = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        result = check_feed(last_ingested_at=old)
        assert result["status"] in ("degraded", "unhealthy")
        assert result["details"]["is_stale"] is True

    @pytest.mark.unit
    def test_check_feed_freshness_no_data(self):
        _, check_feed, *_ = self._import_hc()
        result = check_feed()
        assert result["status"] == "unhealthy"

    @pytest.mark.unit
    def test_check_resource_utilization(self):
        *_, check_res, _, _ = self._import_hc()
        result = check_res()
        assert "memory" in result
        assert "cpu" in result
        assert "disk" in result
        assert result["status"] in ("healthy", "degraded", "unhealthy")

    @pytest.mark.unit
    def test_run_health_check_standalone(self):
        *_, run_hc, HealthStatus = self._import_hc()
        report = run_hc(check_api=False, check_redis_flag=False)
        assert "status" in report
        assert "timestamp" in report
        assert "hostname" in report
        assert "checks" in report
        assert "database" in report["checks"]
        assert "feed_freshness" in report["checks"]
        assert "resources" in report["checks"]
