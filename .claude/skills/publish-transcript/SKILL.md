---
name: publish-transcript
description: Publish a Claude Code session from this project into transcripts/ as redacted HTML, plain text, and raw JSONL. Use when the user wants to add, publish, save, or commit a session log / transcript to the repo. Reviews the session for secrets and PII, redacts them, renders with simonw/claude-code-transcripts, updates the session map, and commits with a conventional commit.
---

# Publish a session transcript

Turns one Claude Code session for this repo into three committed artifacts:

| Output | Path |
|---|---|
| Rendered HTML (simonw/claude-code-transcripts) | `transcripts/html/<slug>/` |
| Plain text | `transcripts/text/<slug>.txt` |
| Redacted source JSONL | `transcripts/raw/<slug>.jsonl` |

**Every artifact is rendered from the redacted JSONL, never from the original.**
Redact once at the source and all three outputs stay consistent — never redact
the HTML and text separately.

## Prerequisites

`claude-code-transcripts` must be on PATH. If `which claude-code-transcripts`
comes up empty, run it via `uvx claude-code-transcripts` instead, or install with
`uv tool install claude-code-transcripts`.

Scripts live in `.claude/skills/publish-transcript/scripts/`. Below, `$S` means
that directory and `$W` a scratch working directory (use the session scratchpad,
not the repo — intermediate files must never be committed).

## Step 1 — Pick the session

```bash
python3 $S/list_sessions.py --limit 20
```

Show the list and ask the user which session to publish, unless they already
named one (by session id, by "the current session", or by describing its topic
clearly enough to match exactly one row).

**Publishing the current session:** the JSONL is still being written, so it will
not contain this final turn. That is expected and fine — say so, and offer to
re-run later if they want the tail included.

## Step 2 — Stage and render for review

```bash
mkdir -p $W
cp ~/.claude/projects/<project-slug>/<session-id>.jsonl $W/original.jsonl
python3 $S/to_text.py $W/original.jsonl -o $W/review.txt --max-tool-output 4000
```

`list_sessions.py` prints the absolute source path — copy it from there rather
than reconstructing it.

## Step 3 — Find sensitive material

Two passes, both required. The regex pass catches well-shaped secrets; the
reading pass catches everything shaped like ordinary prose.

**Pass A — regex triage:**

```bash
python3 $S/scan_secrets.py $W/original.jsonl
```

**Pass B — read the transcript.** Read `$W/review.txt` in full. For a long
session, read it in chunks — do not skim, and do not delegate this to a subagent
that only reports back a summary. You are looking for things a regex cannot
match:

- Credentials, tokens, API keys, passwords, connection strings — including ones
  pasted mid-sentence or shown in command output
- Real names, emails, phone numbers, addresses of anyone (the user included)
- Customer, client, or employer names the user may not want public
- Internal hostnames, private URLs, ticket IDs, Slack/DM links, S3 buckets
- Unreleased or confidential product details discussed in passing
- `.env` file contents, private keys, or `~/.aws/credentials` echoed by a tool
- Anything in a file the repo's `.gitignore` excludes (this repo ignores
  `.env`, `.env.*`) — if its contents appear in the transcript, redact them

Judgment calls to raise with the user rather than decide alone:

- **The user's own name and email.** They are already in the git history of this
  repo, so redacting them is usually pointless — but ask, don't assume.
- **Home directory paths** (`/Users/<name>/...`). Low risk, but they leak a
  username and local layout. Offer to rewrite them to `~/`.
- **Third parties' names.** Default to redacting these; a person who was
  mentioned in a session did not consent to being published.

## Step 4 — Propose redactions

Write `$W/redactions.json` — a list of rules, each with a `reason`:

```json
[
  {"find": "sk-ant-api03-REAL-KEY", "replace": "[REDACTED_API_KEY]", "reason": "Anthropic API key in tool output"},
  {"find": "coworker@example.com", "replace": "[REDACTED_EMAIL]", "reason": "third party PII"},
  {"find": "/Users/chrisebert", "replace": "~", "reason": "local home path"}
]
```

Rules are literal by default; add `"regex": true` for a pattern. Use
`[REDACTED_<KIND>]` placeholders so a reader can tell *what* was removed.

Present the proposed list to the user — grouped by category, with the reason and
match count for each — and get approval before applying. **If you find a live
credential, tell the user plainly that it should be rotated**, since it existed
in plaintext on disk regardless of what gets published.

If both passes come up clean, say so explicitly and confirm they want to publish
unredacted rather than silently proceeding.

## Step 5 — Apply and verify

```bash
python3 $S/apply_redactions.py $W/original.jsonl $W/redactions.json \
    -o $W/redacted.jsonl --verify
python3 $S/scan_secrets.py $W/redacted.jsonl
```

`--verify` fails if any literal target survived. Investigate a `NO MATCHES`
warning before continuing — it usually means a typo'd rule, which means
something you meant to redact is still in the file.

The second scan is the real check: re-read its output and confirm every
remaining hit is something you and the user consciously decided to keep.

## Step 6 — Render the three artifacts

Pick a slug: `YYYY-MM-DD-short-topic` (date of the session, kebab-case topic,
e.g. `2026-08-30-transcript-skill`).

```bash
SLUG=<slug>
claude-code-transcripts json $W/redacted.jsonl -o transcripts/html/$SLUG
python3 $S/to_text.py $W/redacted.jsonl -o transcripts/text/$SLUG.txt
cp $W/redacted.jsonl transcripts/raw/$SLUG.jsonl
```

Do not pass `--gist` — that uploads to a public Gist, which is a separate
publishing decision the user has to make explicitly.

Then confirm the redaction survived rendering:

```bash
python3 $S/scan_secrets.py transcripts/raw/$SLUG.jsonl \
    transcripts/text/$SLUG.txt transcripts/html/$SLUG/*.html
```

## Step 7 — Update the session map

Add a row to the table in `transcripts/README.md`:

| Date | Session | Covers | Share link | Notes |
|---|---|---|---|---|
| 2026-08-30 | [2026-08-30-transcript-skill](html/2026-08-30-transcript-skill/) | Built the transcript publishing skill | | 3 emails redacted |

Keep rows in date order. Put a short, honest note about what was redacted in the
Notes column — that is the reader's signal that gaps are deliberate. Leave the
share link blank unless the user has published one.

## Step 8 — Commit

This repo uses [Conventional Commits](https://www.conventionalcommits.org/).
Transcript publishing is a `docs` change:

```bash
git add transcripts/
git commit -m "docs(transcripts): add session log for <topic>"
```

Guidance:

- Subject in imperative mood, no trailing period, under ~72 characters.
- If anything was redacted, note it in the body — e.g.
  `Redacted 2 API keys and 3 third-party email addresses before publishing.`
- Commit only under `transcripts/`; leave unrelated working-tree changes alone.
- Do not push unless the user asks. Publishing to a remote is their call, and it
  is the point of no return for anything that slipped through redaction.
