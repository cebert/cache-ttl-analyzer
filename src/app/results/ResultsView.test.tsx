/**
 * @vitest-environment jsdom
 *
 * WP-08 acceptance: the results view renders correctly for every bundled
 * sample, for a file with no sidechain traffic, and for a session whose
 * models have no published rate.
 *
 * Each case runs the real parser and simulator over the real fixture, so
 * what is rendered is what a user loading that sample would see — not a
 * hand-written result that could drift from the engine.
 */

import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it } from 'vitest'

import { PRICING } from '../../config/pricing'
import { SAMPLES } from '../../config/samples'
import type { AnalysisResult } from '../../engine/contract'
import { knownModelIds } from '../../engine/cost'
import { parseSession } from '../../engine/parser'
import { analyzeSession } from '../../engine/simulator'
import i18n from '../../i18n'
import { en } from '../../i18n/en'
import { sampleSource } from '../../../scripts/sync-samples.ts'
import { ResultsView } from './ResultsView'
import { mainBucket } from './results-model'

beforeAll(async () => {
  await i18n.init()
})

async function analyze(path: string): Promise<AnalysisResult> {
  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>
  const parsed = await parseSession(stream, {
    fileName: path.split('/').pop() ?? path,
    fileSizeBytes: 1,
    knownModels: knownModelIds(PRICING),
  })
  return analyzeSession(parsed, PRICING)
}

function renderResult(result: AnalysisResult) {
  return render(
    <MemoryRouter>
      <ResultsView result={result} />
    </MemoryRouter>,
  )
}

describe.each(SAMPLES.map((sample) => [sample.id, sample] as const))(
  'bundled sample: %s',
  (_id, sample) => {
    it('renders the verdict, the totals, the identification card and the limits', async () => {
      const result = await analyze(sampleSource(sample.id))
      const main = mainBucket(result)!
      renderResult(result)

      // The verdict the engine reached, and the one the sample's card claims.
      const expected =
        main.recommendation === '1h' ? en.results.recommendation1h : en.results.recommendation5m
      expect(screen.getByRole('heading', { level: 2, name: expected })).toBeInTheDocument()
      expect(main.recommendation).not.toBe('no-verdict')

      // Both scenario costs, and the saving, as currency.
      expect(screen.getByText(en.results.ttl5m)).toBeInTheDocument()
      expect(screen.getByText(en.results.ttl1h)).toBeInTheDocument()
      expect(screen.getAllByText(/^\$\d/).length).toBeGreaterThanOrEqual(3)

      // The six headline metrics.
      for (const label of [
        en.results.metricHitRate,
        en.results.metricReads,
        en.results.metricWrites,
        en.results.metricInput,
        en.results.metricOutput,
        en.results.metricErrors,
      ]) {
        expect(screen.getByText(label)).toBeInTheDocument()
      }

      // Identification, behaviour, limits.
      expect(screen.getByText(en.results.detailDirectory)).toBeInTheDocument()
      expect(screen.getByText(en.results.timelineTitle)).toBeInTheDocument()
      expect(screen.getByText(en.results.gapsTitle)).toBeInTheDocument()
      expect(screen.getByText(en.results.limitsTitle)).toBeInTheDocument()
      // Every dollar figure carries the "prices as of" date (decision D5).
      expect(screen.getByText(/Notional, at published API rates/)).toBeInTheDocument()
    })

    it('never renders message content, or a catalog key it failed to resolve', async () => {
      const result = await analyze(sampleSource(sample.id))
      const { container } = renderResult(result)
      // Every fixture's conversation payload carries this marker (WP-06).
      expect(container.textContent).not.toMatch(/POISON/)
      // A missing plural form or interpolation variable renders the key
      // itself, which looks like copy until someone reads it closely.
      expect(container.textContent).not.toMatch(/results\.[a-zA-Z]/)
      expect(container.textContent).not.toMatch(/\{\{/)
    })
  },
)

describe('the sample whose lesson is hard resets', () => {
  it('lists each reset with its cause and what changed', async () => {
    const modelSwitch = SAMPLES.find((sample) => sample.lesson === 'hard-resets')!
    const result = await analyze(sampleSource(modelSwitch.id))
    renderResult(result)

    // "model" and "effort" also label fields on the identification card, so
    // these are the reset rows among them.
    expect(screen.getAllByText(en.results.resetModel, { exact: false }).length).toBeGreaterThan(0)
    expect(screen.getAllByText(en.results.resetEffort, { exact: false }).length).toBeGreaterThan(0)
    expect(screen.queryByText(en.results.resetsNone)).not.toBeInTheDocument()
    // The model changed, so the identification card flags it.
    expect(screen.getAllByText(en.results.detailChanged).length).toBeGreaterThan(0)
  })
})

describe('no sidechain traffic (contract F2)', () => {
  it('says so rather than silently omitting a subagent section', async () => {
    // Every modern main-session upload, including all four samples.
    const result = await analyze('fixtures/captured/scenarios/gap-heavy-1h/session.jsonl')
    renderResult(result)

    expect(screen.getByText(en.results.limitNoSidechains)).toBeInTheDocument()
    expect(screen.getByText(en.results.detailNone)).toBeInTheDocument()
  })

  it('reports the sidechain traffic when a log does carry some', async () => {
    const result = await analyze('fixtures/synthetic/legacy-interleaved-sidechains.jsonl')
    renderResult(result)

    expect(screen.queryByText(en.results.limitNoSidechains)).not.toBeInTheDocument()
    expect(
      screen.getByText(en.results.limitSubagentsPresent.split('{{')[0], { exact: false }),
    ).toBeInTheDocument()
  })

  it('headlines the subagent bucket when the file is a subagent transcript', async () => {
    const result = await analyze(
      'fixtures/captured/parallel-subagents/subagents/agent-a01d87944318de984.jsonl',
    )
    expect(mainBucket(result)!.requestCount).toBe(0)
    renderResult(result)

    // The verdict speaks for the bucket that has the traffic, and names it.
    expect(screen.getByText('subagentPromptCacheTtl')).toBeInTheDocument()
    expect(screen.queryByText(en.results.noVerdictEmpty)).not.toBeInTheDocument()
  })
})

describe('unknown models', () => {
  it('suppresses the verdict and explains why when most tokens are unpriced', async () => {
    const result = await analyze('fixtures/synthetic/unknown-model-major.jsonl')
    const main = mainBucket(result)!
    expect(main.verdictSuppressed).toBe(true)
    renderResult(result)

    expect(
      screen.getByRole('heading', { level: 2, name: en.results.recommendationNone }),
    ).toBeInTheDocument()
    expect(screen.getByText(en.results.noVerdictBody)).toBeInTheDocument()
    // No dollar figures are offered for a verdict the engine refused to make.
    expect(screen.queryByText(en.results.savedLabel)).not.toBeInTheDocument()
    // Stated in the limits panel, and again in the warnings banner above it.
    expect(
      screen.getAllByText(en.results.limitUnknownModels.split('{{')[0], { exact: false }).length,
    ).toBeGreaterThan(0)
  })

  it('still gives a verdict when only a minority of tokens are unpriced', async () => {
    const result = await analyze('fixtures/synthetic/unknown-model-minor.jsonl')
    const main = mainBucket(result)!
    expect(main.verdictSuppressed).toBe(false)
    renderResult(result)

    expect(screen.getByText(en.results.savedLabel)).toBeInTheDocument()
    // …and the exclusion is still disclosed.
    expect(
      screen.getAllByText(en.results.limitUnknownModels.split('{{')[0], { exact: false }).length,
    ).toBeGreaterThan(0)
  })
})

describe('untrusted metadata', () => {
  it('renders hostile strings as text, never as markup', async () => {
    const result = await analyze('fixtures/adversarial/hostile-metadata.jsonl')
    const { container } = renderResult(result)

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    // The identification card still renders, with the hostile values inert.
    expect(screen.getByText(en.results.detailDirectory)).toBeInTheDocument()
  })
})

describe('failed requests', () => {
  it('counts <synthetic> rows as the error rate rather than as traffic', async () => {
    const result = await analyze('fixtures/synthetic/synthetic-rows.jsonl')
    expect(result.parseStats.syntheticRowsExcluded).toBeGreaterThan(0)
    renderResult(result)

    expect(screen.getByText(en.results.metricErrors)).toBeInTheDocument()
    expect(
      screen.getByText(
        en.results.metricErrorsNote_other.replace(
          '{{count}}',
          String(result.parseStats.syntheticRowsExcluded),
        ),
      ),
    ).toBeInTheDocument()
  })
})
