#!/usr/bin/env python3
"""List Claude Code sessions recorded for this project, newest first.

Usage: list_sessions.py [--project-dir DIR] [--limit N] [--json]
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def project_dir_for(cwd: Path) -> Path:
    """Claude Code stores sessions under ~/.claude/projects/<path-with-dashes>."""
    slug = str(cwd.resolve()).replace("/", "-")
    return Path.home() / ".claude" / "projects" / slug


def summarize(path: Path) -> dict:
    first_prompt = None
    title = None
    user_turns = 0
    assistant_turns = 0
    first_ts = None
    last_ts = None
    branch = None
    session_id = path.stem

    with path.open(encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            kind = entry.get("type")
            if kind == "ai-title" and not title:
                title = entry.get("title") or entry.get("aiTitle")

            ts = entry.get("timestamp")
            if ts:
                first_ts = first_ts or ts
                last_ts = ts

            branch = entry.get("gitBranch") or branch

            if kind == "user":
                user_turns += 1
                if first_prompt is None:
                    content = entry.get("message", {}).get("content")
                    text = content if isinstance(content, str) else None
                    if isinstance(content, list):
                        parts = [
                            b.get("text", "")
                            for b in content
                            if isinstance(b, dict) and b.get("type") == "text"
                        ]
                        text = "\n".join(p for p in parts if p)
                    if text:
                        first_prompt = " ".join(text.split())
            elif kind == "assistant":
                assistant_turns += 1

    return {
        "session_id": session_id,
        "path": str(path),
        "title": title,
        "first_prompt": first_prompt,
        "user_turns": user_turns,
        "assistant_turns": assistant_turns,
        "started": first_ts,
        "ended": last_ts,
        "git_branch": branch,
        "size_bytes": path.stat().st_size,
        "modified": datetime.fromtimestamp(
            path.stat().st_mtime, tz=timezone.utc
        ).isoformat(),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-dir", default=None, help="Session store directory")
    parser.add_argument("--cwd", default=os.getcwd(), help="Repo path to resolve")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument(
        "--include-agents",
        action="store_true",
        help="Include agent-* subagent session files (excluded by default)",
    )
    args = parser.parse_args()

    store = Path(args.project_dir) if args.project_dir else project_dir_for(Path(args.cwd))
    if not store.is_dir():
        print(f"No session store found at {store}", file=sys.stderr)
        return 1

    files = [
        p
        for p in store.glob("*.jsonl")
        if args.include_agents or not p.name.startswith("agent-")
    ]
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    rows = [summarize(p) for p in files[: args.limit]]

    if args.as_json:
        print(json.dumps(rows, indent=2))
        return 0

    if not rows:
        print(f"No sessions found in {store}")
        return 1

    for i, r in enumerate(rows, 1):
        label = r["title"] or r["first_prompt"] or "(no prompt)"
        if len(label) > 100:
            label = label[:97] + "..."
        kb = r["size_bytes"] / 1024
        print(f"{i:>2}. {r['session_id']}")
        print(f"    {r['modified'][:19]}Z  {kb:.0f} KB  "
              f"{r['user_turns']} user / {r['assistant_turns']} assistant turns"
              f"{'  branch=' + r['git_branch'] if r['git_branch'] else ''}")
        print(f"    {label}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
