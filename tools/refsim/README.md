# Reference simulator

`refsim.py` is the **independently written second implementation** of the
analysis engine (docs/PLAN.md decision D7): a plain-Python parser, cost engine
and counterfactual simulator that follows the same spec as `src/engine/` —
the §2 correctness-rules table, the frozen contract, and the WP-05
implementation notes — but shares no code with it. Its only shared input is
`src/config/pricing.json`.

It exists to emit the golden files under `fixtures/golden/` that the
TypeScript engine must reproduce (`src/engine/golden.test.ts`). Neither
implementation is trusted over the other: `test_refsim.py` holds hand-computed
expectations (arithmetic written next to each number), and those are the
tiebreaker when the two disagree.

It replaces the throwaway `prototype-sim.py` from the feasibility research,
which implemented almost none of the rules and was never a valid oracle.

```sh
python3 tools/refsim/refsim.py analyze path/to/session.jsonl   # golden JSON to stdout
npm run golden:emit                                            # write every golden
npm run golden:check                                           # fail if any golden is stale (CI)
npm run test:refsim                                            # hand-computed unit tests
```

No dependencies beyond the standard library; Python ≥ 3.10.

## What it implements

- **Parsing** (`SessionParser`): line splitting with the same semantics as the
  engine's byte splitter (every `\n` ends a line, trailing `\r` and a leading
  BOM stripped, over-cap lines counted as malformed and capped); JSON parsing
  that rejects `NaN`/`Infinity` literals like `JSON.parse`; dedup on
  `message.id` (first row defines the request, later rows extend the
  completion timestamp); `<synthetic>` exclusion; numeric hygiene (absent/null
  = 0, otherwise a non-negative safe integer); request start via the
  `parentUuid` walk to the nearest `user` row; thread keys from `agentId`,
  else legacy sidechain recovery from `parentUuid` chain roots; metadata
  sanitization (control characters stripped, clamp in UTF-16 units, dangling
  surrogate dropped); the three validation verdicts and every warning kind.
- **Pricing**: base × tier × speed multipliers, cache read/write multipliers,
  unattributed writes at 5m, unknown models unpriced.
- **Simulation**: per-bucket, per-thread replay under each TTL with gaps
  between request starts; hard resets on model/effort/version; the
  mixed-TTL policy (server-tool 5m share held at 5m in a 1h-dominant bucket;
  everything user-controlled in a 5m-dominant one); shortening and
  lengthening edits; the insight-event timeline; session shape; verdicts and
  suppression.

## Keeping it independent

When a golden disagreement shows up, do not fix it by reading the other
implementation's code path and copying it. Work the case out on paper (add it
to `test_refsim.py` or `src/engine/simulator.test.ts` as a hand-computed
test), then fix whichever side is wrong.
