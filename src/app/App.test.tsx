/**
 * @vitest-environment jsdom
 *
 * The WP-07 acceptance criteria, end to end: the full flow against the WP-02
 * stub engine, a cancel that actually terminates the worker mid-parse, and a
 * non-session file getting the plain-language rejection rather than a broken
 * analysis.
 *
 * The worker is faked at the port boundary and driven by the real protocol
 * handler, so everything below `postMessage` — the handler, the engine, the
 * outcome mapping — is the shipping code. Only the thread is missing.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeAll, describe, expect, it } from 'vitest'

import App from '../App'
import { MAX_FILE_SIZE_BYTES } from '../engine/contract'
import type { AnalysisEngine } from '../engine/contract'
import { createEngine } from '../engine/engine'
import { createStubEngine } from '../engine/stub'
import i18n from '../i18n'
import { en } from '../i18n/en'
import { setLogSink } from '../lib/logger'
import { SessionsProvider } from '../state/SessionsProvider'
import { createAnalysisWorkerHandler } from '../worker/handler'
import type { AnalysisWorkerPort } from '../state/analysis-runner'

beforeAll(async () => {
  await i18n.init()
})

interface FakeWorkerHandle {
  port: AnalysisWorkerPort
  terminated: () => boolean
}

function fakeWorkerFactory(engine: AnalysisEngine): [() => AnalysisWorkerPort, FakeWorkerHandle[]] {
  const created: FakeWorkerHandle[] = []
  return [
    () => {
      let terminated = false
      const port: AnalysisWorkerPort = {
        onmessage: null,
        onerror: null,
        postMessage: (message) => {
          if (!terminated) handler.onMessage(message)
        },
        terminate: () => {
          terminated = true
        },
      }
      const handler = createAnalysisWorkerHandler(engine, (response) => {
        if (!terminated) port.onmessage?.({ data: response })
      })
      // `createAnalysisWorkerHandler` redirects the logger's global sink so worker
      // logs travel over the protocol. In the browser that is harmless — the worker
      // has its own module instance — but here the handler shares this process's
      // logger with the main thread, so the sink is restored immediately: without
      // it, a main-thread log would post itself back as a worker log, forever.
      setLogSink(null)
      created.push({ port, terminated: () => terminated })
      return port
    },
    created,
  ]
}

function renderApp(engine: AnalysisEngine = createStubEngine()) {
  const [createWorker, workers] = fakeWorkerFactory(engine)
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <SessionsProvider createWorker={createWorker} hardStopDelayMs={50}>
        <App />
      </SessionsProvider>
    </MemoryRouter>,
  )
  return { user, workers }
}

function sessionLog(): File {
  return new File(['{"type":"user"}\n'], 'session.jsonl', { type: 'application/jsonl' })
}

function fileInput(): HTMLInputElement {
  return screen.getByLabelText(en.upload.fileInputLabel)
}

/**
 * Scope assertions to the main pane. The sidebar deliberately repeats a run's
 * state as a screen-reader label, so an unscoped query for "Analysis failed"
 * legitimately matches twice.
 */
/** Drop a file on the dropzone, the way a user hands over a log. */
function drop(file: File) {
  const zone = screen.getByText(en.upload.dropTitle).closest('div[class*="border-dashed"]')
  if (!zone) throw new Error('dropzone not found')
  fireEvent.drop(zone, { dataTransfer: { files: [file], types: ['Files'] } })
}

function main() {
  return within(screen.getByRole('main'))
}

/** Likewise the standing nav links, which also appear inside page copy. */
function nav() {
  return within(screen.getByRole('navigation'))
}

describe('the app shell', () => {
  it('lands on the upload screen with the question, the dropzone and the privacy claim', () => {
    renderApp()
    expect(screen.getByRole('heading', { name: en.upload.headline })).toBeInTheDocument()
    expect(screen.getByText(en.upload.dropTitle)).toBeInTheDocument()
    expect(screen.getByText(en.privacy.title)).toBeInTheDocument()
    expect(screen.getByText(en.privacy.csp)).toBeInTheDocument()
    expect(screen.getByText(en.nav.sessionsEmpty)).toBeInTheDocument()
  })

  it('offers the captured sample sessions', () => {
    renderApp()
    expect(screen.getByText(en.samples.title)).toBeInTheDocument()
    for (const name of Object.values(en.samples.names)) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
  })

  it('carries a file through analysis to a result, and remembers it in the sidebar', async () => {
    const { user } = renderApp()

    await user.upload(fileInput(), sessionLog())

    // The analyzing screen, with the cancel the plan requires always available.
    expect(await screen.findByText(en.analyzing.workerNote)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.analyzing.cancel })).toBeInTheDocument()

    expect(await screen.findByText(en.results.recommendation1h)).toBeInTheDocument()
    expect(screen.getByText(en.results.limitsTitle)).toBeInTheDocument()

    // The sidebar is the history (WP-D): the finished run is in it.
    const list = screen.getByRole('list', { name: en.nav.sessionList })
    expect(within(list).getAllByRole('button')).toHaveLength(1)
  })

  it('surfaces the parse warnings the engine reported alongside the result', async () => {
    const { user } = renderApp()
    await user.upload(fileInput(), sessionLog())
    // The stub reports 33 skipped records across two unrecognized types.
    expect(await screen.findByText(/33 records skipped/)).toBeInTheDocument()
  })

  it('cancels mid-parse: the worker is terminated and no result arrives', async () => {
    // An engine that never finishes on its own, so the only way out is cancel.
    const stalling: AnalysisEngine = {
      analyze: (_input, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    }
    const { user, workers } = renderApp(stalling)

    await user.upload(fileInput(), sessionLog())
    await user.click(await screen.findByRole('button', { name: en.analyzing.cancel }))

    expect(await main().findByText(en.status.cancelled)).toBeInTheDocument()
    expect(workers).toHaveLength(1)
    await waitFor(() => expect(workers[0].terminated()).toBe(true))
    expect(screen.queryByText(en.results.limitsTitle)).not.toBeInTheDocument()
  })

  it('rejects a file that is not a session log in plain language, not with a broken analysis', async () => {
    // The real engine, so the verdict comes from the real parser.
    const { user } = renderApp(createEngine())
    const notALog = new File(['this is not JSON at all\nnor is this\nor this\n'], 'notes.jsonl', {
      type: 'text/plain',
    })

    await user.upload(fileInput(), notALog)

    expect(await main().findByText(en.rejected.title)).toBeInTheDocument()
    expect(main().getByText(en.rejected.malformedLines)).toBeInTheDocument()
    expect(screen.queryByText(en.results.limitsTitle)).not.toBeInTheDocument()

    // And there is a way back to the upload screen.
    await user.click(screen.getByRole('button', { name: en.rejected.tryAnother }))
    expect(screen.getByText(en.upload.dropTitle)).toBeInTheDocument()
  })

  it('blocks a file over the size cap before any worker is created', async () => {
    const { user, workers } = renderApp()
    const huge = new File(['x'], 'huge.jsonl')
    Object.defineProperty(huge, 'size', { value: MAX_FILE_SIZE_BYTES + 1 })

    await user.upload(fileInput(), huge)

    expect(await screen.findByRole('alert')).toHaveTextContent(/limit is/)
    expect(workers).toHaveLength(0)
    expect(screen.getByText(en.nav.sessionsEmpty)).toBeInTheDocument()
  })

  it('accepts a file dropped on the zone, not only one chosen from the picker', async () => {
    const { workers } = renderApp()

    drop(new File(['{"type":"user"}\n'], 'dropped.jsonl'))

    expect(await main().findByText(en.results.limitsTitle)).toBeInTheDocument()
    expect(workers).toHaveLength(1)
  })

  it('warns about an unexpected extension but lets the user proceed', async () => {
    // Reached by dropping rather than by choosing: the picker filters on the
    // input's `accept`, so a renamed log only arrives this way.
    const { user, workers } = renderApp()

    drop(new File(['{"type":"user"}\n'], 'session.txt'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/does not end in/)
    expect(workers).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: en.uploadError.addAnyway }))
    expect(await main().findByText(en.results.limitsTitle)).toBeInTheDocument()
    expect(workers).toHaveLength(1)
  })

  it('navigates to the data policy and back to the analyzer', async () => {
    const { user } = renderApp()

    await user.click(nav().getByRole('link', { name: en.nav.dataPolicy }))
    expect(await screen.findByRole('heading', { name: en.dataPolicy.title })).toBeInTheDocument()
    expect(screen.getByText(en.dataPolicy.cspBody)).toBeInTheDocument()

    await user.click(nav().getByRole('button', { name: en.nav.addSession }))
    expect(await screen.findByText(en.upload.dropTitle)).toBeInTheDocument()
  })

  it('reaches the find-your-logs page from the dropzone, with both platform paths', async () => {
    const { user } = renderApp()

    await user.click(screen.getByRole('button', { name: en.upload.whereAreLogs }))

    expect(await screen.findByText(en.findLogs.subagentsNote)).toBeInTheDocument()
    expect(screen.getByText(en.findLogs.macosPath)).toBeInTheDocument()
    expect(screen.getByText(en.findLogs.windowsPath)).toBeInTheDocument()
  })

  it('reports a worker that fails to start rather than hanging on "analyzing"', async () => {
    const [createWorker] = fakeWorkerFactory(createStubEngine())
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <SessionsProvider
          createWorker={() => {
            const port = createWorker()
            port.postMessage = () => {
              throw new Error('unreachable')
            }
            // Deliver the failure the way the browser does, after wiring.
            queueMicrotask(() => port.onerror?.({ message: 'boom' }))
            port.postMessage = () => {}
            return port
          }}
        >
          <App />
        </SessionsProvider>
      </MemoryRouter>,
    )

    await user.upload(fileInput(), sessionLog())
    expect(await main().findByText(en.status.failed)).toBeInTheDocument()
  })
})
