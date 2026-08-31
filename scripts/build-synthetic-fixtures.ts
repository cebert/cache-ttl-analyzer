/**
 * WP-06 — writes the crafted synthetic fixtures under `fixtures/synthetic/`
 * and `fixtures/adversarial/` (docs/PLAN.md WP-06, kind 1). The outputs ARE
 * committed: this script exists so they are reproducible and reviewable as
 * code, not so they are regenerated at test time.
 *
 * Run: `node scripts/build-synthetic-fixtures.ts`
 *
 * Every fixture exercises one trap from the §2 correctness-rules table or
 * one adversarial input from the validation rules, in a session small
 * enough to check by hand. Row shapes mirror real v2.1.251 logs (see
 * `src/engine/contract.ts` F1–F7): user → attachment → one assistant row
 * per content block, each carrying the full usage.
 *
 * Every conversation payload (message content, attachments, tool results,
 * snapshots) carries the CONTENT_POISON marker; the golden harness asserts
 * it never reaches any output.
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT_ROOT = 'fixtures'
export const CONTENT_POISON = 'POISON'
const T0 = Date.parse('2026-08-30T12:00:00.000Z')
const SESSION_ID = 'f1c7a000-0000-4000-8000-000000000001'
const CWD = '/home/user/projects/fixture-project'

const MIN = 60
const iso = (seconds: number) => new Date(T0 + seconds * 1000).toISOString()
const poison = (label: string) => `${CONTENT_POISON}: ${label} — never read by the parser`

/** Raw `message.usage` as written to the log (deliberately loosely typed). */
type Usage = Record<string, unknown>

interface Turn {
  /** Request start (seconds from T0) — the user row's timestamp. */
  at: number
  input?: number
  read?: number
  w5m?: number
  w1h?: number
  /** Raw override: write `cache_creation_input_tokens` without a split. */
  unattributed?: number
  output?: number
  model?: string
  effort?: string | null
  version?: string
  tier?: string
  speed?: string
  /** Assistant rows for this message (one per content block). */
  blocks?: number
  /** Modern subagent transcript rows. */
  agentId?: string
  /** Legacy interleaved sidechain rows (no agentId). */
  legacySidechain?: string
  /** Extra keys merged into usage (e.g. inference_geo). */
  usageExtra?: Record<string, unknown>
  /** Replace the usage object entirely (invalid-numeric cases). */
  rawUsage?: Usage
  /** Skip the user/attachment rows: the assistant chain has no user ancestor. */
  orphan?: boolean
  /** Point the first assistant row at this parent instead of the attachment. */
  parentOverride?: string | null
}

interface Options {
  version?: string
  model?: string
  effort?: string
  gitBranch?: string
  cwd?: string
  sessionId?: string
  /** Rows appended verbatim (unknown record types etc.). */
  extraRows?: (turnIndex: number) => object[]
  /** Keys merged into every row (e.g. { isSidechain: true, agentId }). */
  rowExtra?: Record<string, unknown>
}

class Session {
  readonly lines: string[] = []
  private turn = 0
  /** Last assistant uuid per thread (main = ''), for parentUuid chaining. */
  private readonly lastByThread = new Map<string, string | null>()
  private readonly opts: Options
  constructor(opts: Options = {}) {
    this.opts = opts
  }

  raw(record: object): void {
    this.lines.push(JSON.stringify(record))
  }

  rawLine(text: string): void {
    this.lines.push(text)
  }

  common(extra: Record<string, unknown> = {}) {
    return {
      isSidechain: false,
      userType: 'external',
      entrypoint: 'cli',
      cwd: this.opts.cwd ?? CWD,
      sessionId: this.opts.sessionId ?? SESSION_ID,
      version: this.opts.version ?? '2.1.251',
      gitBranch: this.opts.gitBranch ?? 'main',
      ...this.opts.rowExtra,
      ...extra,
    }
  }

  /** One request: user → attachment → N assistant rows. Returns the message id. */
  request(t: Turn): string {
    const i = this.turn++
    const thread = t.agentId ?? t.legacySidechain ?? ''
    const sidechainExtra: Record<string, unknown> = t.agentId
      ? { isSidechain: true, agentId: t.agentId }
      : t.legacySidechain
        ? { isSidechain: true }
        : {}
    const tag = thread ? `${thread}-` : ''
    const previous = this.lastByThread.get(thread) ?? null
    let parent: string | null = previous
    if (!t.orphan) {
      const userUuid = `u-${tag}${i}`
      this.raw({
        ...this.common(sidechainExtra),
        parentUuid: previous,
        type: 'user',
        uuid: userUuid,
        timestamp: iso(t.at),
        message: { role: 'user', content: poison(`user prompt ${i}`) },
      })
      const attachmentUuid = `at-${tag}${i}`
      this.raw({
        ...this.common(sidechainExtra),
        parentUuid: userUuid,
        type: 'attachment',
        uuid: attachmentUuid,
        timestamp: iso(t.at + 1),
        attachment: { type: 'hook_success', content: poison(`attachment ${i}`) },
      })
      parent = attachmentUuid
    }
    if (t.parentOverride !== undefined) parent = t.parentOverride

    const messageId = `msg_${tag}${String(i).padStart(3, '0')}`
    const w5m = t.w5m ?? 0
    const w1h = t.w1h ?? 0
    const usage: Usage = t.rawUsage ?? {
      input_tokens: t.input ?? 4,
      cache_creation_input_tokens: t.unattributed ?? w5m + w1h,
      cache_read_input_tokens: t.read ?? 0,
      output_tokens: t.output ?? 120,
      output_tokens_details: { thinking_tokens: 30 },
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
      service_tier: t.tier ?? 'standard',
      ...(t.unattributed === undefined
        ? { cache_creation: { ephemeral_5m_input_tokens: w5m, ephemeral_1h_input_tokens: w1h } }
        : {}),
      inference_geo: 'not_available',
      speed: t.speed ?? 'standard',
      ...t.usageExtra,
    }
    const blocks = t.blocks ?? 1
    let last: string | null = null
    for (let b = 0; b < blocks; b++) {
      const uuid = `a-${tag}${i}-${b}`
      const effort = t.effort === undefined ? (this.opts.effort ?? 'high') : t.effort
      this.raw({
        ...this.common(sidechainExtra),
        // F6: content-block rows are not a linear chain — alternate parents.
        parentUuid: b === 0 || b % 2 === 0 ? parent : last,
        message: {
          model: t.model ?? this.opts.model ?? 'claude-opus-5',
          id: messageId,
          type: 'message',
          role: 'assistant',
          content: [
            b % 2 === 0
              ? { type: 'text', text: poison(`assistant text ${i}/${b}`) }
              : {
                  type: 'tool_use',
                  id: `toolu_${i}_${b}`,
                  name: 'Read',
                  input: { file_path: poison(`tool input ${i}/${b}`) },
                },
          ],
          stop_reason: b === blocks - 1 ? 'end_turn' : null,
          stop_sequence: null,
          usage,
        },
        requestId: `req_${tag}${String(i).padStart(3, '0')}`,
        type: 'assistant',
        uuid,
        timestamp: iso(t.at + 3 + b * 0.5),
        ...(effort === null ? {} : { effort }),
        ...(t.version ? { version: t.version } : {}),
      })
      last = uuid
    }
    this.lastByThread.set(thread, last)
    for (const row of this.opts.extraRows?.(i) ?? []) this.raw(row)
    return messageId
  }

  aiTitle(title: string): void {
    this.raw({ type: 'ai-title', aiTitle: title, sessionId: this.opts.sessionId ?? SESSION_ID })
  }

  text(): string {
    return this.lines.join('\n') + '\n'
  }
}

/** A tight agent loop: first request writes the prefix, later ones read it and append. */
function tightLoop(
  s: Session,
  turns: number,
  ttl: '5m' | '1h',
  opts: {
    start?: number
    every?: number
    prefix?: number
    append?: number
    turn?: Partial<Turn>
  } = {},
): void {
  const start = opts.start ?? 0
  const every = opts.every ?? 20
  const prefix = opts.prefix ?? 20_000
  const append = opts.append ?? 500
  let warm = 0
  for (let i = 0; i < turns; i++) {
    const write = i === 0 ? prefix : append
    s.request({
      at: start + i * every,
      read: warm,
      ...(ttl === '5m' ? { w5m: write } : { w1h: write }),
      blocks: (i % 3) + 1,
      ...opts.turn,
    })
    warm += write
  }
}

const fixtures: Record<string, () => string> = {
  // -- correctness-rules table -------------------------------------------
  'synthetic/dedup-content-blocks': () => {
    // Three requests spanning 1, 3 and 5 rows; every row carries the full usage.
    const s = new Session({
      extraRows: (i) =>
        i === 1 ? [{ type: 'pr-link', prNumber: 7, prUrl: poison('pr url') }] : [],
    })
    s.aiTitle('Provisional title')
    s.request({ at: 0, w1h: 20_000, blocks: 1 })
    s.request({ at: 40, read: 20_000, w1h: 800, blocks: 3 })
    s.request({ at: 95, read: 20_800, w1h: 600, blocks: 5 })
    s.aiTitle('Dedup fixture: three requests, nine rows')
    return s.text()
  },
  'synthetic/synthetic-rows': () => {
    // `<synthetic>` placeholder rows from API error paths carry no billable call.
    const s = new Session()
    s.request({ at: 0, w1h: 15_000 })
    s.raw({
      ...s.common(),
      parentUuid: 'a-0-0',
      type: 'assistant',
      uuid: 'a-synthetic-1',
      timestamp: iso(20),
      message: {
        id: 'msg_synthetic_1',
        model: '<synthetic>',
        role: 'assistant',
        content: [{ type: 'text', text: poison('API error placeholder') }],
        usage: { input_tokens: 0, output_tokens: 0 },
      },
      isApiErrorMessage: true,
    })
    s.request({ at: 45, read: 15_000, w1h: 700 })
    s.raw({
      ...s.common(),
      parentUuid: 'a-1-0',
      type: 'assistant',
      uuid: 'a-synthetic-2',
      timestamp: iso(60),
      message: {
        id: 'msg_synthetic_2',
        model: '<synthetic>',
        role: 'assistant',
        content: [],
        usage: {},
      },
    })
    s.request({ at: 80, read: 15_700, w1h: 300 })
    return s.text()
  },
  'synthetic/legacy-interleaved-sidechains': () => {
    // Pre-separate-file layout (v2.1.193): two parallel subagents' rows are
    // interleaved with the main conversation, marked `isSidechain: true`
    // with no `agentId`; threads must be recovered from `parentUuid` roots.
    const s = new Session({ version: '2.1.193', effort: 'medium' })
    s.request({ at: 0, w1h: 18_000 })
    s.request({ at: 30, read: 18_000, w1h: 900, blocks: 2 }) // spawns two subagents
    s.request({ at: 35, legacySidechain: 'A', w5m: 6_000 })
    s.request({ at: 37, legacySidechain: 'B', w5m: 6_500 })
    s.request({ at: 50, legacySidechain: 'A', read: 6_000, w5m: 400 })
    s.request({ at: 52, legacySidechain: 'B', read: 6_500, w5m: 350 })
    s.request({ at: 70, legacySidechain: 'A', read: 6_400, w5m: 200 })
    s.request({ at: 90, read: 18_900, w1h: 1_200 }) // main resumes
    s.request({ at: 8 * MIN, legacySidechain: 'B', w5m: 6_850 }) // B's 5m entry lapsed (gap 7m08s)
    s.request({ at: 8 * MIN + 30, read: 20_100, w1h: 500 })
    return s.text()
  },
  'synthetic/modern-subagent-transcript': () => {
    // A `<session-id>/subagents/agent-<id>.jsonl` file uploaded on its own:
    // every row carries `agentId` + `isSidechain: true`; the main bucket is empty.
    const s = new Session()
    const agentId = 'a1b2c3d4e5f60718'
    s.request({ at: 0, agentId, w5m: 9_000 })
    s.request({ at: 25, agentId, read: 9_000, w5m: 600, blocks: 2 })
    s.request({ at: 48, agentId, read: 9_600, w5m: 300 })
    s.request({ at: 7 * MIN, agentId, w5m: 9_900 }) // lapsed after a 6m12s gap at 5m
    s.request({ at: 7 * MIN + 20, agentId, read: 9_900, w5m: 250 })
    return s.text()
  },
  'synthetic/model-switch': () => {
    // `/model` mid-session: a hard reset regardless of the 20s gap.
    const s = new Session()
    tightLoop(s, 4, '1h', { prefix: 16_000 })
    tightLoop(s, 3, '1h', { start: 80, prefix: 16_600, turn: { model: 'claude-sonnet-5' } })
    return s.text()
  },
  'synthetic/effort-change': () => {
    const s = new Session()
    tightLoop(s, 3, '1h', { prefix: 14_000, turn: { effort: 'high' } })
    tightLoop(s, 3, '1h', { start: 60, prefix: 15_000, turn: { effort: 'medium' } })
    return s.text()
  },
  'synthetic/version-change': () => {
    // A Claude Code upgrade mid-session (both versions inside the validated range).
    const s = new Session({ version: '2.1.247' })
    tightLoop(s, 3, '1h', { prefix: 14_000 })
    tightLoop(s, 3, '1h', { start: 60, prefix: 14_500, turn: { version: '2.1.251' } })
    return s.text()
  },
  'synthetic/gap-band-observed-1h': () => {
    // Observed 1h. Gaps: 30s, 6m, 20m, 59m (all warm at 1h), then 61m (lapsed).
    const s = new Session()
    const at = [0, 30, 30 + 6 * MIN, 30 + 26 * MIN, 30 + 85 * MIN, 30 + 146 * MIN]
    s.request({ at: at[0], w1h: 22_000 })
    s.request({ at: at[1], read: 22_000, w1h: 700 })
    s.request({ at: at[2], read: 22_700, w1h: 650 })
    s.request({ at: at[3], read: 23_350, w1h: 900 })
    s.request({ at: at[4], read: 24_250, w1h: 400 })
    s.request({ at: at[5], w1h: 24_650 }) // > 1h: re-written in the log itself
    s.request({ at: at[5] + 40, read: 24_650, w1h: 300 })
    return s.text()
  },
  'synthetic/gap-band-observed-5m': () => {
    // Observed 5m with the same gaps: only the 30s gap reads; every other
    // request re-writes the lapsed prefix. 1h would restore the in-band ones.
    const s = new Session()
    const at = [0, 30, 30 + 6 * MIN, 30 + 26 * MIN, 30 + 85 * MIN, 30 + 146 * MIN]
    s.request({ at: at[0], w5m: 22_000 })
    s.request({ at: at[1], read: 22_000, w5m: 700 })
    s.request({ at: at[2], w5m: 23_350 })
    s.request({ at: at[3], w5m: 24_250 })
    s.request({ at: at[4], w5m: 24_650 })
    s.request({ at: at[5], w5m: 24_950 })
    s.request({ at: at[5] + 40, read: 24_950, w5m: 300 })
    return s.text()
  },
  'synthetic/tight-loop-observed-1h': () => {
    // Ten requests 20s apart at 1h: every write is double-priced for nothing.
    const s = new Session()
    tightLoop(s, 10, '1h', { prefix: 30_000, append: 1_200 })
    return s.text()
  },
  'synthetic/mixed-ttl-server-tools': () => {
    // 1h-dominant; web-search requests add their own 5m writes (server-tool share).
    const s = new Session()
    s.request({ at: 0, w1h: 19_000 })
    s.request({
      at: 30,
      read: 19_000,
      w1h: 500,
      w5m: 2_400,
      usageExtra: { server_tool_use: { web_search_requests: 2, web_fetch_requests: 0 } },
    })
    s.request({ at: 7 * MIN, read: 21_900, w1h: 800 })
    s.request({
      at: 7 * MIN + 30,
      read: 22_700,
      w5m: 1_100,
      usageExtra: { server_tool_use: { web_search_requests: 0, web_fetch_requests: 1 } },
    })
    s.request({ at: 8 * MIN, read: 23_800, w1h: 300 })
    return s.text()
  },
  'synthetic/mixed-ttl-5m-dominant-flip': () => {
    // 5m-dominant with a 1h residual at the tail (a mid-session config flip):
    // every write is user-controlled and repriced per scenario.
    const s = new Session()
    s.request({ at: 0, w5m: 17_000 })
    s.request({ at: 40, read: 17_000, w5m: 600 })
    s.request({ at: 6 * MIN, w5m: 17_600 })
    s.request({ at: 6 * MIN + 30, read: 17_600, w1h: 900 })
    s.request({ at: 6 * MIN + 60, read: 18_500, w1h: 200 })
    return s.text()
  },
  'synthetic/unknown-record-types': () => {
    // Skip-and-count, including a `system` row inside the parentUuid chain
    // and more distinct unknown types than the parser keeps separately.
    const s = new Session({
      extraRows: (i) => {
        const rows: object[] = [
          { type: 'mode', mode: 'default', sessionId: SESSION_ID },
          { type: 'permission-mode', permissionMode: 'default', sessionId: SESSION_ID },
          {
            type: 'last-prompt',
            lastPrompt: poison('last prompt'),
            leafUuid: `a-${i}-0`,
            sessionId: SESSION_ID,
          },
          { type: 'frame-link', frameId: `frame-${i}`, sessionId: SESSION_ID },
        ]
        if (i === 0) {
          rows.push({
            type: 'file-history-snapshot',
            messageId: 'u-0',
            snapshot: { files: poison('snapshot') },
          })
          for (let n = 0; n < 104; n++)
            rows.push({ type: `experimental-record-${n}`, payload: poison(`x${n}`) })
        }
        return rows
      },
    })
    s.request({ at: 0, w1h: 12_000 })
    // `system` rows sit inside the parentUuid chain (attachment → system →
    // assistant): the request-start walk must pass through a skipped row. The
    // builder writes the user/attachment rows after this row, which is fine —
    // the walk happens when the assistant row is ingested.
    s.raw({
      ...s.common(),
      parentUuid: 'at-1',
      type: 'system',
      uuid: 'sys-1',
      timestamp: iso(31),
      content: poison('hook output'),
      subtype: 'hook',
    })
    s.request({ at: 30, read: 12_000, w1h: 400, parentOverride: 'sys-1' })
    s.raw({
      ...s.common(),
      parentUuid: 'at-2',
      type: 'system',
      uuid: 'sys-2',
      timestamp: iso(61),
      content: poison('hook output'),
      subtype: 'hook',
    })
    s.request({ at: 60, read: 12_400, w1h: 350, parentOverride: 'sys-2' })
    return s.text()
  },
  'synthetic/unknown-model-minor': () => {
    // One request on an unpriced model: excluded and disclosed; share under 10%.
    const s = new Session()
    tightLoop(s, 6, '1h', { prefix: 25_000 })
    s.request({ at: 200, model: 'claude-mystery-9', input: 900, output: 200 })
    return s.text()
  },
  'synthetic/unknown-model-major': () => {
    // Unpriced share far above 10%: costs shown for the priced share, verdict suppressed.
    const s = new Session()
    s.request({ at: 0, w1h: 8_000 })
    tightLoop(s, 4, '1h', { start: 30, prefix: 30_000, turn: { model: 'claude-mystery-9' } })
    return s.text()
  },
  'synthetic/tier-and-speed': () => {
    // Batch tier (0.5×) and fast mode (2× on Opus 5) mid-session; both scale
    // input, cache and output rates. Neither is a hard reset.
    const s = new Session()
    s.request({ at: 0, w1h: 10_000 })
    s.request({ at: 20, read: 10_000, w1h: 500, tier: 'batch' })
    s.request({ at: 40, read: 10_500, w1h: 500, speed: 'fast' })
    s.request({ at: 60, read: 11_000, w1h: 500, tier: 'batch', speed: 'fast' })
    s.request({ at: 80, read: 11_500, w1h: 500, tier: 'priority' })
    return s.text()
  },
  'synthetic/unattributed-writes': () => {
    // An older log with no `cache_creation` split at all: writes are priced
    // at 5m (the API default) and the observed TTL is 5m.
    const s = new Session({ version: '2.1.193', effort: 'medium' })
    s.request({ at: 0, unattributed: 13_000 })
    s.request({ at: 25, read: 13_000, unattributed: 450 })
    s.request({ at: 6 * MIN, unattributed: 13_450 })
    s.request({ at: 6 * MIN + 30, read: 13_450, unattributed: 300 })
    return s.text()
  },
  'synthetic/version-out-of-range': () => {
    // Canary-exempt: proves the warn-don't-fail path for an unvalidated version.
    const s = new Session({ version: '2.0.0' })
    tightLoop(s, 3, '1h', { prefix: 11_000 })
    return s.text()
  },
  'synthetic/request-start-fallback': () => {
    // Assistant rows whose parentUuid chain never reaches a `user` row (a
    // missing parent, a chain cycle, a null parent) fall back to their own
    // timestamp; one normal request shows the difference.
    const s = new Session()
    s.request({ at: 0, w1h: 9_000 })
    s.request({ at: 30, read: 9_000, w1h: 300, orphan: true, parentOverride: 'never-written' })
    s.raw({
      ...s.common(),
      parentUuid: 'cycle-b',
      type: 'attachment',
      uuid: 'cycle-a',
      timestamp: iso(59),
      attachment: { content: poison('cycle a') },
    })
    s.raw({
      ...s.common(),
      parentUuid: 'cycle-a',
      type: 'attachment',
      uuid: 'cycle-b',
      timestamp: iso(59.5),
      attachment: { content: poison('cycle b') },
    })
    s.request({ at: 60, read: 9_300, w1h: 200, orphan: true, parentOverride: 'cycle-a' })
    s.request({ at: 90, read: 9_500, w1h: 100, orphan: true, parentOverride: null })
    s.request({ at: 120, read: 9_600, w1h: 100 })
    return s.text()
  },
  'synthetic/inference-geo-us': () => {
    // `inference_geo: "us"` data-residency requests. The contract does not
    // carry the field, so these price at standard rates — a stated assumption
    // (docs/PLAN.md WP-04/WP-06 notes), not a modeled 1.1× multiplier.
    const s = new Session()
    tightLoop(s, 4, '1h', { prefix: 12_000, turn: { usageExtra: { inference_geo: 'us' } } })
    return s.text()
  },
  'synthetic/content-poison': () => {
    // Conversation content shaped like the fields the parser wants: a sloppy
    // parser that searched text for usage/model/timestamps would pick these up.
    const decoy = JSON.stringify({
      type: 'assistant',
      timestamp: '1999-01-01T00:00:00.000Z',
      message: {
        id: 'msg_decoy',
        model: 'claude-haiku-4-5',
        usage: { input_tokens: 999_999, cache_read_input_tokens: 999_999, output_tokens: 999_999 },
      },
      version: '0.0.1',
      effort: 'low',
      cwd: `/${CONTENT_POISON}/decoy`,
    })
    const s = new Session({
      extraRows: () => [
        {
          type: 'user',
          uuid: 'decoy-user',
          parentUuid: null,
          timestamp: iso(5),
          message: { role: 'user', content: `${CONTENT_POISON} ${decoy}` },
          toolUseResult: decoy,
        },
      ],
    })
    s.request({ at: 0, w1h: 10_000 })
    s.request({ at: 20, read: 10_000, w1h: 300, blocks: 2 })
    s.raw({
      ...s.common(),
      parentUuid: 'a-1-1',
      type: 'user',
      uuid: 'u-tool',
      timestamp: iso(25),
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1_1', content: `${CONTENT_POISON} ${decoy}` },
        ],
      },
      toolUseResult: { stdout: decoy, file: { filePath: `/${CONTENT_POISON}`, content: decoy } },
    })
    s.request({ at: 40, read: 10_300, w1h: 250 })
    return s.text()
  },
  'synthetic/empty-and-whitespace-lines': () => {
    // Blank lines, CRLF endings, a BOM, whitespace-only lines and no final newline.
    const s = new Session()
    s.request({ at: 0, w1h: 7_000 })
    s.request({ at: 20, read: 7_000, w1h: 200 })
    const lines = s.lines
    return (
      '\uFEFF' +
      lines[0] +
      '\r\n\r\n   \n' +
      lines.slice(1, -1).join('\r\n') +
      '\r\n\n' +
      lines[lines.length - 1]
    )
  },
  // -- adversarial ---------------------------------------------------------
  'adversarial/not-a-session': () => {
    // Valid JSONL that is not a Claude Code session (an app's structured log).
    const rows = []
    for (let i = 0; i < 40; i++) {
      rows.push({
        level: 'info',
        ts: iso(i),
        msg: poison(`log line ${i}`),
        type: i % 5 === 0 ? 'user' : 'request',
        message: { content: poison('nope') },
      })
    }
    return rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
  },
  'adversarial/malformed-majority': () => {
    // 6 good rows, 4 garbage lines (40% > 10%): rejected, with stats.
    const s = new Session()
    s.request({ at: 0, w1h: 5_000 })
    s.request({ at: 20, read: 5_000, w1h: 100 })
    s.rawLine('{"type":"assistant","message":{"id":"msg_x"')
    s.rawLine('not json at all')
    s.rawLine('[1,2,3]')
    s.rawLine('"just a string"')
    return s.text()
  },
  'adversarial/malformed-minority': () => {
    // 3 garbage lines out of 36 non-empty (8.3% ≤ 10%): accepted with warnings.
    const s = new Session()
    tightLoop(s, 11, '1h', { prefix: 5_000, turn: { blocks: 1 } })
    s.rawLine('{"type":')
    s.rawLine('null')
    s.rawLine('{"type": 42}')
    return s.text()
  },
  'adversarial/hostile-metadata': () => {
    // Every log-derived display string is hostile: control characters, ANSI
    // escapes, bidi overrides, markup, and lengths far past the clamp.
    const long = (prefix: string) => prefix + 'x'.repeat(2_000)
    const s = new Session({
      cwd: '/tmp/\u001b[31mred\u001b[0m/<script>alert(1)</script>/\u202eevil/\u0000bin',
      gitBranch: long('feature/bell-\u0007'),
      sessionId: 'sess-\u0085\r\n-ok',
    })
    s.aiTitle('<img src=x onerror=alert(1)> \u001b]0;title' + long('T'))
    s.request({ at: 0, w1h: 6_000, model: 'claude-opus-5' })
    s.request({ at: 20, read: 6_000, w1h: 200, effort: '\u001b[1mhigh\u001b[0m' })
    s.request({ at: 40, read: 6_200, w1h: 200, version: '2.1.251\u0000' })
    s.request({ at: 60, read: 6_400, w1h: 200, model: long('claude-') })
    s.raw({ type: long('weird-type-\u001f'), payload: poison('x') })
    s.raw({ type: '\u0000', payload: poison('y') })
    // Surrogate pairs straddling the clamp boundary in a title.
    s.aiTitle('\u{1F642}'.repeat(260))
    return s.text()
  },
  'adversarial/prototype-pollution': () => {
    // `__proto__` / `constructor` / `prototype` keys at every level. Written
    // as raw JSON text: an object literal's `__proto__` is not an own key.
    const s = new Session()
    s.request({ at: 0, w1h: 4_000 })
    const common = JSON.stringify(s.common()).slice(1, -1)
    s.rawLine(
      `{${common},"type":"assistant","uuid":"a-polluted","parentUuid":"at-0","timestamp":"${iso(20)}",` +
        `"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},` +
        `"message":{"id":"msg_polluted","model":"claude-opus-5","__proto__":{"model":"claude-haiku-4-5"},` +
        `"usage":{"input_tokens":4,"cache_read_input_tokens":4000,"cache_creation_input_tokens":100,"output_tokens":50,` +
        `"cache_creation":{"ephemeral_1h_input_tokens":100,"__proto__":{"ephemeral_5m_input_tokens":999}},` +
        `"constructor":"x","prototype":{"isPrototypeOf":1}}}}`,
    )
    s.rawLine('{"__proto__":{"type":"assistant"},"type":"mode"}')
    s.rawLine(
      `{"type":"user","uuid":"__proto__","parentUuid":"constructor","timestamp":"${iso(30)}"}`,
    )
    s.rawLine(
      `{"type":"assistant","uuid":"a-proto-parent","parentUuid":"__proto__","timestamp":"${iso(33)}","message":{"id":"msg_proto_parent","model":"claude-opus-5","usage":{"input_tokens":4,"cache_read_input_tokens":4100,"output_tokens":20}}}`,
    )
    s.request({ at: 40, read: 4_100, w1h: 100 })
    return s.text()
  },
  'adversarial/invalid-numerics': () => {
    // Each request has exactly one bad token count; only the null/absent
    // ones (meaning 0), the integral floats and exponent forms are valid.
    const s = new Session()
    s.request({ at: 0, w1h: 3_000 })
    const bad: Array<[string, Usage]> = [
      ['negative', { input_tokens: -1, cache_read_input_tokens: 3_000, output_tokens: 10 }],
      ['fraction', { input_tokens: 1.5, cache_read_input_tokens: 3_000, output_tokens: 10 }],
      ['string', { input_tokens: '4', cache_read_input_tokens: 3_000, output_tokens: 10 }],
      ['boolean', { input_tokens: true, cache_read_input_tokens: 3_000, output_tokens: 10 }],
      [
        'unsafe',
        {
          input_tokens: Number.MAX_SAFE_INTEGER + 1,
          cache_read_input_tokens: 3_000,
          output_tokens: 10,
        },
      ],
      [
        'split-negative',
        {
          input_tokens: 4,
          cache_creation_input_tokens: 10,
          cache_creation: { ephemeral_5m_input_tokens: -10, ephemeral_1h_input_tokens: 20 },
          output_tokens: 10,
        },
      ],
      [
        'split-not-object',
        { input_tokens: 4, cache_creation_input_tokens: 10, cache_creation: 10, output_tokens: 10 },
      ],
      ['usage-array', [1, 2, 3] as unknown as Usage],
    ]
    let t = 20
    for (const [, rawUsage] of bad) {
      s.request({ at: t, rawUsage })
      t += 20
    }
    // Valid oddities: null (= 0), absent fields, integral float, exponent form.
    s.request({
      at: t,
      rawUsage: {
        input_tokens: null,
        cache_read_input_tokens: 3e3,
        cache_creation_input_tokens: 100.0,
        output_tokens: 10,
        cache_creation: { ephemeral_1h_input_tokens: 100 },
      },
    })
    // NaN / Infinity literals are not JSON: those lines are malformed, and an
    // out-of-range exponent parses to Infinity, which is an invalid count.
    s.rawLine(
      '{"type":"assistant","uuid":"a-nan","timestamp":"' +
        iso(t + 20) +
        '","message":{"id":"msg_nan","model":"claude-opus-5","usage":{"input_tokens":NaN}}}',
    )
    s.rawLine(
      '{"type":"assistant","uuid":"a-inf","timestamp":"' +
        iso(t + 21) +
        '","message":{"id":"msg_inf","model":"claude-opus-5","usage":{"input_tokens":1e400,"output_tokens":1}}}',
    )
    s.request({ at: t + 40, read: 3_100, w1h: 50 })
    return s.text()
  },
}

function main(): void {
  for (const dir of ['synthetic', 'adversarial']) {
    const path = join(OUT_ROOT, dir)
    mkdirSync(path, { recursive: true })
    for (const stale of readdirSync(path)) rmSync(join(path, stale))
  }
  for (const [id, build] of Object.entries(fixtures)) {
    const path = join(OUT_ROOT, `${id}.jsonl`)
    writeFileSync(path, build())
    console.log(`wrote ${path}`)
  }
}

main()
