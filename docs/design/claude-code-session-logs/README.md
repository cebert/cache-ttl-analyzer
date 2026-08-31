# Claude Code session log research

Research into the on-disk format of Claude Code session logs, and whether they
carry enough data to price prompt-cache TTL counterfactuals.

| File | What it is |
|---|---|
| [feasibility.md](feasibility.md) | The findings: schema, available fields, the two TTL settings, pricing math, parsing traps, limits, open questions, and a linked source list. **Start here.** |
| ~~prototype-sim.py~~ | The throwaway simulator that confirmed the findings by execution (the numbers in `feasibility.md` §8) has been retired. Its spec-parity successor is [`tools/refsim/`](../../../tools/refsim/) — the independently written reference implementation that emits the golden fixtures (WP-06). |

Price a session with the reference simulator:

```sh
python3 tools/refsim/refsim.py analyze ~/.claude/projects/<project>/<session-id>.jsonl
```

## Key external references

Full annotated list in [feasibility.md § 11](feasibility.md#11-sources). The four
that matter most:

- [Where transcripts are stored](https://code.claude.com/docs/en/sessions#where-transcripts-are-stored)
  — the only official word on the file itself, including the warning that the format
  is internal and can break on any release.
- [How Claude Code uses prompt caching](https://code.claude.com/docs/en/prompt-caching)
  — the semantics being modelled, especially
  [Cache lifetime](https://code.claude.com/docs/en/prompt-caching#cache-lifetime) and
  [Choose the TTL yourself](https://code.claude.com/docs/en/prompt-caching#choose-the-ttl-yourself).
- [API prompt caching pricing](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#pricing)
  — the 1.25× / 2.0× write and 0.1× read multipliers.
- [simonw/claude-code-transcripts](https://github.com/simonw/claude-code-transcripts)
  — closest prior art; parses both local JSONL and Claude Code web JSON exports.
