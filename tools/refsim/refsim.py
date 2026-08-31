#!/usr/bin/env python3
"""Reference simulator — the independently written second implementation.

Re-implements, in plain Python, what the TypeScript engine under `src/engine/`
does: parse a Claude Code session log, price it at published API rates, and
replay it under each cache TTL. Its output is committed as golden files that
the TS engine must reproduce (`src/engine/golden.test.ts`).

The spec it follows is docs/PLAN.md §2 (the correctness-rules table and the
input-validation rules), the frozen contract in `src/engine/contract.ts`, and
the WP-05 implementation notes in docs/PLAN.md. It shares no code with the
engine; the only shared input is `src/config/pricing.json`. Neither side is
the oracle — disagreements are settled by hand computation (PLAN §5).

Usage:
    refsim.py analyze  FILE.jsonl [--pricing P] [--file-name N]   # one file, JSON to stdout
    refsim.py emit     [--fixtures fixtures/fixtures.json]        # write every golden
    refsim.py check    [--fixtures fixtures/fixtures.json]        # fail if any golden is stale
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PRICING = REPO_ROOT / "src" / "config" / "pricing.json"
DEFAULT_FIXTURES = REPO_ROOT / "fixtures" / "fixtures.json"

# --- Named contract constants (src/engine/contract.ts) ----------------------

TTL_MS = {"5m": 5 * 60_000, "1h": 60 * 60_000}
MALFORMED_LINE_REJECT_RATIO = 0.1
UNKNOWN_MODEL_SUPPRESSION_RATIO = 0.1
VALIDATED_VERSION_RANGE = ("2.1.193", "2.1.251")
MAX_LINE_LENGTH_BYTES = 10 * 1024 * 1024
MAX_METADATA_STRING_LENGTH = 500
MAX_TIMESTAMP_LENGTH = 64
MAX_SAFE_INTEGER = 2**53 - 1
# Parser (src/engine/parser.ts) constants that shape ParseStats.
MAX_DISTINCT_SKIPPED_TYPES = 100
OTHER_SKIPPED_TYPES_KEY = "<other>"
MAIN_THREAD_ID = "main"
LEGACY_SIDECHAIN_THREAD_PREFIX = "sidechain-"
SYNTHETIC_MODEL_ID = "<synthetic>"

GOLDEN_SCHEMA = "cache-ttl-analyzer/golden/v1"

# Marker every synthetic fixture plants inside conversation content; it must
# never reach a golden (PLAN §2 "never reads message.content").
CONTENT_POISON = "POISON"

CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f-\x9f]")


# ---------------------------------------------------------------------------
# Timestamps
# ---------------------------------------------------------------------------

_ISO_RE = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})?$"
)


def parse_timestamp_ms(text: str) -> int | None:
    """ISO-8601 -> epoch milliseconds (truncated), or None when unparseable.

    Mirrors what `Date.parse` accepts for the timestamps Claude Code writes
    (`YYYY-MM-DDTHH:MM:SS.mmmZ`); anything else counts as invalid.
    """
    m = _ISO_RE.match(text)
    if not m:
        return None
    year, month, day, hour, minute, second = (int(m.group(i)) for i in range(1, 7))
    frac = m.group(7) or "0"
    millis = int((frac + "000")[:3])
    tz = m.group(8)
    try:
        base = datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)
    except ValueError:
        return None
    offset_min = 0
    if tz and tz != "Z":
        sign = 1 if tz[0] == "+" else -1
        digits = tz[1:].replace(":", "")
        offset_min = sign * (int(digits[:2]) * 60 + int(digits[2:]))
    ms = int(base.timestamp()) * 1000 + millis - offset_min * 60_000
    return ms


# ---------------------------------------------------------------------------
# Field readers — the only way values leave a parsed object
# ---------------------------------------------------------------------------


def is_object(value) -> bool:
    return isinstance(value, dict)


def utf16_length(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def sanitize_metadata_string(value: str) -> str:
    text = CONTROL_CHARS.sub("", value)
    # The clamp is in UTF-16 code units (a JS string length): a supplementary
    # character counts twice, and a dangling high surrogate is dropped.
    if utf16_length(text) > MAX_METADATA_STRING_LENGTH:
        units = text.encode("utf-16-le")
        cut = units[: MAX_METADATA_STRING_LENGTH * 2]
        last = int.from_bytes(cut[-2:], "little")
        if 0xD800 <= last <= 0xDBFF:
            cut = cut[:-2]
        text = cut.decode("utf-16-le")
    return text


def read_string(obj: dict, key: str) -> str | None:
    value = obj.get(key)
    if not isinstance(value, str):
        return None
    text = sanitize_metadata_string(value)
    return text if text else None


def read_identifier(obj: dict, key: str) -> str | None:
    value = obj.get(key)
    if not isinstance(value, str) or not value:
        return None
    if utf16_length(value) > MAX_METADATA_STRING_LENGTH or CONTROL_CHARS.search(value):
        return None
    return value


def read_timestamp(obj: dict) -> str | None:
    value = obj.get("timestamp")
    if not isinstance(value, str) or not value or len(value) > MAX_TIMESTAMP_LENGTH:
        return None
    if CONTROL_CHARS.search(value):
        return None
    return value if parse_timestamp_ms(value) is not None else None


_INVALID = object()


def read_token_count(obj: dict, key: str):
    """Absent/null -> 0; otherwise a non-negative safe integer, else _INVALID."""
    value = obj.get(key)
    if value is None:
        return 0
    if isinstance(value, bool):
        return _INVALID
    if isinstance(value, int):
        return value if 0 <= value <= MAX_SAFE_INTEGER else _INVALID
    if isinstance(value, float):
        if not math.isfinite(value) or value < 0 or value != int(value):
            return _INVALID
        return int(value) if value <= MAX_SAFE_INTEGER else _INVALID
    return _INVALID


def parse_usage(value) -> dict | None:
    if not is_object(value):
        return None
    counts = {
        "inputTokens": read_token_count(value, "input_tokens"),
        "cacheReadInputTokens": read_token_count(value, "cache_read_input_tokens"),
        "cacheCreationInputTokens": read_token_count(value, "cache_creation_input_tokens"),
        "outputTokens": read_token_count(value, "output_tokens"),
        "cacheCreation5mTokens": 0,
        "cacheCreation1hTokens": 0,
    }
    split = value.get("cache_creation")
    if split is not None:
        if not is_object(split):
            return None
        counts["cacheCreation5mTokens"] = read_token_count(split, "ephemeral_5m_input_tokens")
        counts["cacheCreation1hTokens"] = read_token_count(split, "ephemeral_1h_input_tokens")
    if any(v is _INVALID for v in counts.values()):
        return None
    counts["serviceTier"] = read_string(value, "service_tier") or "standard"
    counts["speed"] = read_string(value, "speed") or "standard"
    return counts


# ---------------------------------------------------------------------------
# Version range (warn, never fail)
# ---------------------------------------------------------------------------


def parse_version(text: str):
    m = re.match(r"^(\d{1,9})\.(\d{1,9})\.(\d{1,9})$", text)
    return tuple(int(g) for g in m.groups()) if m else None


def version_in_range(text: str) -> bool:
    v = parse_version(text)
    if v is None:
        return False
    lo, hi = (parse_version(b) for b in VALIDATED_VERSION_RANGE)
    return lo <= v <= hi


# ---------------------------------------------------------------------------
# Line splitting (src/engine/jsonl-stream.ts semantics)
# ---------------------------------------------------------------------------


def iter_lines(data: bytes):
    """Yield ('line', text) or ('capped', nbytes) per JSONL line.

    Every `\\n` terminates a line; a final unterminated line still counts; a
    trailing `\\r` and a BOM on the first line are stripped; a line whose
    byte length exceeds the cap is reported as capped, never decoded.
    """
    first = True
    start = 0
    n = len(data)
    while start <= n:
        end = data.find(b"\n", start)
        if end < 0:
            if start == n:
                break
            end = n
        raw = data[start:end]
        if len(raw) > MAX_LINE_LENGTH_BYTES:
            yield ("capped", len(raw))
        else:
            if raw.endswith(b"\r"):
                raw = raw[:-1]
            if first and raw.startswith(b"\xef\xbb\xbf"):
                raw = raw[3:]
            yield ("line", raw.decode("utf-8", errors="replace"))
        first = False
        start = end + 1


# ---------------------------------------------------------------------------
# Parser -> ParsedSession
# ---------------------------------------------------------------------------


def _js_json_loads(text: str):
    """JSON.parse-compatible loading: NaN/Infinity literals are rejected."""

    def reject_constant(name):
        raise ValueError(f"invalid JSON constant {name}")

    return json.loads(text, parse_constant=reject_constant)


class SessionParser:
    def __init__(self, file_name: str, file_size: int, known_models=None):
        self.file_name = file_name
        self.file_size = file_size
        self.known_models = known_models
        self.stats = {
            "totalLines": 0,
            "nonEmptyLines": 0,
            "malformedLines": 0,
            "skippedRecordTypes": {},
            "assistantRows": 0,
            "dedupedRequests": 0,
            "syntheticRowsExcluded": 0,
            "invalidUsageRowsSkipped": 0,
        }
        self.capped_lines = 0
        self.requests: list[dict] = []
        self.index_by_id: dict[str, int] = {}
        self.chain: dict[str, dict] = {}
        self.legacy_thread_by_uuid: dict[str, str] = {}
        self.legacy_thread_count = 0
        self.models: list[str] = []
        self.versions: list[str] = []
        self.efforts: list[str] = []
        self.session_id = None
        self.title = None
        self.cwd = None
        self.git_branch = None
        self.first_ms = None
        self.first_iso = None
        self.last_ms = None
        self.last_iso = None

    # -- feeding -----------------------------------------------------------

    def feed(self, event) -> None:
        kind, payload = event
        self.stats["totalLines"] += 1
        if kind == "capped":
            self.stats["nonEmptyLines"] += 1
            self.stats["malformedLines"] += 1
            self.capped_lines += 1
            return
        if payload.strip() == "":
            return
        self.stats["nonEmptyLines"] += 1
        try:
            value = _js_json_loads(payload)
        except (ValueError, RecursionError):
            self.stats["malformedLines"] += 1
            return
        self.ingest(value)

    def ingest(self, value) -> None:
        if not is_object(value):
            self.stats["malformedLines"] += 1
            return
        type_ = value.get("type")
        if not isinstance(type_, str):
            self.stats["malformedLines"] += 1
            return
        if type_ == "assistant":
            self.ingest_assistant(value)
        elif type_ == "user":
            self.index_chain_row(value, True)
            self.note_session_fields(value)
        elif type_ == "attachment":
            self.index_chain_row(value, False)
            self.note_session_fields(value)
        elif type_ == "ai-title":
            self.title = read_string(value, "aiTitle") or self.title
            self.note_session_fields(value)
        else:
            self.index_chain_row(value, False)
            self.count_skipped(type_)

    def count_skipped(self, type_: str) -> None:
        key = sanitize_metadata_string(type_) or OTHER_SKIPPED_TYPES_KEY
        skipped = self.stats["skippedRecordTypes"]
        if key not in skipped and len(skipped) >= MAX_DISTINCT_SKIPPED_TYPES:
            key = OTHER_SKIPPED_TYPES_KEY
        skipped[key] = skipped.get(key, 0) + 1

    def note_session_fields(self, row: dict) -> None:
        if self.session_id is None:
            self.session_id = read_string(row, "sessionId")
        if self.cwd is None:
            self.cwd = read_string(row, "cwd")
        if self.git_branch is None:
            self.git_branch = read_string(row, "gitBranch")

    def index_chain_row(self, row: dict, is_user: bool) -> str | None:
        uuid = read_identifier(row, "uuid")
        if uuid is None:
            return None
        if uuid not in self.chain:
            self.chain[uuid] = {
                "parent": read_identifier(row, "parentUuid"),
                "timestamp": read_timestamp(row),
                "isUser": is_user,
                "isSidechain": row.get("isSidechain") is True,
            }
        return uuid

    def ingest_assistant(self, row: dict) -> None:
        self.stats["assistantRows"] += 1
        uuid = self.index_chain_row(row, False)
        self.note_session_fields(row)
        message = row.get("message")
        if not is_object(message):
            self.stats["malformedLines"] += 1
            return
        model = read_string(message, "model")
        if model == SYNTHETIC_MODEL_ID:
            self.stats["syntheticRowsExcluded"] += 1
            return
        message_id = read_identifier(message, "id")
        timestamp = read_timestamp(row)
        raw_usage = message.get("usage")
        if model is None or message_id is None or timestamp is None or not is_object(raw_usage):
            self.stats["malformedLines"] += 1
            return

        existing = self.index_by_id.get(message_id)
        if existing is not None:
            record = self.requests[existing]
            if parse_timestamp_ms(timestamp) > parse_timestamp_ms(record["timestamp"]):
                record["timestamp"] = timestamp
                self.note_last(timestamp)
            return

        usage = parse_usage(raw_usage)
        if usage is None:
            self.stats["invalidUsageRowsSkipped"] += 1
            return

        agent_id = read_identifier(row, "agentId")
        if agent_id is not None:
            thread_id, is_sidechain = agent_id, True
        elif row.get("isSidechain") is True:
            thread_id, is_sidechain = self.legacy_thread_for(uuid), True
        else:
            thread_id, is_sidechain = MAIN_THREAD_ID, False

        start = self.resolve_request_start(read_identifier(row, "parentUuid"))
        record = {
            "messageId": message_id,
            "model": model,
            "timestamp": timestamp,
            "requestStartTimestamp": start if start is not None else timestamp,
            "requestStartSource": "user-ancestor" if start is not None else "assistant-row-fallback",
            "threadId": thread_id,
            "isSidechain": is_sidechain,
            "usage": usage,
        }
        effort = read_string(row, "effort")
        if effort is not None:
            record["effort"] = effort
        version = read_string(row, "version")
        if version is not None:
            record["version"] = version

        self.index_by_id[message_id] = len(self.requests)
        self.requests.append(record)
        self.stats["dedupedRequests"] += 1
        if model not in self.models:
            self.models.append(model)
        if version is not None and version not in self.versions:
            self.versions.append(version)
        if effort is not None and effort not in self.efforts:
            self.efforts.append(effort)
        self.note_first(record["requestStartTimestamp"])
        self.note_last(timestamp)

    def resolve_request_start(self, parent_uuid: str | None) -> str | None:
        visited = set()
        current = parent_uuid
        while current is not None and current not in visited:
            visited.add(current)
            entry = self.chain.get(current)
            if entry is None:
                break
            if entry["isUser"] and entry["timestamp"] is not None:
                return entry["timestamp"]
            current = entry["parent"]
        return None

    def legacy_thread_for(self, uuid: str | None) -> str:
        if uuid is None:
            return self.new_legacy_thread()
        path = []
        visited = set()
        current = uuid
        thread_id = None
        while True:
            memo = self.legacy_thread_by_uuid.get(current)
            if memo is not None:
                thread_id = memo
                break
            visited.add(current)
            path.append(current)
            entry = self.chain.get(current)
            parent = entry["parent"] if entry else None
            if parent is None or parent in visited:
                break
            parent_entry = self.chain.get(parent)
            if parent_entry is None or not parent_entry["isSidechain"]:
                break
            current = parent
        if thread_id is None:
            thread_id = self.new_legacy_thread()
        for id_ in path:
            self.legacy_thread_by_uuid[id_] = thread_id
        return thread_id

    def new_legacy_thread(self) -> str:
        self.legacy_thread_count += 1
        return f"{LEGACY_SIDECHAIN_THREAD_PREFIX}{self.legacy_thread_count}"

    def note_first(self, iso: str) -> None:
        ms = parse_timestamp_ms(iso)
        if self.first_ms is None or ms < self.first_ms:
            self.first_ms, self.first_iso = ms, iso

    def note_last(self, iso: str) -> None:
        ms = parse_timestamp_ms(iso)
        if self.last_ms is None or ms > self.last_ms:
            self.last_ms, self.last_iso = ms, iso

    # -- finishing ---------------------------------------------------------

    def malformed_ratio_exceeded(self) -> bool:
        s = self.stats
        if s["nonEmptyLines"] == 0:
            return False
        return s["malformedLines"] / s["nonEmptyLines"] > MALFORMED_LINE_REJECT_RATIO

    def warnings(self) -> list[dict]:
        s = self.stats
        out = []
        if s["malformedLines"] > 0:
            out.append({"kind": "malformed-lines", "count": s["malformedLines"]})
        if self.capped_lines > 0:
            out.append({"kind": "line-length-cap-exceeded", "count": self.capped_lines})
        if s["skippedRecordTypes"]:
            out.append({"kind": "skipped-record-types", "types": dict(s["skippedRecordTypes"])})
        out_of_range = [v for v in self.versions if not version_in_range(v)]
        if out_of_range:
            out.append({"kind": "version-out-of-range", "versions": out_of_range})
        if self.known_models is not None:
            unknown = [m for m in self.models if m not in self.known_models]
            if unknown:
                out.append({"kind": "unknown-models", "models": unknown})
        if s["invalidUsageRowsSkipped"] > 0:
            out.append({"kind": "invalid-usage-rows", "count": s["invalidUsageRowsSkipped"]})
        return out

    def finish(self) -> dict:
        warnings = self.warnings()
        rejected = self.stats["dedupedRequests"] == 0 or self.malformed_ratio_exceeded()
        verdict = "not-a-session-log" if rejected else ("valid-with-warnings" if warnings else "valid")
        metadata = {
            "sessionId": self.session_id,
            "title": self.title,
            "cwd": self.cwd,
            "gitBranch": self.git_branch,
            "models": list(self.models),
            "versions": list(self.versions),
            "efforts": list(self.efforts),
            "firstTimestamp": self.first_iso,
            "lastTimestamp": self.last_iso,
            "fileName": self.file_name,
            "fileSizeBytes": self.file_size,
        }
        return {
            "metadata": metadata,
            "requests": list(self.requests),
            "stats": dict(self.stats, skippedRecordTypes=dict(self.stats["skippedRecordTypes"])),
            "verdict": verdict,
            "warnings": warnings,
        }

    def rejection_reason(self) -> str:
        return "malformed-lines-exceed-threshold" if self.malformed_ratio_exceeded() else "no-assistant-usage-rows"


def parse_session_bytes(data: bytes, file_name: str, known_models=None) -> tuple[dict, SessionParser]:
    parser = SessionParser(file_name, len(data), known_models)
    for event in iter_lines(data):
        parser.feed(event)
    return parser.finish(), parser


# ---------------------------------------------------------------------------
# Pricing (src/engine/cost.ts semantics over src/config/pricing.json)
# ---------------------------------------------------------------------------

TOKENS_PER_MTOK = 1_000_000


def load_pricing(path: Path = DEFAULT_PRICING) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def multiplier(map_: dict | None, key: str) -> float:
    if not map_ or key not in map_:
        return 1.0
    return float(map_[key])


ZERO_COST = {
    "baseInputUsd": 0.0,
    "cacheReadUsd": 0.0,
    "cacheWrite5mUsd": 0.0,
    "cacheWrite1hUsd": 0.0,
    "outputUsd": 0.0,
    "totalUsd": 0.0,
}


def price_tokens(buckets: dict, model: dict, cache: dict, tier: str, speed: str) -> dict:
    scale = multiplier(model.get("serviceTierMultipliers"), tier) * multiplier(
        model.get("speedMultipliers"), speed
    )
    input_rate = model["inputPerMTok"] * scale
    output_rate = model["outputPerMTok"] * scale

    def per(tokens, rate):
        return (tokens / TOKENS_PER_MTOK) * rate

    cost = {
        "baseInputUsd": per(buckets["baseInputTokens"], input_rate),
        "cacheReadUsd": per(buckets["cacheReadTokens"], input_rate * cache["read"]),
        "cacheWrite5mUsd": per(buckets["cacheWrite5mTokens"], input_rate * cache["write5m"]),
        "cacheWrite1hUsd": per(buckets["cacheWrite1hTokens"], input_rate * cache["write1h"]),
        "outputUsd": per(buckets["outputTokens"], output_rate),
    }
    cost["totalUsd"] = sum(cost.values())
    return cost


def unattributed_write_tokens(usage: dict) -> int:
    return max(
        0,
        usage["cacheCreationInputTokens"] - usage["cacheCreation5mTokens"] - usage["cacheCreation1hTokens"],
    )


def buckets_from_usage(usage: dict) -> dict:
    return {
        "baseInputTokens": usage["inputTokens"],
        "cacheReadTokens": usage["cacheReadInputTokens"],
        "cacheWrite5mTokens": usage["cacheCreation5mTokens"] + unattributed_write_tokens(usage),
        "cacheWrite1hTokens": usage["cacheCreation1hTokens"],
        "outputTokens": usage["outputTokens"],
    }


def total_tokens(usage: dict) -> int:
    return (
        usage["inputTokens"]
        + usage["cacheReadInputTokens"]
        + usage["cacheCreationInputTokens"]
        + usage["outputTokens"]
    )


def lookup_model(pricing: dict, model_id: str) -> dict | None:
    return pricing["models"].get(model_id)


def price_request(request: dict, pricing: dict) -> dict | None:
    model = lookup_model(pricing, request["model"])
    if model is None:
        return None
    u = request["usage"]
    return price_tokens(buckets_from_usage(u), model, pricing["cacheMultipliers"], u["serviceTier"], u["speed"])


def add_costs(a: dict, b: dict) -> dict:
    return {k: a[k] + b[k] for k in ZERO_COST}


def sum_costs(costs) -> dict:
    total = dict(ZERO_COST)
    for c in costs:
        total = add_costs(total, c)
    return total


def unknown_model_report(requests: list[dict], pricing: dict) -> dict:
    models = []
    excluded = 0
    tokens = 0
    for r in requests:
        if lookup_model(pricing, r["model"]) is not None:
            continue
        if r["model"] not in models:
            models.append(r["model"])
        excluded += 1
        tokens += total_tokens(r["usage"])
    return {"models": models, "excludedRequests": excluded, "excludedTotalTokens": tokens}


# ---------------------------------------------------------------------------
# Simulator (PLAN §2 rules, contract mixed-TTL policy, WP-05 notes)
# ---------------------------------------------------------------------------


def request_write_split(request: dict) -> dict:
    u = request["usage"]
    return {
        "fiveMinuteWriteTokens": u["cacheCreation5mTokens"] + unattributed_write_tokens(u),
        "oneHourWriteTokens": u["cacheCreation1hTokens"],
    }


def sum_write_splits(requests) -> dict:
    five = one = 0
    for r in requests:
        s = request_write_split(r)
        five += s["fiveMinuteWriteTokens"]
        one += s["oneHourWriteTokens"]
    return {"fiveMinuteWriteTokens": five, "oneHourWriteTokens": one}


def dominant_ttl(split: dict) -> str | None:
    if split["fiveMinuteWriteTokens"] == 0 and split["oneHourWriteTokens"] == 0:
        return None
    return "5m" if split["fiveMinuteWriteTokens"] > split["oneHourWriteTokens"] else "1h"


def hard_reset_causes(previous: dict, current: dict) -> list[dict]:
    causes = []
    if previous["model"] != current["model"]:
        causes.append({"cause": "model-change", "from": previous["model"], "to": current["model"]})
    if previous.get("effort", "") != current.get("effort", ""):
        causes.append(
            {"cause": "effort-change", "from": previous.get("effort", ""), "to": current.get("effort", "")}
        )
    if previous.get("version", "") != current.get("version", ""):
        causes.append(
            {"cause": "version-change", "from": previous.get("version", ""), "to": current.get("version", "")}
        )
    return causes


def gap_ms(previous: dict, current: dict) -> int:
    return max(
        0,
        parse_timestamp_ms(current["requestStartTimestamp"]) - parse_timestamp_ms(previous["requestStartTimestamp"]),
    )


def group_by_thread(requests) -> dict[str, list[dict]]:
    threads: dict[str, list[dict]] = {}
    for r in requests:
        threads.setdefault(r["threadId"], []).append(r)
    return threads


def replay_thread(thread: list[dict], scenario: str, bucket_ttl: str | None, pricing: dict) -> dict:
    """Replay one cache thread under `scenario`.

    The entry written at request r-1 is alive at request r iff the gap
    between the two request STARTS is within the TTL. The observed TTL of a
    warm entry is the bucket's dominant (user-controlled) TTL. Only the
    requests where the observed and scenario windows disagree are edited
    (feasibility §7 + the WP-05 lengthening rule): all-or-nothing for a
    whole entry, but an entry the log only partly read back lapsed only
    partly, and the counterfactual splits it at what was read.
    """
    scenario_ms = TTL_MS[scenario]
    events: list[dict] = []
    costs: list[dict] = []
    expiries = resets = warm_reads = 0
    wasted = 0
    warm_tokens = 0  # cached after the previous request
    previous_user_write = 0
    previous = None

    for request in thread:
        base = {
            "timestamp": request["requestStartTimestamp"],
            "threadId": request["threadId"],
            "messageId": request["messageId"],
        }
        usage = request["usage"]
        split = request_write_split(request)
        user_ttl = bucket_ttl if bucket_ttl is not None else scenario
        if user_ttl == "5m":
            # 5m-dominant bucket: every write is user-controlled (a 1h
            # residual is a mid-session config flip, not a server tool).
            user_write = split["fiveMinuteWriteTokens"] + split["oneHourWriteTokens"]
            server_write = 0
        else:
            # 1h-dominant bucket: the 5m residual is the server-tool share.
            user_write = split["oneHourWriteTokens"]
            server_write = split["fiveMinuteWriteTokens"]
        reads = usage["cacheReadInputTokens"]

        if previous is not None:
            causes = hard_reset_causes(previous, request)
            if causes:
                for c in causes:
                    events.append({"kind": "hard-reset", **c, **base})
                resets += 1
                wasted += previous_user_write
                warm_tokens = 0
            else:
                gap = gap_ms(previous, request)
                alive_observed = gap <= TTL_MS[user_ttl]
                alive_scenario = gap <= scenario_ms
                # The share of the warm entry the log did not read back:
                # zero on a full hit, the whole entry on a total lapse, and
                # something in between on a partial lapse (a stable prefix
                # survives while the tail expires — see `gap-heavy-5m`).
                lapsed = max(0, warm_tokens - reads)
                if alive_observed and not alive_scenario:
                    # Shortening: the read the log shows would have lapsed.
                    if reads > 0:
                        events.append(
                            {
                                "kind": "expiry",
                                "gapMs": gap,
                                "expiryClass": "user-controlled",
                                "rewrittenTokens": reads,
                                **base,
                            }
                        )
                        expiries += 1
                        # Waste is bounded by what lapsed; here the whole
                        # entry goes, and the previous write is never larger.
                        wasted += min(previous_user_write, warm_tokens)
                        user_write += reads
                        reads = 0
                elif not alive_observed and alive_scenario:
                    # Lengthening: the share the log re-wrote was still warm.
                    # A partial lapse restores only the share that expired.
                    if user_write > 0 and lapsed > 0:
                        restored = min(user_write, lapsed)
                        reads += restored
                        user_write -= restored
                elif not alive_observed and not alive_scenario:
                    # Lapsed in the log and the scenario alike: name it.
                    if user_write > 0 and lapsed > 0:
                        events.append(
                            {
                                "kind": "expiry",
                                "gapMs": gap,
                                "expiryClass": "user-controlled",
                                "rewrittenTokens": min(user_write, lapsed),
                                **base,
                            }
                        )
                        expiries += 1
                        wasted += min(previous_user_write, lapsed)

        if reads > 0:
            warm_reads += 1
            events.append({"kind": "warm-read", "tokens": reads, **base})
        if user_write > 0:
            events.append(
                {"kind": "cache-write", "ttl": scenario, "tokens": user_write, "expiryClass": "user-controlled", **base}
            )
        if server_write > 0:
            events.append(
                {"kind": "cache-write", "ttl": "5m", "tokens": server_write, "expiryClass": "server-tool-5m", **base}
            )

        model = lookup_model(pricing, request["model"])
        if model is not None:
            costs.append(
                price_tokens(
                    {
                        "baseInputTokens": usage["inputTokens"],
                        "cacheReadTokens": reads,
                        "cacheWrite5mTokens": (user_write if scenario == "5m" else 0) + server_write,
                        "cacheWrite1hTokens": user_write if scenario == "1h" else 0,
                        "outputTokens": usage["outputTokens"],
                    },
                    model,
                    pricing["cacheMultipliers"],
                    usage["serviceTier"],
                    usage["speed"],
                )
            )

        warm_tokens = reads + user_write + server_write
        previous_user_write = user_write
        previous = request

    return {
        "cost": sum_costs(costs),
        "events": events,
        "cacheExpiries": expiries,
        "hardResets": resets,
        "warmReadRequests": warm_reads,
        "wastedWriteTokens": wasted,
    }


def simulate_scenario(threads: dict[str, list[dict]], scenario: str, bucket_ttl: str | None, pricing: dict) -> dict:
    result = {
        "ttl": scenario,
        "cost": dict(ZERO_COST),
        "events": [],
        "cacheExpiries": 0,
        "hardResets": 0,
        "warmReadRequests": 0,
        "wastedWriteTokens": 0,
    }
    costs = []
    for thread_id, thread in threads.items():
        first = thread[0]
        if first["isSidechain"]:
            result["events"].append(
                {
                    "kind": "subagent-thread-start",
                    "timestamp": first["requestStartTimestamp"],
                    "threadId": thread_id,
                    "messageId": first["messageId"],
                }
            )
        replay = replay_thread(thread, scenario, bucket_ttl, pricing)
        costs.append(replay["cost"])
        result["events"].extend(replay["events"])
        for key in ("cacheExpiries", "hardResets", "warmReadRequests", "wastedWriteTokens"):
            result[key] += replay[key]
    result["cost"] = sum_costs(costs)
    # Stable sort by request start, like the engine's Array.prototype.sort.
    result["events"].sort(key=lambda e: parse_timestamp_ms(e["timestamp"]))
    return result


def session_shape(requests: list[dict], threads: dict[str, list[dict]]) -> dict:
    if not requests:
        span = 0
    else:
        first_start = min(parse_timestamp_ms(r["requestStartTimestamp"]) for r in requests)
        last_end = max(parse_timestamp_ms(r["timestamp"]) for r in requests)
        span = max(0, last_end - first_start)
    largest = 0
    in_band = 0
    for thread in threads.values():
        for i in range(1, len(thread)):
            gap = gap_ms(thread[i - 1], thread[i])
            largest = max(largest, gap)
            if TTL_MS["5m"] < gap <= TTL_MS["1h"]:
                in_band += 1
    return {
        "requestCount": len(requests),
        "spanMs": span,
        "largestGapMs": largest,
        "gapsIn5mTo1hBand": in_band,
    }


def analyze_bucket(bucket: str, requests: list[dict], pricing: dict) -> dict:
    threads = group_by_thread(requests)
    observed_split = sum_write_splits(requests)
    observed_ttl = dominant_ttl(observed_split)

    actual_costs = []
    bucket_tokens = 0
    unpriced_tokens = 0
    for r in requests:
        tokens = total_tokens(r["usage"])
        bucket_tokens += tokens
        cost = price_request(r, pricing)
        if cost is not None:
            actual_costs.append(cost)
        else:
            unpriced_tokens += tokens
    actual_cost = sum_costs(actual_costs)
    unpriced_share = 0.0 if bucket_tokens == 0 else unpriced_tokens / bucket_tokens

    five = simulate_scenario(threads, "5m", observed_ttl, pricing)
    one = simulate_scenario(threads, "1h", observed_ttl, pricing)

    suppressed = unpriced_share > UNKNOWN_MODEL_SUPPRESSION_RATIO
    if suppressed or not requests:
        recommendation = "no-verdict"
    elif five["cost"]["totalUsd"] < one["cost"]["totalUsd"]:
        recommendation = "5m"
    elif one["cost"]["totalUsd"] < five["cost"]["totalUsd"]:
        recommendation = "1h"
    else:
        recommendation = observed_ttl if observed_ttl is not None else "5m"

    analysis = {
        "bucket": bucket,
        "threadCount": len(threads),
        "requestCount": len(requests),
        "actualCost": actual_cost,
        "observedWriteSplit": observed_split,
        "observedTtl": observed_ttl,
        "scenarios": {"fiveMinute": five, "oneHour": one},
        "recommendation": recommendation,
        "savingsUsd": abs(five["cost"]["totalUsd"] - one["cost"]["totalUsd"]),
        "verdictSuppressed": suppressed,
        "unpricedTokenShare": unpriced_share,
        "shape": session_shape(requests, threads),
    }
    if suppressed:
        analysis["suppressionReason"] = "unknown-model-share-exceeded"
    return analysis


def config_explicitness(main_ttl, subagent_ttl) -> str:
    if main_ttl is None or subagent_ttl is None:
        return "unknown"
    if (main_ttl, subagent_ttl) in (("1h", "1h"), ("5m", "1h")):
        return "provably-explicit"
    return "ambiguous"


def analyze_session(parsed: dict, pricing: dict) -> dict:
    main_requests = [r for r in parsed["requests"] if not r["isSidechain"]]
    sub_requests = [r for r in parsed["requests"] if r["isSidechain"]]
    main = analyze_bucket("main", main_requests, pricing)
    sub = analyze_bucket("subagent", sub_requests, pricing) if sub_requests else None
    explicitness = config_explicitness(main["observedTtl"], sub["observedTtl"] if sub else None)
    buckets = [dict(main, configExplicitness=explicitness)]
    if sub is not None:
        buckets.append(dict(sub, configExplicitness=explicitness))
    return {
        "metadata": parsed["metadata"],
        "parseStats": parsed["stats"],
        "parseWarnings": parsed["warnings"],
        "buckets": buckets,
        "unknownModels": unknown_model_report(parsed["requests"], pricing),
        "pricesAsOf": pricing["pricesAsOf"],
        "approximation": {"allOrNothingExpiry": True, "conservativeToward": "5m"},
    }


# ---------------------------------------------------------------------------
# Golden files
# ---------------------------------------------------------------------------


def golden_bucket(b: dict) -> dict:
    """Key order fixed so goldens diff cleanly."""
    out = {
        "bucket": b["bucket"],
        "threadCount": b["threadCount"],
        "requestCount": b["requestCount"],
        "actualCost": b["actualCost"],
        "observedWriteSplit": b["observedWriteSplit"],
        "observedTtl": b["observedTtl"],
        "configExplicitness": b["configExplicitness"],
        "scenarios": b["scenarios"],
        "recommendation": b["recommendation"],
        "savingsUsd": b["savingsUsd"],
        "verdictSuppressed": b["verdictSuppressed"],
        "unpricedTokenShare": b["unpricedTokenShare"],
        "shape": b["shape"],
    }
    if "suppressionReason" in b:
        out["suppressionReason"] = b["suppressionReason"]
    return out


def golden_metadata(m: dict) -> dict:
    # fileName / fileSizeBytes are inputs, not analysis; omit them.
    return {k: m[k] for k in (
        "sessionId", "title", "cwd", "gitBranch", "models", "versions", "efforts", "firstTimestamp", "lastTimestamp"
    ) if m[k] is not None}


def analyze_file(path: Path, pricing: dict, fixture_id: str, file_name: str | None = None) -> dict:
    data = path.read_bytes()
    parsed, parser = parse_session_bytes(data, file_name or path.name, set(pricing["models"]))
    golden = {"$schema": GOLDEN_SCHEMA, "fixture": fixture_id}
    if parsed["verdict"] == "not-a-session-log":
        golden["outcome"] = "rejected"
        golden["rejection"] = {"reason": parser.rejection_reason(), "stats": parsed["stats"]}
        return golden
    result = analyze_session(parsed, pricing)
    golden["outcome"] = "analysis"
    golden["metadata"] = golden_metadata(result["metadata"])
    golden["parseStats"] = result["parseStats"]
    golden["parseWarnings"] = result["parseWarnings"]
    golden["buckets"] = [golden_bucket(b) for b in result["buckets"]]
    golden["unknownModels"] = result["unknownModels"]
    return golden


def golden_file_name(fixture_id: str) -> str:
    return fixture_id.replace("/", "__") + ".json"


def load_fixture_list(manifest_path: Path) -> list[dict]:
    """Expand the manifest: a `path` ending in `.jsonl` is one fixture; a
    directory yields one fixture per `*.jsonl` under it (recursively), with
    id = the file's path relative to `fixtures/`, extension dropped.
    """
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    root = manifest_path.parent
    out = []
    for entry in manifest["fixtures"]:
        target = root / entry["path"]
        if target.is_dir():
            for file in sorted(target.rglob("*.jsonl")):
                rel = file.relative_to(root).as_posix()
                out.append({**entry, "id": rel[: -len(".jsonl")], "file": file})
        else:
            out.append({**entry, "id": entry["path"][: -len(".jsonl")], "file": target})
    return out


def dumps(value) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n"


def cmd_analyze(args) -> int:
    pricing = load_pricing(Path(args.pricing))
    path = Path(args.file)
    golden = analyze_file(path, pricing, fixture_id=args.file, file_name=args.file_name)
    sys.stdout.write(dumps(golden))
    return 0


def _goldens(args):
    pricing = load_pricing(Path(args.pricing))
    manifest = Path(args.fixtures)
    golden_dir = manifest.parent / "golden"
    for fixture in load_fixture_list(manifest):
        golden = analyze_file(fixture["file"], pricing, fixture["id"])
        text = dumps(golden)
        if CONTENT_POISON in text:
            raise SystemExit(f"{fixture['id']}: conversation content leaked into the golden")
        yield fixture, golden_dir / golden_file_name(fixture["id"]), text


def cmd_emit(args) -> int:
    seen = set()
    for fixture, out_path, text in _goldens(args):
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(text, encoding="utf-8")
        seen.add(out_path)
        print(f"wrote {out_path.relative_to(REPO_ROOT)}")
    golden_dir = Path(args.fixtures).parent / "golden"
    for stale in sorted(golden_dir.glob("*.json")):
        if stale not in seen:
            stale.unlink()
            print(f"removed stale {stale.relative_to(REPO_ROOT)}")
    return 0


def cmd_check(args) -> int:
    failures = []
    expected = set()
    for fixture, out_path, text in _goldens(args):
        expected.add(out_path)
        if not out_path.exists():
            failures.append(f"missing golden for {fixture['id']} (run: npm run golden:emit)")
        elif out_path.read_text(encoding="utf-8") != text:
            failures.append(f"stale golden for {fixture['id']} (run: npm run golden:emit)")
    golden_dir = Path(args.fixtures).parent / "golden"
    for extra in sorted(golden_dir.glob("*.json")):
        if extra not in expected:
            failures.append(f"orphan golden {extra.name} has no fixture")
    for f in failures:
        print(f, file=sys.stderr)
    print(f"{len(expected)} goldens checked, {len(failures)} problems")
    return 1 if failures else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)
    a = sub.add_parser("analyze", help="analyze one JSONL file and print its golden JSON")
    a.add_argument("file")
    a.add_argument("--pricing", default=str(DEFAULT_PRICING))
    a.add_argument("--file-name", default=None)
    a.set_defaults(func=cmd_analyze)
    for name, func, help_ in (
        ("emit", cmd_emit, "write every golden file listed by the fixtures manifest"),
        ("check", cmd_check, "verify committed goldens are current (exit 1 if not)"),
    ):
        p = sub.add_parser(name, help=help_)
        p.add_argument("--pricing", default=str(DEFAULT_PRICING))
        p.add_argument("--fixtures", default=str(DEFAULT_FIXTURES))
        p.set_defaults(func=func)
    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
