#!/usr/bin/env python3
"""Scrub a captured Claude Code session so it can ship as a public fixture.

Real captures (docs/PLAN.md WP-06, kind 2) contain the whole conversation:
prompts, file contents, tool output, paths. The analyzer never reads any of
that, so the fixture does not need it either. This script keeps the exact
row structure and every field the engine consumes, and replaces EVERYTHING
else with placeholders:

- Numbers, booleans and nulls are kept everywhere (token counts, flags).
- Strings are kept only under an allowlist of metadata keys (ids, timestamps,
  model, version, effort, service tier, speed, record types...). Any other
  string, at any depth, becomes the placeholder — which carries the
  CONTENT_POISON marker so the golden harness proves it never leaks.
- `message.content` becomes a single placeholder block; the row-per-block
  layout (one assistant row per content block) is what exercises dedup, and
  that survives because rows are never merged or dropped.
- `cwd` is rewritten to `~/…` and `ai-title` gets the title you pass.
- The `agent-<id>.meta.json` sidecars are copied with their description
  blanked.

Usage:
    scrub-capture.py SESSION.jsonl OUT_DIR --title "..." [--name session.jsonl]

`OUT_DIR/session.jsonl` is written, plus `OUT_DIR/subagents/` when the
session directory has one, plus `OUT_DIR/capture.json` describing the source
(version, counts, scrub rules) for `fixtures/README.md`.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

SCRUB_RULES_VERSION = 1
CONTENT_POISON = "POISON"
PLACEHOLDER = f"[scrubbed {CONTENT_POISON}]"

# String values under these keys survive. Everything else is replaced.
KEEP_STRING_KEYS = {
    # row identity and threading
    "type", "uuid", "parentUuid", "timestamp", "sessionId", "session_id", "agentId",
    "requestId", "userType", "entrypoint", "version", "effort", "gitBranch",
    # message envelope + usage
    "id", "model", "role", "stop_reason", "stop_sequence", "service_tier", "speed",
    "inference_geo", "iteration_id",
    # small enums on non-billing rows (keep the record shapes recognizable)
    "mode", "permissionMode", "operation", "subtype", "level", "stopReason",
    "leafUuid", "messageId", "snapshotMessageId", "toolUseID", "promptId",
    "sourceToolUseID", "sourceToolAssistantUUID",
    # subagent meta
    "agentType", "toolUseId",
}
# `cwd` is kept but rewritten; `aiTitle` is kept but replaced by --title.
HOME_RE = re.compile(r"^(/Users/[^/]+|/home/[^/]+|[A-Za-z]:\\Users\\[^\\]+)")


def scrub_value(value, key: str | None, ctx: dict):
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if k == "content":
                # Conversation payload on user/assistant/system/queue rows.
                if isinstance(v, list):
                    out[k] = [{"type": "text", "text": PLACEHOLDER}] if v else []
                else:
                    out[k] = PLACEHOLDER
                ctx["scrubbed"] += 1
                continue
            if k == "cwd" and isinstance(v, str):
                out[k] = HOME_RE.sub("~", v)
                continue
            if k == "aiTitle" and isinstance(v, str):
                out[k] = ctx["title"]
                continue
            out[k] = scrub_value(v, k, ctx)
        return out
    if isinstance(value, list):
        return [scrub_value(v, key, ctx) for v in value]
    if isinstance(value, str):
        if key in KEEP_STRING_KEYS:
            return value
        ctx["scrubbed"] += 1
        return PLACEHOLDER
    return value  # numbers, booleans, null


def scrub_file(src: Path, dst: Path, ctx: dict) -> dict:
    types = Counter()
    lines = 0
    with src.open("r", encoding="utf-8") as fin, dst.open("w", encoding="utf-8") as fout:
        for line in fin:
            lines += 1
            line = line.rstrip("\n")
            if not line.strip():
                fout.write("\n")
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                # A malformed line in a real capture is worth keeping as-is
                # only if it carries nothing sensitive; we cannot know, so
                # replace it with an unparseable placeholder of the same class.
                fout.write("{not-json " + PLACEHOLDER + "\n")
                ctx["scrubbed"] += 1
                continue
            types[row.get("type") if isinstance(row, dict) else "<non-object>"] += 1
            fout.write(json.dumps(scrub_value(row, None, ctx), ensure_ascii=False) + "\n")
    return {"file": str(dst.relative_to(ctx["out_dir"])), "lines": lines, "recordTypes": dict(types)}


def scrub_meta(src: Path, dst: Path) -> None:
    meta = json.loads(src.read_text(encoding="utf-8"))
    kept = {}
    for k, v in meta.items():
        if isinstance(v, str) and k not in KEEP_STRING_KEYS:
            kept[k] = PLACEHOLDER
        else:
            kept[k] = v
    dst.write_text(json.dumps(kept, indent=2) + "\n", encoding="utf-8")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("session", help="path to <session-id>.jsonl")
    ap.add_argument("out_dir")
    ap.add_argument("--title", required=True, help="replacement ai-title")
    ap.add_argument("--name", default="session.jsonl", help="output file name for the main log")
    ap.add_argument("--description", default="", help="what this capture is (recorded in capture.json)")
    args = ap.parse_args(argv)

    src = Path(args.session).expanduser().resolve()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    ctx = {"title": args.title, "scrubbed": 0, "out_dir": out_dir}

    files = [scrub_file(src, out_dir / args.name, ctx)]
    subagent_dir = src.with_suffix("") / "subagents"
    if subagent_dir.is_dir():
        (out_dir / "subagents").mkdir(exist_ok=True)
        for agent in sorted(subagent_dir.glob("agent-*.jsonl")):
            files.append(scrub_file(agent, out_dir / "subagents" / agent.name, ctx))
            meta = agent.with_suffix(".meta.json")
            if meta.exists():
                scrub_meta(meta, out_dir / "subagents" / meta.name)

    # Provenance for fixtures/README.md — content-free by construction.
    versions = set()
    with src.open("r", encoding="utf-8") as f:
        for line in f:
            m = re.search(r'"version":\s*"([0-9.]+)"', line)
            if m:
                versions.add(m.group(1))
    capture = {
        "source": {"sessionId": src.stem, "claudeCodeVersions": sorted(versions)},
        "description": args.description,
        "title": args.title,
        "scrubRulesVersion": SCRUB_RULES_VERSION,
        "scrubbedValues": ctx["scrubbed"],
        "files": files,
    }
    (out_dir / "capture.json").write_text(json.dumps(capture, indent=2) + "\n", encoding="utf-8")
    print(f"scrubbed {len(files)} file(s), {ctx['scrubbed']} values → {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
