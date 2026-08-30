#!/usr/bin/env python3
"""Apply a redaction rule list to a session JSONL, producing a redacted copy.

Redactions are applied to the *parsed* JSON string values and the file is
re-serialized, so values containing quotes, newlines or backslashes are handled
correctly rather than being matched against raw escaped text.

Rules file is JSON: a list of objects, or {"redactions": [...]}.

    [
      {"find": "sk-ant-abc123...",   "replace": "[REDACTED_API_KEY]", "reason": "Anthropic key"},
      {"find": "person@example.com", "replace": "[REDACTED_EMAIL]",   "reason": "PII"},
      {"find": "(?i)acme-?corp", "replace": "[REDACTED_ORG]", "regex": true, "reason": "client name"}
    ]

Usage: apply_redactions.py SESSION.jsonl RULES.json -o REDACTED.jsonl [--verify]
"""

import argparse
import json
import re
import sys
from pathlib import Path


def load_rules(path: Path) -> list:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("redactions", [])
    if not isinstance(data, list):
        raise ValueError("Rules file must be a list, or an object with a 'redactions' list")

    rules = []
    for i, rule in enumerate(data):
        if not isinstance(rule, dict) or "find" not in rule:
            raise ValueError(f"Rule {i} is missing a 'find' field")
        find = rule["find"]
        if not find:
            raise ValueError(f"Rule {i} has an empty 'find'")
        replace = rule.get("replace", "[REDACTED]")
        if rule.get("regex"):
            pattern = re.compile(find)
        else:
            pattern = re.compile(re.escape(find))
        rules.append(
            {
                "find": find,
                "replace": replace,
                "pattern": pattern,
                "regex": bool(rule.get("regex")),
                "reason": rule.get("reason", ""),
                "count": 0,
            }
        )
    return rules


def scrub(value, rules):
    """Recursively rewrite every string inside a parsed JSON value."""
    if isinstance(value, str):
        for rule in rules:
            value, n = rule["pattern"].subn(rule["replace"], value)
            rule["count"] += n
        return value
    if isinstance(value, list):
        return [scrub(v, rules) for v in value]
    if isinstance(value, dict):
        return {scrub(k, rules): scrub(v, rules) for k, v in value.items()}
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("session")
    parser.add_argument("rules")
    parser.add_argument("-o", "--output", required=True)
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Fail if any literal 'find' value still appears in the output",
    )
    args = parser.parse_args()

    session = Path(args.session)
    if not session.is_file():
        print(f"No such session file: {session}", file=sys.stderr)
        return 2

    try:
        rules = load_rules(Path(args.rules))
    except (OSError, ValueError, json.JSONDecodeError, re.error) as exc:
        print(f"Bad rules file: {exc}", file=sys.stderr)
        return 2

    if not rules:
        print("Rules file contains no redactions.", file=sys.stderr)

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    kept = skipped = 0
    with session.open(encoding="utf-8", errors="replace") as src, \
            out_path.open("w", encoding="utf-8") as dst:
        for line in src:
            stripped = line.strip()
            if not stripped:
                continue
            try:
                entry = json.loads(stripped)
            except json.JSONDecodeError:
                skipped += 1
                continue
            dst.write(json.dumps(scrub(entry, rules), ensure_ascii=False) + "\n")
            kept += 1

    print(f"Wrote {out_path} ({kept} entries"
          f"{f', {skipped} unparseable lines dropped' if skipped else ''})\n")

    unused = []
    for rule in rules:
        status = f"x{rule['count']}" if rule["count"] else "NO MATCHES"
        if not rule["count"]:
            unused.append(rule["find"])
        note = f"  ({rule['reason']})" if rule["reason"] else ""
        print(f"  {status:>10}  {rule['find'][:60]!r} -> {rule['replace']}{note}")

    if unused:
        sys.stdout.flush()
        print(f"\nWARNING: {len(unused)} rule(s) matched nothing — check for typos "
              f"or values that only exist in a different file.", file=sys.stderr)
        sys.stderr.flush()

    if args.verify:
        text = out_path.read_text(encoding="utf-8")
        leaked = [r["find"] for r in rules if not r["regex"] and r["find"] in text]
        if leaked:
            print(f"\nVERIFY FAILED: {len(leaked)} value(s) still present in output:",
                  file=sys.stderr)
            for value in leaked:
                print(f"  {value[:80]!r}", file=sys.stderr)
            return 1
        print("\nVerify passed: no literal redaction target remains in the output.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
