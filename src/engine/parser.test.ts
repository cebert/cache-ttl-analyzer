/**
 * WP-03 parser tests: one block per row of the docs/PLAN.md §2 correctness
 * table, the three validation verdicts, the adversarial cases from the
 * "Input validation and secure file handling" rules, and a regression run
 * over the real corpus the contract's F1–F7 findings were taken from.
 */

import { createReadStream, readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  MALFORMED_LINE_REJECT_RATIO,
  MAX_LINE_LENGTH_BYTES,
  MAX_METADATA_STRING_LENGTH,
  VALIDATED_VERSION_RANGE,
  type ParsedSession,
  type RequestRecord,
} from './contract'
import { JsonlLineSplitter } from './jsonl-stream'
import {
  DEFAULT_SERVICE_TIER,
  DEFAULT_SPEED,
  isVersionInValidatedRange,
  LEGACY_SIDECHAIN_THREAD_PREFIX,
  MAIN_THREAD_ID,
  MAX_DISTINCT_SKIPPED_TYPES,
  OTHER_SKIPPED_TYPES_KEY,
  parseSession,
  parseUsage,
  rejectionReason,
  sanitizeMetadataString,
  SessionParser,
  SYNTHETIC_MODEL_ID,
} from './parser'

/* ---------------------------------------------------------------------------
 * Row builders. Field names mirror the real log; content is present so the
 * poison test has something to leak.
 * ------------------------------------------------------------------------- */

const T0 = Date.parse('2026-08-30T12:00:00.000Z')
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString()
const SESSION_ID = 'de925854-5278-4226-acc0-3e9f02abab1e'
const OK_VERSION = VALIDATED_VERSION_RANGE.max

const common = {
  isSidechain: false,
  userType: 'external',
  entrypoint: 'cli',
  cwd: '/home/user/project',
  sessionId: SESSION_ID,
  version: OK_VERSION,
  gitBranch: 'main',
}

type Json = Record<string, unknown>

function userRow(uuid: string, parentUuid: string | null, ts: string, extra: Json = {}): Json {
  return {
    ...common,
    parentUuid,
    type: 'user',
    uuid,
    timestamp: ts,
    message: { role: 'user', content: 'user prompt text' },
    ...extra,
  }
}

function attachmentRow(uuid: string, parentUuid: string, ts: string, extra: Json = {}): Json {
  return {
    ...common,
    parentUuid,
    type: 'attachment',
    uuid,
    timestamp: ts,
    attachment: { type: 'hook_success', content: 'hook output' },
    ...extra,
  }
}

const OK_USAGE = {
  input_tokens: 2,
  cache_creation_input_tokens: 100,
  cache_read_input_tokens: 1000,
  output_tokens: 50,
  output_tokens_details: { thinking_tokens: 10 },
  server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
  service_tier: 'standard',
  cache_creation: { ephemeral_1h_input_tokens: 100, ephemeral_5m_input_tokens: 0 },
  inference_geo: 'not_available',
  iterations: [],
  speed: 'standard',
}

interface AssistantOpts {
  uuid: string
  parentUuid: string | null
  ts: string
  id: string
  model?: string
  usage?: unknown
  effort?: unknown
  version?: unknown
  extra?: Json
  message?: Json
}

function assistantRow(o: AssistantOpts): Json {
  return {
    ...common,
    parentUuid: o.parentUuid,
    message: {
      model: o.model ?? 'claude-fable-5',
      id: o.id,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'assistant reply text' }],
      stop_reason: 'end_turn',
      usage: o.usage === undefined ? OK_USAGE : o.usage,
      ...(o.message ?? {}),
    },
    requestId: `req_${o.id}`,
    type: 'assistant',
    uuid: o.uuid,
    timestamp: o.ts,
    effort: o.effort === undefined ? 'high' : o.effort,
    ...(o.version === undefined ? {} : { version: o.version }),
    ...(o.extra ?? {}),
  }
}

/** One full turn: user -> attachment -> N assistant content-block rows. */
function turn(
  n: number,
  opts: { blocks?: number; prev?: string | null; model?: string; extra?: Json } = {},
): Json[] {
  const base = n * 60
  const rows: Json[] = [
    userRow(`u${n}`, opts.prev ?? (n === 0 ? null : `a${n - 1}-0`), at(base), opts.extra),
    attachmentRow(`at${n}`, `u${n}`, at(base + 1), opts.extra),
  ]
  const blocks = opts.blocks ?? 1
  for (let b = 0; b < blocks; b++) {
    rows.push(
      assistantRow({
        uuid: `a${n}-${b}`,
        parentUuid: b === 0 ? `at${n}` : `a${n}-${b - 1}`,
        ts: at(base + 3 + b),
        id: `msg_${n}`,
        model: opts.model,
        extra: opts.extra,
      }),
    )
  }
  return rows
}

function parse(
  lines: (Json | string)[],
  options: Partial<ConstructorParameters<typeof SessionParser>[0]> = {},
): ParsedSession {
  const parser = new SessionParser({ fileName: 'session.jsonl', fileSizeBytes: 1234, ...options })
  for (const line of lines) parser.feedLine(typeof line === 'string' ? line : JSON.stringify(line))
  return parser.finish()
}

function ids(parsed: ParsedSession): string[] {
  return parsed.requests.map((r) => r.messageId)
}

/* ---------------------------------------------------------------------------
 * Correctness-rules table (docs/PLAN.md §2).
 * ------------------------------------------------------------------------- */

describe('dedup on message.id (§6.1, F6, F7)', () => {
  it('collapses one row per content block into one request, keeping the first row', () => {
    const parsed = parse([...turn(0, { blocks: 3 }), ...turn(1)])
    expect(parsed.stats.assistantRows).toBe(4)
    expect(parsed.stats.dedupedRequests).toBe(2)
    expect(ids(parsed)).toEqual(['msg_0', 'msg_1'])
    expect(parsed.requests[0].usage.cacheReadInputTokens).toBe(1000)
  })

  it('takes the completion timestamp from the last row of the message', () => {
    const parsed = parse(turn(0, { blocks: 3 }))
    expect(parsed.requests[0].timestamp).toBe(at(5))
    expect(parsed.requests[0].requestStartTimestamp).toBe(at(0))
    expect(parsed.metadata.lastTimestamp).toBe(at(5))
  })

  it('does not depend on parentUuid being linear across a message', () => {
    // F6: continuation rows may all point back at the attachment.
    const rows = [
      userRow('u0', null, at(0)),
      attachmentRow('at0', 'u0', at(1)),
      assistantRow({ uuid: 'a0', parentUuid: 'at0', ts: at(3), id: 'msg_0' }),
      assistantRow({ uuid: 'a1', parentUuid: 'at0', ts: at(4), id: 'msg_0' }),
      assistantRow({ uuid: 'a2', parentUuid: 'u0', ts: at(5), id: 'msg_0' }),
    ]
    expect(parse(rows).stats.dedupedRequests).toBe(1)
  })

  it('keys on message.id only — same requestId or uuid does not merge, same id does', () => {
    const rows = [
      userRow('u0', null, at(0)),
      assistantRow({
        uuid: 'a0',
        parentUuid: 'u0',
        ts: at(3),
        id: 'msg_A',
        extra: { requestId: 'req_X' },
      }),
      assistantRow({
        uuid: 'a1',
        parentUuid: 'a0',
        ts: at(4),
        id: 'msg_B',
        extra: { requestId: 'req_X' },
      }),
      assistantRow({ uuid: 'a0', parentUuid: 'a1', ts: at(5), id: 'msg_C' }),
      assistantRow({ uuid: 'a9', parentUuid: 'a1', ts: at(6), id: 'msg_A' }),
    ]
    expect(ids(parse(rows))).toEqual(['msg_A', 'msg_B', 'msg_C'])
  })

  it('preserves file order', () => {
    const parsed = parse([...turn(0), ...turn(1), ...turn(2)])
    expect(ids(parsed)).toEqual(['msg_0', 'msg_1', 'msg_2'])
  })
})

describe('synthetic row exclusion (§6.2)', () => {
  it('drops <synthetic> rows and counts them, even with null tier/speed and no id', () => {
    const synthetic = assistantRow({
      uuid: 's0',
      parentUuid: 'at0',
      ts: at(2),
      id: 'cd48aa87-821c-4977-9325-f8cbc217207a',
      model: SYNTHETIC_MODEL_ID,
      usage: { ...OK_USAGE, service_tier: null, speed: null, iterations: null },
      extra: { error: 'authentication_failed', isApiErrorMessage: true },
    })
    const parsed = parse([
      ...turn(0),
      synthetic,
      { type: 'assistant', message: { model: SYNTHETIC_MODEL_ID } },
    ])
    expect(parsed.stats.syntheticRowsExcluded).toBe(2)
    expect(parsed.stats.assistantRows).toBe(3)
    expect(ids(parsed)).toEqual(['msg_0'])
    expect(parsed.metadata.models).toEqual(['claude-fable-5'])
    expect(parsed.stats.malformedLines).toBe(0)
  })

  it('rejects a file whose only assistant rows are synthetic', () => {
    const parsed = parse([
      userRow('u0', null, at(0)),
      assistantRow({ uuid: 's0', parentUuid: 'u0', ts: at(1), id: 'x', model: SYNTHETIC_MODEL_ID }),
    ])
    expect(parsed.verdict).toBe('not-a-session-log')
    expect(rejectionReason(parsed)).toBe('no-assistant-usage-rows')
  })
})

describe('skip-and-count unrecognized record types (F4)', () => {
  it('counts each unknown type and warns; recognized types are never counted', () => {
    const parsed = parse([
      ...turn(0),
      { type: 'frame-link', artifactCount: 0, sessionId: SESSION_ID },
      { type: 'frame-link', artifactCount: 1, sessionId: SESSION_ID },
      { type: 'pr-link', prNumber: 13, sessionId: SESSION_ID },
      { type: 'artifact-autoreact-ledger', sessionId: SESSION_ID },
      { type: 'ai-title', aiTitle: 'Title', sessionId: SESSION_ID },
      { type: 'never-seen-before', payload: {} },
    ])
    expect(parsed.stats.skippedRecordTypes).toEqual({
      'frame-link': 2,
      'pr-link': 1,
      'artifact-autoreact-ledger': 1,
      'never-seen-before': 1,
    })
    expect(parsed.warnings).toContainEqual({
      kind: 'skipped-record-types',
      types: parsed.stats.skippedRecordTypes,
    })
    expect(parsed.verdict).toBe('valid-with-warnings')
  })

  it('aggregates beyond MAX_DISTINCT_SKIPPED_TYPES so a hostile file cannot grow the map', () => {
    const rows: Json[] = [...turn(0)]
    for (let i = 0; i < MAX_DISTINCT_SKIPPED_TYPES + 50; i++) rows.push({ type: `t${i}` })
    const types = parse(rows).stats.skippedRecordTypes
    expect(Object.keys(types)).toHaveLength(MAX_DISTINCT_SKIPPED_TYPES + 1)
    expect(types[OTHER_SKIPPED_TYPES_KEY]).toBe(50)
  })
})

describe('version range (feasibility §4)', () => {
  it('accepts both inclusive bounds and warns outside them', () => {
    expect(isVersionInValidatedRange(VALIDATED_VERSION_RANGE.min)).toBe(true)
    expect(isVersionInValidatedRange(VALIDATED_VERSION_RANGE.max)).toBe(true)
    expect(isVersionInValidatedRange('2.1.192')).toBe(false)
    expect(isVersionInValidatedRange('2.1.252')).toBe(false)
    expect(isVersionInValidatedRange('2.2.0')).toBe(false)
    expect(isVersionInValidatedRange('1.9.999')).toBe(false)
    expect(isVersionInValidatedRange('2.1.200')).toBe(true)
  })

  it('compares numerically, not lexically', () => {
    expect(isVersionInValidatedRange('2.1.25')).toBe(false)
    expect(isVersionInValidatedRange('2.1.1930')).toBe(false)
  })

  it('treats unparseable versions as out of range', () => {
    for (const v of ['', '2.1', '2.1.251-beta', 'v2.1.251', '2.1.251.1', 'latest', '2.1.x']) {
      expect(isVersionInValidatedRange(v), v).toBe(false)
    }
  })

  it('warns (never fails) listing only the out-of-range versions, in first-seen order', () => {
    const rows = [
      ...turn(0, { extra: { version: '9.0.0' } }),
      ...turn(1, { extra: { version: OK_VERSION } }),
      ...turn(2, { extra: { version: '0.1.0' } }),
      ...turn(3, { extra: { version: '9.0.0' } }),
    ]
    const parsed = parse(rows)
    expect(parsed.verdict).toBe('valid-with-warnings')
    expect(parsed.warnings).toEqual([
      { kind: 'version-out-of-range', versions: ['9.0.0', '0.1.0'] },
    ])
    expect(parsed.metadata.versions).toEqual(['9.0.0', OK_VERSION, '0.1.0'])
    expect(parsed.requests.map((r) => r.version)).toEqual(['9.0.0', OK_VERSION, '0.1.0', '9.0.0'])
  })

  it('leaves version undefined when absent or not a string', () => {
    const parsed = parse([
      userRow('u0', null, at(0)),
      assistantRow({ uuid: 'a0', parentUuid: 'u0', ts: at(1), id: 'm0', version: 5 }),
    ])
    expect(parsed.requests[0].version).toBeUndefined()
    expect(parsed.metadata.versions).toEqual([])
    expect(parsed.warnings).toEqual([])
  })
})

describe('request start pairing (F3)', () => {
  it('walks parentUuid through the attachment to the nearest user row', () => {
    const parsed = parse(turn(0))
    expect(parsed.requests[0]).toMatchObject({
      requestStartTimestamp: at(0),
      requestStartSource: 'user-ancestor',
      timestamp: at(3),
    })
  })

  it('uses the nearest user ancestor, not the root of the conversation', () => {
    const rows = [
      userRow('u0', null, at(0)),
      assistantRow({ uuid: 'a0', parentUuid: 'u0', ts: at(3), id: 'm0' }),
      userRow('u1', 'a0', at(10)), // tool_result user row
      attachmentRow('at1', 'u1', at(11)),
      assistantRow({ uuid: 'a1', parentUuid: 'at1', ts: at(14), id: 'm1' }),
    ]
    expect(parse(rows).requests[1].requestStartTimestamp).toBe(at(10))
  })

  it('walks through unrecognized rows (e.g. system) that link the chain', () => {
    const rows = [
      userRow('u0', null, at(0)),
      {
        ...common,
        type: 'system',
        subtype: 'local_command',
        uuid: 's0',
        parentUuid: 'u0',
        timestamp: at(1),
      },
      assistantRow({ uuid: 'a0', parentUuid: 's0', ts: at(80), id: 'm0' }),
    ]
    const parsed = parse(rows)
    expect(parsed.requests[0]).toMatchObject({
      requestStartTimestamp: at(0),
      requestStartSource: 'user-ancestor',
    })
    expect(parsed.stats.skippedRecordTypes).toEqual({ system: 1 })
  })

  it('falls back to the assistant timestamp when no user ancestor resolves', () => {
    const rows = [
      attachmentRow('at0', 'missing', at(1)),
      assistantRow({ uuid: 'a0', parentUuid: 'at0', ts: at(3), id: 'm0' }),
      assistantRow({ uuid: 'a1', parentUuid: null, ts: at(4), id: 'm1' }),
      assistantRow({
        uuid: 'a2',
        parentUuid: 'a1',
        ts: at(5),
        id: 'm2',
        extra: { parentUuid: 42 },
      }),
    ]
    const parsed = parse(rows)
    for (const r of parsed.requests) {
      expect(r.requestStartSource).toBe('assistant-row-fallback')
      expect(r.requestStartTimestamp).toBe(r.timestamp)
    }
  })

  it('skips user rows without a usable timestamp and keeps walking', () => {
    const rows = [
      userRow('u0', null, at(0)),
      userRow('u1', 'u0', 'not a date'),
      assistantRow({ uuid: 'a0', parentUuid: 'u1', ts: at(3), id: 'm0' }),
    ]
    expect(parse(rows).requests[0].requestStartTimestamp).toBe(at(0))
  })

  it('survives a parentUuid cycle', () => {
    const rows = [
      attachmentRow('x', 'y', at(1)),
      attachmentRow('y', 'x', at(2)),
      assistantRow({ uuid: 'a0', parentUuid: 'x', ts: at(3), id: 'm0' }),
    ]
    expect(parse(rows).requests[0].requestStartSource).toBe('assistant-row-fallback')
  })

  it('never lets a duplicated uuid rewrite the chain', () => {
    const rows = [
      userRow('u0', null, at(0)),
      userRow('u0', null, at(50)), // hostile duplicate; first writer wins
      assistantRow({ uuid: 'a0', parentUuid: 'u0', ts: at(3), id: 'm0' }),
    ]
    expect(parse(rows).requests[0].requestStartTimestamp).toBe(at(0))
  })
})

describe('thread keys (F2)', () => {
  it('main-thread rows get threadId "main" and isSidechain false', () => {
    expect(parse(turn(0)).requests[0]).toMatchObject({
      threadId: MAIN_THREAD_ID,
      isSidechain: false,
    })
  })

  it('a modern subagent transcript keys every request on agentId', () => {
    const agent = { agentId: 'a137a13bcaec09000', isSidechain: true }
    const rows = [
      userRow('u0', null, at(0), agent),
      assistantRow({ uuid: 'a0', parentUuid: 'u0', ts: at(3), id: 'm0', extra: agent }),
      userRow('u1', 'a0', at(10), agent),
      attachmentRow('at1', 'u1', at(11), agent),
      assistantRow({ uuid: 'a1', parentUuid: 'at1', ts: at(14), id: 'm1', extra: agent }),
    ]
    const parsed = parse(rows)
    expect(parsed.requests.map((r) => r.threadId)).toEqual([
      'a137a13bcaec09000',
      'a137a13bcaec09000',
    ])
    expect(parsed.requests.every((r) => r.isSidechain)).toBe(true)
    expect(parsed.requests[1].requestStartTimestamp).toBe(at(10))
  })

  it('agentId wins even when isSidechain is missing', () => {
    const parsed = parse([
      assistantRow({
        uuid: 'a0',
        parentUuid: null,
        ts: at(3),
        id: 'm0',
        extra: { agentId: 'agent-x' },
      }),
    ])
    expect(parsed.requests[0]).toMatchObject({ threadId: 'agent-x', isSidechain: true })
  })

  it('legacy interleaved sidechains are recovered per chain root, interleaved or not', () => {
    const sc = { isSidechain: true }
    const rows = [
      // main conversation
      userRow('u0', null, at(0)),
      assistantRow({ uuid: 'a0', parentUuid: 'u0', ts: at(3), id: 'main-0' }),
      // subagent A starts (root has no parent)
      userRow('sa-u0', null, at(4), sc),
      assistantRow({ uuid: 'sa-a0', parentUuid: 'sa-u0', ts: at(6), id: 'A-0', extra: sc }),
      // subagent B, spawned from the main assistant row (parent points into main)
      userRow('sb-u0', 'a0', at(5), sc),
      assistantRow({ uuid: 'sb-a0', parentUuid: 'sb-u0', ts: at(7), id: 'B-0', extra: sc }),
      // A continues, interleaved with B
      userRow('sa-u1', 'sa-a0', at(8), sc),
      attachmentRow('sa-at1', 'sa-u1', at(9), sc),
      assistantRow({ uuid: 'sa-a1', parentUuid: 'sa-at1', ts: at(12), id: 'A-1', extra: sc }),
      userRow('sb-u1', 'sb-a0', at(9), sc),
      assistantRow({ uuid: 'sb-a1', parentUuid: 'sb-u1', ts: at(13), id: 'B-1', extra: sc }),
      // main resumes
      userRow('u1', 'a0', at(20)),
      assistantRow({ uuid: 'a1', parentUuid: 'u1', ts: at(23), id: 'main-1' }),
    ]
    const parsed = parse(rows)
    const byId = Object.fromEntries(parsed.requests.map((r) => [r.messageId, r.threadId]))
    expect(byId).toEqual({
      'main-0': MAIN_THREAD_ID,
      'A-0': `${LEGACY_SIDECHAIN_THREAD_PREFIX}1`,
      'B-0': `${LEGACY_SIDECHAIN_THREAD_PREFIX}2`,
      'A-1': `${LEGACY_SIDECHAIN_THREAD_PREFIX}1`,
      'B-1': `${LEGACY_SIDECHAIN_THREAD_PREFIX}2`,
      'main-1': MAIN_THREAD_ID,
    })
    expect(parsed.requests.filter((r) => r.isSidechain)).toHaveLength(4)
    expect(parsed.requests.find((r) => r.messageId === 'A-1')?.requestStartTimestamp).toBe(at(8))
  })

  it('a legacy sidechain row that cannot be chained gets its own thread', () => {
    const rows = [
      assistantRow({
        uuid: 'x',
        parentUuid: 'nope',
        ts: at(1),
        id: 'm0',
        extra: { isSidechain: true },
      }),
      assistantRow({
        uuid: 'y',
        parentUuid: 'x',
        ts: at(2),
        id: 'm1',
        extra: { isSidechain: true },
      }),
      {
        ...assistantRow({
          uuid: 'z',
          parentUuid: null,
          ts: at(3),
          id: 'm2',
          extra: { isSidechain: true },
        }),
        uuid: 7,
      },
    ]
    const parsed = parse(rows)
    expect(parsed.requests.map((r) => r.threadId)).toEqual([
      `${LEGACY_SIDECHAIN_THREAD_PREFIX}1`,
      `${LEGACY_SIDECHAIN_THREAD_PREFIX}1`,
      `${LEGACY_SIDECHAIN_THREAD_PREFIX}2`,
    ])
  })
})

describe('usage copying (F5 optional subfields, numeric hygiene)', () => {
  it('copies every field of a complete usage object', () => {
    expect(parse(turn(0)).requests[0].usage).toEqual({
      inputTokens: 2,
      cacheReadInputTokens: 1000,
      cacheCreationInputTokens: 100,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 100,
      outputTokens: 50,
      serviceTier: 'standard',
      speed: 'standard',
    })
  })

  it('treats missing subfields as genuinely optional (the real subagent shape)', () => {
    const usage = parseUsage({
      input_tokens: 2,
      cache_creation_input_tokens: 23486,
      cache_read_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 23486, ephemeral_1h_input_tokens: 0 },
      output_tokens: 5,
      service_tier: 'standard',
      inference_geo: 'not_available',
      iterations: [],
    })
    expect(usage).toEqual({
      inputTokens: 2,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 23486,
      cacheCreation5mTokens: 23486,
      cacheCreation1hTokens: 0,
      outputTokens: 5,
      serviceTier: 'standard',
      speed: DEFAULT_SPEED,
    })
  })

  it('defaults an absent cache_creation split and null tier/speed', () => {
    expect(
      parseUsage({ input_tokens: 1, output_tokens: 1, service_tier: null, speed: null }),
    ).toEqual({
      inputTokens: 1,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheCreation5mTokens: 0,
      cacheCreation1hTokens: 0,
      outputTokens: 1,
      serviceTier: DEFAULT_SERVICE_TIER,
      speed: DEFAULT_SPEED,
    })
    expect(parseUsage({ cache_creation: null })?.cacheCreation1hTokens).toBe(0)
  })

  it('keeps observed tier/speed values verbatim', () => {
    expect(parseUsage({ service_tier: 'batch', speed: 'fast' })).toMatchObject({
      serviceTier: 'batch',
      speed: 'fast',
    })
  })

  it('accepts zero, the largest safe integer, and ignores unknown additions', () => {
    expect(
      parseUsage({ input_tokens: 0, output_tokens: 0, brand_new_field: { deep: true } }),
    ).not.toBeNull()
    expect(parseUsage({ input_tokens: Number.MAX_SAFE_INTEGER })?.inputTokens).toBe(
      Number.MAX_SAFE_INTEGER,
    )
  })

  it.each([
    ['negative', { input_tokens: -1 }],
    ['negative in the split', { cache_creation: { ephemeral_5m_input_tokens: -5 } }],
    ['NaN', { output_tokens: Number.NaN }],
    ['Infinity', { cache_read_input_tokens: Number.POSITIVE_INFINITY }],
    ['-Infinity', { cache_creation_input_tokens: Number.NEGATIVE_INFINITY }],
    ['numeric string', { input_tokens: '12' }],
    ['fractional', { input_tokens: 1.5 }],
    ['huge but finite (1e308)', { output_tokens: 1e308 }],
    ['beyond MAX_SAFE_INTEGER', { input_tokens: 2 ** 53 }],
    ['boolean', { output_tokens: true }],
    ['object', { input_tokens: {} }],
    ['array', { input_tokens: [1] }],
    ['split is an array', { cache_creation: [] }],
    ['split is a string', { cache_creation: '1h' }],
    ['not an object', 'usage'],
    ['array instead of object', []],
    ['null', null],
  ])('rejects %s token counts', (_label, usage) => {
    expect(parseUsage(usage)).toBeNull()
  })

  it('skips and counts rows with invalid usage, without touching valid ones', () => {
    const rows = [
      userRow('u0', null, at(0)),
      assistantRow({
        uuid: 'a0',
        parentUuid: 'u0',
        ts: at(1),
        id: 'bad',
        usage: { ...OK_USAGE, input_tokens: -2 },
      }),
      '{"type":"assistant","uuid":"a1","timestamp":"2026-08-30T12:00:02.000Z","message":{"id":"inf","model":"m","usage":{"input_tokens":1e999}}}',
      assistantRow({ uuid: 'a2', parentUuid: 'u0', ts: at(3), id: 'good' }),
    ]
    const parsed = parse(rows)
    expect(parsed.stats.invalidUsageRowsSkipped).toBe(2)
    expect(ids(parsed)).toEqual(['good'])
    expect(parsed.warnings).toContainEqual({ kind: 'invalid-usage-rows', count: 2 })
    expect(parsed.verdict).toBe('valid-with-warnings')
  })
})

describe('session metadata (PLAN §3 identification card)', () => {
  it('collects content-free metadata with first-seen ordering and last title', () => {
    const rows = [
      { type: 'ai-title', aiTitle: 'First title', sessionId: SESSION_ID },
      ...turn(0, { model: 'claude-opus-5', extra: { effort: 'medium' } }),
      ...turn(1, { model: 'claude-fable-5' }),
      ...turn(2, { model: 'claude-opus-5', extra: { version: '2.1.247', gitBranch: 'other' } }),
      { type: 'ai-title', aiTitle: 'Final title', sessionId: SESSION_ID },
    ]
    const parsed = parse(rows, { fileName: 'my-session.jsonl', fileSizeBytes: 99 })
    expect(parsed.metadata).toEqual({
      sessionId: SESSION_ID,
      title: 'Final title',
      cwd: '/home/user/project',
      gitBranch: 'main',
      models: ['claude-opus-5', 'claude-fable-5'],
      versions: [OK_VERSION, '2.1.247'],
      efforts: ['medium', 'high'],
      firstTimestamp: at(0),
      lastTimestamp: at(2 * 60 + 3),
      fileName: 'my-session.jsonl',
      fileSizeBytes: 99,
    })
  })

  it('leaves optional metadata undefined when absent or wrongly typed', () => {
    const parsed = parse([
      assistantRow({
        uuid: 'a0',
        parentUuid: null,
        ts: at(1),
        id: 'm0',
        effort: [],
        extra: { cwd: 123, gitBranch: {}, sessionId: null },
      }),
      { type: 'ai-title', aiTitle: 42, sessionId: SESSION_ID },
    ])
    expect(parsed.metadata).toMatchObject({
      sessionId: SESSION_ID, // from the ai-title row, the first valid string
      title: undefined,
      cwd: undefined,
      gitBranch: undefined,
      efforts: [],
    })
    expect(parsed.requests[0].effort).toBeUndefined()
  })

  it('emits unknown-models only when a knownModels set is supplied', () => {
    const rows = [
      ...turn(0, { model: 'claude-fable-5' }),
      ...turn(1, { model: 'claude-mystery-9' }),
    ]
    expect(parse(rows).warnings).toEqual([])
    expect(parse(rows, { knownModels: new Set(['claude-fable-5']) }).warnings).toEqual([
      { kind: 'unknown-models', models: ['claude-mystery-9'] },
    ])
  })
})

/* ---------------------------------------------------------------------------
 * Validation verdicts (PLAN §2).
 * ------------------------------------------------------------------------- */

describe('validation verdicts', () => {
  it('valid: a clean session produces no warnings', () => {
    const parsed = parse([...turn(0), ...turn(1)])
    expect(parsed.verdict).toBe('valid')
    expect(parsed.warnings).toEqual([])
  })

  it('valid-with-warnings: any warning downgrades the verdict', () => {
    expect(parse([...turn(0), { type: 'mode', mode: 'default' }]).verdict).toBe(
      'valid-with-warnings',
    )
  })

  it('not-a-session-log: no assistant rows carrying usage', () => {
    const parsed = parse([userRow('u0', null, at(0)), { type: 'mode' }, { type: 'user' }])
    expect(parsed.verdict).toBe('not-a-session-log')
    expect(rejectionReason(parsed)).toBe('no-assistant-usage-rows')
  })

  it('not-a-session-log: an empty file', () => {
    const parsed = parse(['', '   ', '\t'])
    expect(parsed.stats).toMatchObject({ totalLines: 3, nonEmptyLines: 0, malformedLines: 0 })
    expect(parsed.verdict).toBe('not-a-session-log')
    expect(rejectionReason(parsed)).toBe('no-assistant-usage-rows')
  })

  it('not-a-session-log: malformed lines strictly exceeding the ratio', () => {
    // 18 good lines + k malformed, with k chosen so k / (18 + k) is exactly
    // the ratio (k = 2 at 10%): "exceeds" means strictly greater.
    const good = [...turn(0), ...turn(1)] // 6 lines
    const filler = Array.from({ length: 12 }, (_, i) => ({ type: 'mode', i }))
    const base = [...good, ...filler]
    const k = Math.round(
      (MALFORMED_LINE_REJECT_RATIO * base.length) / (1 - MALFORMED_LINE_REJECT_RATIO),
    )
    expect(k / (base.length + k)).toBe(MALFORMED_LINE_REJECT_RATIO)

    const exactly = parse([...base, ...Array<string>(k).fill('{not json')])
    expect(exactly.verdict).toBe('valid-with-warnings')
    expect(exactly.warnings).toContainEqual({ kind: 'malformed-lines', count: k })

    const over = parse([...base, ...Array<string>(k + 1).fill('{not json')])
    expect(over.verdict).toBe('not-a-session-log')
    expect(rejectionReason(over)).toBe('malformed-lines-exceed-threshold')
    expect(over.requests).toHaveLength(2) // still reported alongside the rejection
  })
})

/* ---------------------------------------------------------------------------
 * Adversarial input (PLAN §2 "Input validation and secure file handling").
 * ------------------------------------------------------------------------- */

describe('malformed lines', () => {
  it('counts unparseable JSON, non-object JSON, and records without a string type', () => {
    const parsed = parse([
      ...turn(0),
      '{"type": "user", ',
      'not json at all',
      '[1,2,3]',
      '"a string"',
      '42',
      'null',
      'true',
      '{"noType": true}',
      '{"type": 7}',
      '{"type": null}',
      '{"type": ["assistant"]}',
    ])
    expect(parsed.stats.malformedLines).toBe(11)
    expect(parsed.stats.nonEmptyLines).toBe(14)
    expect(parsed.requests).toHaveLength(1)
  })

  it('counts assistant rows missing the structure a request needs', () => {
    const base = { ...common, type: 'assistant', uuid: 'x', parentUuid: null, timestamp: at(1) }
    const parsed = parse([
      ...turn(0),
      { ...base, message: null },
      { ...base, message: 'text' },
      { ...base, message: { model: 'm', usage: OK_USAGE } }, // no id
      { ...base, message: { id: 'm1', usage: OK_USAGE } }, // no model
      { ...base, message: { id: 'm2', model: 7, usage: OK_USAGE } }, // model not a string
      { ...base, message: { id: 'm3', model: 'm' } }, // no usage
      { ...base, message: { id: 'm4', model: 'm', usage: null } },
      { ...base, message: { id: 'm5', model: 'm', usage: OK_USAGE }, timestamp: undefined },
      { ...base, message: { id: 'm6', model: 'm', usage: OK_USAGE }, timestamp: 'yesterday' },
      { ...base, message: { id: 'm7', model: 'm', usage: OK_USAGE }, timestamp: 1_700_000_000_000 },
      {
        ...base,
        message: { id: 'm8', model: 'm', usage: OK_USAGE },
        timestamp: `${at(1)}${' '.repeat(100)}`,
      },
      { ...base, message: { id: 'm9', model: 'm', usage: OK_USAGE }, timestamp: `${at(1)}\u0000` },
    ])
    expect(parsed.stats.assistantRows).toBe(13)
    expect(parsed.stats.malformedLines).toBe(12)
    expect(parsed.stats.invalidUsageRowsSkipped).toBe(0)
    expect(ids(parsed)).toEqual(['msg_0'])
  })
})

describe('prototype pollution', () => {
  it('neither pollutes Object.prototype nor leaks hostile keys into output', () => {
    const hostile = {
      __proto__: { polluted: 'yes' },
      constructor: { prototype: { polluted: 'yes' } },
    }
    const rows: string[] = [
      JSON.stringify({ ...userRow('u0', null, at(0)), ...hostile }),
      JSON.stringify({
        ...assistantRow({
          uuid: 'a0',
          parentUuid: 'u0',
          ts: at(1),
          id: 'm0',
          usage: {
            ...OK_USAGE,
            ...hostile,
            cache_creation: { ...hostile, ephemeral_1h_input_tokens: 1 },
          },
          message: hostile,
          extra: hostile,
        }),
      }),
      '{"type":"__proto__","x":1}',
      '{"type":"constructor","x":1}',
      '{"type":"hasOwnProperty","x":1}',
      '{"__proto__":{"polluted":"yes"},"type":"mode"}',
    ]
    // JSON.stringify of an object literal with __proto__ drops it; assert
    // the raw text really carries the keys we think it does.
    const withProto = rows[1].replace(
      '{"isSidechain"',
      '{"__proto__":{"polluted":"yes"},"isSidechain"',
    )
    rows[1] = withProto
    expect(withProto).toContain('"__proto__"')

    const parsed = parse(rows)
    expect(({} as { polluted?: string }).polluted).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('polluted')
    expect(parsed.requests).toHaveLength(1)
    // (An object literal cannot express an own `__proto__` key, so compare entries.)
    expect(Object.entries(parsed.stats.skippedRecordTypes)).toEqual([
      ['__proto__', 1],
      ['constructor', 1],
      ['hasOwnProperty', 1],
      ['mode', 1],
    ])
    expect(Object.hasOwn(parsed.stats.skippedRecordTypes, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(parsed.stats.skippedRecordTypes)).toBe(Object.prototype)
    expect(JSON.stringify(parsed)).not.toContain('polluted')
  })
})

describe('hostile metadata strings', () => {
  it('strips control characters (ANSI, NUL, newlines) and clamps length', () => {
    const ansi = '\u001b[31mred\u001b[0m'
    expect(sanitizeMetadataString(ansi)).toBe('[31mred[0m')
    expect(sanitizeMetadataString('a\u0000b\r\nc\u007fd\u0085e')).toBe('abcde')
    expect(sanitizeMetadataString('x'.repeat(10_000))).toHaveLength(MAX_METADATA_STRING_LENGTH)
    expect(sanitizeMetadataString('日本語 🚀 ok')).toBe('日本語 🚀 ok')
  })

  it('does not split a surrogate pair at the clamp boundary', () => {
    const value = 'a'.repeat(MAX_METADATA_STRING_LENGTH - 1) + '🚀'
    const out = sanitizeMetadataString(value)
    expect(out).toHaveLength(MAX_METADATA_STRING_LENGTH - 1)
    expect(out.endsWith('a')).toBe(true)
  })

  it('applies sanitization to every log-derived string that reaches output', () => {
    const evil = '\u001b]0;pwned\u0007<script>alert(1)</script>' + 'X'.repeat(2000)
    const rows = [
      { type: 'ai-title', aiTitle: `\u0000${evil}`, sessionId: `${evil}` },
      ...turn(0, {
        model: `claude\u001b-x`,
        extra: {
          cwd: evil,
          gitBranch: evil,
          effort: `hi\ngh`,
          version: `2.1.251\u0000`,
          agentId: `agent\u001b1`,
        },
      }),
    ]
    const parsed = parse(rows)
    const text = JSON.stringify(parsed)
    // oxlint-disable-next-line no-control-regex -- asserting their absence
    expect(text).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
    for (const value of [
      parsed.metadata.title,
      parsed.metadata.cwd,
      parsed.metadata.gitBranch,
      parsed.metadata.sessionId,
    ]) {
      expect(value).toHaveLength(MAX_METADATA_STRING_LENGTH)
      expect(value?.startsWith(']0;pwned<script>')).toBe(true)
    }
    expect(parsed.requests[0]).toMatchObject({
      model: 'claude-x',
      effort: 'high',
      version: '2.1.251',
      threadId: 'agent1',
    })
    expect(parsed.metadata.versions).toEqual(['2.1.251'])
    expect(parsed.warnings).toEqual([])
  })

  it('treats a string that is only control characters as absent', () => {
    const parsed = parse([...turn(0, { extra: { gitBranch: '\u0000\u001b' } })])
    expect(parsed.metadata.gitBranch).toBeUndefined()
  })
})

describe('content poison: message content never influences or leaks into output', () => {
  const POISON = 'POISON-7f3a9c'
  const poisonBlocks = [
    { type: 'text', text: POISON },
    { type: 'tool_use', id: `toolu_${POISON}`, name: POISON, input: { command: POISON } },
    { type: 'thinking', thinking: POISON, signature: POISON },
  ]

  it('through the whole surface, including fields we do not read', () => {
    const rows: Json[] = [
      { type: 'ai-title', aiTitle: 'clean title', sessionId: SESSION_ID, extra: POISON },
      { type: 'last-prompt', lastPrompt: POISON, sessionId: SESSION_ID },
      { type: 'queue-operation', operation: 'enqueue', content: POISON, sessionId: SESSION_ID },
      { type: 'file-history-snapshot', messageId: POISON, snapshot: { files: [POISON] } },
      userRow('u0', null, at(0), {
        message: { role: 'user', content: POISON },
        toolUseResult: { stdout: POISON },
        promptId: POISON,
        requestId: POISON,
      }),
      attachmentRow('at0', 'u0', at(1), {
        attachment: { type: 'file', content: POISON, path: POISON },
      }),
      assistantRow({
        uuid: 'a0',
        parentUuid: 'at0',
        ts: at(3),
        id: 'msg_clean',
        message: {
          content: poisonBlocks,
          stop_sequence: POISON,
          diagnostics: POISON,
          usage: {
            ...OK_USAGE,
            iterations: [{ type: POISON }],
            inference_geo: POISON,
            server_tool_use: { note: POISON },
          },
        },
        extra: {
          requestId: POISON,
          attributionSkill: POISON,
          session_id: POISON,
          userType: POISON,
          entrypoint: POISON,
        },
      }),
      assistantRow({
        uuid: 'a1',
        parentUuid: 'at0',
        ts: at(4),
        id: 'msg_clean',
        message: { content: POISON }, // content as a plain string
      }),
      {
        ...userRow('u1', 'a1', at(10), {
          message: { role: 'user', content: [{ type: 'tool_result', content: POISON }] },
        }),
      },
      assistantRow({
        uuid: 'a2',
        parentUuid: 'u1',
        ts: at(12),
        id: 'msg_clean_2',
        message: { content: poisonBlocks },
      }),
    ]
    const parsed = parse(rows)
    expect(parsed.requests).toHaveLength(2)
    expect(parsed.verdict).toBe('valid-with-warnings')
    expect(JSON.stringify(parsed)).not.toContain(POISON)
    // And the analysis is identical with the content swapped out entirely.
    const scrubbed = JSON.parse(JSON.stringify(rows).replaceAll(POISON, 'other')) as Json[]
    expect(parse(scrubbed)).toEqual(parsed)
  })

  it('reads only the allow-listed fields (audited through a recording Proxy)', () => {
    const ALLOWED = new Set([
      'type',
      'uuid',
      'parentUuid',
      'timestamp',
      'isSidechain',
      'agentId',
      'sessionId',
      'cwd',
      'gitBranch',
      'effort',
      'version',
      'aiTitle',
      'message',
      'message.id',
      'message.model',
      'message.usage',
      'message.usage.input_tokens',
      'message.usage.cache_read_input_tokens',
      'message.usage.cache_creation_input_tokens',
      'message.usage.output_tokens',
      'message.usage.cache_creation',
      'message.usage.cache_creation.ephemeral_5m_input_tokens',
      'message.usage.cache_creation.ephemeral_1h_input_tokens',
      'message.usage.service_tier',
      'message.usage.speed',
    ])
    const accessed = new Set<string>()
    const record = (value: unknown, path: string): unknown => {
      if (typeof value !== 'object' || value === null) return value
      return new Proxy(value as object, {
        get(target, key, receiver) {
          if (typeof key === 'string') {
            const full = path ? `${path}.${key}` : key
            accessed.add(full)
            return record(Reflect.get(target, key, receiver), full)
          }
          return Reflect.get(target, key, receiver)
        },
      })
    }
    const parser = new SessionParser({ fileName: 'f', fileSizeBytes: 1 })
    const rows = [
      { type: 'ai-title', aiTitle: 't', sessionId: SESSION_ID },
      userRow('u0', null, at(0), { toolUseResult: { stdout: 'x' } }),
      attachmentRow('at0', 'u0', at(1)),
      assistantRow({
        uuid: 'a0',
        parentUuid: 'at0',
        ts: at(3),
        id: 'm0',
        message: { content: poisonBlocks },
      }),
      assistantRow({
        uuid: 'a1',
        parentUuid: 'a0',
        ts: at(4),
        id: 'm0',
        extra: { agentId: 'x', isSidechain: true },
      }),
      { type: 'frame-link', frameUrl: 'u', title: 't' },
    ]
    for (const row of rows) parser.ingest(record(row, ''))
    parser.finish()
    const disallowed = [...accessed].filter((k) => !ALLOWED.has(k))
    expect(disallowed).toEqual([])
    expect(accessed.has('message.content')).toBe(false)
    expect(accessed.has('attachment')).toBe(false)
    expect(accessed.has('toolUseResult')).toBe(false)
  })
})

/* ---------------------------------------------------------------------------
 * The streaming entry point.
 * ------------------------------------------------------------------------- */

function streamOf(text: string, chunkBytes = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close()
        return
      }
      controller.enqueue(bytes.subarray(offset, offset + chunkBytes))
      offset += chunkBytes
    },
  })
}

describe('parseSession (stream)', () => {
  const text =
    [...turn(0, { blocks: 2 }), ...turn(1), '', '{oops']
      .map((r) => (typeof r === 'string' ? r : JSON.stringify(r)))
      .join('\n') + '\n'

  it('parses across arbitrary chunk boundaries and reports final progress', async () => {
    const progress: number[] = []
    const parsed = await parseSession(streamOf(text, 5), {
      fileName: 's.jsonl',
      fileSizeBytes: text.length,
      onProgress: (p) => progress.push(p.bytesProcessed),
    })
    expect(parsed.stats).toMatchObject({
      totalLines: 9,
      nonEmptyLines: 8,
      malformedLines: 1,
      assistantRows: 3,
      dedupedRequests: 2,
    })
    expect(parsed.metadata.fileName).toBe('s.jsonl')
    expect(progress.at(-1)).toBe(text.length)
  })

  it('counts a capped line as malformed and reports the cap warning', async () => {
    const giant = JSON.stringify({ type: 'user', pad: 'x'.repeat(3000) })
    const turns = [0, 1, 2, 3].flatMap((n) => turn(n)) // 12 lines, so 1 capped line stays under the ratio
    const body = turns.map((r) => JSON.stringify(r)).join('\n') + '\n' + giant + '\n'
    const parsed = await parseSession(streamOf(body, 64), {
      fileName: 's.jsonl',
      fileSizeBytes: body.length,
      splitter: new JsonlLineSplitter(2000),
    })
    expect(parsed.stats).toMatchObject({
      totalLines: 13,
      nonEmptyLines: 13,
      malformedLines: 1,
      dedupedRequests: 4,
    })
    expect(parsed.warnings).toEqual([
      { kind: 'malformed-lines', count: 1 },
      { kind: 'line-length-cap-exceeded', count: 1 },
    ])
    expect(parsed.verdict).toBe('valid-with-warnings')

    // A file that is mostly over-cap lines is not a session log.
    const mostlyGiant =
      turns
        .slice(0, 3)
        .map((r) => JSON.stringify(r))
        .join('\n') +
      '\n' +
      giant +
      '\n'
    const rejected = await parseSession(streamOf(mostlyGiant, 64), {
      fileName: 's.jsonl',
      fileSizeBytes: mostlyGiant.length,
      splitter: new JsonlLineSplitter(2000),
    })
    expect(rejected.verdict).toBe('not-a-session-log')
    expect(rejectionReason(rejected)).toBe('malformed-lines-exceed-threshold')
  })

  it('rejects with AbortError when cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      parseSession(streamOf(text), { fileName: 's', fileSizeBytes: 1, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('the default cap is the contract constant', () => {
    const splitter = new JsonlLineSplitter()
    expect(splitter.push(new Uint8Array(MAX_LINE_LENGTH_BYTES).fill(0x61))).toEqual([])
    expect(splitter.push(new Uint8Array([0x61]))).toEqual([])
    expect(splitter.finish()).toEqual([{ kind: 'capped', bytes: MAX_LINE_LENGTH_BYTES + 1 }])
  })
})

/* ---------------------------------------------------------------------------
 * Real corpus regression: the session the contract's F1–F7 came from.
 * ------------------------------------------------------------------------- */

describe('real corpus: transcripts/004-build-plan/session.jsonl (v2.1.251)', () => {
  const path = 'transcripts/004-build-plan/session.jsonl'

  it('reproduces the WP-02 inspection numbers', async () => {
    const size = readFileSync(path).byteLength
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>
    const parsed = await parseSession(stream, { fileName: 'session.jsonl', fileSizeBytes: size })

    expect(parsed.stats).toEqual({
      totalLines: 715,
      nonEmptyLines: 715,
      malformedLines: 0,
      skippedRecordTypes: {
        'permission-mode': 28,
        mode: 28,
        'bridge-session': 28,
        'atis-latch': 28,
        'last-prompt': 27,
        system: 25,
        'frame-link': 25,
        'queue-operation': 14,
        'file-history-snapshot': 12,
        'pr-link': 8,
        'file-history-delta': 5,
        'artifact-comment-monitor': 5,
        'artifact-autoreact-ledger': 1,
      },
      assistantRows: 201,
      dedupedRequests: 79,
      syntheticRowsExcluded: 0,
      invalidUsageRowsSkipped: 0,
    })
    expect(parsed.verdict).toBe('valid-with-warnings')
    expect(parsed.warnings.map((w) => w.kind)).toEqual(['skipped-record-types'])

    expect(parsed.metadata).toMatchObject({
      sessionId: SESSION_ID,
      cwd: '~/Code/cache-ttl-analyzer',
      models: ['claude-fable-5'],
      versions: ['2.1.251'],
      efforts: ['high'],
      fileSizeBytes: size,
    })
    expect(parsed.metadata.title).toBeTypeOf('string')

    // F3: every request start comes from a user ancestor and precedes completion.
    const requests: RequestRecord[] = parsed.requests
    expect(requests.every((r) => r.requestStartSource === 'user-ancestor')).toBe(true)
    expect(
      requests.every((r) => Date.parse(r.requestStartTimestamp) <= Date.parse(r.timestamp)),
    ).toBe(true)
    // F2: a modern main-session upload has no subagent traffic.
    expect(requests.every((r) => r.threadId === MAIN_THREAD_ID && !r.isSidechain)).toBe(true)
    // The 8-row message from the inspection dedups to one record.
    expect(requests.filter((r) => r.messageId === 'msg_011CeZXNmiRG5oAtT3LM9biV')).toHaveLength(1)
    // Every request wrote at 1h, none at 5m (the corpus ran on a subscription).
    expect(requests.every((r) => r.usage.cacheCreation5mTokens === 0)).toBe(true)
    expect(requests.some((r) => r.usage.cacheCreation1hTokens > 0)).toBe(true)
    expect(
      requests.every((r) => r.usage.serviceTier === 'standard' && r.usage.speed === 'standard'),
    ).toBe(true)
  })
})
