
# cache-ttl-analyzer

Upload local Claude Code session logs (JSONL files), and this tool will analyze whether you could save money by paying for a longer cache window duration or whether this would end up costing even more.

**Status:** in progress, see [docs/PLAN.md](docs/PLAN.md) for more details.
**Live URL:** [cacheanalyzer.com](https://cacheanalyzer.com) 

## What it does

Upload a Claude Code JSONL session and this tool will:
- analyze  its caching behavior and actual token cost
- simulates the same session using alternative cache TTLs
- compares the resulting cost
- highlights session behaviors that caused expensive cache misses


## Why

Prompt caching plays an important role in agentic harnesses like Claude Code. Without caching, every turn must be reprocessed, which increases latency and cost.

This tool was created to help answer the question: **should I pay for longer cache windows?**

On a Claude Code subscription plan, Claude picks a default for you. Main conversations are cached for one hour when running under subsidized plan usage. However, when subscription users transition to credit usage, this drops to 5 minutes. When using an API key or a cloud provider like Amazon Bedrock, the default TTL is also 5 minutes.

Users who aren't on a subscription plan must decide whether paying for longer caching (which incurs extra cost) is more economical than staying with shorter window durations. Caching behavior can be altered by changing the `CLAUDE_CODE_PROMPT_CACHE_TTL` environmental variable or by modifying the `promptCacheTtl` in Claude Code's settings.json file. See Anthropic's [Prompt Caching Guide](https://code.claude.com/docs/en/prompt-caching) for additional details.

### Aren't there already tools for this?

Many excellent tools are already available to trace and review coding harness sessions, such as [Datadog Lapdog](https://chrisebert.net/see-what-your-ai-coding-agent-is-doing-with-datadog-lapdog/) (which I've blogged about previously) and [Agents View](https://www.agentsview.io/). However, these tools arguably focus less on prompt caching and more on overall session observability.

### Background Motivation

The organization I work for is moving from a legacy Claude Code Enterprise plan with subsidized tokens to API-based billing. There's an increased focus on cost and token usage. Prompt caching is a meaningful cost lever, but we have little data to determine whether longer cache windows will save money or cost more. Cache TTL Analyzer was created to address this real-world question with data.

A secondary goal of this tool is to increase developer awareness of cost drivers. From my experience, many developers are still unaware of the cost impact their behaviors have on caching. or example, changing effort or models mid-session can invalidate the cache, while resuming long-lived sessions can result in expensive cache misses. This tool can help surface those behaviors and enable better-informed decisions.

## Repo map

| Path | What's in it |
|---|---|
| `docs/PLAN.md` | Build plan and phases |
| `docs/design/` | Claude Design exports, screenshots |
| `transcripts/` | The AI sessions that built this project ([map](transcripts/README.md)) |
| `src/` | Application source |
| `public/samples/` | Bundled demo session logs so the tool works without your own data |
| `.coderabbit.yaml` | [CodeRabbit](https://coderabbit.ai) AI review settings for pull requests |

## Development

Prerequisites: [Node.js](https://nodejs.org/) 22+ (developed on 26) and npm.
Python 3.10+ (standard library only) for the reference simulator and golden
fixtures — not needed to build or run the app.

```sh
npm  install
npm  run  dev  # Vite dev server with HMR
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
| `npm run preview` | Serve the production build via Vite |
| `npx wrangler dev` | Serve the production build the way Cloudflare Workers will (build first) |
| `npm run deploy` | Build and deploy to Cloudflare Workers (manual escape hatch; CI deploys `main` automatically) |

### Architecture

Analysis runs entirely in the browser so uploaded Claude Code session data does not need to be sent to an external service. A Web Worker streams JSONL through the analysis engine and reports progress and results back to the UI.

The engine consists of parsing, cost calculation, and cache simulation components under `src/engine/`. Its shared contract is defined in `src/engine/contract.ts`. See [docs/PLAN.md](docs/PLAN.md) for detailed architecture and implementation decisions.

### Testing and debugging

`npm test` runs the full test suite, including a generated ~100 MB synthetic session used to exercise large-file processing.

The engine is also cross-validated against **golden fixtures**: every
session under `fixtures/` (crafted traps, adversarial inputs, and scrubbed
real captures) is priced by an independently written Python reference
simulator, and `src/engine/golden.test.ts` diffs the engine's output against
those goldens — with the format-drift canary and content-poison checks on
top. CI runs the sim's own tests and `golden:check`, so a committed golden
can never drift from the sim. [fixtures/README.md](fixtures/README.md) has
the details and the add-a-fixture recipe.

Application logging goes through `src/lib/logger.ts` and is console-only. Production defaults to `warn`. Enable verbose logging with either:

- `?debug=1` in the URL
- `localStorage.setItem('cta-debug', '1')` followed by a reload

Session strings and file contents must never be logged. Logs should be limited to safe metadata such as counts, enums, durations, and error codes.

## How changes ship

Changes are submitted through pull requests into `main`.

1. [CodeRabbit](https://coderabbit.ai) reviews pull requests, with findings verified against the code before being applied. This gives us adversarial reviews on every PR.
2. CI runs formatting, linting, typechecking, tests, and the production build. The resulting `dist/` artifact is reused for deployment so production serves the same build CI validated.
3. Merges to `main` deploy automatically to Cloudflare Workers and [cacheanalyzer.com](https://cacheanalyzer.com).
4. Branches in this repository receive Cloudflare preview deployments so platform behavior can be tested before merge.

Deployment uses a scoped Cloudflare API token stored in GitHub Actions secrets. See [docs/PLAN.md](docs/PLAN.md) for the credentials and deployment design decisions.