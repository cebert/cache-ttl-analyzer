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
    headline: 'Should your sessions cache for five minutes, or an hour?',
    subhead:
      'Drop in a session log and find out. You will see what it would have cost either way, and what made the difference. Nothing leaves this page.',
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
    title: 'Or try one of these',
    meta: '{{requests}} requests over {{span}} · {{hitRate}} from cache',
    badge5m: '5 minutes wins',
    badge1h: '1 hour wins',
    badgeResets: '{{count}} resets',
    loadFailed: 'That one would not load. Reload the page and try again.',
    // Sample names are our copy, not log-derived, so they are translatable
    // strings like everything else. WP-06 captures the sessions these name;
    // a sample it adds under a new id adds its name here too.
    // Consumed by `SampleSession.nameKey`; WP-06 adds the sessions these name.
    names: {
      realSession: 'A real 85-minute session',
      tightLoop: 'Back-to-back requests',
      gapHeavy: 'Long pauses between requests',
      gapHeavy5m: 'Long pauses, cached for 5 minutes',
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
    fileNameTitle: 'Which file is which',
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
    recommendationEyebrow: 'Recommendation',
    recommendation5m: 'Use the 5-minute cache',
    recommendation1h: 'Use the 1-hour cache',
    recommendationNone: 'No verdict for this session',
    // The verdict headline colors the TTL alone, so it is interpolated
    // rather than split in the component — a translation is free to put the
    // highlighted phrase wherever its grammar wants it.
    ttl5m: '5 minutes',
    ttl1h: '1 hour',
    savedEyebrow: 'You would have saved',
    savedComparison: '{{percent}} less than {{other}}',
    noDifference: 'Both settings would have cost the same here. Either is fine.',
    scenarioCostLabel: 'Cost at {{ttl}}',
    // `count` drives plural selection; `formatted` is the same number through
    // `Intl`, so a five-figure gap count still reads with separators.
    bandSentence_one:
      '{{formatted}} of {{total}} gaps fell between 5 minutes and 1 hour — the only band where the setting changes anything.',
    bandSentence_other:
      '{{formatted}} of {{total}} gaps fell between 5 minutes and 1 hour — the only band where the setting changes anything.',
    bandSentenceNone:
      'No gap fell between 5 minutes and 1 hour, the only band where the setting changes anything.',
    ratesNote: 'Notional, at published API rates · {{date}}',
    ratesWhy: 'What does that mean?',
    suppressedTitle: 'Too much of this session has no published price',
    suppressedBody:
      'Making a recommendation would mean guessing at what some of these requests cost, so we are not making one. The figures below cover only the part we could price.',
    metrics: {
      hitRate: 'Cache hit rate',
      hitRateDetail: '{{warm}} of {{total}} requests',
      reads: 'Cache reads',
      readsDetail: 'billed at 0.1×',
      writes: 'Cache writes',
      writesAll1h: 'at 2× — all 1 hour',
      writesAll5m: 'at 1.25× — all 5 minutes',
      writesMixed: 'mixed, {{share}} at 1 hour',
      writesNone: 'none written',
      input: 'Input tokens',
      inputDetail: 'never cached',
      output: 'Output tokens',
      outputDetail: 'thinking included',
      errorRate: 'Error rate',
      errorRateDetail_one: '{{formatted}} failed',
      errorRateDetail_other: '{{formatted}} failed',
      exactTokens_one: '{{formatted}} token',
      exactTokens_other: '{{formatted}} tokens',
    },
    details: {
      directory: 'Directory',
      branch: 'Branch',
      span: 'Span',
      observedTtl: 'Observed TTL',
      model: 'Model',
      effort: 'Effort',
      version: 'Claude Code',
      requests: 'Requests',
      subagents: 'Subagents',
      changed: 'CHANGED',
      notRecorded: 'not recorded',
      observedAll1h: '1 hour, every write',
      observedAll5m: '5 minutes, every write',
      observedMixed: 'mixed — {{share}} at 1 hour',
      observedNone: 'no cache writes',
      spanValue: '{{start}} – {{end}}',
      spanSameDay: '{{date}}, {{start}} – {{end}}',
      requestsValue_one: '{{formatted}} priced',
      requestsValue_other: '{{formatted}} priced',
      requestsSkipped: '{{priced}} · {{skipped}} skipped',
      subagentsNone: 'none in this file',
      subagentsCount_one: '{{formatted}} thread',
      subagentsCount_other: '{{formatted}} threads',
      changedFromTo: '{{from}} → {{to}}',
    },
    timeline: {
      title: 'Cache timeline',
      legendWarm: 'warm read',
      legendExpiry: 'expiry at 5 minutes',
      legendReset: 'reset',
      caption:
        'Each column is a slice of the session. The tall marks are where a five-minute cache would have gone cold; an hour-long cache goes cold at some of the same points, never more.',
      unavailable: 'This session was too short to plot — everything happened at once.',
      configStripLabel: 'Model and effort over the session',
      resetsTitle: 'Cache resets',
      resetsNone: 'None. The model, effort and version stayed the same throughout.',
      resetNote: 'A reset throws the cache away and rebuilds it, and costs the same either way.',
      resetCauseModel: 'model',
      resetCauseEffort: 'effort',
      resetCauseVersion: 'version',
      gapsTitle: 'Gaps between requests',
      gapsNone: 'Only one request, so there are no gaps to measure.',
      gapUnder5m: 'under 5 minutes',
      gapBand: '5 minutes – 1 hour',
      gapOver1h: 'over 1 hour',
    },
    subagentTitle: 'Subagent traffic',
    subagentLead:
      'This session also ran subagents, which Claude Code caches under a separate setting. Here is that half on its own.',
    limits: {
      title: 'Limits of this analysis',
      noSidechain:
        'This file has no subagent traffic, so subagentPromptCacheTtl was not looked at. Subagents keep their own logs.',
      observedNotConfigured:
        'The log shows which cache setting was used, but never whether you chose it or it was the default.',
      provablyExplicit:
        'The two settings differed, which only happens when someone sets them deliberately.',
      allOrNothing:
        'A cache entry is treated as either surviving a gap or not, with nothing in between. That errs toward making 5 minutes look worse, not better.',
      unknownModels_one:
        'No published rate for {{models}}. {{count}} request is excluded from every dollar figure.',
      unknownModels_other:
        'No published rate for {{models}}. {{count}} requests are excluded from every dollar figure.',
    },
    footer: {
      privacy: 'Read here in your browser. Never uploaded.',
      about: 'How this is worked out',
      source: 'Source on GitHub',
    },
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
    authorTitle: 'Who made this',
    authorBody:
      'Chris Ebert, a software engineer in Michigan with over fifteen years of experience building cloud applications. He works on govtech at Tyler Technologies, and has previously built software at Lockheed Martin and GE Healthcare — across space, signals intelligence, manufacturing, finance and public safety. He has a computer science degree from the University of Michigan and an MBA from Wayne State.',
    authorBlog: 'chrisebert.net',
    authorX: '@realchrisebert',
  },

  common: {
    externalLink: 'opens in a new tab',
  },
} as const
