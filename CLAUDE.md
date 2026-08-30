# CLAUDE.md

Working rules for this repo. Keep this lean — the build plan lives in
[docs/PLAN.md](docs/PLAN.md), read it before starting work.

## Rules

- **Use [Conventional Commits](https://www.conventionalcommits.org/) for every
  commit in this repo.** Format: `type(scope): subject`, subject in imperative
  mood, no trailing period, under ~72 characters. Types used here: `feat`,
  `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`, `perf`, `style`.
  Breaking changes take a `!` before the colon and a `BREAKING CHANGE:` footer.
  Publishing a session log is `docs(transcripts): ...`.
- **Tests live in separate files from the code they test**, colocated next to
  the source: `foo.ts` is tested by `foo.test.ts` in the same directory.
  Never put tests inside a production source file.
- Commit only what the task touched; leave unrelated working-tree changes alone.
- Don't push unless asked.

## Transcripts

Sessions on this project get committed to `transcripts/`. See
[transcripts/README.md](transcripts/README.md) for the convention, and use the
`publish-transcript` skill to add one — it handles redacting secrets and PII
before anything is committed.
