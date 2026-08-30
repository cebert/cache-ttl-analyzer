# Build plan

The plan for taking cache-ttl-analyzer from scaffolding to a deployed MVP.
Grounded in the research at
[docs/design/claude-code-session-logs/feasibility.md](design/claude-code-session-logs/feasibility.md)
(referenced below as "the feasibility doc") — read it before implementing the
parser or simulator; it documents the traps that make naive implementations
silently wrong.

This plan is decomposed into **work packages (WPs)** sized for individual Claude
sessions, with an explicit dependency graph so independent WPs can run in
parallel.

---

## 1. MVP definition

A static web app, deployed to Cloudflare, where a user:

1. Uploads **one Claude Code session log (JSONL)** at a time — or loads a
   bundled sample.
2. Watches analysis run **entirely in their browser** (Web Worker), with a
   progress indicator and a cancel button.
3. Gets a verdict: what the session actually cost at published Anthropic API
   rates, what it *would have cost* under the other cache TTL (5m vs 1h), and a
   recommendation.
4. Sees cache-behavior insights: cache invalidations (expiry gaps, and hard
   resets from model / effort / version changes), warm-read counts, and short
   educational explanations of each.
5. Can revisit sessions analyzed earlier in the same browser session
   (in-memory history only — nothing persisted).

Plus: clear instructions for finding session logs on macOS and Windows, a
prominent privacy statement ("analysis is local; this is open source — verify
it yourself" with a link to the repo), a dedicated **data policy page** (see
§3a), and a "prices as of" date on every dollar figure.

Two cross-cutting requirements, cheap now and expensive to retrofit:

- **Localization-ready from day one.** MVP ships English only, but no
  user-facing string is hard-coded in a component: all copy lives in locale
  resource files (react-i18next or equivalent — chosen in WP-07), and all
  number, currency, date, and duration formatting goes through the `Intl`
  APIs keyed to the active locale. Adding a second language later must be a
  translation task, not a refactor.
- **Data policy page**: a first-class page, linked from the footer and the
  upload screen, stating in plain language: analysis runs entirely in the
  browser; the file is never uploaded, stored, or sent anywhere; the strict
  CSP enforces this at the platform level (with a one-line "check devtools"
  pointer); no analytics or tracking in the MVP; the project is open source
  (repo link); and any future optional API-powered analysis will be opt-in
  with an explicit, itemized disclosure of what would be sent.

### Non-goals for MVP (deferred, in rough priority order)

- **Anthropic API deep-analysis feature** (upload timestamps/token counts for
  richer analysis). Deferred until MVP proves useful. When picked up, the
  BYO-API-key vs. our-key-plus-rate-limiting decision gets made then.
- Multi-file / folder upload and cross-session rollups (requires global dedup
  and cross-session cache modeling — feasibility doc §6.3, §7).
- Provider-specific rate tables (Bedrock, Vertex). MVP uses Anthropic
  published API rates only — see decision log.
- Claude Code **web JSON export** input. Unverified that it carries `usage`
  (feasibility doc §10). JSONL only for MVP.
- Durable persistence, accounts, authentication.

---

## 2. Architecture

- **Stack:** React + TypeScript + Vite. Deployed as **static assets on
  Cloudflare Workers** via Wrangler. **No server-side code in the MVP** — this
  is deliberate: the strongest form of the privacy claim is that there is no
  backend to send data to.
- **Analysis engine** (`src/engine/`): pure TypeScript, zero DOM/React
  dependencies, so it runs in a Web Worker and is unit-testable in Node.
  - **Parser** reads only the fields it needs (`type`, `timestamp`,
    `message.id`, `message.model`, `message.usage`, `isSidechain`, `effort`,
    `version`) and **never reads `message.content`** — enforced by a test that
    feeds a session whose content blocks are poison values and asserts they
    never appear in any output (feasibility doc §9). One deliberate, named
    exception: the `ai-title` record (the short session title Claude Code
    generates), read for the session identification card (§3) — a single
    string, not conversation content. Not every session has one (4 of 7 in
    the research corpus); payload shape to be verified in WP-03.
  - **Simulator** implements the counterfactual model from the feasibility
    doc: see §3 below.
- **Web Worker** wraps the engine: streams the file
  (`File.stream()` + line splitting, so large logs don't need one giant
  string), posts progress messages, and supports cancellation (terminate).
- **Pricing config** (`src/config/pricing.json`): per-model base rates, cache
  multipliers (read 0.1×, 5m write 1.25×, 1h write 2.0×), `service_tier` and
  `speed` modifiers, and a top-level `pricesAsOf` date shown in the UI.
  Unknown model IDs are reported to the user, never guessed.
- **UI** consumes a frozen engine contract (WP-02) so UI and engine work can
  proceed in parallel.

### Input validation and secure file handling

The app is static and client-side, so the threat model is a malicious or
corrupted **file** being processed in the user's own browser — plus proving to
users that nothing is exfiltrated. Rules:

- **Three validation verdicts:** *valid*; *valid with warnings* (skipped
  records, out-of-range version, unknown model); or *not a session log* — no
  assistant rows carrying `usage`, or malformed-line share above a threshold
  (~10%) — with a plain-language error, never a garbage analysis.
- **Numeric hygiene:** every usage field is checked finite and non-negative
  before pricing; bad rows are skipped and counted.
- **Log-derived strings are untrusted input.** Title, `cwd`, `gitBranch`,
  model IDs render only as text nodes (no `innerHTML` anywhere), length-clamped.
- **No raw JSON into app state.** The parser copies the needed fields into
  typed records and discards the parsed object — no spreading of parsed
  objects, which also neutralizes prototype-pollution keys (`__proto__`,
  `constructor`).
- **Resource limits:** file-size cap with a clear message; streaming parse
  with a per-line length cap so one giant line can't exhaust tab memory;
  analysis in a worker so the page stays responsive; cancel always available.
- **CSP as proof, not just promise:** deploy with a strict
  Content-Security-Policy (`default-src 'self'`; no external `connect-src`)
  so "your data never leaves the browser" is enforced by the platform and
  verifiable in devtools — and mention that in the privacy statement.
- **Nothing persisted:** the file is never written to storage; in-memory
  history keeps analysis results, not file bytes.

### Engine correctness rules (from the feasibility doc — all mandatory)

| Rule | Source |
|---|---|
| Dedup rows on `message.id` (one row per content block, each carries full usage; up to 13× overstatement otherwise) | §6.1 |
| Exclude `message.model == "<synthetic>"` rows | §6.2 |
| Partition by `isSidechain` before computing gaps — sidechains are a separate cache namespace | §6.4 |
| Hard cache reset on any change of `model`, `effort`, or `version`, independent of elapsed time | §6.6 |
| Price per request (models/tiers/speed can vary mid-session); honor `service_tier` and `speed` | §6.5 |
| Gap timing: use the preceding `user` row's timestamp as request start | §7 |
| Expiry model is all-or-nothing per gap; this is conservative toward 5m — disclose it in the UI | §7 |
| Effective TTL comes from `usage.cache_creation` (`ephemeral_5m` / `ephemeral_1h` split), treated as a token-weighted mix | §2 |
| Unrecognized record types are skipped and counted, surfaced as "N records skipped" | §4 |
| Warn (don't fail) when `version` is outside the validated range | §4 |

---

## 3. What the analysis reports

**First, a session identification card** so the user can confirm they loaded
the session they intended — built entirely from content-free metadata: the
session title (from the `ai-title` record when present), working directory
(`cwd`), git branch, date and time span, duration, request count, model(s),
Claude Code version, and file name/size. Message content is never shown; the
card is why it never needs to be.

**Headline:** the main-conversation bucket. Cost at 5m vs cost at 1h,
recommendation, and delta — labelled as *notional cost at published Anthropic
API rates* with a one-line rationale (subscription users have no per-token
bill; API-rate framing is what an API/Bedrock/credits user pays and what
everyone should understand — see decision log).

**Conditionally:** if the session contains sidechain turns, a second section
for the **subagent bucket** (`subagentPromptCacheTtl`), with its own
recommendation. When no sidechains exist, this section does not appear, and
the tool does not imply it evaluated subagent traffic (feasibility doc §3).

**Insights (the educational layer):**

- Timeline of cache events: writes, warm reads, expiries (with the gap that
  caused each), hard resets (annotated with the cause: model switch, effort
  change, version upgrade).
- Counts: cache invalidations, warm-read requests, wasted-write tokens.
- Observed effective TTL per bucket, and whether the configuration was
  provably explicit (the two unambiguous patterns from feasibility doc §3) —
  otherwise no claim about defaults.
- Session shape summary: request count, span, largest gap, share of gaps in
  the 5m–1h band (the only band where the choice matters).

---

## 4. Work packages

Sized so each WP is one focused session producing one PR into `main`. Every PR
passes CI (typecheck, lint, tests, build) and CodeRabbit review.

### WP-01 — Scaffold and tooling
**Depends on:** nothing. **Blocks:** everything.
Vite + React + TS app skeleton; Vitest; ESLint + Prettier; `wrangler.jsonc`
for Workers static assets; npm scripts (`dev`, `build`, `test`, `lint`,
`typecheck`, `deploy`); README "Development" section filled in.
*Acceptance:* `npm run build && npm test` green; `wrangler dev` serves the
placeholder app.

### WP-02 — Engine contract (do in the same session as WP-01)
**Depends on:** WP-01. **Blocks:** WP-03, WP-04, WP-05, WP-07, WP-08.
The frozen TypeScript interfaces everything else codes against:
`ParsedSession` (deduped request records + skip/warning counts),
`AnalysisResult` (per-bucket actual/counterfactual costs, recommendation,
insight events), the Web Worker message protocol (start / progress / cancel /
result / error), and the `pricing.json` schema. Documented inline; changes
after freeze require touching this plan.
*Acceptance:* types compile; a stub engine returning canned data satisfies
them end-to-end through a stub worker.

### WP-03 — Parser
**Depends on:** WP-02. **Parallel with:** WP-04, WP-06, WP-09.
Streaming JSONL parser implementing the correctness rules table (dedup,
synthetic exclusion, skip-and-count, version warnings, minimal field surface,
content-poison test) and the validation/security rules (three verdicts,
numeric hygiene, typed-record copying, line-length cap).
Investigate **Zod** for the per-record schema validation (v4.5's compilation
feature claims large speedups) — but this parser validates millions of lines
in a hot path, so adopt it only if a benchmark against hand-rolled guards on
the 100MB fixture shows no meaningful regression; either way the validation
rules above are the requirement, the library is an implementation choice.
*Acceptance:* unit tests for every rule, plus adversarial tests: malformed
lines, prototype-pollution keys, hostile strings in metadata fields, negative
/ NaN token counts, a single multi-hundred-MB line; parses a 100MB synthetic
file without loading it into one string.

### WP-04 — Pricing config and cost engine
**Depends on:** WP-02. **Parallel with:** WP-03, WP-06, WP-09.
`pricing.json` populated from the published pricing page (with `pricesAsOf`);
actual-cost computation per request (base, cache read, 5m/1h writes, output,
tier/speed modifiers); unknown-model reporting.
*Acceptance:* hand-computed unit tests (values worked out on paper, not
generated by code) for each modifier combination.

### WP-05 — Counterfactual simulator
**Depends on:** WP-03, WP-04.
The core product: replay the session under each TTL; per-bucket partition;
gap-driven expiry; hard resets; insight-event generation (§3 above).
*Acceptance:* unit tests for reset/expiry/refresh edge cases, plus the golden
fixtures from WP-06 matching to the cent.

### WP-06 — Fixtures and golden data
**Depends on:** WP-02 (shapes only). **Parallel with:** WP-03, WP-04.
Two kinds of fixtures:
1. **Crafted synthetic JSONL** exercising each trap: content-block
   duplication, synthetic rows, sidechains, mid-session model switch, effort
   change, version change, gaps in the 5m–1h band, mixed
   `ephemeral_5m`/`ephemeral_1h` writes, unknown record types, unknown model —
   plus adversarial fixtures: a non-session JSONL, malformed lines, hostile
   metadata strings, prototype-pollution keys, invalid numerics.
2. **Real sessions generated by Claude** enacting scenarios (a tight agent
   loop where 5m wins; a long gap-heavy session where 1h wins; a session that
   switches models mid-way) — these double as the bundled samples in
   `public/samples/` and as end-to-end verification that the tool's verdicts
   match intuition.

Extend `prototype-sim.py` to emit expected-output JSON per fixture; commit
those as golden files with a test harness that runs the TS engine against
them.
*Acceptance:* golden files committed; harness wired into `npm test`; samples
are content-scrubbed (they'll be public).

### WP-D — UX design (Claude Design session)
**Depends on:** nothing (MVP definition in this plan is the brief).
**Parallel with:** WP-03, WP-04, WP-06, WP-09.
A dedicated **Claude Design** session produces the visual direction and screen
designs for the whole flow: landing page (privacy statement, upload,
"find your logs" instructions, samples), the analyzing state (progress +
cancel), and the results view (session identification card, recommendation
card, cost comparison,
conditional subagent section, cache-event timeline, educational explainers,
session-history strip). It should also cover the empty/error states: unknown
model, skipped records, version warning, malformed file. Include the data
policy page, and design copy areas with text expansion in mind (translated
strings run ~30% longer than English).
Exports (screens, and the canvas link) are committed to `docs/design/` so
WP-07 and WP-08 sessions can implement against them without guessing.
*Acceptance:* every screen and state listed above has a design in
`docs/design/`; user has signed off on the direction.

### WP-07 — UI shell
**Depends on:** WP-02; WP-D (visual design).
**Parallel with:** WP-05.
Upload (drag-drop + picker), Web Worker wiring with progress bar and cancel,
in-memory history of this browser session's analyses, "find your logs"
instructions (macOS: `~/.claude/projects/...`; Windows path; note
`CLAUDE_CONFIG_DIR` and the 30-day cleanup), privacy statement with repo
link, data policy page, sample-session loader. File-size cap and the three
validation verdicts (valid / warnings / not a session log) as distinct UI
states. Sets up the i18n foundation: locale resource files, the translation
hook pattern, and `Intl`-based formatters — every string in WP-07 and WP-08
goes through it (English-only catalog for MVP).
*Acceptance:* full flow works against the WP-02 stub engine; cancel actually
terminates the worker mid-parse; a non-session file gets the plain-language
rejection, not a broken analysis.

### WP-08 — Results and insights UI
**Depends on:** WP-05, WP-07, WP-D.
Session identification card (title/`cwd`/branch/span/models, with
metadata-only fallback when `ai-title` is absent), recommendation card (with
the API-rates framing line and `pricesAsOf` date), cost comparison, conditional subagent section, cache-event timeline,
educational explainers, approximation disclosure (§7 conservatism), skipped
records / version warnings surfaced.
*Acceptance:* renders correctly for each WP-06 sample, including the
no-sidechain and unknown-model cases.

### WP-09 — CI/CD
**Depends on:** WP-01. **Parallel with:** WP-03, WP-04, WP-06.
GitHub Actions: PR workflow (typecheck, lint, test, build) required on
`main`; deploy workflow on push to `main` via `wrangler deploy` using a
Cloudflare API token secret. Document secret setup in README. Branch
protection on `main`. Serve the strict CSP and security headers (via the
Workers static-assets headers config). Once the domain is in the Cloudflare
account, attach
**cacheanalyzer.com** as a custom domain on the Worker (wrangler
`routes`/custom domain config).
*Acceptance:* a PR shows the checks; a merge to `main` deploys, reachable at
`workers.dev` (and at cacheanalyzer.com once DNS is live); the README's Live
URL is updated.

### WP-10 — Launch polish
**Depends on:** WP-08, WP-09.
README rewrite for end users; verify samples load on the deployed site;
cross-browser pass (Chrome, Safari, Firefox, Edge); Lighthouse/perf sanity
check with the 100MB fixture; final wording pass on privacy and
approximation disclosures.

### Dependency graph

```mermaid
graph LR
    WP01[WP-01 Scaffold] --> WP02[WP-02 Contract]
    WP01 --> WP09[WP-09 CI/CD]
    WP02 --> WP03[WP-03 Parser]
    WP02 --> WP04[WP-04 Pricing]
    WP02 --> WP06[WP-06 Fixtures]
    WP02 --> WP07[WP-07 UI shell]
    WP03 --> WP05[WP-05 Simulator]
    WP04 --> WP05
    WP06 --> WP05
    WP05 --> WP08[WP-08 Results UI]
    WP07 --> WP08
    WP08 --> WP10[WP-10 Launch]
    WP09 --> WP10
    WPD([WP-D Claude Design]) --> WP07
    WPD --> WP08
```

**Suggested waves:** ① WP-01+02 (one session) → ② WP-03, WP-04, WP-06, WP-09,
and WP-D (the Claude Design session), all in parallel → ③ WP-05 and WP-07 in
parallel → ④ WP-08 → ⑤ WP-10.

---

## 5. Testing strategy

- **Unit tests** (Vitest) on parser rules and pricing math, with
  hand-computed expected values.
- **Golden-fixture cross-validation:** `prototype-sim.py` is the reference
  implementation; the TS engine must reproduce its outputs to the cent on
  every fixture. Independent hand-computed tests exist so a shared logic bug
  can't hide in both implementations.
- **Content-poison test:** proves `message.content` never influences or leaks
  into output.
- **Format-drift canary:** fixtures are tagged with the Claude Code `version`
  they represent; the parser's validated-version range lives in one constant,
  and CI fails if a fixture version falls outside it.

---

## 6. Decision log

| # | Decision | Rationale |
|---|---|---|
| D1 | Anthropic API feature deferred to post-MVP | Keeps MVP fully static: no backend, no rate limiting, strongest privacy story. (User, 2026-08-30) |
| D2 | All dollar figures at published Anthropic API rates, clearly labelled | API rates are what usage-billed users pay and what everyone should understand; rationale stated in README and UI. Provider tables (Bedrock/Vertex) deferred. (User) |
| D3 | One session upload at a time; in-memory history only | Processing time unknown; persistence deferred until the tool proves useful. (User) |
| D4 | Always partition sidechains in the simulation; headline the main bucket; show a subagent section only when the session contains sidechain turns | Partitioning is required for correctness regardless (§6.4); conditional display gives two-bucket value without confusing the majority whose sessions have no subagents. (Claude's vote, accepted) |
| D5 | Rates live in a committed `pricing.json` with a `pricesAsOf` date; unknown models reported to the user | Simple, auditable, no runtime fetch. API-driven rates possible later. (User) |
| D6 | Fixtures are synthetic + Claude-generated scenario sessions; no personal sessions bundled | Avoids publishing usage patterns; scenarios can be engineered to teach specific lessons and to verify verdicts. (User) |
| D7 | `prototype-sim.py` is the reference implementation, generating golden fixtures the TS engine must match; plus independent hand-computed tests | Cross-validation between two implementations, with hand-computed values as the tiebreaker. (Claude's vote) |
| D8 | Domain is **cacheanalyzer.com** (user purchasing, 2026-08-30). Deploys target `workers.dev` until the custom domain is wired up in WP-09 | Name was available; buying via Cloudflare Registrar keeps DNS in the same account as the Worker. (User) |
| D9 | JSONL input only for MVP | Web-export JSON unverified for `usage` data (feasibility §10). |
| D10 | Localization-ready architecture from day one; English-only catalog for MVP | Externalized strings + `Intl` formatting are cheap now and a painful retrofit; future languages become translation tasks. (User, 2026-08-30) |
| D11 | Dedicated data policy page in the MVP | Data privacy is a core product value; the policy also pre-commits the disclosure standard for any future opt-in API feature. (User, 2026-08-30) |

## 7. Risks

| Risk | Mitigation |
|---|---|
| Log format is officially internal and unstable (feasibility §4) | Minimal field surface; version pinning + warning; skip-and-count; versioned fixtures in CI |
| Pricing goes stale | `pricesAsOf` shown to users; single-file update path; periodic check noted in README |
| Counterfactual is approximate (all-or-nothing expiry, feasibility §7) | Conservative direction (understates 1h's downside cases toward 5m) disclosed in the UI |
| Subagent path untested against real data | WP-06 must include a real subagent session fixture before WP-05 is called done |
| Huge session files stall the browser | Streaming parse in a worker; progress + cancel; 100MB perf test in WP-10 |
| Malicious or corrupted uploads (hostile strings, pollution keys, giant lines, non-session files) | Validation verdicts; text-node-only rendering; typed-record copying; size/line caps; adversarial fixtures in WP-03/WP-06; strict CSP |
