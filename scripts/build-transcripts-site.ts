/**
 * Builds the static site published to GitHub Pages from `transcripts/`.
 *
 * The rendered transcripts are already static HTML with relative links, so the
 * site is just those folders plus a landing page. The landing page is
 * generated from the session map table in `transcripts/README.md` rather than
 * hand-maintained, so there is exactly one place to update when a session is
 * published — the same table the `publish-transcript` skill already writes.
 *
 * Run by hand: `npm run build:transcripts` (output in the git-ignored `site/`).
 */

import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const transcriptsDir = join(repoRoot, 'transcripts')
const outDir = join(repoRoot, 'site')

const SITE_TITLE = 'Cache TTL Analyzer — session transcripts'
const REPO_URL = 'https://github.com/cebert/cache-ttl-analyzer'
const APP_URL = 'https://cacheanalyzer.com'
const SITE_URL = 'https://cebert.github.io/cache-ttl-analyzer/'

interface Session {
  date: string
  slug: string
  covers: string
  notes: string
}

/** Splits one markdown table row into its cells, dropping the outer pipes. */
function cells(row: string): string[] {
  return row
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/**
 * Reads the session map table out of `transcripts/README.md`. Rows look like:
 * `| 2026-08-30 | [001-slug](001-slug/) | Covers… | Share link | Notes… |`
 */
function readSessionMap(): Session[] {
  const readme = readFileSync(join(transcriptsDir, 'README.md'), 'utf8')
  const mapSection = readme.split('## Session map')[1]
  if (mapSection === undefined) {
    throw new Error('transcripts/README.md has no "## Session map" section')
  }

  const sessions: Session[] = []
  for (const line of mapSection.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue
    const [date, session, covers, , notes] = cells(line)
    // Skip the header row and its `|---|` separator.
    if (date === undefined || date === 'Date' || /^-+$/.test(date)) continue

    const slug = session?.match(/^\[([^\]]+)\]\(/)?.[1]
    if (slug === undefined) {
      throw new Error(`Session map row has no [slug](slug/) link: ${line.trim()}`)
    }
    sessions.push({ date, slug, covers: covers ?? '', notes: notes ?? '' })
  }

  if (sessions.length === 0) throw new Error('Session map table is empty')
  return sessions
}

/** Directory names under `transcripts/`, which are the published sessions. */
function publishedSlugs(): string[] {
  return readdirSync(transcriptsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

/**
 * A drifted map means the landing page would silently omit or dead-link a
 * session, so treat it as a build failure rather than publishing a broken site.
 */
function assertInSync(sessions: Session[], slugs: string[]): void {
  const mapped = new Set(sessions.map((session) => session.slug))
  const onDisk = new Set(slugs)

  const missingFromMap = slugs.filter((slug) => !mapped.has(slug))
  const missingOnDisk = [...mapped].filter((slug) => !onDisk.has(slug))

  const problems = [
    ...missingFromMap.map((slug) => `transcripts/${slug}/ is not in the session map table`),
    ...missingOnDisk.map(
      (slug) => `session map lists ${slug}, but transcripts/${slug}/ does not exist`,
    ),
  ]
  if (problems.length > 0) {
    throw new Error(
      `transcripts/README.md and transcripts/ disagree:\n  - ${problems.join('\n  - ')}`,
    )
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * True for a link target safe to put in an `href`. Escaping the URL does not
 * defuse it — `javascript:` and `data:` targets execute when clicked — so a
 * scheme the browser would treat as code is rejected outright, and the link is
 * rendered as plain text instead. Relative targets resolve against the site
 * and come back `https:`.
 */
function isSafeHref(href: string): boolean {
  try {
    const { protocol } = new URL(href, SITE_URL)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * Renders the small slice of markdown the map cells actually use: links and
 * inline code. Everything else is escaped and left as literal text — this is a
 * table of one-line summaries, not a general markdown document.
 */
function renderInline(markdown: string): string {
  return escapeHtml(markdown)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, text: string, href: string) => {
      if (!isSafeHref(href)) return text
      // Relative links in the table point at sibling transcript folders, which
      // sit at the same depth on the site as they do in the repo.
      return `<a href="${href}">${text}</a>`
    })
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function renderPage(sessions: Session[]): string {
  const rows = sessions
    .map((session) => {
      const notes = session.notes ? `<p class="notes">${renderInline(session.notes)}</p>` : ''
      return `      <li class="session">
        <a class="session-link" href="${session.slug}/">${escapeHtml(session.slug)}</a>
        <time datetime="${escapeHtml(session.date)}">${escapeHtml(session.date)}</time>
        <p class="covers">${renderInline(session.covers)}</p>
        ${notes}
      </li>`
    })
    .join('\n')

  // Styling deliberately mirrors the rendered transcripts (same font stack,
  // background and accent) so moving between the index and a session does not
  // feel like moving between two sites.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(SITE_TITLE)}</title>
<style>
:root { --bg-color: #f5f5f5; --card-bg: #ffffff; --accent: #1976d2; --text-color: #212121; --text-muted: #757575; }
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg-color); color: var(--text-color); margin: 0; padding: 16px; line-height: 1.6; }
.container { max-width: 800px; margin: 0 auto; }
h1 { font-size: 1.5rem; margin-bottom: 8px; }
header { border-bottom: 2px solid var(--accent); padding-bottom: 16px; margin-bottom: 24px; }
.lede { color: var(--text-muted); margin: 8px 0 0; }
a { color: var(--accent); }
ol { list-style: none; margin: 0; padding: 0; counter-reset: session; }
.session { background: var(--card-bg); border-left: 4px solid var(--accent); border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 16px; margin-bottom: 16px; }
.session-link { font-weight: 600; font-size: 1.05rem; text-decoration: none; }
.session-link:hover { text-decoration: underline; }
time { color: var(--text-muted); font-size: 0.85rem; margin-left: 8px; }
.covers { margin: 8px 0 0; }
.notes { margin: 8px 0 0; color: var(--text-muted); font-size: 0.9rem; }
code { background: rgba(0,0,0,0.06); border-radius: 4px; padding: 1px 4px; font-size: 0.9em; }
footer { color: var(--text-muted); font-size: 0.9rem; border-top: 1px solid #e0e0e0; padding-top: 16px; margin-top: 8px; }
</style>
</head>
<body>
  <div class="container">
    <header>
      <h1>${escapeHtml(SITE_TITLE)}</h1>
      <p class="lede">
        Every Claude Code session that built <a href="${APP_URL}">Cache TTL Analyzer</a> is published here,
        reviewed and redacted first. Rendered with
        <a href="https://github.com/simonw/claude-code-transcripts">claude-code-transcripts</a>.
      </p>
    </header>
    <ol>
${rows}
    </ol>
    <footer>
      Source: <a href="${REPO_URL}">${REPO_URL.replace('https://', '')}</a>.
      Raw logs (<code>session.jsonl</code>) sit next to each rendered session.
    </footer>
  </div>
</body>
</html>
`
}

const sessions = readSessionMap()
const slugs = publishedSlugs()
assertInSync(sessions, slugs)

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

for (const slug of slugs) {
  cpSync(join(transcriptsDir, slug), join(outDir, slug), { recursive: true })
}

writeFileSync(join(outDir, 'index.html'), renderPage(sessions))
// Pages runs Jekyll over artifacts it builds itself; this one is uploaded
// ready-made, but the marker costs nothing and rules the question out.
writeFileSync(join(outDir, '.nojekyll'), '')

console.log(`Built site/ with ${sessions.length} session${sessions.length === 1 ? '' : 's'}`)
