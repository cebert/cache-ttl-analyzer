/**
 * The English string catalog — the ONLY place user-facing copy lives
 * (docs/PLAN.md, D10). Components never hard-code a string; they call `t`.
 *
 * This object's shape is the contract a translation must satisfy: it is fed
 * to i18next's `CustomTypeOptions` in `./index.ts`, so `t('does.not.exist')`
 * is a compile error and a future `de.ts` typed as `typeof en` cannot omit a
 * key. Plurals use i18next's `_one` / `_other` suffixes, which resolve
 * through `Intl.PluralRules` for whatever locale is active — a language with
 * more plural categories adds its own suffixed keys without touching
 * components.
 *
 * Numbers, currency, dates and durations are NOT formatted here; they come
 * in as already-formatted strings from `./formatters.ts` so one `Intl`
 * configuration serves the whole app.
 */

export const en = {
  app: {
    name: 'cacheanalyzer',
    title: 'Cache TTL Analyzer',
  },

  nav: {
    addSession: 'Add session',
    sessions: 'Sessions',
    sessionsEmpty: 'Sessions you analyze appear here',
    memoryOnly: 'Memory only — reloading clears these',
    findLogs: 'Find your logs',
    dataPolicy: 'Data policy',
    about: 'About',
    openMenu: 'Open navigation',
    closeMenu: 'Close navigation',
    skipToContent: 'Skip to main content',
    sessionList: 'Analyzed sessions',
  },

  upload: {
    headline: 'Should your sessions cache for five minutes, or an hour?',
    subhead:
      'Add a Claude Code session log. You get the cost at both TTLs and the gaps that decide it — computed in this browser.',
    dropTitle: 'Drop a session log here',
    dropTitleActive: 'Release to analyze',
    dropHint: 'One .jsonl file, up to {{size}}',
    choose: 'Choose a file',
    whereAreLogs: 'Where are my logs?',
    busyTitle: 'An analysis is already running',
    busyHint: 'One session at a time — cancel the running analysis to add another.',
    fileInputLabel: 'Session log file',
  },

  uploadError: {
    tooLarge: 'That file is {{size}}. The limit is {{limit}} — larger than any real session log.',
    empty: 'That file is empty.',
    wrongType:
      'Session logs are JSONL files. “{{name}}” does not end in .jsonl — add it anyway if you are sure.',
    addAnyway: 'Analyze it anyway',
    dismiss: 'Dismiss',
  },

  samples: {
    title: 'Or start with a captured session',
    meta: '{{requests}} requests · {{span}} · {{hitRate}} hits',
    badge5m: '5 min wins',
    badge1h: '1 hour wins',
    badgeResets: '{{count}} resets',
    loadFailed: 'That sample could not be loaded. Reload the page and try again.',
    // Sample names are our copy, not log-derived, so they are translatable
    // strings like everything else. WP-06 captures the sessions these name;
    // a sample it adds under a new id adds its name here too.
    // Consumed by `SampleSession.nameKey`; WP-06 adds the sessions these name.
    names: {
      realSession: 'A real 85-minute session',
      tightLoop: 'Tight agent loop',
      gapHeavy: 'Long and gap-heavy',
      gapHeavy5m: 'Gap-heavy, run at 5 minutes',
      modelSwitch: 'Model switched',
    },
  },

  privacy: {
    title: 'Nothing is uploaded',
    inBrowser: 'Analyzed in a Web Worker on your machine. Never sent, never stored.',
    metadataOnly: 'The parser reads token counts and timestamps — never message content.',
    csp: 'A strict Content-Security-Policy blocks outbound connections. Check devtools.',
    source: 'Source on GitHub',
  },

  findLogs: {
    title: 'Where are my session logs?',
    intro:
      'Claude Code writes one JSONL file per session, under a folder named for the working directory.',
    macos: 'macOS & Linux',
    windows: 'Windows',
    macosPath: '~/.claude/projects/<project>/<id>.jsonl',
    windowsPath: '%USERPROFILE%\\.claude\\projects\\<project>\\<id>.jsonl',
    projectNote: 'Project folder = working directory, non-alphanumerics replaced by dashes.',
    macosHiddenNote:
      'On macOS the .claude folder is hidden in Finder. In the file picker, press ⌘ + Shift + G and paste the path to jump straight to it.',
    configDirNote:
      'CLAUDE_CONFIG_DIR moves the root. Transcripts are deleted after 30 days by default.',
    subagentsTitle: 'Subagent transcripts',
    subagentsNote:
      'A session that spawned subagents keeps each one in its own file beside the session log, in <id>/subagents/agent-<agentId>.jsonl. Analyze those separately — a main-session log contains none of their traffic.',
    docs: 'Claude Code docs',
    copyPath: 'Copy path',
    copied: 'Copied',
  },

  analyzing: {
    title: 'Analyzing',
    fileMeta: '{{name}} · {{size}}',
    cancel: 'Cancel',
    workerNote: 'Running in a Web Worker — the tab stays responsive.',
    starting: 'Starting the worker',
    bytesProgress: '{{done}} of {{total}}',
    requestsSeen_one: '{{count}} request so far',
    requestsSeen_other: '{{count}} requests so far',
    stepStream: 'Streamed the file',
    stepDedup: 'Deduplicating requests',
    stepPrice: 'Pricing at published API rates',
    stepReplay: 'Replaying at 5 minutes and 1 hour',
  },

  warnings: {
    details: 'Details',
    hide: 'Hide',
    skippedRecordTypes_one: '{{count}} record skipped — unrecognized type, no billing data.',
    skippedRecordTypes_other: '{{count}} records skipped — unrecognized types, no billing data.',
    malformedLines_one: '{{count}} line could not be parsed and was skipped.',
    malformedLines_other: '{{count}} lines could not be parsed and were skipped.',
    invalidUsageRows_one: '{{count}} row had unusable token counts and was skipped.',
    invalidUsageRows_other: '{{count}} rows had unusable token counts and were skipped.',
    lineLengthCap_one: '{{count}} line exceeded the length cap and was skipped.',
    lineLengthCap_other: '{{count}} lines exceeded the length cap and were skipped.',
    versionOutOfRange:
      'Recorded by Claude Code {{versions}}, outside the versions this parser was validated against. The analysis ran anyway.',
    unknownModels:
      'No published rate for {{models}}. Those requests are excluded from every dollar figure.',
  },

  rejected: {
    title: 'That is not a Claude Code session log',
    malformedLines:
      'Most lines in this file are not valid JSON records. A session log is JSONL — one JSON object per line.',
    noAssistantUsage:
      'This file has no assistant records carrying token usage, so there is nothing to cost out. Session logs written by Claude Code always do.',
    linesScanned: 'Scanned {{lines}}, kept nothing.',
    tryAnother: 'Try another file',
    whereAreLogs: 'Where are my session logs?',
  },

  status: {
    cancelled: 'Analysis cancelled',
    cancelledHint: 'The worker was stopped and nothing was kept.',
    failed: 'Analysis failed',
    analyzing: 'Analyzing',
    startOver: 'Start over',
    errorFileTooLarge: 'That file is larger than this tool will read.',
    errorReadFailure:
      'The file could not be read. It may have moved or changed since you picked it.',
    errorInternal: 'Something went wrong inside the analyzer.',
  },

  results: {
    recommendation5m: 'Use the 5-minute cache',
    recommendation1h: 'Use the 1-hour cache',
    recommendationNone: 'No verdict for this session',
    pricesAsOf: 'Prices as of {{date}}',

    // Verdict band.
    recommendationLabel: 'Recommendation',
    savedLabel: 'You would have saved',
    savedComparison: '{{percent}} less than {{other}}',
    ttl5m: '5 minutes',
    ttl1h: '1 hour',
    noVerdictBody:
      'Too much of this session ran on models with no published rate, so there is no honest cost to compare.',
    noVerdictEmpty: 'This file recorded no billable requests for this cache.',
    bandSentence_one:
      '{{count}} of {{total}} gaps fell between 5 minutes and 1 hour — the only band where the setting changes anything.',
    bandSentence_other:
      '{{count}} of {{total}} gaps fell between 5 minutes and 1 hour — the only band where the setting changes anything.',
    bandSentenceNone:
      'No gap fell between 5 minutes and 1 hour, the only band where the setting changes anything.',
    notional: 'Notional, at published API rates · {{date}}',
    whyLink: 'why?',

    // Headline metrics.
    metricHitRate: 'Cache hit rate',
    metricHitRateNote: '{{reads}} of {{requests}} read warm',
    metricReads: 'Cache reads',
    metricReadsNote: '0.1× rate',
    metricWrites: 'Cache writes',
    metricWritesNote5m: '1.25× rate, all 5 minutes',
    metricWritesNote1h: '2.0× rate, all 1 hour',
    metricWritesNoteMixed: 'mixed 5 minute and 1 hour writes',
    metricWritesNoteNone: 'no cache writes',
    metricInput: 'Input tokens',
    metricInputNote: 'uncached',
    metricOutput: 'Output tokens',
    metricOutputNote: 'thinking included',
    metricErrors: 'Error rate',
    metricErrorsNote_one: '{{count}} failed row',
    metricErrorsNote_other: '{{count}} failed rows',

    // Session identification.
    detailDirectory: 'Directory',
    detailBranch: 'Branch',
    detailSpan: 'Span',
    detailObservedTtl: 'Observed TTL',
    detailModel: 'Model',
    detailEffort: 'Effort',
    detailVersion: 'Claude Code',
    detailRequests: 'Requests',
    detailSubagents: 'Subagents',
    detailChanged: 'CHANGED',
    detailUnknown: 'not recorded',
    detailNone: 'none',
    observedTtlUniform: '{{ttl}}, every write',
    observedTtlMixed: '{{ttl}} for most writes',
    observedTtlNone: 'no cache writes',
    requestsCount: '{{priced}} priced · {{skipped}} skipped',
    // `count` picks the plural form; `formattedCount` is the same number
    // written by the locale's formatter, which is what gets displayed.
    requestsCountNoSkips_one: '{{formattedCount}} request',
    requestsCountNoSkips_other: '{{formattedCount}} requests',
    subagentThreads_one: '{{count}} thread, {{requests}} requests',
    subagentThreads_other: '{{count}} threads, {{requests}} requests',

    // Cache behaviour.
    timelineTitle: 'Cache timeline',
    legendWarmRead: 'warm read',
    legendExpiry: 'cache expired',
    legendWrite: 'wrote, read nothing',
    legendReset: 'reset',
    timelineEmpty: 'This cache recorded no requests to plot.',
    resetsTitle: 'Cache resets',
    resetRequest: '{{time}} · req {{number}}',
    resetModel: 'model',
    resetEffort: 'effort',
    resetVersion: 'version',
    resetsWaste: '{{tokens}} tokens rewritten — the same under either TTL.',
    resetsNone: 'No model, effort or version change reset this cache.',
    gapsTitle: 'Gaps between requests',
    gapsUnder5m: 'under 5 minutes',
    gapsBand: '5 minutes – 1 hour',
    gapsOver1h: 'over 1 hour',

    // Limits.
    limitsTitle: 'Limits of this analysis',
    limitNoSidechains:
      'No sidechain traffic in this file — subagentPromptCacheTtl was not evaluated. Subagent transcripts are separate files, beside the session log in its subagents folder.',
    // A file can carry sidechain traffic two ways, and the honest sentence
    // differs: a subagent transcript on its own is fully analyzed (its bucket
    // is the headline), while a legacy log carrying both gets a main-only
    // verdict.
    limitSubagentsOnly:
      'This file is a subagent transcript: {{requests}} sidechain requests across {{threads}} threads, analyzed here in full. Its verdict governs subagentPromptCacheTtl, not promptCacheTtl.',
    limitSubagentsPresent:
      'This file also carries {{requests}} sidechain requests across {{threads}} threads. Version 1 reports the main conversation only; analyzing both caches together is on the roadmap.',
    limitObservedOnly:
      'The log records the observed TTL, never whether it was configured or defaulted.',
    limitApproximation:
      'A cache entry is modelled as expiring whole, or as far as the log shows it lapsed — which overstates the 5-minute cost rather than understating it.',
    limitUnknownModels:
      'No published rate for {{models}}, so {{requests}} requests are excluded from every dollar figure.',
    footerPrivacy: 'Read in this browser, never uploaded.',
    footerHowTo: 'How to set promptCacheTtl',
    footerSource: 'Source on GitHub',
  },

  dataPolicy: {
    title: 'Data policy',
    lead: 'This tool has no backend. There is nowhere for your session log to go.',
    localTitle: 'Your file never leaves your browser',
    localBody:
      'You pick a file, the page hands it to a Web Worker running on your own machine, and the worker streams it and computes the answer. The file is never uploaded, never written to storage, and never sent to us or anyone else.',
    cspTitle: 'The platform enforces it, we do not just promise it',
    cspBody:
      'Every page is served with a strict Content-Security-Policy whose connect-src is limited to this origin. The browser will refuse an outbound request to anywhere else, whatever the code tries. Open devtools, watch the network tab while you analyze a session, and you will see no request carrying your data.',
    contentTitle: 'What is read, and what is not',
    contentBody:
      'The parser reads token counts, timestamps, model ids, the Claude Code version, the working directory, the git branch, and the session title. It never reads message content — a test in the repository feeds the parser a session whose message bodies are poison values and asserts they appear nowhere in the output.',
    memoryTitle: 'Nothing is kept',
    memoryBody:
      'Analyses you run live in this tab’s memory and are gone when you reload or close it. There is no account, no database, and no cookie. The one thing this app writes to browser storage is an optional debug flag you set yourself.',
    analyticsTitle: 'No analytics, no tracking',
    analyticsBody:
      'There is no analytics script, no tag manager, no error-reporting service and no third-party embed of any kind. Logs go to your own browser console and nowhere else.',
    futureTitle: 'If that ever changes',
    futureBody:
      'A richer analysis using the Anthropic API is a possible future feature. If it ships, it will be opt-in, off by default, and will state exactly which fields would be sent before you turn it on. Nothing will start leaving your browser silently.',
    verifyTitle: 'Verify it yourself',
    verifyBody: 'The whole app is open source. Read the parser, or run it locally.',
    verifyLink: 'Source on GitHub',
    debugTitle: 'Debug logging',
    debugBody:
      'Add ?debug=1 to the URL, or set cta-debug to 1 in localStorage, to raise console verbosity when you need to troubleshoot. Log output stays in your console; it is never collected.',
  },

  about: {
    title: 'About',
    lead: 'cacheanalyzer tells you whether a Claude Code session would have cost less with a five-minute or a one-hour prompt cache.',
    whyTitle: 'Why this exists',
    whyBody:
      'Prompt caching is billed at a discount to read and a premium to write, and the premium depends on how long the entry lives. Whether the longer TTL pays for itself depends entirely on the shape of your session — how long the pauses between requests are. That is knowable from a session log, and guessable from nothing else.',
    howTitle: 'How it works',
    howBody:
      'The session log is parsed into one record per API request, deduplicated by message id. Each request is priced at published Anthropic API rates, then the session is replayed twice — once with a five-minute cache, once with a one-hour cache — expiring entries on the gaps actually observed and resetting the cache whenever the model, effort or version changed.',
    costTitle: 'About the dollar figures',
    costBody:
      'Every figure is the notional cost at published Anthropic API rates. If you use Claude Code on a subscription you are not billed per token, so treat these as a measure of the work, not an invoice. If you pay by usage — API, Bedrock or credits — this is what the session cost.',
    limitsTitle: 'What it approximates',
    limitsBody:
      'A cache entry is treated as all-or-nothing: it either survived the gap or it did not. Real caching is finer-grained than that, and the simplification runs conservative toward the five-minute setting. Requests using a model with no published rate are excluded from the totals and disclosed rather than guessed.',
    monitorTitle: 'Watching this going forward',
    monitorBody:
      'Claude Code 2.1.251 and later report live cache statistics with the /usage command, which is the right tool for day-to-day monitoring. This one is for deciding the setting in the first place.',
    sourceLink: 'Source on GitHub',
  },

  common: {
    externalLink: 'opens in a new tab',
  },
} as const
