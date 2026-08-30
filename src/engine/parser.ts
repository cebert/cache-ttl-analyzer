/**
 * WP-03 — streaming JSONL session parser producing `ParsedSession`.
 *
 * Implements the docs/PLAN.md §2 correctness rules that belong to parsing
 * (dedup on `message.id`, `<synthetic>` exclusion, skip-and-count, version
 * warnings, request-start pairing, thread keys) and the validation /
 * security rules (three verdicts, numeric hygiene, typed-record copying,
 * line-length cap). It reads a dozen metadata fields and NEVER
 * `message.content` — `parser.test.ts` proves that with a content-poison
 * session and a field-access audit.
 *
 * Two layers:
 *  - `SessionParser` is line-fed (`feedLine` / `feedCappedLine` / `finish`)
 *    and synchronous, so unit tests drive it directly.
 *  - `parseSession` wraps it around a `ReadableStream` via
 *    `jsonl-stream.ts`, adding progress and cancellation for the worker.
 *
 * Nothing here spreads or retains a parsed object: every field is copied
 * out through a typed accessor and the object is dropped, which also
 * neutralizes prototype-pollution keys (`__proto__`, `constructor`).
 */

import {
  MALFORMED_LINE_REJECT_RATIO,
  MAX_METADATA_STRING_LENGTH,
  VALIDATED_VERSION_RANGE,
  type EngineProgress,
  type ParsedSession,
  type ParseStats,
  type ParseWarning,
  type RequestRecord,
  type RequestUsage,
  type SessionMetadata,
  type ValidationVerdict,
} from './contract'
import { readJsonlLines, type JsonlLineSplitter, type LineEvent } from './jsonl-stream'

/** `RequestRecord.threadId` for the main conversation (contract). */
export const MAIN_THREAD_ID = 'main'
/** Prefix for threads recovered from legacy interleaved sidechains (contract). */
export const LEGACY_SIDECHAIN_THREAD_PREFIX = 'sidechain-'
/** The model id Claude Code writes on API-error placeholder rows (§6.2). */
export const SYNTHETIC_MODEL_ID = '<synthetic>'
/** Default for absent/null `service_tier` and `speed` (F5). */
export const DEFAULT_SERVICE_TIER = 'standard'
export const DEFAULT_SPEED = 'standard'
/**
 * A hostile file can invent unlimited record types; past this many distinct
 * ones the rest aggregate under `OTHER_SKIPPED_TYPES_KEY`.
 */
export const MAX_DISTINCT_SKIPPED_TYPES = 100
export const OTHER_SKIPPED_TYPES_KEY = '<other>'
/** ISO-8601 with milliseconds is 24 chars; anything longer is not a timestamp. */
export const MAX_TIMESTAMP_LENGTH = 64
/** Progress is reported at most once per this many bytes. */
export const PROGRESS_INTERVAL_BYTES = 1024 * 1024

/** Why `verdict` is `not-a-session-log` — the `EngineOutcome` reason code. */
export type RejectionReason = 'malformed-lines-exceed-threshold' | 'no-assistant-usage-rows'

export interface ParseSessionOptions {
  fileName: string
  fileSizeBytes: number
  /**
   * Priced model ids (from the pricing config). When supplied, models
   * outside the set produce an `unknown-models` warning; when absent the
   * parser stays pricing-blind and never emits that warning.
   */
  knownModels?: ReadonlySet<string>
  onProgress?: (progress: EngineProgress) => void
  signal?: AbortSignal
  /** Injectable so tests can observe buffering through the real path. */
  splitter?: JsonlLineSplitter
}

/* ---------------------------------------------------------------------------
 * Typed field accessors — the only way values leave a parsed object.
 * ------------------------------------------------------------------------- */

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// C0 controls, DEL, and C1 controls: covers NUL, ANSI escapes, line breaks.
// oxlint-disable-next-line no-control-regex -- matching them is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g
// oxlint-disable-next-line no-control-regex
const HAS_CONTROL_CHAR = /[\u0000-\u001f\u007f-\u009f]/

/**
 * Log-derived strings are untrusted (PLAN §2): strip control characters and
 * clamp to `MAX_METADATA_STRING_LENGTH` without splitting a surrogate pair.
 */
export function sanitizeMetadataString(value: string): string {
  let text = value.replace(CONTROL_CHARS, '')
  if (text.length > MAX_METADATA_STRING_LENGTH) {
    text = text.slice(0, MAX_METADATA_STRING_LENGTH)
    const last = text.charCodeAt(text.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1)
  }
  return text
}

/** A sanitized, non-empty string field, or undefined. */
function readString(obj: JsonObject, key: string): string | undefined {
  const value = obj[key]
  if (typeof value !== 'string') return undefined
  const text = sanitizeMetadataString(value)
  return text.length > 0 ? text : undefined
}

/** A parseable timestamp string, returned verbatim, or undefined. */
function readTimestamp(obj: JsonObject): string | undefined {
  const value = obj['timestamp']
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TIMESTAMP_LENGTH) {
    return undefined
  }
  if (HAS_CONTROL_CHAR.test(value)) return undefined
  return Number.isFinite(Date.parse(value)) ? value : undefined
}

/**
 * A token count: absent/null means 0 (F5); otherwise it must be a finite,
 * non-negative number. Returns undefined when invalid.
 */
function readTokenCount(obj: JsonObject, key: string): number | undefined {
  const value = obj[key]
  if (value === undefined || value === null) return 0
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return value
}

function readStringWithDefault(obj: JsonObject, key: string, fallback: string): string {
  return readString(obj, key) ?? fallback
}

/**
 * Copy `message.usage` into a `RequestUsage`, or return null when any
 * token count is non-numeric, non-finite, or negative (numeric hygiene).
 */
export function parseUsage(value: unknown): RequestUsage | null {
  if (!isObject(value)) return null
  const inputTokens = readTokenCount(value, 'input_tokens')
  const cacheReadInputTokens = readTokenCount(value, 'cache_read_input_tokens')
  const cacheCreationInputTokens = readTokenCount(value, 'cache_creation_input_tokens')
  const outputTokens = readTokenCount(value, 'output_tokens')

  const split = value['cache_creation']
  let cacheCreation5mTokens: number | undefined = 0
  let cacheCreation1hTokens: number | undefined = 0
  if (split !== undefined && split !== null) {
    if (!isObject(split)) return null
    cacheCreation5mTokens = readTokenCount(split, 'ephemeral_5m_input_tokens')
    cacheCreation1hTokens = readTokenCount(split, 'ephemeral_1h_input_tokens')
  }

  if (
    inputTokens === undefined ||
    cacheReadInputTokens === undefined ||
    cacheCreationInputTokens === undefined ||
    outputTokens === undefined ||
    cacheCreation5mTokens === undefined ||
    cacheCreation1hTokens === undefined
  ) {
    return null
  }

  return {
    inputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    cacheCreation5mTokens,
    cacheCreation1hTokens,
    outputTokens,
    serviceTier: readStringWithDefault(value, 'service_tier', DEFAULT_SERVICE_TIER),
    speed: readStringWithDefault(value, 'speed', DEFAULT_SPEED),
  }
}

/* ---------------------------------------------------------------------------
 * Version range check (warn, never fail — feasibility §4).
 * ------------------------------------------------------------------------- */

function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/.exec(version)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareVersions(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  }
  return 0
}

/** Inclusive x.y.z comparison against `VALIDATED_VERSION_RANGE`; unparseable = out of range. */
export function isVersionInValidatedRange(version: string): boolean {
  const parsed = parseVersion(version)
  if (!parsed) return false
  const min = parseVersion(VALIDATED_VERSION_RANGE.min)
  const max = parseVersion(VALIDATED_VERSION_RANGE.max)
  if (!min || !max) return false
  return compareVersions(parsed, min) >= 0 && compareVersions(parsed, max) <= 0
}

/* ---------------------------------------------------------------------------
 * Verdict helpers.
 * ------------------------------------------------------------------------- */

export function isMalformedRatioExceeded(stats: ParseStats): boolean {
  if (stats.nonEmptyLines === 0) return false
  return stats.malformedLines / stats.nonEmptyLines > MALFORMED_LINE_REJECT_RATIO
}

/**
 * Reason code for a `not-a-session-log` verdict, derived from `stats` (the
 * contract's `ParsedSession` carries no reason field; `EngineOutcome` does).
 */
export function rejectionReason(parsed: ParsedSession): RejectionReason {
  return isMalformedRatioExceeded(parsed.stats)
    ? 'malformed-lines-exceed-threshold'
    : 'no-assistant-usage-rows'
}

/* ---------------------------------------------------------------------------
 * The parser.
 * ------------------------------------------------------------------------- */

/** Metadata-only index entry for `user`, `attachment`, and `assistant` rows. */
interface ChainEntry {
  parent: string | null
  timestamp: string | undefined
  isUser: boolean
  isSidechain: boolean
}

interface TimestampBound {
  iso: string
  ms: number
}

export type SessionParserOptions = Pick<
  ParseSessionOptions,
  'fileName' | 'fileSizeBytes' | 'knownModels'
>

export class SessionParser {
  private readonly stats: ParseStats = {
    totalLines: 0,
    nonEmptyLines: 0,
    malformedLines: 0,
    skippedRecordTypes: {},
    assistantRows: 0,
    dedupedRequests: 0,
    syntheticRowsExcluded: 0,
    invalidUsageRowsSkipped: 0,
  }
  private cappedLines = 0
  private readonly skipped = new Map<string, number>()
  private readonly requests: RequestRecord[] = []
  private readonly requestIndexById = new Map<string, number>()
  /** uuid -> chain metadata for the `parentUuid` walks (F3, legacy F2). */
  private readonly chain = new Map<string, ChainEntry>()
  /** Legacy sidechain recovery: uuid -> recovered thread id (memoized). */
  private readonly legacyThreadByUuid = new Map<string, string>()
  private legacyThreadCount = 0
  private readonly models: string[] = []
  private readonly versions: string[] = []
  private readonly efforts: string[] = []
  private sessionId: string | undefined
  private title: string | undefined
  private cwd: string | undefined
  private gitBranch: string | undefined
  private first: TimestampBound | undefined
  private last: TimestampBound | undefined

  private readonly options: SessionParserOptions

  constructor(options: SessionParserOptions) {
    this.options = options
  }

  /** Deduped requests accepted so far (for progress reporting). */
  get requestCount(): number {
    return this.requests.length
  }

  /** Feed one complete line of text. */
  feedLine(text: string): void {
    this.stats.totalLines++
    if (text.trim().length === 0) return
    this.stats.nonEmptyLines++
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      this.stats.malformedLines++
      return
    }
    this.ingest(value)
  }

  /** Account for a line the splitter dropped for exceeding the length cap. */
  feedCappedLine(): void {
    this.stats.totalLines++
    this.stats.nonEmptyLines++
    this.stats.malformedLines++
    this.cappedLines++
  }

  /**
   * Ingest one parsed JSON value. Public so tests can audit exactly which
   * fields are touched (via a Proxy) — production code goes through
   * `feedLine`.
   */
  ingest(value: unknown): void {
    if (!isObject(value)) {
      this.stats.malformedLines++
      return
    }
    const type = value['type']
    if (typeof type !== 'string') {
      this.stats.malformedLines++
      return
    }
    switch (type) {
      case 'assistant':
        this.ingestAssistant(value)
        break
      case 'user':
        this.indexChainRow(value, true)
        this.noteSessionFields(value)
        break
      case 'attachment':
        this.indexChainRow(value, false)
        this.noteSessionFields(value)
        break
      case 'ai-title':
        // F1: rewritten repeatedly; the last one wins.
        this.title = readString(value, 'aiTitle') ?? this.title
        this.noteSessionFields(value)
        break
      default:
        this.countSkipped(type)
    }
  }

  finish(): ParsedSession {
    const stats: ParseStats = {
      ...this.stats,
      skippedRecordTypes: Object.fromEntries(this.skipped),
    }
    const warnings = this.buildWarnings(stats)
    const rejected = stats.dedupedRequests === 0 || isMalformedRatioExceeded(stats)
    const verdict: ValidationVerdict = rejected
      ? 'not-a-session-log'
      : warnings.length > 0
        ? 'valid-with-warnings'
        : 'valid'
    const metadata: SessionMetadata = {
      sessionId: this.sessionId,
      title: this.title,
      cwd: this.cwd,
      gitBranch: this.gitBranch,
      models: [...this.models],
      versions: [...this.versions],
      efforts: [...this.efforts],
      firstTimestamp: this.first?.iso,
      lastTimestamp: this.last?.iso,
      fileName: this.options.fileName,
      fileSizeBytes: this.options.fileSizeBytes,
    }
    return { metadata, requests: [...this.requests], stats, verdict, warnings }
  }

  private buildWarnings(stats: ParseStats): ParseWarning[] {
    const warnings: ParseWarning[] = []
    if (stats.malformedLines > 0) {
      warnings.push({ kind: 'malformed-lines', count: stats.malformedLines })
    }
    if (this.cappedLines > 0) {
      warnings.push({ kind: 'line-length-cap-exceeded', count: this.cappedLines })
    }
    if (this.skipped.size > 0) {
      warnings.push({ kind: 'skipped-record-types', types: stats.skippedRecordTypes })
    }
    const outOfRange = this.versions.filter((v) => !isVersionInValidatedRange(v))
    if (outOfRange.length > 0) {
      warnings.push({ kind: 'version-out-of-range', versions: outOfRange })
    }
    if (this.options.knownModels) {
      const known = this.options.knownModels
      const unknown = this.models.filter((m) => !known.has(m))
      if (unknown.length > 0) warnings.push({ kind: 'unknown-models', models: unknown })
    }
    if (stats.invalidUsageRowsSkipped > 0) {
      warnings.push({ kind: 'invalid-usage-rows', count: stats.invalidUsageRowsSkipped })
    }
    return warnings
  }

  private countSkipped(type: string): void {
    let key = sanitizeMetadataString(type)
    if (key.length === 0) key = OTHER_SKIPPED_TYPES_KEY
    if (!this.skipped.has(key) && this.skipped.size >= MAX_DISTINCT_SKIPPED_TYPES) {
      key = OTHER_SKIPPED_TYPES_KEY
    }
    this.skipped.set(key, (this.skipped.get(key) ?? 0) + 1)
  }

  /** First-seen `sessionId` / `cwd` / `gitBranch` from any recognized row. */
  private noteSessionFields(row: JsonObject): void {
    this.sessionId ??= readString(row, 'sessionId')
    this.cwd ??= readString(row, 'cwd')
    this.gitBranch ??= readString(row, 'gitBranch')
  }

  /** Record uuid/parentUuid/timestamp — metadata only — for the walks. */
  private indexChainRow(row: JsonObject, isUser: boolean): string | undefined {
    const uuid = readString(row, 'uuid')
    if (uuid === undefined) return undefined
    const parent = readString(row, 'parentUuid') ?? null
    // First writer wins: a duplicated uuid must not rewrite the chain.
    if (!this.chain.has(uuid)) {
      this.chain.set(uuid, {
        parent,
        timestamp: readTimestamp(row),
        isUser,
        isSidechain: row['isSidechain'] === true,
      })
    }
    return uuid
  }

  private ingestAssistant(row: JsonObject): void {
    this.stats.assistantRows++
    const uuid = this.indexChainRow(row, false)
    this.noteSessionFields(row)

    const message = row['message']
    if (!isObject(message)) {
      this.stats.malformedLines++
      return
    }
    const model = readString(message, 'model')
    if (model === SYNTHETIC_MODEL_ID) {
      this.stats.syntheticRowsExcluded++
      return
    }
    const messageId = readString(message, 'id')
    const timestamp = readTimestamp(row)
    const rawUsage = message['usage']
    if (
      model === undefined ||
      messageId === undefined ||
      timestamp === undefined ||
      !isObject(rawUsage)
    ) {
      this.stats.malformedLines++
      return
    }

    // Dedup on message.id only (F6/F7): one request spans many content-block
    // rows, each carrying the full usage. The first row defines the record;
    // later rows only extend the completion timestamp.
    const existing = this.requestIndexById.get(messageId)
    if (existing !== undefined) {
      const record = this.requests[existing]
      if (Date.parse(timestamp) > Date.parse(record.timestamp)) {
        record.timestamp = timestamp
        this.noteLast(timestamp)
      }
      return
    }

    const usage = parseUsage(rawUsage)
    if (usage === null) {
      this.stats.invalidUsageRowsSkipped++
      return
    }

    const agentId = readString(row, 'agentId')
    let threadId: string
    let isSidechain: boolean
    if (agentId !== undefined) {
      threadId = agentId
      isSidechain = true
    } else if (row['isSidechain'] === true) {
      threadId = this.legacyThreadFor(uuid)
      isSidechain = true
    } else {
      threadId = MAIN_THREAD_ID
      isSidechain = false
    }

    const start = this.resolveRequestStart(readString(row, 'parentUuid'))
    const record: RequestRecord = {
      messageId,
      model,
      timestamp,
      requestStartTimestamp: start?.timestamp ?? timestamp,
      requestStartSource: start ? 'user-ancestor' : 'assistant-row-fallback',
      threadId,
      isSidechain,
      usage,
    }
    const effort = readString(row, 'effort')
    if (effort !== undefined) record.effort = effort
    const version = readString(row, 'version')
    if (version !== undefined) record.version = version

    this.requestIndexById.set(messageId, this.requests.length)
    this.requests.push(record)
    this.stats.dedupedRequests++
    pushDistinct(this.models, model)
    if (version !== undefined) pushDistinct(this.versions, version)
    if (effort !== undefined) pushDistinct(this.efforts, effort)
    this.noteFirst(record.requestStartTimestamp)
    this.noteLast(timestamp)
  }

  /**
   * F3: nearest `user`-row ancestor's timestamp via the `parentUuid` walk
   * (the immediate parent is usually an `attachment`). Cycle-safe.
   */
  private resolveRequestStart(parentUuid: string | undefined): { timestamp: string } | null {
    const visited = new Set<string>()
    let current = parentUuid
    while (current !== undefined && !visited.has(current)) {
      visited.add(current)
      const entry = this.chain.get(current)
      if (!entry) break
      if (entry.isUser && entry.timestamp !== undefined) return { timestamp: entry.timestamp }
      current = entry.parent ?? undefined
    }
    return null
  }

  /**
   * F2 (legacy interleaved logs): a sidechain row without `agentId` belongs
   * to the thread rooted at its topmost sidechain ancestor. Results are
   * memoized per uuid so the walk is amortized O(1) per row.
   */
  private legacyThreadFor(uuid: string | undefined): string {
    if (uuid === undefined) return this.newLegacyThread()
    const path: string[] = []
    const visited = new Set<string>()
    let current = uuid
    let threadId: string | undefined
    for (;;) {
      const memo = this.legacyThreadByUuid.get(current)
      if (memo !== undefined) {
        threadId = memo
        break
      }
      visited.add(current)
      path.push(current)
      const entry = this.chain.get(current)
      const parent = entry?.parent ?? undefined
      if (parent === undefined || visited.has(parent)) break
      const parentEntry = this.chain.get(parent)
      if (!parentEntry || !parentEntry.isSidechain) break
      current = parent
    }
    threadId ??= this.newLegacyThread()
    for (const id of path) this.legacyThreadByUuid.set(id, threadId)
    return threadId
  }

  private newLegacyThread(): string {
    this.legacyThreadCount++
    return `${LEGACY_SIDECHAIN_THREAD_PREFIX}${this.legacyThreadCount}`
  }

  private noteFirst(iso: string): void {
    const ms = Date.parse(iso)
    if (this.first === undefined || ms < this.first.ms) this.first = { iso, ms }
  }

  private noteLast(iso: string): void {
    const ms = Date.parse(iso)
    if (this.last === undefined || ms > this.last.ms) this.last = { iso, ms }
  }
}

function pushDistinct(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value)
}

/**
 * Parse a session from a byte stream (the worker path). Reports progress at
 * most once per `PROGRESS_INTERVAL_BYTES` plus once at the end, and rejects
 * with an `AbortError` `DOMException` when `signal` aborts.
 */
export async function parseSession(
  stream: ReadableStream<Uint8Array>,
  options: ParseSessionOptions,
): Promise<ParsedSession> {
  const parser = new SessionParser(options)
  const { onProgress, signal, fileSizeBytes } = options
  let lastReported = 0
  let bytesSeen = 0
  const report = (bytes: number) => {
    onProgress?.({
      phase: 'parsing',
      bytesProcessed: bytes,
      totalBytes: fileSizeBytes,
      requestsSeen: parser.requestCount,
    })
    lastReported = bytes
  }
  const onLine = (event: LineEvent) => {
    if (event.kind === 'line') parser.feedLine(event.text)
    else parser.feedCappedLine()
  }
  await readJsonlLines(stream, onLine, {
    signal,
    splitter: options.splitter,
    onChunk: (bytes) => {
      bytesSeen = bytes
      if (bytes - lastReported >= PROGRESS_INTERVAL_BYTES) report(bytes)
    },
  })
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
  const parsed = parser.finish()
  report(bytesSeen)
  return parsed
}
