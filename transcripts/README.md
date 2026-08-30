# Session transcripts

A goal of this project is to keep a record of the AI sessions that helped build this tool. Claude Code sessions uploaded to this repository using the [Claude Code Transcripts](https://github.com/simonw/claude-code-transcripts?tab=readme-ov-file) created by Simon Willison.

Transcripts are published in two forms, both produced from the same redacted source:

-  `raw/` — the session JSONL, after redaction
-  `html/` — rendered via [simonw/claude-code-transcripts](https://github.com/simonw/claude-code-transcripts)

Each session gets a zero-padded counter and a short topic slug, shared by both
formats: `raw/001-transcript-skill.jsonl` and `html/001-transcript-skill/`.

Sessions are reviewed for secrets and PII and redacted before publishing.
Removed values are replaced with `[REDACTED_...]` placeholders, and the Notes
column below records what was taken out of each session.

## Publishing a session

Run the `publish-transcript` skill in Claude Code — ask it to publish a session
transcript, or invoke it directly. It lists the recorded sessions for this repo,
reviews the one you pick for sensitive material, applies redactions you approve,
renders both formats, updates the table below, and commits the result.

## Session map

| Date | Session | Covers | Share link | Notes |
|---|---|---|---|---|
| 2026-08-30 | [001-transcript-skill](html/001-transcript-skill/) | Built the `publish-transcript` skill so build sessions can be published here with sensitive information and PII redacted first — a stated goal of this project; also adopted Conventional Commits | | Redacted: unrelated project names, user email, synthetic test credentials |
