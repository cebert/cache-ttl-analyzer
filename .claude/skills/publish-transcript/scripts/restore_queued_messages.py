#!/usr/bin/env python3
"""Recover mid-turn user messages that the renderer would otherwise drop.

A message typed while Claude is working is not written as a `type: "user"`
record. Claude Code logs it as a `queue-operation`, and those pair up:

  enqueue                            the message was typed
  dequeue                            delivered as a normal turn later, so a
                                     real `user` record exists too
  remove / absorbed_mid_turn         Claude picked it up mid-turn
  remove / delivered_to_agent        routed to a subagent

Only the `dequeue` path ever produces a `user` record. The other two leave the
message in the log but invisible to `claude-code-transcripts`, whose
`_parse_jsonl_file()` discards every record that is not `user` or `assistant`
(v0.6, __init__.py:481). Across this repo's published sessions that silently
lost 39 human messages — real direction, not noise.

This script writes a RENDER-ONLY copy of a session with a synthetic `user`
record for each lost message. The committed `session.jsonl` stays the authentic
log; only the HTML gains the messages.

Two deliberate choices:

* Each recovered message is prefixed `[sent mid-turn] `. The renderer starts a
  new conversation at every text-bearing user record, so a recovered message
  necessarily *displays* as a top-level prompt even though it interrupted one.
  The prefix is what keeps that honest.
* `<task-notification>` payloads are skipped. They are the harness telling
  Claude a background task finished — machine plumbing, not the user's voice —
  and in one session they outnumber the real messages nine to one.

Usage:
    restore_queued_messages.py IN.jsonl -o OUT.jsonl [--report]
"""

from __future__ import annotations

import argparse
import json
import sys

PREFIX = "[sent mid-turn] "

# Content that is harness plumbing rather than something the user typed.
MACHINE_PREFIXES = ("<task-notification", "<system-reminder", "<local-command")


def _text_of(content) -> str:
    """The plain text of a message's content, list-of-blocks or bare string."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        ]
        return "\n".join(p for p in parts if p)
    return ""


def _norm(text: str) -> str:
    """Whitespace-insensitive key for comparing a queued message to a turn."""
    return " ".join(text.split())


def restore(records: list[dict]) -> tuple[list[dict], list[str]]:
    """Return records plus synthetic user rows, and the texts recovered."""
    # Every message that reached the log as a real turn. A queued message that
    # was later dequeued appears here, and must not be duplicated.
    delivered = {
        _norm(_text_of(r.get("message", {}).get("content", "")))
        for r in records
        if r.get("type") == "user"
    }
    delivered.discard("")

    template = next(
        (r for r in records if r.get("type") == "user" and isinstance(r.get("uuid"), str)),
        None,
    )

    recovered: list[str] = []
    seen: set[str] = set()
    synthetic: dict[int, dict] = {}

    for index, record in enumerate(records):
        if record.get("type") != "queue-operation" or record.get("operation") != "enqueue":
            continue
        content = record.get("content")
        if not isinstance(content, str) or not content.strip():
            continue
        stripped = content.lstrip()
        if stripped.startswith(MACHINE_PREFIXES):
            continue
        key = _norm(content)
        if key in delivered or key in seen:
            continue
        seen.add(key)
        recovered.append(content)

        row = {
            "type": "user",
            "timestamp": record.get("timestamp", ""),
            "message": {"role": "user", "content": PREFIX + content},
            "isMidTurnRecovery": True,
        }
        # Carry the session's own identifying fields so the row looks native to
        # anything that reads them; the renderer itself uses none of these.
        for field in ("sessionId", "cwd", "gitBranch", "version", "userType"):
            if template and field in template:
                row[field] = template[field]
            elif field in record:
                row[field] = record[field]
        synthetic[index] = row

    if not synthetic:
        return records, recovered
    return _merge(records, synthetic), recovered


def _merge(records: list[dict], synthetic: dict[int, dict]) -> list[dict]:
    """Splice each synthetic row in at its own enqueue's position.

    Deliberately not a sort. An earlier version ordered the whole file by
    timestamp, which silently corrupted any session whose records are not
    stored in strict chronological order — subagent traffic interleaves, and
    some records carry no timestamp at all. On one session that reordering
    dropped five rendered prompts instead of adding three. Splicing in place
    leaves every original record exactly where it was, and puts the recovered
    message at the moment it was typed, which is where it belongs anyway.
    """
    out: list[dict] = []
    for index, record in enumerate(records):
        if index in synthetic:
            out.append(synthetic[index])
        out.append(record)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input")
    ap.add_argument("-o", "--output", required=True)
    ap.add_argument(
        "--report", action="store_true", help="print each recovered message"
    )
    args = ap.parse_args()

    records: list[dict] = []
    malformed = 0
    with open(args.input, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                malformed += 1

    merged, recovered = restore(records)

    with open(args.output, "w", encoding="utf-8") as handle:
        for record in merged:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(f"Wrote {args.output} ({len(merged)} records)")
    print(f"Recovered {len(recovered)} mid-turn message(s)")
    if malformed:
        print(f"warning: skipped {malformed} unparseable line(s)", file=sys.stderr)
    if args.report:
        for text in recovered:
            one_line = " ".join(text.split())
            print(f"  · {one_line[:110]}{'…' if len(one_line) > 110 else ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
