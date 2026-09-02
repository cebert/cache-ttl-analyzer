# cache-ttl-analyzer

**Should your Claude Code sessions cache for five minutes, or an hour?**

Cache TTL Analyzer is a helpful tool that uses your actual Claude Code session history to answer that question. You can add a session log, and this tool compares both cache windows to show which would have cost less. Additionally, this tool provides another visual example of how user behavior impacts cost and can be used for educational purposes.

You can visit a live version of this tool at [**cacheanalyzer.com**](https://cacheanalyzer.com).

Don't worry, any sessions you upload to this tool are only processed locally and never leave your machine.

## Why

Prompt caching has an important impact on cost when using agentic coding harnesses like Claude Code. However, the cost drivers aren't always clear. Cache reads are cheaper than fresh input, but longer-lived cache writes are more expensive. Whether a one-hour cache is worth the cache-write premium depends on the session type. 

This tool helps users choose the cache TTLs setting values based on usage data from their actual sessions.

I built Cache TTL Analyzer because many organizations, like the one I work in, are moving from a Claude Code Enterprise plan with subsidized usage to API-based billing. As token costs become more of a concern, we had a practical question: **would paying for a longer cache window actually save us money or cost us more money?**

Claude Code session logs already have all the information you need to answer this question. This tool turns those logs into a concrete visual comparison.

## What it does

Point this tool at a Claude Code session log (a `.jsonl` file from
`~/.claude/projects/`) and it will:

- price the session as it actually ran using Anthropic's published API rates
- replay the same timeline with both five-minute and one-hour cache windows
- tell you which setting would have cost less
- explain what drove the difference, including cache hits, expiries, wasted writes, resets, and request gaps
- educate users on how their session behaviors impact cost

If you don't have a log handy, that's ok. This tool comes with four sample sessions:
- A tight agent loop where 5 minutes wins
- A session with heavy idle gaps where one hour wins
- A session that changes models partway through (ouch)
- A real 85-minute session with human pacing


If you decide to change the setting afterward, use the `CLAUDE_CODE_PROMPT_CACHE_TTL` environment variable, or `promptCacheTtl` in Claude Code's `settings.json`. 

See Anthropic's [Prompt Caching Guide](https://code.claude.com/docs/en/prompt-caching) for more details.

### Aren't there already tools for this?

There are already wonderful tools for inspecting coding agent sessions, such as [Datadog Lapdog](https://chrisebert.net/see-what-your-ai-coding-agent-is-doing-with-datadog-lapdog/) (which I've blogged about previously) and [Agents View](https://www.agentsview.io/). They are great tools you should try.

Cache TTL Analyzer is narrower by design: it focuses specifically on prompt-cache economics and answers a concrete question these tools don’t focus on as much.

### Limitations

Version 1 of this tool analyzes the main conversations in the cache the `promptCacheTtl` setting applies to. Subagents have their own caches (controlled by `subagentPromptCacheTtl`), and these sessions are saved to separate files. Future versions of this tool could support subagent analysis too.

Cache expiration is also modeled at the entry level except where the log shows part of a prefix surviving. Real cache behavior is finer-grained, so this simplification is more conservative.

Pricing uses Anthropic's standard published API rates. Sessions pinned to US-only inference may cost roughly 10% more than shown because that information is not recorded in the session log.

## Roadmap

After Version 1, some good next steps include:

- Analyze main-session and subagent caches together
- Fetch latest API rates instead of static configuration from an API
- Add provider-specific pricing for platforms such as Bedrock and Vertex
- Explore deeper, opt-in analysis and cache recommendations by invoking an LLM only after explicit user consent

---

## Contributing

The build plan, architecture, and decision log live in [docs/PLAN.md](docs/PLAN.md).

### Repo map

| Path | What's in it |
|---|---|
| `src/` | Application source — `engine/` is the analysis and `app/` the UI |
| `docs/PLAN.md` | Build plan, architecture, and decision log |
| `docs/design/` | Claude Design exports and screenshots |
| `fixtures/` | Test sessions and the "golden outputs" the engine must reproduce ([details](fixtures/README.md)) |
| `public/samples/` | The bundled sample logs |
| `transcripts/` | The AI sessions used to build this project ([map](transcripts/README.md)) |
| `.coderabbit.yaml` | [CodeRabbit](https://coderabbit.ai) pull-request review settings |

### Development

Prerequisites:
- [Node.js](https://nodejs.org/) 22+ (developed on 26) and npm.
- Python 3.10+ is used by the reference simulator and golden fixtures, but is not required to build or run the application.

```sh
npm install
npm run dev  # Vite dev server with HMR
```

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + prod build |
| `npm test` | Run tests |
| `npm run lint` | Run [Oxlint](https://oxc.rs/docs/guide/usage/linter.html) |
| `npm run format` | Run Prettier |
| `npm run test:refsim` | Test the Python reference simulator |
| `npm run golden:check` | Verify golden fixtures |
| `npm run preview` | Serve the production build |

### Architecture

Analysis runs entirely in the browser, so uploaded Claude Code session data never needs to leave the machine. This helps eliminate privacy and data policy concerns.

A Web Worker streams the JSONL through the analysis engine and reports progress and findings to the UI. The engine under `src/engine/` has no DOM or React dependencies, allowing it to run independently and be tested directly in Node. The UI under `src/app/` consumes the engine's frozen contract.

### Testing

The analysis engine is tested against synthetic edge cases, scrubbed real sessions, and a generated ~100 MB session that exercises large-file streaming.

It is also cross-validated against an independently written Python reference simulator. Golden fixtures ensure that the TypeScript implementation and reference implementation continue to produce the same results.

### Debugging

Application logging goes through `src/lib/logger.ts` and is console-only. Production defaults to `warn`.

Enable verbose logging with either:
- `?debug=1` in the URL
- `localStorage.setItem('cta-debug', '1')` followed by a reload

Please note the session strings and file contents *must not be logged*. Logs should be limited to privacy preserving metadata such as counts, enums, timestamps, and error codes.

### Deployment

- Pull requests run formatting, linting, typechecking, tests, and the production build. CodeRabbit provides an additional automated review pass.
- Merges to `main` deploy automatically to Cloudflare Workers and cacheanalyzer.com. Branches receive Cloudflare preview deployments for testing before merge.
- Deployment uses a scoped Cloudflare API token stored in GitHub Actions secrets.