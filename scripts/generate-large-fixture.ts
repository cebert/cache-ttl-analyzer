/**
 * Generates the ~100MB synthetic session log used by
 * `src/engine/parser.large.test.ts` (docs/PLAN.md WP-03 acceptance). The
 * output lives under the git-ignored `fixtures/generated/` and is NEVER
 * committed; the test calls `ensureLargeFixture()` and regenerates it when
 * the manifest is missing or stale.
 *
 * Run by hand: `node scripts/generate-large-fixture.ts`
 *
 * The file mimics a real Claude Code session: user -> attachment ->
 * assistant chains, one assistant row per content block (each carrying the
 * full usage, so dedup is exercised), a few unrecognized record types, and
 * repeated `ai-title` records. Deterministic, so the manifest's expected
 * counts are exact.
 */

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LARGE_FIXTURE_PATH = 'fixtures/generated/large-session.jsonl'
export const LARGE_FIXTURE_TARGET_BYTES = 100 * 1024 * 1024

/** Bump when the generated shape changes so stale fixtures regenerate. */
const GENERATOR_VERSION = 1
const SESSION_ID = 'ffffffff-0000-4000-8000-00000000f1x7'
const VERSION = '2.1.251'
const MODEL = 'claude-fable-5'
const T0 = Date.parse('2026-08-30T12:00:00.000Z')

export interface LargeFixtureManifest {
  generatorVersion: number
  targetBytes: number
  bytes: number
  totalLines: number
  userRows: number
  attachmentRows: number
  assistantRows: number
  requests: number
  aiTitleRows: number
  skippedRecordTypes: Record<string, number>
  lastTitle: string
}

function manifestPathFor(path: string): string {
  return `${path}.manifest.json`
}

/** Return the manifest, generating the fixture first if missing or stale. */
export function ensureLargeFixture(
  path: string = LARGE_FIXTURE_PATH,
  targetBytes: number = LARGE_FIXTURE_TARGET_BYTES,
): LargeFixtureManifest {
  const manifestPath = manifestPathFor(path)
  if (existsSync(path) && existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as LargeFixtureManifest
      if (
        manifest.generatorVersion === GENERATOR_VERSION &&
        manifest.targetBytes === targetBytes &&
        statSync(path).size === manifest.bytes
      ) {
        return manifest
      }
    } catch {
      // fall through and regenerate
    }
  }
  return generateLargeFixture(path, targetBytes)
}

const iso = (ms: number) => new Date(ms).toISOString()
const padding = (chars: number, seed: number) =>
  `content-block-${seed}-`.repeat(Math.ceil(chars / 16)).slice(0, chars)

export function generateLargeFixture(path: string, targetBytes: number): LargeFixtureManifest {
  mkdirSync(dirname(path), { recursive: true })
  const fd = openSync(path, 'w')
  let buffered: string[] = []
  let bufferedBytes = 0
  let bytes = 0
  const manifest: LargeFixtureManifest = {
    generatorVersion: GENERATOR_VERSION,
    targetBytes,
    bytes: 0,
    totalLines: 0,
    userRows: 0,
    attachmentRows: 0,
    assistantRows: 0,
    requests: 0,
    aiTitleRows: 0,
    skippedRecordTypes: {},
    lastTitle: '',
  }
  const emit = (record: object) => {
    const line = JSON.stringify(record) + '\n'
    buffered.push(line)
    bufferedBytes += line.length // ASCII-only content, so chars == bytes
    manifest.totalLines++
    if (bufferedBytes >= 4 * 1024 * 1024) flush()
  }
  const flush = () => {
    if (buffered.length === 0) return
    const chunk = buffered.join('')
    writeSync(fd, chunk)
    bytes += Buffer.byteLength(chunk)
    buffered = []
    bufferedBytes = 0
  }
  const skip = (type: string) => {
    manifest.skippedRecordTypes[type] = (manifest.skippedRecordTypes[type] ?? 0) + 1
  }

  const common = {
    isSidechain: false,
    userType: 'external',
    entrypoint: 'cli',
    cwd: '/home/user/large-project',
    sessionId: SESSION_ID,
    version: VERSION,
    gitBranch: 'main',
  }

  let lastAssistantUuid: string | null = null
  let turn = 0
  try {
    while (bytes + bufferedBytes < targetBytes) {
      const base = T0 + turn * 20_000
      const userUuid = `u-${turn}`
      emit({
        ...common,
        parentUuid: lastAssistantUuid,
        type: 'user',
        uuid: userUuid,
        timestamp: iso(base),
        message: { role: 'user', content: padding(3000, turn) },
      })
      manifest.userRows++
      const attachmentUuid = `at-${turn}`
      emit({
        ...common,
        parentUuid: userUuid,
        type: 'attachment',
        uuid: attachmentUuid,
        timestamp: iso(base + 1000),
        attachment: { type: 'hook_success', content: padding(2000, turn) },
      })
      manifest.attachmentRows++

      const messageId = `msg_large_${turn}`
      const usage = {
        input_tokens: 2,
        cache_creation_input_tokens: 500,
        cache_read_input_tokens: 20_000 + (turn % 1000),
        output_tokens: 100 + (turn % 50),
        output_tokens_details: { thinking_tokens: 40 },
        server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
        service_tier: 'standard',
        cache_creation: { ephemeral_1h_input_tokens: 500, ephemeral_5m_input_tokens: 0 },
        inference_geo: 'not_available',
        iterations: [{ type: 'message', iteration_id: `it-${turn}` }],
        speed: 'standard',
      }
      const blocks = (turn % 4) + 1
      for (let block = 0; block < blocks; block++) {
        const uuid = `a-${turn}-${block}`
        emit({
          ...common,
          // F6: continuation rows are not a linear chain — alternate parents.
          parentUuid: block === 0 || block % 2 === 0 ? attachmentUuid : `a-${turn}-${block - 1}`,
          message: {
            model: MODEL,
            id: messageId,
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: padding(1000, turn * 10 + block) }],
            stop_reason: block === blocks - 1 ? 'end_turn' : null,
            usage,
          },
          requestId: `req_large_${turn}`,
          type: 'assistant',
          uuid,
          timestamp: iso(base + 3000 + block * 500),
          effort: 'high',
        })
        manifest.assistantRows++
        lastAssistantUuid = uuid
      }
      manifest.requests++

      if (turn % 7 === 0) {
        emit({ type: 'permission-mode', permissionMode: 'default', sessionId: SESSION_ID })
        skip('permission-mode')
      }
      if (turn % 10 === 0) {
        emit({ type: 'frame-link', artifactCount: 0, sessionId: SESSION_ID, timestamp: iso(base) })
        skip('frame-link')
      }
      if (turn % 25 === 0) {
        manifest.lastTitle = `Large synthetic session, turn ${turn}`
        emit({ type: 'ai-title', aiTitle: manifest.lastTitle, sessionId: SESSION_ID })
        manifest.aiTitleRows++
      }
      turn++
    }
    flush()
  } finally {
    closeSync(fd)
  }
  manifest.bytes = bytes
  writeFileSync(manifestPathFor(path), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const manifest = ensureLargeFixture()
  console.log(JSON.stringify(manifest, null, 2))
}
