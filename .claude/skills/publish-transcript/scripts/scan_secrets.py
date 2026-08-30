#!/usr/bin/env python3
"""Regex pre-scan for secrets and PII in a transcript file.

This is a triage aid, not a verdict: it catches the well-shaped stuff (keys,
tokens, emails) and misses anything context-dependent. A human/model review of
the rendered transcript is still required.

Usage: scan_secrets.py FILE [FILE...] [--json] [--context N]
Exit code 0 = no candidates, 1 = candidates found, 2 = usage error.
"""

import argparse
import json
import re
import sys
from pathlib import Path

# (label, pattern, severity)
PATTERNS = [
    ("anthropic-api-key", r"sk-ant-[A-Za-z0-9_\-]{20,}", "high"),
    ("openai-api-key", r"\bsk-(?:proj-)?[A-Za-z0-9_\-]{32,}", "high"),
    ("github-token", r"\bgh[pousr]_[A-Za-z0-9]{16,}", "high"),
    ("github-pat-fine", r"\bgithub_pat_[A-Za-z0-9_]{22,}", "high"),
    ("slack-token", r"\bxox[abposr]-[A-Za-z0-9-]{10,}", "high"),
    ("aws-access-key-id", r"\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b", "high"),
    ("google-api-key", r"\bAIza[0-9A-Za-z_\-]{35}\b", "high"),
    ("stripe-key", r"\b[rs]k_(?:live|test)_[A-Za-z0-9]{20,}", "high"),
    ("private-key-block", r"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----", "high"),
    ("jwt", r"\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}", "high"),
    ("bearer-token", r"(?i)\b(?:authorization|bearer)\s*[:=]\s*[\"']?[A-Za-z0-9._\-]{20,}", "high"),
    ("assigned-secret", r"(?i)\b(?:api[_-]?key|secret|password|passwd|token|client[_-]?secret)\b\s*[:=]\s*[\"']?[^\s\"',}{]{8,}", "medium"),
    ("connection-string", r"(?i)\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp)://[^\s\"'<>]*:[^\s\"'<>@]+@", "high"),
    ("email", r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b", "medium"),
    ("ipv4-public", r"\b(?!10\.|127\.|192\.168\.|169\.254\.|0\.)\d{1,3}(?:\.\d{1,3}){3}\b", "low"),
    ("us-phone", r"(?<![\d.\-])(?:\+1[ \-.]?)?\(?\d{3}\)?[ \-.]\d{3}[ \-.]\d{4}(?![\d.\-])", "low"),
    ("ssn", r"\b\d{3}-\d{2}-\d{4}\b", "high"),
    ("credit-card", r"\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6011)[ \-]?\d{4}[ \-]?\d{4}[ \-]?\d{4}\b", "high"),
    ("home-path", r"/(?:Users|home)/[A-Za-z0-9._\-]+", "low"),
    ("env-file-line", r"(?m)^\s*[A-Z][A-Z0-9_]{3,}=\S{8,}$", "medium"),
]

COMPILED = [(label, re.compile(pattern), severity) for label, pattern, severity in PATTERNS]

SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}


def scan(path: Path, context: int):
    findings = []
    with path.open(encoding="utf-8", errors="replace") as fh:
        for lineno, line in enumerate(fh, 1):
            for label, rx, severity in COMPILED:
                for match in rx.finditer(line):
                    value = match.group(0)
                    start = max(0, match.start() - context)
                    end = min(len(line), match.end() + context)
                    findings.append(
                        {
                            "file": str(path),
                            "line": lineno,
                            "type": label,
                            "severity": severity,
                            "match": value,
                            "context": line[start:end].strip(),
                        }
                    )
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("files", nargs="+")
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument("--context", type=int, default=60)
    parser.add_argument(
        "--min-severity",
        choices=["high", "medium", "low"],
        default="low",
        help="Only report findings at or above this severity",
    )
    args = parser.parse_args()

    threshold = SEVERITY_ORDER[args.min_severity]
    findings = []
    for name in args.files:
        path = Path(name)
        if not path.is_file():
            print(f"No such file: {path}", file=sys.stderr)
            return 2
        findings.extend(f for f in scan(path, args.context)
                        if SEVERITY_ORDER[f["severity"]] <= threshold)

    findings.sort(key=lambda f: (SEVERITY_ORDER[f["severity"]], f["file"], f["line"]))

    if args.as_json:
        print(json.dumps(findings, indent=2))
    else:
        if not findings:
            print("No regex candidates found. Manual review is still required.")
            return 0
        # Group identical values so a repeated key reports once with a count.
        groups = {}
        for f in findings:
            key = (f["type"], f["severity"], f["match"])
            groups.setdefault(key, []).append(f)
        print(f"{len(findings)} candidate match(es), {len(groups)} distinct value(s):\n")
        for (label, severity, value) in sorted(
            groups, key=lambda k: (SEVERITY_ORDER[k[1]], k[0])
        ):
            hits = groups[(label, severity, value)]
            lines = ", ".join(str(h["line"]) for h in hits[:8])
            more = f" (+{len(hits) - 8} more)" if len(hits) > 8 else ""
            print(f"[{severity:^6}] {label}: {value!r}")
            print(f"          x{len(hits)} on line(s) {lines}{more}")
            print(f"          e.g. ...{hits[0]['context']}...")
            print()

    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
