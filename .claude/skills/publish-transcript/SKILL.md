---
name: publish-transcript
description: Publish a Claude Code session from this project into transcripts/ as redacted HTML and raw JSONL. Use when the user wants to add, publish, save, or commit a session log / transcript to the repo. Reviews the session for secrets and PII, redacts them, renders with simonw/claude-code-transcripts, updates the session map, and commits with a conventional commit.
---

# Publish a session transcript

Turns one Claude Code session for this repo into one committed folder holding
both published forms:

```
transcripts/<NNN-slug>/
  session.jsonl    the redacted session log
  index.html       rendered via simonw/claude-code-transcripts
  page-001.html
```

**The HTML is rendered from the redacted JSONL, never from the original.**
Redact once at the source and both outputs stay consistent — never redact the
rendered HTML separately.

`to_text.py` renders a session as plain text for *your* review in step 2. That
rendering is a working file: it is never committed. Only `session.jsonl` and the
rendered HTML go into the repo.

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
re-run later if they want the tail included. Note that the skill is loaded at
session start, so a session that *created or edited* the skill cannot invoke it
by name; follow these steps directly instead.

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
- **Names of the user's other projects.** A session that ran `ls ~/.claude/projects`,
  `git remote -v` elsewhere, or any directory listing above the repo will name
  unrelated work. A regex cannot catch this — it is the single most likely real
  leak in an otherwise clean session.
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

**Redact the shortest distinctive token, not the full prefixed value.** A
transcript contains *truncated* copies of its own content — tool output gets cut
off, scanner context windows clip mid-value, and prose refers to values with an
ellipsis. A rule for `sk-ant-api03-<key>` will sail past `...-api03-<key>` and
`sk-ant-api03-<pre>...`, leaving fragments behind. Add a rule for the bare core
(`<key>`) as well as the full value, and for a multi-part name like
`acme-widget-service` add one for `acme` too.

**Watch for self-reference.** Once a session discusses its own redaction, the
sensitive strings appear in the discussion — in your grep commands, your
findings summary, and your questions to the user. Re-copying the source JSONL
after that point pulls those in, and each re-copy adds more. Copy the source
once, redact and verify against that snapshot, and stop; do not chase the tail.

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

## Step 6 — Recover mid-turn messages

A message typed *while Claude is working* is not logged as a `type: "user"`
record — Claude Code writes it as a `queue-operation`, and the renderer
discards every record that is not `user` or `assistant`
(`claude-code-transcripts` v0.6, `__init__.py:481`). Left alone, those
messages vanish from the HTML while staying in the JSONL. Across this repo's
first fourteen sessions that silently hid **50 human messages**; one session
published 2 prompts where 10 were sent.

```bash
python3 $S/restore_queued_messages.py $W/redacted.jsonl \
    -o $W/for-render.jsonl --report
```

Read the `--report` list: it is exactly what was invisible before. The script
skips queued messages that were later delivered normally (so nothing is
duplicated) and `<task-notification>` payloads (harness plumbing, not the
user's voice).

**Render from `for-render.jsonl`, but commit `redacted.jsonl`.** The recovered
rows are synthetic — the archive should stay the authentic log. Each recovered
message renders prefixed `[sent mid-turn]`, because the renderer starts a new
conversation at every user record, so a message that interrupted a turn
necessarily displays as a top-level prompt; the prefix is what keeps that
honest.

## Step 7 — Render the two artifacts

Name the session `NNN-short-topic`: a zero-padded counter one higher than the
highest folder already in `transcripts/`, plus a kebab-case topic — e.g.
`002-cost-model`.

`--json` copies the JSONL into the output directory alongside the HTML, naming
it after the input file. Rename the redacted file to `session.jsonl` first so it
lands with the right name, and the whole folder is produced in one command:

```bash
SLUG=<NNN-short-topic>
mv $W/redacted.jsonl $W/session.jsonl
claude-code-transcripts json $W/for-render.jsonl -o transcripts/$SLUG
cp $W/session.jsonl transcripts/$SLUG/session.jsonl
```

The render and the committed log come from different files, so `--json` is not
used: the HTML is built from `for-render.jsonl` and the authentic
`session.jsonl` is copied in beside it.

Do not pass `--gist` — that uploads to a public Gist, which is a separate
publishing decision the user has to make explicitly.

Then confirm the redaction survived rendering:

```bash
python3 $S/scan_secrets.py transcripts/$SLUG/*
```

## Step 8 — Update the session map

Add a row to the table in `transcripts/README.md`:

| Date | Session | Covers | Share link | Notes |
|---|---|---|---|---|
| 2026-08-30 | [001-transcript-skill](001-transcript-skill/) | Built the transcript publishing skill | [open](https://cebert.github.io/cache-ttl-analyzer/001-transcript-skill/) | 3 emails redacted |

Keep rows in date order. Put a short, honest note about what was redacted in the
Notes column — that is the reader's signal that gaps are deliberate.

The share link is the GitHub Pages copy —
`https://cebert.github.io/cache-ttl-analyzer/<slug>/`, live once the commit
reaches `main`. This table is also the source for that site's landing page, so
a missing or misspelled row fails the `Transcripts site` workflow rather than
publishing a broken index. Check the table still matches the folders with:

```bash
npm run build:transcripts
```

**Ask the user what the session covers — don't just write it yourself.** Propose
a one-line summary drawn from reading the transcript, and ask them to confirm or
replace it. They know why the session mattered; the transcript only shows what
happened in it.

Aim the summary at *why the work was done*, not the mechanics of what was
typed. Where a session advanced a stated goal of the project, say so — that
connection is the reason the transcript is worth keeping, and it is exactly the
part a reader cannot reconstruct from the log.

- Weak: "Created four Python scripts and a SKILL.md"
- Better: "Built the transcript publishing skill, so build sessions can be
  published without leaking secrets or PII — a stated goal of the project"

Use the same confirmed summary for the commit subject in step 9, so the map row
and the git history agree.

## Step 9 — Commit

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
