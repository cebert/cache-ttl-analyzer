import { describe, expect, it } from 'vitest'

import { MAX_FILE_SIZE_BYTES } from '../engine/contract'
import { inspectFile } from './file-validation'

describe('inspectFile', () => {
  it('accepts a plausible session log', () => {
    expect(inspectFile({ name: 'session.jsonl', size: 4200 })).toBeNull()
  })

  it('blocks a file over the cap and reports both numbers', () => {
    const issue = inspectFile({ name: 'huge.jsonl', size: MAX_FILE_SIZE_BYTES + 1 })
    expect(issue).toEqual({
      severity: 'blocking',
      kind: 'too-large',
      sizeBytes: MAX_FILE_SIZE_BYTES + 1,
      limitBytes: MAX_FILE_SIZE_BYTES,
    })
  })

  it('accepts a file exactly at the cap', () => {
    expect(inspectFile({ name: 'exact.jsonl', size: MAX_FILE_SIZE_BYTES })).toBeNull()
  })

  it('blocks an empty file, which the parser could only reject anyway', () => {
    expect(inspectFile({ name: 'empty.jsonl', size: 0 })?.kind).toBe('empty')
  })

  it('only advises on a wrong extension, since a renamed log is still a log', () => {
    const issue = inspectFile({ name: 'session.txt', size: 10 })
    expect(issue).toEqual({
      severity: 'advisory',
      kind: 'wrong-extension',
      fileName: 'session.txt',
    })
  })

  it('matches the extension case-insensitively', () => {
    expect(inspectFile({ name: 'SESSION.JSONL', size: 10 })).toBeNull()
  })

  it('checks the size before the extension: a huge file is blocked either way', () => {
    expect(inspectFile({ name: 'huge.txt', size: MAX_FILE_SIZE_BYTES + 1 })?.kind).toBe('too-large')
  })
})
