/**
 * WP-06 — golden-fixture cross-validation (docs/PLAN.md §5).
 *
 * Every fixture listed in `fixtures/fixtures.json` is parsed and analyzed by
 * the real engine and compared with the golden emitted by the independent
 * Python reference sim (`tools/refsim/refsim.py`). Neither side is the
 * oracle: a disagreement is settled by hand computation, never by copying
 * one side's number into the other.
 *
 * Also enforced here, per fixture:
 *  - the format-drift canary: the Claude Code versions a fixture carries
 *    must sit inside `VALIDATED_VERSION_RANGE`, except the one fixture the
 *    manifest marks `canaryExempt`, which must instead take the warn path;
 *  - the content-poison property: the CONTENT_POISON marker every fixture
 *    plants in conversation content never appears in any output;
 *  - the reconciliation property: the scenario at the observed TTL
 *    reproduces the actual cost;
 *  - manifest completeness: every committed `.jsonl` under `fixtures/` is
 *    listed (the generated 100MB fixture is git-ignored and excluded).
 */

import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { PRICING } from '../config/pricing'
import { VALIDATED_VERSION_RANGE, type AnalysisResult, type BucketAnalysis } from './contract'
import { knownModelIds } from './cost'
import { isVersionInValidatedRange, parseSession, rejectionReason } from './parser'
import { analyzeSession } from './simulator'
import { SAMPLES } from '../config/samples'
import { SAMPLES_DIR, sampleSource } from '../../scripts/sync-samples.ts'

const FIXTURES_ROOT = 'fixtures'
const MANIFEST_PATH = join(FIXTURES_ROOT, 'fixtures.json')
const GOLDEN_DIR = join(FIXTURES_ROOT, 'golden')
const GOLDEN_SCHEMA = 'cache-ttl-analyzer/golden/v1'
/** Planted by `scripts/build-synthetic-fixtures.ts` and `scripts/scrub-capture.py`. */
const CONTENT_POISON = 'POISON'
/**
 * Dollar figures are sums of per-token products; the two implementations
 * sum in different orders, so allow floating-point noise and nothing more.
 * (A single-token disagreement at the cheapest rate in the config —
 * Haiku 3.5 cache reads, $0.08/MTok — is 8e-8, three orders above this.)
 */
const USD_TOLERANCE = 1e-10

interface ManifestEntry {
  path: string
  canaryExempt?: boolean
  trap?: string
  expect?: string
}

interface Fixture extends ManifestEntry {
  id: string
  file: string
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

function loadFixtures(): Fixture[] {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as { fixtures: ManifestEntry[] }
  const fixtures: Fixture[] = []
  for (const entry of manifest.fixtures) {
    const target = join(FIXTURES_ROOT, entry.path)
    if (statSync(target).isDirectory()) {
      for (const file of walk(target)) {
        const rel = relative(FIXTURES_ROOT, file).replaceAll('\\', '/')
        fixtures.push({ ...entry, id: rel.slice(0, -'.jsonl'.length), file })
      }
    } else {
      fixtures.push({ ...entry, id: entry.path.slice(0, -'.jsonl'.length), file: target })
    }
  }
  return fixtures
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (name.endsWith('.jsonl')) out.push(path)
  }
  return out
}

function goldenPath(id: string): string {
  return join(GOLDEN_DIR, `${id.replaceAll('/', '__')}.json`)
}

async function runEngine(file: string) {
  const parsed = await parseSession(
    Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>,
    {
      fileName: 'session.jsonl',
      fileSizeBytes: statSync(file).size,
      knownModels: knownModelIds(PRICING),
    },
  )
  if (parsed.verdict === 'not-a-session-log') {
    return { parsed, result: undefined, reason: rejectionReason(parsed) }
  }
  return { parsed, result: analyzeSession(parsed, PRICING), reason: undefined }
}

/** The golden's view of an `AnalysisResult` (mirrors `refsim.py` `analyze_file`). */
function project(result: AnalysisResult): Json {
  const m = result.metadata
  const metadata: Record<string, Json> = {}
  for (const key of [
    'sessionId',
    'title',
    'cwd',
    'gitBranch',
    'models',
    'versions',
    'efforts',
    'firstTimestamp',
    'lastTimestamp',
  ] as const) {
    const value = m[key]
    if (value !== undefined) metadata[key] = value as Json
  }
  return {
    outcome: 'analysis',
    metadata,
    parseStats: result.parseStats as unknown as Json,
    parseWarnings: result.parseWarnings as unknown as Json,
    buckets: result.buckets.map(projectBucket),
    unknownModels: result.unknownModels as unknown as Json,
  }
}

function projectBucket(b: BucketAnalysis): Json {
  const out: Record<string, Json> = {
    bucket: b.bucket,
    threadCount: b.threadCount,
    requestCount: b.requestCount,
    actualCost: b.actualCost as unknown as Json,
    actualUsage: b.actualUsage as unknown as Json,
    warmReadRequestCount: b.warmReadRequestCount,
    observedWriteSplit: b.observedWriteSplit as unknown as Json,
    observedTtl: b.observedTtl,
    configExplicitness: b.configExplicitness,
    scenarios: b.scenarios as unknown as Json,
    recommendation: b.recommendation,
    savingsUsd: b.savingsUsd,
    verdictSuppressed: b.verdictSuppressed,
    unpricedTokenShare: b.unpricedTokenShare,
    shape: b.shape as unknown as Json,
  }
  if (b.suppressionReason !== undefined) out.suppressionReason = b.suppressionReason
  return out
}

/** Deep comparison collecting every difference, with a tolerance on floats. */
function diff(actual: Json, expected: Json, path: string, out: string[]): void {
  if (typeof expected === 'number' && typeof actual === 'number') {
    const close =
      Number.isInteger(expected) && Number.isInteger(actual)
        ? actual === expected
        : Math.abs(actual - expected) <= USD_TOLERANCE * Math.max(1, Math.abs(expected))
    if (!close) out.push(`${path}: engine ${actual} vs golden ${expected}`)
    return
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      out.push(`${path}: engine ${JSON.stringify(actual)} vs golden ${JSON.stringify(expected)}`)
      return
    }
    if (expected.length !== actual.length) {
      out.push(`${path}: length ${actual.length} vs golden ${expected.length}`)
    }
    const n = Math.min(expected.length, actual.length)
    for (let i = 0; i < n; i++) diff(actual[i], expected[i], `${path}[${i}]`, out)
    return
  }
  if (isObject(expected) && isObject(actual)) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)])
    for (const key of [...keys].sort()) {
      const childPath = path ? `${path}.${key}` : key
      if (!(key in actual)) out.push(`${childPath}: missing in engine output`)
      else if (!(key in expected)) out.push(`${childPath}: missing in golden`)
      else diff(actual[key], expected[key], childPath, out)
    }
    return
  }
  if (actual !== expected) {
    out.push(`${path}: engine ${JSON.stringify(actual)} vs golden ${JSON.stringify(expected)}`)
  }
}

function isObject(value: Json): value is { [key: string]: Json } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const fixtures = loadFixtures()

describe('fixture manifest', () => {
  it('lists every committed fixture file', () => {
    const listed = new Set(fixtures.map((f) => f.file))
    const onDisk = walk(FIXTURES_ROOT).filter(
      (f) => !f.startsWith(join(FIXTURES_ROOT, 'generated')),
    )
    expect(onDisk.filter((f) => !listed.has(f))).toEqual([])
    expect(fixtures.length).toBeGreaterThan(0)
  })

  it('has a golden for every fixture and no orphan goldens', () => {
    const expected = new Set(fixtures.map((f) => goldenPath(f.id)))
    for (const path of expected) expect(existsSync(path), `missing ${path}`).toBe(true)
    const orphans = readdirSync(GOLDEN_DIR)
      .map((name) => join(GOLDEN_DIR, name))
      .filter((path) => !expected.has(path))
    expect(orphans).toEqual([])
  })

  it('marks exactly one fixture canary-exempt', () => {
    expect(fixtures.filter((f) => f.canaryExempt).map((f) => f.id)).toEqual([
      'synthetic/version-out-of-range',
    ])
  })
})

describe.each(fixtures.map((f) => [f.id, f] as const))('%s', (id, fixture) => {
  const golden = JSON.parse(readFileSync(goldenPath(id), 'utf8')) as {
    $schema: string
    fixture: string
    outcome: 'analysis' | 'rejected'
    rejection?: { reason: string; stats: Json }
  } & Record<string, Json>

  it('matches the reference sim golden', async () => {
    expect(golden.$schema).toBe(GOLDEN_SCHEMA)
    expect(golden.fixture).toBe(id)
    const { parsed, result, reason } = await runEngine(fixture.file)
    const differences: string[] = []
    if (golden.outcome === 'rejected') {
      diff(
        {
          outcome: 'rejected',
          rejection: { reason: reason ?? 'accepted', stats: parsed.stats as unknown as Json },
        },
        { outcome: 'rejected', rejection: golden.rejection as unknown as Json },
        '',
        differences,
      )
    } else {
      const { $schema: _schema, fixture: _fixture, ...expected } = golden
      diff(
        result ? project(result) : { outcome: 'rejected', reason: reason ?? null },
        expected,
        '',
        differences,
      )
    }
    expect(differences, differences.join('\n')).toEqual([])
  })

  it('never leaks conversation content', async () => {
    const { parsed, result } = await runEngine(fixture.file)
    expect(JSON.stringify(parsed)).not.toContain(CONTENT_POISON)
    expect(JSON.stringify(result ?? null)).not.toContain(CONTENT_POISON)
    expect(readFileSync(goldenPath(id), 'utf8')).not.toContain(CONTENT_POISON)
  })

  it('passes the format-drift canary', async () => {
    const { result } = await runEngine(fixture.file)
    if (!result) return // rejected fixtures carry no validated analysis
    const versions = result.metadata.versions
    if (fixture.canaryExempt) {
      expect(versions.some((v) => !isVersionInValidatedRange(v))).toBe(true)
      expect(result.parseWarnings.map((w) => w.kind)).toContain('version-out-of-range')
      return
    }
    for (const version of versions) {
      expect(
        isVersionInValidatedRange(version),
        `${id} carries version ${version}, outside ${VALIDATED_VERSION_RANGE.min}..${VALIDATED_VERSION_RANGE.max}`,
      ).toBe(true)
    }
    expect(result.parseWarnings.map((w) => w.kind)).not.toContain('version-out-of-range')
  })

  it('reproduces the actual cost at the observed TTL (reconciliation)', async () => {
    const { result } = await runEngine(fixture.file)
    if (!result) return
    for (const bucket of result.buckets) {
      if (bucket.observedTtl === null) continue
      // A 5m-dominant bucket that also carries 1h writes is a mid-session
      // config flip: every write is user-controlled there, so the "5m"
      // scenario deliberately reprices the flipped 1h writes and cannot
      // equal the actual mixed bill (contract mixed-TTL policy, WP-05
      // notes). The property holds exactly for every other bucket.
      if (bucket.observedTtl === '5m' && bucket.observedWriteSplit.oneHourWriteTokens > 0) continue
      const observed =
        bucket.observedTtl === '5m' ? bucket.scenarios.fiveMinute : bucket.scenarios.oneHour
      expect(observed.cost.totalUsd).toBeCloseTo(bucket.actualCost.totalUsd, 9)
    }
  })
})

describe('bundled samples (public/samples)', () => {
  // The scenario captures double as the app's samples (PLAN WP-06). The UI's
  // `SAMPLES` list is the source of truth for which ship and what the cards
  // say; prove the shipped copies and the card numbers cannot drift from the
  // fixtures the goldens cover.
  it('ships exactly the SAMPLES entries, byte-identical to their fixtures', () => {
    expect(SAMPLES.length).toBeGreaterThan(0)
    for (const sample of SAMPLES) {
      expect(readFileSync(join(SAMPLES_DIR, sample.file))).toEqual(
        readFileSync(sampleSource(sample.id)),
      )
    }
    const shipped = readdirSync(SAMPLES_DIR)
      .filter((name) => name.endsWith('.jsonl'))
      .sort()
    expect(shipped).toEqual(SAMPLES.map((s) => s.file).sort())
  })

  it.each(SAMPLES.map((s) => [s.id, s] as const))(
    '%s card numbers come from the data',
    async (_id, sample) => {
      const { parsed, result } = await runEngine(sampleSource(sample.id))
      expect(result).toBeDefined()
      const main = result!.buckets.find((b) => b.bucket === 'main')!
      expect(sample.requestCount).toBe(main.requestCount)
      expect(sample.spanMs).toBe(main.shape.spanMs)
      expect(sample.hardResets ?? 0).toBe(main.scenarios.oneHour.hardResets)
      let input = 0
      let read = 0
      let write = 0
      for (const r of parsed.requests) {
        input += r.usage.inputTokens
        read += r.usage.cacheReadInputTokens
        write += r.usage.cacheCreationInputTokens
      }
      expect(sample.cacheHitRate).toBeCloseTo(read / (input + read + write), 3)
      const lesson =
        main.scenarios.oneHour.hardResets > 0
          ? 'hard-resets'
          : main.recommendation === '5m'
            ? 'five-minute-wins'
            : 'one-hour-wins'
      expect(sample.lesson).toBe(lesson)
    },
  )
})
