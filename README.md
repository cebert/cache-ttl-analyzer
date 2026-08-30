
# cache-ttl-analyzer

Upload Claude Code session logs in files (JSON or JSONL), and this tool will analyze whether you could save money by paying for a longer cache window duration.

**Status:** scaffolding — nothing implemented yet. See [docs/PLAN.md](docs/PLAN.md).

**Live URL:**  _not deployed yet (Cloudflare, planned)_

## Why

[Prompt caching](https://code.claude.com/docs/en/prompt-caching) plays a critical role in agentic harnesses like Claude Code. Without caching, every turn must be reprocessed, which increases latency and cost.

This tool was created to help answer the question: **should I pay for longer cache windows?**

Claude Code picks a cache TTL for you, but the default depends on your plan. On a Claude subscription plan, the main conversation is cached for one hour under plan usage (usage credit usage drops to 5 minutes). When using an API key or a cloud provider like Amazon Bedrock, the default TTL is only five minutes. Users who aren't on a subscription plan must decide whether paying for longer caching (which incurs extra cost) is more economical than staying with shorter window durations. 

Many excellent tools are already available to trace and review coding harness sessions, such as [Datadog Lapdog](https://chrisebert.net/see-what-your-ai-coding-agent-is-doing-with-datadog-lapdog/) and [Agents View](https://www.agentsview.io/).  However, these tools arguably focus less on prompt caching and seem to assume users are on subscription plans. 

The organization I work for is increasingly concerned about AI costs and ensuring the value delivered matches or exceeds token costs. Like many other organizations, we are on a legacy Claude Code Enterprise Subscription plan with subsidized tokens that ends soon. Our organization is planning for the increased costs it will incur when it transitions to API-based billing in Amazon Bedrock or another provider with usage-based billing. Caching is one lever we can use to control costs, but few tools help us focus on this problem. The cache TTL analyzer can help with making these decisions. 

From my experience, many developers are still unaware of the cost impact their behaviors have on caching. For example, changing effort or models mid-session will invalidate the cache, and resuming long-lived sessions can result in expensive cache misses. A secondary goal of this tool is to raise awareness of the cost impact of these behaviors.

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

```sh
npm install
npm run dev        # Vite dev server with HMR
```

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck (`tsc -b`) + production build to `dist/` |
| `npm test` | Vitest, single run (`npm run test:watch` for watch mode) |
| `npm run lint` | [Oxlint](https://oxc.rs/docs/guide/usage/linter.html) |
| `npm run format` | Prettier, write mode (`format:check` in CI) |
| `npm run typecheck` | `tsc -b` only |
| `npm run preview` | Serve the production build via Vite |
| `npx wrangler dev` | Serve the production build the way Cloudflare Workers will (build first) |
| `npm run deploy` | Build and deploy to Cloudflare Workers (manual; CI deploys land in WP-09) |

### Architecture in one paragraph

Analysis runs entirely in the browser: a Web Worker
(`src/worker/analysis.worker.ts`) streams the uploaded JSONL through the
engine (`src/engine/` — pure TypeScript, no DOM, unit-testable in Node) and
posts progress/results back over a typed message protocol. The frozen
engine contract lives in `src/engine/contract.ts` (with `pricing.ts` and
`protocol.ts`) — read its header before touching engine code; changes
require touching [docs/PLAN.md](docs/PLAN.md). The current engine is the
WP-02 stub returning canned data.

### Debug logging

All logging goes through `src/lib/logger.ts` (see docs/PLAN.md, decision
D13): console-only, never transmitted anywhere, quiet (`warn`) by default in
production builds. To get verbose output for troubleshooting, either:

- add `?debug=1` to the URL, or
- run `localStorage.setItem('cta-debug', '1')` in the devtools console (and
  reload; remove with `localStorage.removeItem('cta-debug')`).

When contributing: never log session-log-derived strings (titles, paths,
branches, prompts) or file contents — counts, enums, durations, and error
codes only.