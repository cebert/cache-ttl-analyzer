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
    home: 'Go to the start page',
    backToUpload: 'All sessions',
  },

  upload: {
    headline: 'Should your Claude Code sessions cache for five minutes, or an hour?',
    subhead:
      'Drop in a session log and find out. You will see what it would have cost either way, and what made the difference. The file is read in this browser and never uploaded — there is no server to upload it to.',
    dropTitle: 'Drop a session log here',
    dropTitleActive: 'Release to analyze',
    dropHint: 'One .jsonl file, up to {{size}}',
    choose: 'Choose a file',
    whereAreLogs: 'Where are my logs?',
    busyTitle: 'An analysis is already running',
    busyHint: 'One at a time. Cancel the one that is running to start another.',
    fileInputLabel: 'Session log file',
  },

  uploadError: {
    tooLarge:
      'That file is {{size}}, and the limit is {{limit}} — bigger than any real session log we have seen.',
    empty: 'That file is empty.',
    wrongType:
      'Session logs are .jsonl files, and “{{name}}” does not end in .jsonl. Go ahead anyway if you know it is one.',
    addAnyway: 'Analyze it anyway',
    dismiss: 'Dismiss',
  },

  samples: {
    title: 'Or try a sample session',
    // `requests` arrives already pluralized (counts.requests).
    meta: '{{requests}} over {{span}} · {{hitRate}} from cache',
    badge5m: '5 minutes wins',
    badge1h: '1 hour wins',
    // `count` picks the form; `formattedCount` is the locale-written number
    // that actually renders (the house pattern — see results.requestsCountNoSkips).
    badgeResets_one: '{{formattedCount}} reset',
    badgeResets_other: '{{formattedCount}} resets',
    loadFailed: 'That one would not load. Reload the page and try again.',
    // Sample names are our copy, not log-derived, so they are translatable
    // strings like everything else. WP-06 captures the sessions these name;
    // a sample it adds under a new id adds its name here too.
    // Consumed by `SampleSession.nameKey`; WP-06 adds the sessions these name.
    names: {
      realSession: 'A real 85-minute session',
      tightLoop: 'Back-to-back requests',
      gapHeavy: 'Long pauses between requests',
      modelSwitch: 'Switched models partway',
    },
  },

  privacy: {
    title: 'Nothing is uploaded',
    inBrowser: 'Your file is read on your own machine. It is never sent anywhere and never stored.',
    metadataOnly: 'We read token counts and timestamps. We never read what you or Claude said.',
    csp: 'The browser itself blocks this page from sending anything out. Open devtools and watch.',
    source: 'Source on GitHub',
  },

  findLogs: {
    title: 'Where are my session logs?',
    intro:
      'Claude Code writes one JSONL file per session, in a folder named for the directory you were working in. Pick the file for the session you want to analyze.',
    pathEyebrow: 'Path',
    openEyebrow: 'Opening it',
    // The three platforms get their own block rather than one shared path
    // with footnotes: the path, the hidden-folder problem and the keystroke
    // that solves it are different on each, and interleaving them is what
    // made the earlier single-panel version hard to follow.
    mac: {
      name: 'macOS',
      path: '~/.claude/projects/',
      // The two ways in: from a file picker (which is where the user
      // already is, having clicked "Choose a file"), and from Finder.
      step1: 'In the file picker, press <keys><kbd>⌘</kbd><kbd>⇧</kbd><kbd>G</kbd></keys>.',
      step2: 'Paste the path above and press <keys><kbd>Return</kbd></keys>.',
      note: 'Finder hides the .claude folder. <keys><kbd>⌘</kbd><kbd>⇧</kbd><kbd>.</kbd></keys> shows hidden files if you would rather click your way there.',
    },
    linux: {
      name: 'Linux',
      path: '~/.claude/projects/',
      step1: 'In the file picker, press <keys><kbd>Ctrl</kbd><kbd>L</kbd></keys>.',
      step2: 'Paste the path above and press <keys><kbd>Enter</kbd></keys>.',
      note: 'File managers hide the .claude folder. <keys><kbd>Ctrl</kbd><kbd>H</kbd></keys> shows hidden files.',
    },
    windows: {
      name: 'Windows',
      path: '%USERPROFILE%\\.claude\\projects\\',
      step1:
        'In the file picker, press <keys><kbd>Ctrl</kbd><kbd>L</kbd></keys> or click the address bar.',
      step2: 'Paste the path above and press <keys><kbd>Enter</kbd></keys>.',
      note: 'Paste it exactly as written — Explorer fills in %USERPROFILE% for you.',
    },
    fileNameTitle: 'Which file is which?',
    fileNameBody:
      'Inside is one folder per project, named for its working directory with every non-alphanumeric character replaced by a dash. Each session is a file named for its id, so sort by date modified to find the one you just ran.',
    retentionNote:
      'Claude Code deletes transcripts after 30 days by default, and CLAUDE_CONFIG_DIR moves the whole root if you have set it.',
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
    workerNote: 'Running in the background — the page stays usable.',
    starting: 'Getting started',
    bytesProgress: '{{done}} of {{total}}',
    requestsSeen_one: '{{count}} request so far',
    requestsSeen_other: '{{count}} requests so far',
    stepStream: 'Reading the file',
    stepDedup: 'Sorting out the requests',
    stepPrice: 'Working out what each one cost',
    stepReplay: 'Replaying it at 5 minutes and at 1 hour',
  },

  warnings: {
    details: 'Details',
    hide: 'Hide',
    skippedRecordTypes_one: '{{count}} record skipped — unrecognized type, no billing data.',
    skippedRecordTypes_other: '{{count}} records skipped — unrecognized types, no billing data.',
    malformedLines_one: '{{count}} line was not readable and was skipped.',
    malformedLines_other: '{{count}} lines were not readable and were skipped.',
    invalidUsageRows_one: '{{count}} row had token counts we could not use, so it was skipped.',
    invalidUsageRows_other:
      '{{count}} rows had token counts we could not use, so they were skipped.',
    lineLengthCap_one: '{{count}} line was too long to read, so it was skipped.',
    lineLengthCap_other: '{{count}} lines were too long to read, so they were skipped.',
    versionOutOfRange:
      'This log came from Claude Code {{versions}}, which we have not tested against. We ran the analysis anyway.',
    unknownModels:
      'There is no published price for {{models}}, so those requests are left out of the dollar figures.',
  },

  rejected: {
    title: 'This does not look like a session log',
    malformedLines:
      'Most lines in this file are not valid JSON. A session log has one JSON object per line.',
    noAssistantUsage:
      'Nothing in this file records how many tokens a request used, so there is nothing to price. A real Claude Code session log always has that.',
    linesScanned: 'Read {{lines}} and found nothing to use.',
    tryAnother: 'Try another file',
    whereAreLogs: 'Where are my session logs?',
  },

  status: {
    cancelled: 'Analysis cancelled',
    cancelledHint: 'Stopped, and nothing was kept.',
    failed: 'Analysis failed',
    analyzing: 'Analyzing',
    startOver: 'Start over',
    errorFileTooLarge: 'That file is bigger than this tool will read.',
    errorReadFailure:
      'We could not read the file. It may have moved or changed since you picked it.',
    errorInternal: 'Something went wrong on our side.',
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
    // Pluralized on the in-band count; `total` is the second count and
    // arrives already pluralized (counts.gaps), so "1 of 1 gap" reads right.
    bandSentence_one:
      '{{formattedCount}} of {{total}} fell between 5 minutes and 1 hour — the only band where the setting changes anything.',
    bandSentence_other:
      '{{formattedCount}} of {{total}} fell between 5 minutes and 1 hour — the only band where the setting changes anything.',
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
    // Two independent counts, and i18next can only pluralize on one (`count`)
    // per key. So each count becomes its own pluralized fragment and the
    // outer key just joins them — the pattern every multi-count string here
    // follows. A translator reorders the fragments freely.
    subagentThreads: '{{threads}}, {{requests}}',

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
    // `tokens` arrives already pluralized (counts.tokens).
    resetsWaste: '{{tokens}} rewritten — the same under either TTL.',
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
    // `requests` and `threads` arrive as already-pluralized fragments
    // (countSidechainRequests / countThreads), because one key cannot
    // pluralize on two counts.
    limitSubagentsOnly:
      'This file is a subagent transcript: {{requests}} across {{threads}}, analyzed here in full. Its verdict governs subagentPromptCacheTtl, not promptCacheTtl.',
    limitSubagentsPresent:
      'This file also carries {{requests}} across {{threads}}. Version 1 reports the main conversation only; analyzing both caches together is on the roadmap.',
    limitObservedOnly:
      'The log records the observed TTL, never whether it was configured or defaulted.',
    // D21: `inference_geo` is not in the frozen contract, so we cannot detect
    // it per request and the line is unconditional. Stating the direction and
    // the size is the honest version of "we do not model this".
    limitInferenceGeo:
      'Rates here are the standard published ones. Sessions pinned to US-only inference bill about 10% more, and the log does not record that, so those are understated.',
    limitApproximation:
      'Cache entries are modelled as expiring whole, except where the log shows part of a prefix survived. Real caching is finer-grained, and the simplification errs toward making 5 minutes look worse, never better.',
    // Pluralized on the excluded-request count because the verb has to agree.
    limitUnknownModels_one:
      'No published rate for {{models}}, so {{formattedCount}} request is excluded from every dollar figure.',
    limitUnknownModels_other:
      'No published rate for {{models}}, so {{formattedCount}} requests are excluded from every dollar figure.',
    footerPrivacy: 'Read in this browser, never uploaded.',
    footerHowTo: 'How to set promptCacheTtl',
    footerSource: 'Source on GitHub',
  },

  dataPolicy: {
    title: 'Data policy',
    lead: 'This tool has no backend, so there is nowhere for your session log to go. That is not a promise about what we do with your data — it is a statement that we never receive it.',
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
      'A cache entry is treated as all-or-nothing — it either survived the gap or it did not — except where the log shows a prefix partly survived, which is modelled. Real caching is finer-grained still, and every simplification here errs toward making the five-minute setting look worse rather than better, so a verdict of one hour is the conservative one. Requests on a model with no published rate are excluded from the totals and disclosed rather than guessed, and rates are the standard published ones: a session pinned to US-only inference bills about 10% more than shown, which the log does not record.',
    monitorTitle: 'Watching this going forward',
    monitorBody:
      'Claude Code 2.1.251 and later report live cache statistics with the /usage command, which is the right tool for day-to-day monitoring. This one is for deciding the setting in the first place.',
    sourceLink: 'Source on GitHub',

    // Vendor references. The divergences are the point of this section: this
    // tool models Anthropic's first-party 5m/1h choice, and the same choice is
    // not offered identically everywhere, so a reader on Bedrock or Google
    // Cloud needs to know before acting on a verdict.
    referencesTitle: 'Where this comes from',
    referencesBody:
      'The behaviour modelled here is documented by each vendor. Links checked 30 August 2026.',
    refClaudeCode: 'Claude Code — how it uses prompt caching',
    refClaudeCodeNote:
      'Which TTL you get by default: one hour for the main conversation on a subscription within plan usage, five minutes on credits, an API key or a cloud provider. Subagents and compaction get five minutes unless overridden.',
    refAnthropic: 'Anthropic API — prompt caching',
    refAnthropicNote:
      'The five-minute default, refreshed free on each hit, and the one-hour opt-in.',
    refAnthropicPricing: 'Anthropic — pricing',
    refAnthropicPricingNote:
      'The multipliers this tool prices with: 1.25× to write for five minutes, 2× for an hour, 0.1× to read.',
    refBedrock: 'Amazon Bedrock — prompt caching',
    refBedrockNote:
      'Five minutes by default, one hour available on current Claude models. Older ones — Claude 3.7 Sonnet and 3.5 Sonnet v2 — are five-minute only, so a one-hour verdict is not actionable there.',
    refGoogle: 'Google Cloud — prompt caching for Claude',
    refGoogleNote:
      'The same five-minute default and one-hour opt-in, with the same pricing shape. The one-hour TTL is not supported for Claude 3.7 Sonnet, 3.5 Sonnet v2, 3.5 Sonnet or 3 Opus.',
    refOpenai: 'OpenAI — prompt caching',
    refOpenaiNote:
      'For contrast: no five-minute-or-an-hour choice to make. Current models cache for thirty minutes, and that is the only supported value.',

    authorTitle: 'Who made this',
    authorBody:
      'Chris Ebert, a software engineer in Michigan with over fifteen years of experience building cloud applications. He works on govtech at Tyler Technologies, and has previously built software at Lockheed Martin and GE Healthcare — across space, signals intelligence, manufacturing, finance and public safety. He has a computer science degree from the University of Michigan and an MBA from Wayne State.',
    authorBlog: 'chrisebert.net',
    authorX: '@realchrisebert',
  },

  /**
   * Reusable "number + noun" fragments, pluralized on `count` and written by
   * the locale's formatter through `formattedCount`.
   *
   * They exist because i18next selects a plural form from exactly one
   * variable per key (`count`), so a sentence carrying two independent counts
   * — "3 threads, 45 requests" — cannot be pluralized as a single string.
   * Each count becomes a fragment, and the sentence interpolates the finished
   * fragments. Resolve them with `useCounted` (./counted.ts).
   */
  counts: {
    requests_one: '{{formattedCount}} request',
    requests_other: '{{formattedCount}} requests',
    sidechainRequests_one: '{{formattedCount}} sidechain request',
    sidechainRequests_other: '{{formattedCount}} sidechain requests',
    threads_one: '{{formattedCount}} thread',
    threads_other: '{{formattedCount}} threads',
    gaps_one: '{{formattedCount}} gap',
    gaps_other: '{{formattedCount}} gaps',
    tokens_one: '{{formattedCount}} token',
    tokens_other: '{{formattedCount}} tokens',
  },

  common: {
    externalLink: 'opens in a new tab',
  },
} as const
