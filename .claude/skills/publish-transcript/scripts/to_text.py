#!/usr/bin/env python3
"""Render a Claude Code session JSONL as a readable plain-text transcript.

Usage: to_text.py SESSION.jsonl [-o OUT.txt] [--max-tool-output N] [--keep-thinking]
"""

import argparse
import json
import sys
from pathlib import Path

RULE = "=" * 78
THIN = "-" * 78


def block_text(blocks) -> str:
    """Flatten a message content field into text."""
    if isinstance(blocks, str):
        return blocks
    if not isinstance(blocks, list):
        return ""
    return "\n".join(
        b.get("text", "")
        for b in blocks
        if isinstance(b, dict) and b.get("type") == "text" and b.get("text")
    )


def truncate(text: str, limit: int) -> str:
    if limit <= 0 or len(text) <= limit:
        return text
    omitted = len(text) - limit
    return text[:limit] + f"\n... [{omitted} characters truncated]"


def render_tool_input(payload, limit: int) -> str:
    if not isinstance(payload, dict):
        return truncate(str(payload), limit)
    lines = []
    for key, value in payload.items():
        rendered = value if isinstance(value, str) else json.dumps(value, default=str)
        rendered = truncate(rendered, limit)
        if "\n" in rendered:
            lines.append(f"  {key}:")
            lines.extend(f"    {ln}" for ln in rendered.splitlines())
        else:
            lines.append(f"  {key}: {rendered}")
    return "\n".join(lines)


def render(path: Path, max_tool_output: int, keep_thinking: bool) -> str:
    out = []
    header_done = False
    tool_names = {}

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

            if not header_done and entry.get("sessionId"):
                out.append(RULE)
                out.append(f"Claude Code session {entry['sessionId']}")
                if entry.get("cwd"):
                    out.append(f"cwd: {entry['cwd']}")
                if entry.get("gitBranch"):
                    out.append(f"branch: {entry['gitBranch']}")
                out.append(RULE)
                header_done = True

            if kind not in ("user", "assistant"):
                continue

            message = entry.get("message") or {}
            content = message.get("content")
            ts = (entry.get("timestamp") or "")[:19]

            if kind == "user":
                # A "user" entry is either a real prompt or a tool result relay.
                results = [
                    b
                    for b in (content if isinstance(content, list) else [])
                    if isinstance(b, dict) and b.get("type") == "tool_result"
                ]
                if results:
                    for block in results:
                        name = tool_names.get(block.get("tool_use_id"), "tool")
                        body = block.get("content")
                        if isinstance(body, list):
                            body = "\n".join(
                                b.get("text", "")
                                for b in body
                                if isinstance(b, dict) and b.get("type") == "text"
                            )
                        body = truncate(str(body or "").rstrip(), max_tool_output)
                        flag = " (error)" if block.get("is_error") else ""
                        out.append("")
                        out.append(f"[tool result: {name}{flag}]")
                        out.extend(f"  {ln}" for ln in body.splitlines())
                    continue

                text = block_text(content).strip()
                if not text:
                    continue
                out.append("")
                out.append(THIN)
                out.append(f"USER  {ts}")
                out.append(THIN)
                out.append(text)
                continue

            # assistant
            if not isinstance(content, list):
                text = block_text(content).strip()
                if text:
                    out.append("")
                    out.append(f"ASSISTANT  {ts}")
                    out.append(text)
                continue

            for block in content:
                if not isinstance(block, dict):
                    continue
                btype = block.get("type")
                if btype == "text" and block.get("text", "").strip():
                    out.append("")
                    out.append(f"ASSISTANT  {ts}")
                    out.append(block["text"].rstrip())
                elif btype == "thinking" and keep_thinking:
                    thought = (block.get("thinking") or "").rstrip()
                    if thought:
                        out.append("")
                        out.append(f"ASSISTANT (thinking)  {ts}")
                        out.extend(f"  {ln}" for ln in thought.splitlines())
                elif btype == "tool_use":
                    name = block.get("name", "tool")
                    tool_names[block.get("id")] = name
                    out.append("")
                    out.append(f"[tool use: {name}]")
                    rendered = render_tool_input(block.get("input"), max_tool_output)
                    if rendered:
                        out.append(rendered)

    out.append("")
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("session")
    parser.add_argument("-o", "--output", default=None)
    parser.add_argument(
        "--max-tool-output",
        type=int,
        default=2000,
        help="Truncate tool inputs/results to this many characters (0 = no limit)",
    )
    parser.add_argument(
        "--keep-thinking",
        action="store_true",
        help="Include assistant thinking blocks (omitted by default)",
    )
    args = parser.parse_args()

    path = Path(args.session)
    if not path.is_file():
        print(f"No such session file: {path}", file=sys.stderr)
        return 1

    text = render(path, args.max_tool_output, args.keep_thinking)
    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(text, encoding="utf-8")
        print(f"Wrote {out_path} ({len(text)} chars)")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
