# cache-ttl-analyzer

**Should your Claude Code sessions cache for five minutes, or an hour?**

Drop in a session log and find out. [**cacheanalyzer.com**](https://cacheanalyzer.com)

Prompt caching is billed at a discount to read and a premium to write, and the
premium depends on how long the entry lives. Whether the longer window pays for
itself depends entirely on the shape of your session — mostly on how long the
pauses between requests are. That is knowable from a session log, and guessable
from nothing else.

The analysis runs entirely in your browser. The file is never uploaded, because
there is no server to upload it to.

## What you get

Point it at a Claude Code session log (a `.jsonl` file from
`~/.claude/projects/`) and it will:

- price the session as it actually ran, at published Anthropic API rates;
- replay it twice — once with a five-minute cache, once with a one-hour cache —
  expiring entries on the gaps that really occurred, and resetting the cache
  wherever the model, effort or version changed;
- tell you which setting would have cost less, and by how much;
- show what drove the difference: cache hit rate, warm reads, expiries, wasted
  writes, hard resets, and how many of your gaps fell in the 5m–1h band, which
  is the only band where the setting changes anything.

Don't have a log handy? Four captured sessions ship with the tool, each chosen
to teach one lesson — a tight agent loop where five minutes wins, a gap-heavy
session where an hour wins, a session that switched models partway, and a real
85-minute build session at ordinary human pacing.

If you want to change the setting afterwards, it is the
`CLAUDE_CODE_PROMPT_CACHE_TTL` environment variable, or `promptCacheTtl` in
Claude Code's `settings.json`. Anthropic's
[Prompt Caching Guide](https://code.claude.com/docs/en/prompt-caching) has the
details.

### What it does not analyze

Version 1 analyzes the **main conversation** only — the cache that
`promptCacheTtl` governs. Subagents keep their own caches, governed separately
by `subagentPromptCacheTtl`, and on current Claude Code versions their turns
live in separate files beside the session log (`<session-id>/subagents/`), so a
main-session upload contains none of that traffic. The results view says so
explicitly rather than staying quiet about it: the tool never implies it
evaluated a cache it did not see. The engine already partitions subagent
traffic correctly, so uploading a subagent transcript on its own analyzes that
subagent — what version 1 does not do is roll the two buckets up into one
verdict.

Two more limits, both stated in the app rather than buried here. A cache entry
is modelled as expiring whole, except where the log shows part of a prefix
survived; real caching is finer-grained, and the simplification errs toward
making five minutes look worse, never better. And rates are the standard
published ones — a session pinned to US-only inference bills about 10% more
than shown, which the log does not record.

## Why

Prompt caching plays an important role in agentic harnesses like Claude Code. Without caching, every turn must be reprocessed, which increases latency and cost.

This tool was created to help answer the question: **should I pay for longer cache windows?**

On a Claude Code subscription plan, Claude picks a default for you. Main conversations are cached for one hour when running under subsidized plan usage. However, when subscription users transition to credit usage, this drops to 5 minutes. When using an API key or a cloud provider like Amazon Bedrock, the default TTL is also 5 minutes.

Users who aren't on a subscription plan must decide whether paying for longer caching (which incurs extra cost) is more economical than staying with shorter window durations.

### Aren't there already tools for this?

Many excellent tools are already available to trace and review coding harness sessions, such as [Datadog Lapdog](https://chrisebert.net/see-what-your-ai-coding-agent-is-doing-with-datadog-lapdog/) (which I've blogged about previously) and [Agents View](https://www.agentsview.io/). However, these tools arguably focus less on prompt caching and more on overall session observability.

### Background Motivation

The organization I work for is moving from a legacy Claude Code Enterprise plan with subsidized tokens to API-based billing. There's an increased focus on cost and token usage. Prompt caching is a meaningful cost lever, but we have little data to determine whether longer cache windows will save money or cost more. Cache TTL Analyzer was created to address this real-world question with data.

A secondary goal of this tool is to increase developer awareness of cost drivers. From my experience, many developers are still unaware of the cost impact their behaviors have on caching. For example, changing effort or models mid-session can invalidate the cache, while resuming long-lived sessions can result in expensive cache misses. This tool can help surface those behaviors and enable better-informed decisions.

## Roadmap

Beyond version 1, in rough priority order:

- **Subagent cache analysis.** Read a session and its `subagents/` transcripts
  together and report both buckets — `promptCacheTtl` and
  `subagentPromptCacheTtl` — with their own verdicts. Needs multi-file upload
  and cross-file dedup.
- **Multi-file and cross-session rollups**, so a week of work answers the
  question rather than one session.
- **Deeper API-powered analysis**, opt-in and itemized, if the local analysis
  proves useful enough to want it.
- **Provider rate tables** (Bedrock, Vertex) alongside the published Anthropic
  API rates.
- **Hybrid-TTL guidance** (a stable 1-hour prefix with a 5-minute tail), which
  today can only be qualitative — the logs cannot support a computed number.

---

## Contributing

The build plan, the architecture and every decision taken along the way are in
[docs/PLAN.md](docs/PLAN.md). Read it before starting work.

### Repo map

| Path | What's in it |
|---|---|
| `src/` | Application source — `engine/` is the analysis, `app/` the UI |
| `docs/PLAN.md` | Build plan, architecture, and the decision log |
| `docs/design/` | Claude Design exports, screenshots |
| `fixtures/` | Test sessions and the golden outputs the engine must reproduce ([details](fixtures/README.md)) |
| `public/samples/` | The bundled sample logs, so the tool works without your own data |
| `transcripts/` | The AI sessions that built this project ([map](transcripts/README.md)) |
| `.coderabbit.yaml` | [CodeRabbit](https://coderabbit.ai) AI review settings for pull requests |

### Development

Prerequisites: [Node.js](https://nodejs.org/) 22+ (developed on 26) and npm.
Python 3.10+ (standard library only) for the reference simulator and golden
fixtures — not needed to build or run the app.

```sh
npm install
npm run dev  # Vite dev server with HMR
```

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck (`tsc -b`) + production build to `dist/` |
| `npm test` | Vitest, single run (`npm run test:watch` for watch mode) |
| `npm run lint` | [Oxlint](https://oxc.rs/docs/guide/usage/linter.html) |
| `npm run format` | Prettier, write mode (`format:check` in CI) |
| `npm run typecheck` | `tsc -b` only |
| `npm run test:refsim` | Hand-computed unit tests for the Python reference simulator (`tools/refsim/`) |
| `npm run golden:emit` / `golden:check` | Regenerate / verify the golden fixtures the engine is cross-validated against (see [fixtures/README.md](fixtures/README.md)) |
| `npm run fixtures:build` | Regenerate the synthetic fixture sessions from `scripts/build-synthetic-fixtures.ts` |
| `npm run samples:sync` | Copy the fixtures listed in `src/config/samples.ts` into `public/samples/` |
| `npm run preview` | Serve the production build via Vite |
| `npx wrangler dev` | Serve the production build the way Cloudflare Workers will (build first) |
| `npm run deploy` | Build and deploy to Cloudflare Workers (manual escape hatch; CI deploys `main` automatically) |

### Architecture

Analysis runs entirely in the browser, so uploaded Claude Code session data
never needs to be sent anywhere. A Web Worker streams the JSONL through the
analysis engine and reports progress and results back to the UI.

The engine is parsing, cost calculation and cache simulation under
`src/engine/`, with zero DOM or React dependencies so it runs in a worker and
is testable in Node. Its frozen contract is `src/engine/contract.ts`. The UI in
`src/app/` consumes that contract and nothing else.

No user-facing string is hard-coded in a component: copy lives in
`src/i18n/en.ts` and all number, currency, date and duration formatting goes
through `Intl` (`src/i18n/formatters.ts`), so adding a language is a
translation task rather than a refactor.

### Testing and debugging

`npm test` runs the full suite, including a generated ~100 MB synthetic session
that exercises large-file streaming.

The engine is also cross-validated against **golden fixtures**: every session
under `fixtures/` (crafted traps, adversarial inputs, and scrubbed real
captures) is priced by an independently written Python reference simulator, and
`src/engine/golden.test.ts` diffs the engine's output against those goldens —
with the format-drift canary and content-poison checks on top. CI runs the
sim's own tests and `golden:check`, so a committed golden can never drift from
the sim. [fixtures/README.md](fixtures/README.md) has the details and the
add-a-fixture recipe.

Application logging goes through `src/lib/logger.ts` and is console-only.
Production defaults to `warn`. Enable verbose logging with either:

- `?debug=1` in the URL
- `localStorage.setItem('cta-debug', '1')` followed by a reload

Session strings and file contents must never be logged. Logs are limited to
safe metadata such as counts, enums, durations, and error codes.

### How changes ship

Changes are submitted through pull requests into `main`.

1. [CodeRabbit](https://coderabbit.ai) reviews pull requests, with findings verified against the code before being applied. This gives us adversarial reviews on every PR.
2. CI runs formatting, linting, typechecking, tests, and the production build. The resulting `dist/` artifact is reused for deployment so production serves the same build CI validated.
3. Merges to `main` deploy automatically to Cloudflare Workers and [cacheanalyzer.com](https://cacheanalyzer.com).
4. Branches in this repository receive Cloudflare preview deployments so platform behavior can be tested before merge.

Deployment uses a scoped Cloudflare API token stored in GitHub Actions secrets. See [docs/PLAN.md](docs/PLAN.md) for the credentials and deployment design decisions.
