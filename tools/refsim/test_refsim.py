"""Hand-computed tests for the reference simulator.

Every dollar figure here was worked out on paper at Opus 5 rates ($5 in /
$25 out per MTok; cache read $0.50, 5m write $6.25, 1h write $10 per MTok)
— the arithmetic is written next to each expectation. These are the
tiebreaker when the TS engine and this sim disagree (docs/PLAN.md §5).

Run: python3 -m unittest discover -s tools/refsim
"""

import json
import unittest
from pathlib import Path

import refsim

PRICING = refsim.load_pricing()
T0 = refsim.parse_timestamp_ms("2026-08-30T12:00:00.000Z")


def at(seconds: float) -> str:
    ms = T0 + int(seconds * 1000)
    from datetime import datetime, timezone

    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{ms % 1000:03d}Z"


def req(
    id_,
    start,
    *,
    end=None,
    model="claude-opus-5",
    effort=None,
    version=None,
    thread=None,
    sidechain=False,
    input_=10,
    read=0,
    w5m=0,
    w1h=0,
    output=5,
    tier="standard",
    speed="standard",
):
    record = {
        "messageId": id_,
        "model": model,
        "timestamp": at(end if end is not None else start + 3),
        "requestStartTimestamp": at(start),
        "requestStartSource": "user-ancestor",
        "threadId": thread or ("agent-1" if sidechain else "main"),
        "isSidechain": sidechain,
        "usage": {
            "inputTokens": input_,
            "cacheReadInputTokens": read,
            "cacheCreationInputTokens": w5m + w1h,
            "cacheCreation5mTokens": w5m,
            "cacheCreation1hTokens": w1h,
            "outputTokens": output,
            "serviceTier": tier,
            "speed": speed,
        },
    }
    if effort is not None:
        record["effort"] = effort
    if version is not None:
        record["version"] = version
    return record


def kinds(events):
    return [e["kind"] for e in events]


def jsonl(*rows) -> bytes:
    return ("\n".join(json.dumps(r) for r in rows) + "\n").encode("utf-8")


def user(uuid, parent, ts, **extra):
    return {"type": "user", "uuid": uuid, "parentUuid": parent, "timestamp": ts, "message": {"role": "user", "content": "POISON"}, **extra}


def attachment(uuid, parent, ts, **extra):
    return {"type": "attachment", "uuid": uuid, "parentUuid": parent, "timestamp": ts, "attachment": {"content": "POISON"}, **extra}


def assistant(uuid, parent, ts, msg_id, *, model="claude-opus-5", usage=None, **extra):
    usage = usage or {"input_tokens": 10, "cache_creation_input_tokens": 1000, "cache_read_input_tokens": 0, "output_tokens": 5, "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": 1000}}
    return {
        "type": "assistant",
        "uuid": uuid,
        "parentUuid": parent,
        "timestamp": ts,
        "version": "2.1.251",
        "effort": "high",
        "message": {"id": msg_id, "model": model, "content": [{"type": "text", "text": "POISON"}], "usage": usage},
        **extra,
    }


class PricingTests(unittest.TestCase):
    def test_opus5_each_bucket(self):
        # base 1000×$5 = 0.005; read 2000×$0.50 = 0.001; 5m 3000×$6.25 = 0.01875;
        # 1h 4000×$10 = 0.04; out 500×$25 = 0.0125 → total 0.07725
        cost = refsim.price_tokens(
            {"baseInputTokens": 1000, "cacheReadTokens": 2000, "cacheWrite5mTokens": 3000, "cacheWrite1hTokens": 4000, "outputTokens": 500},
            PRICING["models"]["claude-opus-5"],
            PRICING["cacheMultipliers"],
            "standard",
            "standard",
        )
        self.assertAlmostEqual(cost["baseInputUsd"], 0.005, places=12)
        self.assertAlmostEqual(cost["cacheReadUsd"], 0.001, places=12)
        self.assertAlmostEqual(cost["cacheWrite5mUsd"], 0.01875, places=12)
        self.assertAlmostEqual(cost["cacheWrite1hUsd"], 0.04, places=12)
        self.assertAlmostEqual(cost["outputUsd"], 0.0125, places=12)
        self.assertAlmostEqual(cost["totalUsd"], 0.07725, places=12)

    def test_batch_halves_and_fast_doubles_everything(self):
        buckets = {"baseInputTokens": 1000, "cacheReadTokens": 2000, "cacheWrite5mTokens": 3000, "cacheWrite1hTokens": 4000, "outputTokens": 500}
        model = PRICING["models"]["claude-opus-5"]
        batch = refsim.price_tokens(buckets, model, PRICING["cacheMultipliers"], "batch", "standard")
        self.assertAlmostEqual(batch["totalUsd"], 0.07725 / 2, places=12)
        fast = refsim.price_tokens(buckets, model, PRICING["cacheMultipliers"], "standard", "fast")
        self.assertAlmostEqual(fast["totalUsd"], 0.07725 * 2, places=12)
        # Unknown tier/speed keys price at standard; unknown models price at nothing.
        odd = refsim.price_tokens(buckets, model, PRICING["cacheMultipliers"], "mystery", "warp")
        self.assertAlmostEqual(odd["totalUsd"], 0.07725, places=12)
        self.assertIsNone(refsim.price_request(req("r", 0, model="claude-mystery-9"), PRICING))

    def test_unattributed_writes_priced_at_5m(self):
        # cache_creation_input_tokens 1000 with no split → 1000 at the 5m rate.
        r = req("r", 0)
        r["usage"]["cacheCreationInputTokens"] = 1000
        r["usage"]["cacheCreation5mTokens"] = r["usage"]["cacheCreation1hTokens"] = 0
        cost = refsim.price_request(r, PRICING)
        self.assertAlmostEqual(cost["cacheWrite5mUsd"], 0.00625, places=12)
        self.assertEqual(refsim.request_write_split(r), {"fiveMinuteWriteTokens": 1000, "oneHourWriteTokens": 0})


class ShorteningTests(unittest.TestCase):
    # r1 @0s: in 10, 1h write 1000, out 5.   r2 @600s: in 10, read 1000, 1h write 200, out 5.
    def setUp(self):
        self.bucket = refsim.analyze_bucket("main", [req("r1", 0, w1h=1000), req("r2", 600, read=1000, w1h=200)], PRICING)

    def test_actual_and_reconciliation(self):
        # r1: 0.00005 + 0.01 + 0.000125 = 0.010175;  r2: 0.00005 + 0.0005 + 0.002 + 0.000125 = 0.002675
        self.assertAlmostEqual(self.bucket["actualCost"]["totalUsd"], 0.01285, places=12)
        self.assertEqual(self.bucket["scenarios"]["oneHour"]["cost"], self.bucket["actualCost"])
        self.assertEqual(self.bucket["observedTtl"], "1h")

    def test_five_minute_scenario_lapses_the_read(self):
        five = self.bucket["scenarios"]["fiveMinute"]
        # r1 at 5m: 0.00005 + 1000×$6.25 = 0.00625 + 0.000125 = 0.006425
        # r2: the 1000 read lapses (gap 600s > 300s) and joins the write: 1200×$6.25 = 0.0075
        #     → 0.00005 + 0.0075 + 0.000125 = 0.007675.  Total 0.0141.
        self.assertAlmostEqual(five["cost"]["totalUsd"], 0.0141, places=12)
        self.assertEqual(five["cacheExpiries"], 1)
        self.assertEqual(five["warmReadRequests"], 0)
        self.assertEqual(five["wastedWriteTokens"], 1000)
        self.assertEqual(kinds(five["events"]), ["cache-write", "expiry", "cache-write"])
        self.assertEqual(five["events"][1]["gapMs"], 600_000)
        self.assertEqual(five["events"][1]["rewrittenTokens"], 1000)
        self.assertEqual(self.bucket["recommendation"], "1h")
        self.assertAlmostEqual(self.bucket["savingsUsd"], 0.00125, places=12)


class LengtheningTests(unittest.TestCase):
    # observed 5m.  r1 @0s: 5m write 1000.   r2 @600s: no read, 5m write 1000 (the lapse re-write).
    def setUp(self):
        self.bucket = refsim.analyze_bucket("main", [req("r1", 0, w5m=1000), req("r2", 600, w5m=1000)], PRICING)

    def test_actual(self):
        # each: 0.00005 + 0.00625 + 0.000125 = 0.006425 → 0.01285
        self.assertAlmostEqual(self.bucket["actualCost"]["totalUsd"], 0.01285, places=12)
        self.assertEqual(self.bucket["observedTtl"], "5m")
        five = self.bucket["scenarios"]["fiveMinute"]
        self.assertEqual(five["cost"], self.bucket["actualCost"])
        # The log's own lapse is named so the timeline explains the re-write.
        self.assertEqual(kinds(five["events"]), ["cache-write", "expiry", "cache-write"])
        self.assertEqual(five["cacheExpiries"], 1)
        self.assertEqual(five["wastedWriteTokens"], 1000)

    def test_one_hour_restores_the_read(self):
        one = self.bucket["scenarios"]["oneHour"]
        # r1 at 1h: 0.00005 + 0.01 + 0.000125 = 0.010175
        # r2: warm 1000 → read 1000 (0.0005), write 0 → 0.00005 + 0.0005 + 0.000125 = 0.000675
        self.assertAlmostEqual(one["cost"]["totalUsd"], 0.01085, places=12)
        self.assertEqual(kinds(one["events"]), ["cache-write", "warm-read"])
        self.assertEqual(one["warmReadRequests"], 1)
        self.assertEqual(one["cacheExpiries"], 0)
        self.assertEqual(self.bucket["recommendation"], "1h")
        self.assertAlmostEqual(self.bucket["savingsUsd"], 0.002, places=12)

    def test_restore_is_bounded_by_what_was_warm(self):
        # r1 cached 1000; r2 re-writes 1500 → only 1000 becomes a read, 500 stays a write.
        bucket = refsim.analyze_bucket("main", [req("r1", 0, w5m=1000), req("r2", 600, w5m=1500)], PRICING)
        one = bucket["scenarios"]["oneHour"]
        self.assertEqual(one["events"][1], {"kind": "warm-read", "tokens": 1000, "timestamp": at(600), "threadId": "main", "messageId": "r2"})
        self.assertEqual(one["events"][2]["tokens"], 500)


class PartialLapseTests(unittest.TestCase):
    """The shape `fixtures/captured/scenarios/gap-heavy-5m` exhibits: after a
    >5m gap the log shows a read AND a re-write, so only part of the entry
    lapsed.  r1 @0s: 5m write 2000 (warm = 2000).  r2 @600s: read 800, 5m
    write 1500 — 1200 of the warm prefix lapsed, 300 is new content."""

    def setUp(self):
        self.bucket = refsim.analyze_bucket("main", [req("r1", 0, w5m=2000), req("r2", 600, read=800, w5m=1500)], PRICING)

    def test_five_minute_scenario_names_the_partial_expiry(self):
        # r1: 0.00005 + 2000×$6.25 = 0.0125 + 0.000125 = 0.012675
        # r2: 0.00005 + 800×$0.50 = 0.0004 + 1500×$6.25 = 0.009375 + 0.000125 = 0.00995
        five = self.bucket["scenarios"]["fiveMinute"]
        self.assertAlmostEqual(self.bucket["actualCost"]["totalUsd"], 0.022625, places=12)
        self.assertEqual(five["cost"], self.bucket["actualCost"])
        self.assertEqual(kinds(five["events"]), ["cache-write", "expiry", "warm-read", "cache-write"])
        self.assertEqual(five["cacheExpiries"], 1)
        self.assertEqual(five["warmReadRequests"], 1)
        # Only the lapsed share: min(write 1500, warm 2000 − read 800) = 1200,
        # and only that share of r1's write was wasted — 800 of it was read.
        self.assertEqual(five["events"][1]["rewrittenTokens"], 1200)
        self.assertEqual(five["wastedWriteTokens"], 1200)

    def test_one_hour_restores_only_the_lapsed_share(self):
        # r1: 0.00005 + 2000×$10 = 0.02 + 0.000125 = 0.020175
        # r2: 0.00005 + (800 + 1200)×$0.50 = 0.001 + 300×$10 = 0.003 + 0.000125 = 0.004175
        one = self.bucket["scenarios"]["oneHour"]
        self.assertAlmostEqual(one["cost"]["totalUsd"], 0.02435, places=12)
        self.assertEqual(kinds(one["events"]), ["cache-write", "warm-read", "cache-write"])
        self.assertEqual(one["events"][1]["tokens"], 2000)
        self.assertEqual(one["events"][2]["tokens"], 300)
        self.assertEqual(one["cacheExpiries"], 0)
        self.assertEqual(one["wastedWriteTokens"], 0)
        # Before partial lapses were modeled r2 re-wrote all 1500 at 1h
        # (total 0.03575); 5m still wins here, by $0.001725 not $0.013125.
        self.assertEqual(self.bucket["recommendation"], "5m")
        self.assertAlmostEqual(self.bucket["savingsUsd"], 0.001725, places=12)

    def test_a_read_wider_than_the_tracked_entry_restores_nothing(self):
        # r2 reads 2500 of a 2000-token entry: warm − read is negative, so
        # there is no lapsed share, no expiry, and the write stands.
        bucket = refsim.analyze_bucket("main", [req("r1", 0, w5m=2000), req("r2", 600, read=2500, w5m=400)], PRICING)
        one = bucket["scenarios"]["oneHour"]
        # r2 at 1h: 0.00005 + 2500×$0.50 = 0.00125 + 400×$10 = 0.004 + 0.000125 = 0.005425
        self.assertAlmostEqual(one["cost"]["totalUsd"], 0.0256, places=12)
        self.assertEqual(one["events"][2]["tokens"], 400)
        self.assertEqual(bucket["scenarios"]["fiveMinute"]["cacheExpiries"], 0)


class HardResetTests(unittest.TestCase):
    def test_model_change_empties_the_cache_and_attributes_no_expiry(self):
        # gap 600s would be an expiry under 5m, but the model changed: a reset in every scenario.
        bucket = refsim.analyze_bucket(
            "main", [req("r1", 0, w1h=1000), req("r2", 600, w1h=1000, model="claude-sonnet-5")], PRICING
        )
        for name in ("fiveMinute", "oneHour"):
            s = bucket["scenarios"][name]
            self.assertEqual(s["hardResets"], 1)
            self.assertEqual(s["cacheExpiries"], 0)
            self.assertEqual(s["wastedWriteTokens"], 1000)
            self.assertEqual(kinds(s["events"]), ["cache-write", "hard-reset", "cache-write"])
            self.assertEqual(s["events"][1]["from"], "claude-opus-5")
            self.assertEqual(s["events"][1]["to"], "claude-sonnet-5")
        # A reset request is priced per its own model: sonnet-5 1h write 1000×$4 = 0.004,
        # in 1000×$2 = 0.00002, out 5×$10 = 0.00005 → 0.00407; plus r1 0.010175 → 0.014245.
        self.assertAlmostEqual(bucket["actualCost"]["totalUsd"], 0.014245, places=12)

    def test_effort_and_version_changes_are_each_a_cause(self):
        causes = refsim.hard_reset_causes(
            req("a", 0, effort="high", version="2.1.247"), req("b", 1, effort="medium", version="2.1.251")
        )
        self.assertEqual([c["cause"] for c in causes], ["effort-change", "version-change"])
        self.assertEqual(refsim.hard_reset_causes(req("a", 0), req("b", 1)), [])


class MixedTtlTests(unittest.TestCase):
    # 1h-dominant bucket with a server-tool 5m residual.
    # r1 @0: 1h write 1000 + 5m write 100.   r2 @600s: read 1100, 1h write 50.
    def setUp(self):
        self.bucket = refsim.analyze_bucket(
            "main", [req("r1", 0, w1h=1000, w5m=100), req("r2", 600, read=1100, w1h=50)], PRICING
        )

    def test_observed_split_and_dominant_ttl(self):
        self.assertEqual(self.bucket["observedWriteSplit"], {"fiveMinuteWriteTokens": 100, "oneHourWriteTokens": 1050})
        self.assertEqual(self.bucket["observedTtl"], "1h")
        self.assertEqual(refsim.dominant_ttl({"fiveMinuteWriteTokens": 7, "oneHourWriteTokens": 7}), "1h")
        self.assertIsNone(refsim.dominant_ttl({"fiveMinuteWriteTokens": 0, "oneHourWriteTokens": 0}))

    def test_server_share_stays_5m_in_both_scenarios(self):
        # 1h (= actual): r1 0.00005 + 0.01 + 100×$6.25 = 0.000625 + 0.000125 = 0.0108
        #                r2 0.00005 + 1100×$0.50 = 0.00055 + 50×$10 = 0.0005 + 0.000125 = 0.001225 → 0.012025
        one = self.bucket["scenarios"]["oneHour"]
        self.assertAlmostEqual(one["cost"]["totalUsd"], 0.012025, places=12)
        self.assertEqual(one["cost"], self.bucket["actualCost"])
        # 5m: r1 user 1000 at 5m 0.00625 + server 100 at 5m 0.000625 + 0.000175 = 0.00705
        #     r2 read lapses → user write 50 + 1100 = 1150×$6.25 = 0.0071875 + 0.000175 = 0.0073625 → 0.0144125
        five = self.bucket["scenarios"]["fiveMinute"]
        self.assertAlmostEqual(five["cost"]["totalUsd"], 0.0144125, places=12)
        for s in (one, five):
            server = [e for e in s["events"] if e["kind"] == "cache-write" and e["expiryClass"] == "server-tool-5m"]
            self.assertEqual([(e["ttl"], e["tokens"]) for e in server], [("5m", 100)])

    def test_five_minute_dominant_bucket_reprices_every_write(self):
        # 5m-dominant with a 1h residual (config flip): all 1100 tokens are user-controlled.
        bucket = refsim.analyze_bucket("main", [req("r1", 0, w5m=1000, w1h=100)], PRICING)
        one = bucket["scenarios"]["oneHour"]
        self.assertEqual([(e["kind"], e["tokens"], e["ttl"]) for e in one["events"]], [("cache-write", 1100, "1h")])
        # 1100×$10 = 0.011 + 0.000175
        self.assertAlmostEqual(one["cost"]["totalUsd"], 0.011175, places=12)


class VerdictTests(unittest.TestCase):
    def test_unknown_model_share_above_threshold_suppresses(self):
        # r1 priced 1015 tokens; r2 unpriced 1015 tokens → share 0.5 > 0.1
        bucket = refsim.analyze_bucket("main", [req("r1", 0, w1h=1000), req("r2", 10, w1h=1000, model="claude-mystery-9")], PRICING)
        self.assertTrue(bucket["verdictSuppressed"])
        self.assertEqual(bucket["recommendation"], "no-verdict")
        self.assertEqual(bucket["suppressionReason"], "unknown-model-share-exceeded")
        self.assertAlmostEqual(bucket["unpricedTokenShare"], 0.5, places=12)
        # Unpriced requests still replay (their write is on the timeline, and the model
        # change is a hard reset) but cost nothing.
        self.assertEqual(kinds(bucket["scenarios"]["oneHour"]["events"]), ["cache-write", "hard-reset", "cache-write"])
        self.assertAlmostEqual(bucket["actualCost"]["totalUsd"], 0.010175, places=12)

    def test_unknown_model_share_below_threshold_keeps_the_verdict(self):
        # r2 unpriced: 10 in + 5 out = 15 of 1030 tokens → 0.0146
        bucket = refsim.analyze_bucket("main", [req("r1", 0, w1h=1000), req("r2", 10, model="claude-mystery-9")], PRICING)
        self.assertFalse(bucket["verdictSuppressed"])
        self.assertAlmostEqual(bucket["unpricedTokenShare"], 15 / 1030, places=12)
        self.assertNotEqual(bucket["recommendation"], "no-verdict")
        report = refsim.unknown_model_report([req("r1", 0), req("r2", 1, model="claude-mystery-9")], PRICING)
        self.assertEqual(report, {"models": ["claude-mystery-9"], "excludedRequests": 1, "excludedTotalTokens": 15})

    def test_tie_recommends_the_observed_ttl(self):
        # No writes, no reads: both scenarios cost the same; nothing to gain from switching.
        bucket = refsim.analyze_bucket("main", [req("r1", 0), req("r2", 10)], PRICING)
        self.assertIsNone(bucket["observedTtl"])
        self.assertEqual(bucket["recommendation"], "5m")
        self.assertEqual(bucket["savingsUsd"], 0)

    def test_empty_bucket_has_no_verdict(self):
        bucket = refsim.analyze_bucket("main", [], PRICING)
        self.assertEqual(bucket["recommendation"], "no-verdict")
        self.assertEqual(bucket["shape"], {"requestCount": 0, "spanMs": 0, "largestGapMs": 0, "gapsIn5mTo1hBand": 0})

    def test_config_explicitness_table(self):
        self.assertEqual(refsim.config_explicitness("1h", "1h"), "provably-explicit")
        self.assertEqual(refsim.config_explicitness("5m", "1h"), "provably-explicit")
        self.assertEqual(refsim.config_explicitness("1h", "5m"), "ambiguous")
        self.assertEqual(refsim.config_explicitness("5m", "5m"), "ambiguous")
        self.assertEqual(refsim.config_explicitness("1h", None), "unknown")
        self.assertEqual(refsim.config_explicitness(None, "5m"), "unknown")


class ThreadTests(unittest.TestCase):
    def test_threads_are_replayed_independently(self):
        # Two subagents interleaved: each thread's gap is measured against its own previous request.
        requests = [
            req("a1", 0, thread="agent-a", sidechain=True, w5m=1000),
            req("b1", 100, thread="agent-b", sidechain=True, w5m=1000),
            req("a2", 400, thread="agent-a", sidechain=True, read=1000, w5m=100),  # gap 400s (a)
            req("b2", 200, thread="agent-b", sidechain=True, read=1000, w5m=100),  # gap 100s (b)
        ]
        bucket = refsim.analyze_bucket("subagent", requests, PRICING)
        self.assertEqual(bucket["threadCount"], 2)
        self.assertEqual(bucket["shape"]["largestGapMs"], 400_000)
        self.assertEqual(bucket["shape"]["gapsIn5mTo1hBand"], 1)
        five = bucket["scenarios"]["fiveMinute"]
        self.assertEqual(kinds(five["events"])[:2], ["subagent-thread-start", "cache-write"])
        self.assertEqual(sum(1 for e in five["events"] if e["kind"] == "subagent-thread-start"), 2)
        # observed 5m: a2's 400s gap is a lapse in the log (read 1000 stands as observed — the
        # sim never rewrites observed usage in the observed scenario).
        for key, value in bucket["actualCost"].items():
            self.assertAlmostEqual(five["cost"][key], value, places=12)
        one = bucket["scenarios"]["oneHour"]
        self.assertEqual(one["cacheExpiries"], 0)

    def test_session_split_into_buckets(self):
        parsed = {
            "metadata": {"fileName": "s.jsonl", "fileSizeBytes": 1, "sessionId": None, "title": None, "cwd": None, "gitBranch": None, "models": [], "versions": [], "efforts": [], "firstTimestamp": None, "lastTimestamp": None},
            "requests": [req("m1", 0, w1h=1000), req("s1", 1, sidechain=True, w5m=500)],
            "stats": {},
            "verdict": "valid",
            "warnings": [],
        }
        result = refsim.analyze_session(parsed, PRICING)
        self.assertEqual([b["bucket"] for b in result["buckets"]], ["main", "subagent"])
        self.assertEqual([b["configExplicitness"] for b in result["buckets"]], ["ambiguous", "ambiguous"])
        parsed["requests"] = [req("m1", 0, w1h=1000)]
        self.assertEqual([b["bucket"] for b in refsim.analyze_session(parsed, PRICING)["buckets"]], ["main"])


class ParserTests(unittest.TestCase):
    def parse(self, data: bytes, known=None):
        return refsim.parse_session_bytes(data, "s.jsonl", known)

    def test_dedup_request_start_and_completion(self):
        data = jsonl(
            user("u0", None, at(0), sessionId="sess", cwd="/p", gitBranch="main"),
            attachment("t0", "u0", at(1)),
            assistant("a0", "t0", at(3), "msg_0"),
            assistant("a1", "t0", at(4), "msg_0"),  # F6: not chained to a0
            assistant("a2", "a1", at(5), "msg_0"),
            {"type": "pr-link", "prNumber": 1},
            {"type": "ai-title", "aiTitle": "first"},
            {"type": "ai-title", "aiTitle": "last"},
        )
        parsed, parser = self.parse(data)
        self.assertEqual(parsed["stats"]["assistantRows"], 3)
        self.assertEqual(parsed["stats"]["dedupedRequests"], 1)
        r = parsed["requests"][0]
        self.assertEqual(r["requestStartTimestamp"], at(0))
        self.assertEqual(r["requestStartSource"], "user-ancestor")
        self.assertEqual(r["timestamp"], at(5))
        self.assertEqual(parsed["metadata"]["title"], "last")
        self.assertEqual(parsed["metadata"]["sessionId"], "sess")
        # `pr-link` is a classified non-billing type: counted, never warned on.
        self.assertEqual(parsed["stats"]["skippedRecordTypes"], {"pr-link": 1})
        self.assertEqual(parsed["warnings"], [])
        self.assertEqual(parsed["verdict"], "valid")
        self.assertNotIn("POISON", json.dumps(parsed))

    def test_skipped_types_warn_only_when_unclassified(self):
        data = jsonl(
            user("u0", None, at(0)),
            assistant("a0", "u0", at(3), "msg_0"),
            {"type": "queue-operation"},
            {"type": "system"},
            {"type": "system\u0000"},  # sanitized away -> <other>, not `system`
            {"type": "never-seen-before"},
        )
        parsed, _ = self.parse(data)
        self.assertEqual(
            parsed["stats"]["skippedRecordTypes"],
            {"queue-operation": 1, "system": 1, "<other>": 1, "never-seen-before": 1},
        )
        self.assertEqual(
            parsed["warnings"],
            [{"kind": "skipped-record-types", "types": {"<other>": 1, "never-seen-before": 1}}],
        )
        self.assertEqual(parsed["verdict"], "valid-with-warnings")

    def test_fallback_start_synthetic_and_invalid_usage(self):
        bad = {"input_tokens": -1, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0, "output_tokens": 1}
        data = jsonl(
            assistant("a0", "missing", at(3), "msg_0"),
            assistant("a1", "a0", at(4), "msg_1", model="<synthetic>"),
            assistant("a2", "a0", at(5), "msg_2", usage=bad),
            assistant("a3", "a0", at(6), "msg_3", usage={"input_tokens": 1.5}),
            assistant("a4", "a0", at(7), "msg_4", usage={"input_tokens": 2**53}),
        )
        parsed, _ = self.parse(data)
        self.assertEqual(parsed["requests"][0]["requestStartSource"], "assistant-row-fallback")
        self.assertEqual(parsed["requests"][0]["requestStartTimestamp"], at(3))
        self.assertEqual(parsed["stats"]["syntheticRowsExcluded"], 1)
        self.assertEqual(parsed["stats"]["invalidUsageRowsSkipped"], 3)
        self.assertEqual(parsed["stats"]["dedupedRequests"], 1)

    def test_threads_modern_and_legacy(self):
        data = jsonl(
            assistant("m0", None, at(1), "msg_m"),
            assistant("s0", None, at(2), "msg_s0", isSidechain=True),
            assistant("s1", "s0", at(3), "msg_s1", isSidechain=True),
            assistant("s2", "m0", at(4), "msg_s2", isSidechain=True),  # parent is main → new thread
            assistant("g0", None, at(5), "msg_g", agentId="agent-x"),
        )
        parsed, _ = self.parse(data)
        self.assertEqual([r["threadId"] for r in parsed["requests"]], ["main", "sidechain-1", "sidechain-1", "sidechain-2", "agent-x"])
        self.assertEqual([r["isSidechain"] for r in parsed["requests"]], [False, True, True, True, True])

    def test_rejections(self):
        parsed, parser = self.parse(jsonl({"type": "user"}, {"type": "mode"}))
        self.assertEqual(parsed["verdict"], "not-a-session-log")
        self.assertEqual(parser.rejection_reason(), "no-assistant-usage-rows")
        good = jsonl(assistant("a0", None, at(1), "msg_0"))
        parsed, parser = self.parse(good + b"{garbage\n" * 2 + b"\n\n")
        self.assertEqual(parsed["stats"], parsed["stats"] | {"totalLines": 5, "nonEmptyLines": 3, "malformedLines": 2})
        self.assertEqual(parser.rejection_reason(), "malformed-lines-exceed-threshold")
        # Exactly 10% is not "exceeds".
        parsed, _ = self.parse(good * 9 + b"{garbage\n")
        self.assertEqual(parsed["verdict"], "valid-with-warnings")

    def test_hostile_metadata_and_line_handling(self):
        long_cwd = "x" * 600
        data = (
            b"\xef\xbb\xbf"
            + json.dumps(user("u0", None, at(0), cwd="/a\x00b\x1b[31m", gitBranch=long_cwd)).encode()
            + b"\r\n"
            + json.dumps(assistant("a0", "u0", at(3), "msg_0", version="9.9.9")).encode()
            + b"\r\n"
            + json.dumps({"type": "assistant", "__proto__": {"polluted": 1}, "constructor": {"prototype": {}}}).encode()
            + b"\n"
            + b"[1,2]\n"
            + b'{"type": 5}\n'
        )
        parsed, _ = self.parse(data)
        self.assertEqual(parsed["metadata"]["cwd"], "/ab[31m")
        self.assertEqual(len(parsed["metadata"]["gitBranch"]), 500)
        self.assertEqual(parsed["stats"]["malformedLines"], 3)  # no-message assistant, array, bad type
        self.assertIn({"kind": "version-out-of-range", "versions": ["9.9.9"]}, parsed["warnings"])
        self.assertEqual(parsed["stats"]["totalLines"], 5)

    def test_capped_lines_and_nan_literals(self):
        old = refsim.MAX_LINE_LENGTH_BYTES
        refsim.MAX_LINE_LENGTH_BYTES = 64
        try:
            data = jsonl(assistant("a0", None, at(1), "msg_0")) + b'{"type":"assistant","message":{"usage":{"input_tokens":NaN}}}\n'
            parsed, _ = self.parse(data)
        finally:
            refsim.MAX_LINE_LENGTH_BYTES = old
        self.assertEqual(parsed["stats"]["malformedLines"], 2)
        self.assertIn({"kind": "line-length-cap-exceeded", "count": 1}, parsed["warnings"])

    def test_unknown_models_warning_needs_the_known_set(self):
        data = jsonl(assistant("a0", None, at(1), "msg_0", model="claude-mystery-9"))
        parsed, _ = self.parse(data)
        self.assertEqual(parsed["warnings"], [])
        parsed, _ = self.parse(data, known={"claude-opus-5"})
        self.assertEqual(parsed["warnings"], [{"kind": "unknown-models", "models": ["claude-mystery-9"]}])


class GoldenTests(unittest.TestCase):
    def test_timestamp_parsing_matches_js(self):
        self.assertEqual(refsim.parse_timestamp_ms("2026-08-30T12:00:00.000Z"), T0)
        self.assertEqual(refsim.parse_timestamp_ms("2026-08-30T13:00:00.250+01:00"), T0 + 250)
        self.assertIsNone(refsim.parse_timestamp_ms("yesterday"))
        self.assertIsNone(refsim.parse_timestamp_ms("2026-13-01T00:00:00Z"))

    def test_analyze_file_produces_a_rejection_or_an_analysis(self):
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "x.jsonl"
            p.write_bytes(jsonl({"type": "mode"}))
            golden = refsim.analyze_file(p, PRICING, "x")
            self.assertEqual(golden["outcome"], "rejected")
            self.assertEqual(golden["rejection"]["reason"], "no-assistant-usage-rows")
            p.write_bytes(jsonl(user("u0", None, at(0)), assistant("a0", "u0", at(3), "msg_0")))
            golden = refsim.analyze_file(p, PRICING, "x")
            self.assertEqual(golden["outcome"], "analysis")
            self.assertEqual(golden["buckets"][0]["requestCount"], 1)
            self.assertNotIn("POISON", json.dumps(golden))


if __name__ == "__main__":
    unittest.main()
