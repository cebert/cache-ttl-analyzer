# Feasibility: computing cache-TTL cost counterfactuals from Claude Code session logs

**Date:** 2026-08-30
**Question:** Do Claude Code session logs contain enough data to recompute what a
session would have cost under a different `promptCacheTtl` (5m vs 1h), using
Anthropic's published API rates?

**Verdict: Yes — build it.** Every input the cost model needs is present per
request. The exact-dollar *actual* cost is fully determined by the logs; the
*counterfactual* is a simulation with one honest approximation, described below.

Two things the official docs added that reshape the product, both detailed later:
there are **two TTL settings**, not one (`promptCacheTtl` and
`subagentPromptCacheTtl`), so the tool should report two recommendations; and the
**defaults depend on how the user is billed**, which determines whether the dollar
figure is their real bill or a notional at-API-rates comparison. The one standing
risk is that Anthropic documents the file format as internal and unstable (§4).

A working prototype (`prototype-sim.py`, alongside this doc) ran over 7 real
sessions end-to-end and produced differentiated recommendations, so this is
confirmed by execution, not by reading the schema.

---

## 1. Where the logs live and what they are

[Officially](https://code.claude.com/docs/en/sessions#where-transcripts-are-stored):
`~/.claude/projects/<project>/<session-id>.jsonl`, where `<project>` is the working
directory path with non-alphanumeric characters replaced by `-` (truncated to 200
chars plus a hash of the full path when longer). `CLAUDE_CONFIG_DIR` can move the
root and `CLAUDE_CODE_PROJECT_DIR_NAME` can override the `<project>` segment, so an
uploader must not assume the path encodes a real directory. Transcripts are cleaned
up after 30 days by default (`cleanupPeriodDays`), which caps how much history any
user can bring.

One JSON object per line. Record `type` values observed: `assistant`, `user`, `attachment`, `system`,
`file-history-snapshot`, `file-history-delta`, `mode`, `permission-mode`,
`bridge-session`, `ai-title`, `atis-latch`, `last-prompt`, `queue-operation`.

**Only `type: "assistant"` rows carry billing data.** Everything else is ignorable
for this tool.

## 2. The billing payload

Every assistant row has `message.usage`:

```json
{
  "input_tokens": 2,
  "cache_creation_input_tokens": 13185,
  "cache_read_input_tokens": 23472,
  "output_tokens": 386,
  "output_tokens_details": { "thinking_tokens": 237 },
  "cache_creation": {
    "ephemeral_5m_input_tokens": 0,
    "ephemeral_1h_input_tokens": 13185
  },
  "service_tier": "standard",
  "speed": "standard",
  "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 },
  "iterations": [ ... ]
}
```

Plus on the row itself: `timestamp` (ISO-8601, ms), `requestId`, `message.id`,
`message.model`, `isSidechain`, `sessionId`, `cwd`, `gitBranch`, `version`.

This is everything the cost model needs:

| Needed | Field | Notes |
|---|---|---|
| Which model priced it | `message.model` | e.g. `claude-opus-5`, `claude-opus-4-8` |
| Uncached input | `usage.input_tokens` | |
| Cache reads | `usage.cache_read_input_tokens` | billed 0.1× base input |
| Cache writes | `usage.cache_creation_input_tokens` | |
| **Which TTL was actually used** | `usage.cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` | the decisive field |
| Output | `usage.output_tokens` | thinking tokens are already included |
| Request timing | `timestamp` on the assistant row; the preceding `user` row approximates request *start* | drives the expiry simulation |
| Rate modifiers | `usage.service_tier`, `usage.speed` | `speed: "fast"` on Opus 5 prices at $10/$50, not $5/$25 |

**The configured `promptCacheTtl` value is not written to the log, and is not in
`settings.json` either.** It must be *inferred* from the `cache_creation` split.
That inference is reliable: in all 7 sessions on this machine, 100% of cache-write
tokens landed in `ephemeral_1h_input_tokens`, correctly identifying a 1h
configuration. Note the split is per-request, and a single request can legitimately
mix both TTLs (server tools insert their own 5m writes), so treat it as a
token-weighted mix, not a boolean.

## 3. The setting being analyzed is actually two settings

Anthropic documents [two independent TTL controls](https://code.claude.com/docs/en/prompt-caching#choose-the-ttl-yourself),
each accepting `5m` or `1h`, both requiring Claude Code **v2.1.242 or later**:

| Bucket | Setting | Env var | Covers |
|---|---|---|---|
| Main conversation | [`promptCacheTtl`](https://code.claude.com/docs/en/settings-reference#promptcachettl) | `CLAUDE_CODE_PROMPT_CACHE_TTL` | interactive turns, `-p` runs, Agent SDK turns, inline helpers |
| Everything else | [`subagentPromptCacheTtl`](https://code.claude.com/docs/en/settings-reference#subagentpromptcachettl) | `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` | subagents, workflows, teammates, forks, compaction, session titles |

**This makes the sidechain handling in §6.4 a product feature, not an edge case.**
The tool should report and recommend the two buckets separately — they are tuned
separately, they have different default values, and an agent-heavy workload can
easily want opposite answers for each.

Resolution order when several controls apply (first match wins), per the docs:
`FORCE_PROMPT_CACHING_5M=1` → the bucket's env var → the bucket's setting →
a subagent's `experimental.cacheTtl` frontmatter (v2.1.248+) →
`ENABLE_PROMPT_CACHING_1H=1` → the bucket default.

### What the log does and doesn't reveal about the setting

**The configured value is never recorded.** No record type carries `promptCacheTtl`,
`subagentPromptCacheTtl`, either env var, or any settings snapshot — verified by
scanning every line of all 9 local session files for those names and for `"ttl"`.
The only hits are this project's own conversation content. The setting is also absent
from `settings.json`.

What the log carries instead is the **effective TTL per request**, in
`usage.cache_creation`. That is arguably better than the setting: it is ground truth
*after* the entire six-step resolution order, so it already accounts for env vars,
managed settings, subagent frontmatter, and the plan-usage downgrade. But it answers
"what happened", never "what was configured" or "why".

Two consequences:

**Default vs. explicit is only inferable in one direction.** Comparing the two
buckets narrows the possibilities, but never confirms a default:

| Observed pattern | What it means |
|---|---|
| Main 1h, subagents 5m | Consistent with subscription-within-plan defaults — but identical to an API-key user who set `promptCacheTtl: 1h` and left the other alone. **Ambiguous.** |
| Main 5m, subagents 5m | Consistent with API-key/credits defaults — or `FORCE_PROMPT_CACHING_5M=1`. **Ambiguous.** |
| Both 1h | No default combination produces this. Requires `ENABLE_PROMPT_CACHING_1H=1` or both settings set. **Definitely explicit.** |
| Main 5m, subagents 1h | No default produces this either. **Definitely explicit.** |

So the tool can say "this was explicitly configured" with certainty in two of four
cases, and can never say "this was the default" with certainty. Billing mode is not
recoverable at all. Ask the user; don't guess.

**The second bucket is mostly invisible.** Of the request classes
`subagentPromptCacheTtl` governs, only subagents appear in the transcript at all.
Verified: four sessions carry an `ai-title` record — proving a background
title-generation request ran — yet **no session contains a single Haiku-model
assistant row**. Helper and background requests are not written to the transcript
with usage. Compaction is unconfirmed either way, since no session in this corpus
compacted.

Practically: unless the uploaded session ran subagents, the tool sees only the main
conversation bucket and can only advise on `promptCacheTtl`. It should say so rather
than implying it evaluated both.

### Defaults depend on how you're billed — and this reframes the headline

| Bucket | Claude subscription, within plan usage | Usage credits, API key, or cloud provider |
|---|---|---|
| Main conversation | **1 hour** | **5 minutes** |
| Everything else | 5 minutes (except server-controlled helpers) | 5 minutes |

This explains the corpus cleanly: every local session wrote 1h because these ran on
a Claude subscription within plan usage, where 1h is the *default* — not because
anything was misconfigured. Two consequences worth stating plainly in the product:

- **The framing "6 of 7 sessions were on the wrong setting" is about cost at API
  rates, not about a mistake anyone made.** For a subscription user inside plan
  usage there is no per-token bill at all, so the dollar figures are a *notional*
  "what this would have cost at published API rates" — exactly what was asked for,
  but it must be labelled as such or it will read as an invoice.
- **The audience that can act on the recommendation is the API-key / usage-credit /
  cloud-provider user**, who defaults to 5m on both buckets and may be leaving the
  1h win on the table for long, gap-heavy sessions. The tool cannot see billing mode
  in the log, so it should ask, or present both readings.

## 4. The format is officially unstable — plan for it

This is the one genuine project risk, and it comes straight from Anthropic:

> Each line is a JSON object for a message, tool use, or metadata entry. **The entry
> format is internal to Claude Code and changes between versions, so scripts that
> parse these files directly can break on any release.** To build on session data,
> use `/export` or the script interfaces instead.
> — [Where transcripts are stored](https://code.claude.com/docs/en/sessions#where-transcripts-are-stored)

The sanctioned alternatives don't serve this use case: `/export` renders prose for a
human and drops `usage` entirely, and the script interfaces
([`--output-format json`](https://code.claude.com/docs/en/headless#get-structured-output),
the [hook `transcript_path`](https://code.claude.com/docs/en/hooks#common-input-fields),
the Agent SDK) all cover a *live* run, not the historical sessions already sitting on
disk. Retrospective analysis has no supported path, so parsing the JSONL is the only
way to build this — which is a deliberate tradeoff, not an oversight to discover later.

Mitigations, all cheap:

- **Pin to the `version` field**, which every assistant row carries. Record the
  versions a build was validated against and warn on anything outside that range
  rather than failing silently. The corpus already spans 2.1.193 / 2.1.247 / 2.1.251.
- **Depend on the smallest possible surface.** The tool needs `type`, `timestamp`,
  `message.id`, `message.model`, `message.usage`, `isSidechain`, `effort`, `version` —
  eight fields. Never touch `message.content`. A narrow parser survives more releases
  and, per §9, is also the privacy-correct design.
- **Fail loudly and partially.** An unrecognized record type should be skipped and
  counted, not crash the run; surface "N records skipped" in the UI.
- **Ship fixtures** from each validated version so a format change shows up in CI
  rather than in a user's browser.

## 5. The pricing math

From Anthropic's published rates:

- cache **read** = 0.1× the base input rate
- cache **write, 5m TTL** = 1.25× base input
- cache **write, 1h TTL** = 2.0× base input
- A cache read **refreshes the entry's timer at no cost**, on either TTL.
- Lifetime is measured from the **start** of the request that writes or reads it —
  generation time counts against the window.

Base rates ($/1M): Opus 5 and Opus 4.8 $5/$25 · Sonnet 5 $2/$10 ·
Sonnet 4.6 $3/$15 · Haiku 4.5 $1/$5 · Fable 5 $10/$50.

Break-even: 5m pays for itself at 2 requests (1.25 + 0.1 = 1.35 vs 2.0 uncached);
1h needs 3+ (2.0 + 0.2 = 2.2 vs 3.0). **1h only wins when gaps exceed 5 minutes** —
otherwise every request refreshes the 5m entry for free and the doubled write price
is pure loss. This is exactly the tradeoff the tool exists to quantify.

## 6. Traps that will silently produce wrong numbers

These are the reason a naive implementation gives garbage, and they're the real
value of this research.

### 6.1 One JSONL row per content block — dedup is mandatory

Claude Code writes **one row per content block of an assistant message**, and
**every one of those rows carries the full message `usage`**. Observed in real
logs: `msg_011CdygtRmd95FeRM1AqU7Xt` appears **13 times**, all with identical
`output_tokens: 12528`, `cache_read: 37044`. Summing rows overstates cost by up to
13×. Across the sample, 281 rows collapsed to 142 real requests.

**Dedup on `message.id`.** Verified 1:1 with `requestId` across all 669 assistant
rows (0 requestIds mapping to >1 message id, and vice versa), so either key works.

### 6.2 Synthetic rows

`message.model == "<synthetic>"` rows exist (2 in the sample, from API error
paths). They have no `service_tier`/`speed` and represent no billable call.
Exclude them.

### 6.3 Cross-file duplication

`--resume` / fork can copy history into a new session file. Not observed in this
sample (0 message ids in >1 file), but if the tool accepts a folder upload,
dedup must be **global across files**, not per-file.

### 6.4 Sidechains are a separate cache namespace

`isSidechain: true` marks subagent turns. A subagent starts its own conversation
with its own system prompt and tool set, so its first request cannot read the
parent's cache and it warms one of its own. The simulator must partition by
`isSidechain` before computing gaps.

Per §3 this is also the boundary of the second setting, `subagentPromptCacheTtl` —
so this is not merely a correctness detail but the split along which the tool
reports two separate recommendations. None appear in this sample, so **the path
is untested against real data until a session with subagents is captured.**

### 6.5 Model and rate heterogeneity within one session

The corpus spans `claude-opus-5` and `claude-opus-4-8`, though each individual
session held one model. Price per request anyway — a mid-session `/model` switch is
both legal and, per the docs below, a full cache invalidation. Also honor
`service_tier` (batch = 50%) and `speed` (fast mode = 2× on Opus 5).

### 6.6 Model, effort, and version changes reset the cache entirely

Per Anthropic's docs, the cache key includes the **model**, the **effort level**,
and the **fast-mode header** — and a Claude Code upgrade usually changes the system
prompt, invalidating from the top. All three are recoverable from the log: the row
carries `message.model`, `effort`, and `version`.

The simulator must treat a change in any of them as a hard cache reset, independent
of elapsed time. In this corpus each session held one model, one effort, and one
version, so no in-session reset occurs — but `effort` does vary across sessions
(`high` vs `medium`) and `version` spans 2.1.193 / 2.1.247 / 2.1.251, so the fields
are live and the case is real.

## 7. The one real approximation

The actual cost is exact. The counterfactual is not, for one reason:

**The logs report aggregate token counts, not per-breakpoint detail.** Claude Code
uses up to 4 cache breakpoints. When a 5m entry lapses, real-world behavior is a
*partial* invalidation — some breakpoints survive, some don't — but the logs only
give you a single `cache_read_input_tokens` total. The simulator therefore models
expiry as all-or-nothing: if the gap since the previous same-thread request exceeds
the TTL, the tokens that were read become a fresh write at the write multiplier.

This **overstates** the penalty of the shorter TTL in mixed cases, which means the
5m recommendation is conservative — it will under-sell 5m rather than over-sell it.
That's the right direction to be wrong in, and it should be stated in the UI rather
than hidden.

Second-order: `timestamp` on an assistant row is response completion, not request
start, and TTL runs from start. The preceding `user` row's timestamp is a good
proxy for start (observed ~2–5s earlier). Using it tightens gap accuracy; ignoring
it biases gaps slightly long. Cheap to do — do it.

Third: sub-5-minute gaps that a 1h TTL would have covered are irrelevant, so the
simulation is only sensitive in the 5m–1h band. In this sample, only 1 session had
gaps in that band — which is also the only session where 1h won.

Fourth, and newly confirmed from the docs: **cache scope is wider than one session.**
Claude Code's cache is effectively scoped to machine + working directory, so parallel
sessions in the same directory read each other's cache; a fork reads its parent's;
`/rewind` lands back on an already-warm entry; and the compaction request reads the
conversation prefix. A strictly per-session simulation therefore ignores real cross-
session hits. Treating each session independently is the right v1 — it is the unit
the user uploads and reasons about — but the folder-level rollup should not claim to
be exact, and cross-session sharing is a plausible v2 refinement.

## 8. Prototype results (real sessions, this machine)

| Session | Requests | Span | Cost @5m | Cost @1h | Better | Delta |
|---|---|---|---|---|---|---|
| 908ed721 | 8 | 1.1m | $0.77 | $1.07 | **5m** | $0.30 |
| 3dd62ac3 | 19 | 10.7m | $1.93 | $2.32 | **5m** | $0.40 |
| 43e08bdd | 50 | 80.2m | $6.97 | $4.83 | **1h** | $2.13 |
| 334db6f6 | 142 | 29.1m | $11.86 | $12.80 | **5m** | $0.94 |
| 4cb8948e | 56 | 19.2m | $4.63 | $5.10 | **5m** | $0.47 |
| d4592e2c | 10 | 2.9m | $0.83 | $1.07 | **5m** | $0.24 |
| 98d37497 | 11 | 1.3m | $0.54 | $0.71 | **5m** | $0.16 |

The result is not degenerate — it flips on session shape. Tight agent loops favor
5m (writes are half price and reads keep refreshing); the 80-minute session with
human think-time gaps favors 1h by 31%. All these sessions actually ran at 1h, so
6 of 7 were on the wrong setting. That's the product.

## 9. Privacy: local-only processing is genuinely required, not decorative

The JSONL contains full user prompts, full assistant output, complete file contents
via `attachment` and `file-history-snapshot` records, absolute paths (`cwd`),
`gitBranch`, and tool outputs. Uploading these to a server would be a real
disclosure. The client-side-only design is the correct call and should be stated
prominently — and the parser should never need to read `message.content` at all,
only `usage` + metadata, which is worth enforcing in code as a defensive property.

## 10. Open items before/during build

- **JSON (non-JSONL) input.** The user asked for JSON support. Claude Code's
  `/export` output is a different shape and may not carry `usage`. **Verify against
  a real export before promising it.** JSONL is confirmed and should be the primary
  path.
- **Capture a subagent session** as a fixture to exercise the `isSidechain` path.
- **Capture a 5m-configured session** for the inverse direction; every local
  session ran at 1h.
- Decide whether to model a **hybrid** recommendation (1h on the stable system/tool
  prefix, 5m on the conversation tail) — the logs can't distinguish per-breakpoint
  behavior, so this can only be presented as guidance, not a computed number.
- Pricing table needs a stated "rates as of" date and an easy update path, sourced
  from the [published pricing page](https://platform.claude.com/docs/en/about-claude/pricing).
- **Consider whether the tool is even needed for a given user.** As of v2.1.251,
  `/usage` shows a `Prompt cache (main)` line with hit ratio, miss count, and warm
  state, and a statusline script can read the same `prompt_cache` object. That is
  live, not retrospective, and gives no dollar counterfactual — but it is worth
  knowing what the built-in already answers, and worth linking to from the UI.

## 11. Sources

### Official Anthropic documentation

The format itself is barely documented — location and a stability warning, nothing
more. The *caching semantics* the tool models, by contrast, are documented in depth.

| Page | What it establishes |
|---|---|
| [Manage sessions › Where transcripts are stored](https://code.claude.com/docs/en/sessions#where-transcripts-are-stored) | The path layout, the `<project>` slug rule and 200-char truncation, retention (`cleanupPeriodDays`, default 30 days), `CLAUDE_CONFIG_DIR` / `CLAUDE_CODE_PROJECT_DIR_NAME`, and the **explicit warning that the entry format is internal and unstable** |
| [Manage sessions › Access conversations from scripts](https://code.claude.com/docs/en/sessions#access-conversations-from-scripts) | The four sanctioned programmatic interfaces, and why none of them covers retrospective analysis |
| [How Claude Code uses prompt caching](https://code.claude.com/docs/en/prompt-caching) | The whole model: prefix matching, the three-layer request ordering, and the full list of invalidating vs. cache-preserving actions |
| [› Cache lifetime](https://code.claude.com/docs/en/prompt-caching#cache-lifetime) | The two TTLs, which requests fall in which bucket, and the billing-dependent defaults table |
| [› Choose the TTL yourself](https://code.claude.com/docs/en/prompt-caching#choose-the-ttl-yourself) | Both settings, both env vars, the six-step resolution order, `FORCE_PROMPT_CACHING_5M`, and the official method for confirming which TTL was used — reading `usage.cache_creation` |
| [› Cache scope](https://code.claude.com/docs/en/prompt-caching#cache-scope) | Cache is scoped to machine + directory; parallel same-directory sessions share it |
| [› Subagents and the cache](https://code.claude.com/docs/en/prompt-caching#subagents-and-the-cache) | Subagents warm their own cache; forks read the parent's |
| [› Check cache performance](https://code.claude.com/docs/en/prompt-caching#check-cache-performance) | Field definitions for `cache_creation_input_tokens` and `cache_read_input_tokens` |
| [Settings reference › `promptCacheTtl`](https://code.claude.com/docs/en/settings-reference#promptcachettl) · [`subagentPromptCacheTtl`](https://code.claude.com/docs/en/settings-reference#subagentpromptcachettl) | The two settings the tool exists to advise on |
| [Environment variables](https://code.claude.com/docs/en/env-vars) | `CLAUDE_CODE_PROMPT_CACHE_TTL`, `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL`, `FORCE_PROMPT_CACHING_5M`, `ENABLE_PROMPT_CACHING_1H` |
| [Costs › Prompt cache statistics](https://code.claude.com/docs/en/costs#prompt-cache-statistics) · [Statusline › prompt cache fields](https://code.claude.com/docs/en/statusline#prompt-cache-fields) | What the built-in `/usage` and statusline already report (v2.1.251+) |
| [Non-interactive mode › structured output](https://code.claude.com/docs/en/headless#get-structured-output) | `--output-format json`, the one JSON shape with usage and cost |
| [Hooks › common input fields](https://code.claude.com/docs/en/hooks#common-input-fields) | `transcript_path`, for a `SessionEnd` archiving hook |
| [API › Prompt caching: 1-hour cache duration](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#1-hour-cache-duration) · [pricing](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#pricing) | The canonical 1.25× / 2.0× write and 0.1× read multipliers |
| [Published API pricing](https://platform.claude.com/docs/en/about-claude/pricing) | The per-model base rates |
| [Lessons from building Claude Code: prompt caching is everything](https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything) | Design rationale — useful background, not a spec |

### Prior art

| Project | Why it's relevant |
|---|---|
| [simonw/claude-code-transcripts](https://github.com/simonw/claude-code-transcripts) (Apache-2.0) | Closest prior art. Renders local JSONL **and Claude Code web JSON exports** to paginated HTML. Confirms the web-export JSON path is real and parseable, and is a working reference for record-type coverage. `uvx claude-code-transcripts --help` |
| [Simon Willison's write-up](https://simonwillison.net/2025/Dec/25/claude-code-transcripts/) (2025-12-25) | Background on the tool and the format |
| [daaain/claude-code-log](https://github.com/daaain/claude-code-log) | Python CLI, JSONL → HTML/Markdown; another independent read of the record types |
| [claude-code-transcripts (Rust crate)](https://docs.rs/claude-code-transcripts) | A typed parser — the closest thing to a written-down schema, and a useful cross-check on field nullability |

None of these price anything or model cache TTL. **No prior art was found for the
cost-counterfactual use case**, which is the gap this project fills.
