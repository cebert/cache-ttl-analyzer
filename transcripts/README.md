# Session transcripts

A goal of this project is to keep a record of the AI sessions that helped build this tool. Claude Code sessions uploaded to this repository using the [Claude Code Transcripts](https://github.com/simonw/claude-code-transcripts?tab=readme-ov-file) tool created by Simon Willison.

Each session lives in its own folder, named with a zero-padded counter and a
short topic slug, holding both published forms:

```
transcripts/001-transcript-skill/
  session.jsonl    the session log, after redaction
  index.html       rendered via simonw/claude-code-transcripts
  page-001.html
```

Rendering is done with [simonw/claude-code-transcripts](https://github.com/simonw/claude-code-transcripts).
The table below is the index — start there rather than browsing the folders.

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
| 2026-08-30 | [001-transcript-skill](001-transcript-skill/) | Built the `publish-transcript` skill so build sessions can be published here with sensitive information and PII redacted first — a stated goal of this project; also adopted Conventional Commits | | Redacted: unrelated project names, user email, synthetic test credentials |
| 2026-08-30 | [002-log-format-feasibility](002-log-format-feasibility/) | Confirmed Claude Code session logs carry enough data to price 5m vs 1h `promptCacheTtl` counterfactuals at published API rates — the feasibility gate for building this tool at all | | Redacted: unrelated project names, Desktop path, user email; home paths rewritten to `~` |
| 2026-08-30 | [004-build-plan](004-build-plan/) | Established the MVP build plan (docs/PLAN.md, PR #9): requirements Q&A, work breakdown for parallel Claude sessions, then hardened by an independent agent review and a CodeRabbit round | | Redacted: user email; home paths rewritten to `~`. Log ends before the final transcript-publishing turns |
