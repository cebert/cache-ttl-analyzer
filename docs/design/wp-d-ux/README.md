# WP-D — UX design

Visual direction and screen designs for cache-ttl-analyzer. Signed off 2026-08-30.

**Canvas:** <https://claude.ai/code/artifact/db848d95-b475-4f61-9984-a843c2ec9b09>
(pan/zoom, two pages: *Screens* and *System & localization*; PNG/PDF export from
the toolbar).

The `.dc.html` files here are the artboard sources — plain HTML with inline
styles, openable in a browser on their own. `canvas.json` is the layout
manifest. Implement against these, not against a screenshot: every value below
is in the markup.

---

## Screens

| File | Screen |
|---|---|
| `Upload.dc.html` | Landing — add a session, samples, find-your-logs, privacy. Sidebar in its empty state |
| `Analyzing.dc.html` | Progress + cancel, with the in-flight session showing progress in the sidebar |
| `Main.dc.html` | Results |
| `MobileUpload.dc.html` | Landing at 390px |
| `MobileResults.dc.html` | Results at 390px |
| `Palette.dc.html` | Design tokens, type ramp, controls, standard dialog, Tailwind mapping |
| `Expansion.dc.html` | Results in German — text-expansion stress test |

## Layout

**Persistent left sidebar, 236px.** *Add session* button, the session list, then
the standing links (Find your logs / Data policy / About) pinned to the bottom
above a memory-only notice. Each session row carries id, project, chosen TTL and
saving. The active row is tinted `#EFF4FE`, never given a left accent bar. A
session being analyzed shows a 3px progress bar inside its row.

There is no separate history table — the sidebar *is* the history. On mobile the
sidebar collapses to a horizontal chip strip under the header.

**One sheet per region, not a card grid.** A region is a single white sheet
(`#FFFFFF`, 1px `#D9E2EC`, radius 10) divided internally by `#E8EEF4` rules.
Results is one sheet: verdict band → session totals → session details → cache
timeline → limits. Shadows appear only on dialogs, so elevation always means
modal.

**Order follows what matters:** the recommendation and the dollar saving, then
the six totals (cache hit rate, cache reads, cache writes, input tokens, output
tokens, error rate), then identification, then behaviour, then caveats.

## Color

Neutral by default; each accent owns exactly one meaning.

| Token | Hex | Tailwind | Meaning |
|---|---|---|---|
| background | `#F7F9FC` | extend | app ground |
| surface | `#FFFFFF` | `white` | sheets |
| verdict band | `#F4F7FE` | extend | the one tinted region |
| line | `#D9E2EC` | extend | sheet borders |
| line-soft | `#E8EEF4` | extend | rules inside a sheet |
| ink | `#172033` | extend | headings, figures |
| ink-2 | `#3D4B60` | extend | body copy |
| muted | `#64748B` | `slate-500` | secondary text |
| faint | `#94A3B8` | `slate-400` | labels, warm-read ticks |
| primary | `#2563EB` | `blue-600` | interaction, links, the recommendation, the 1h series |
| indigo | `#6366F1` | `indigo-500` | cache expiries, CHANGED badge |
| green | `#059669` | `emerald-600` | money saved |
| amber | `#D97706` | `amber-600` | validation warnings |
| red | `#DC2626` | `red-600` | failed requests, rejected files |

Seven of these map to stock Tailwind — the five semantic accents plus the two
neutral text colors, `slate-500` and `slate-400`. The six marked *extend* need
`theme.extend.colors`, because this ground and ink are cooler and bluer than
Tailwind's slate.

Accent tints, all defined alongside rather than reaching for `blue-50` and its
siblings, which are warmer than this ground: `#EFF4FE` blue, `#EEEFFE` indigo,
`#FDF4E7` amber, `#FCEBEB` red, and `#E7F5F0` green. The green tint is reserved
— green currently appears only at full strength on the saving figure — so it is
on the token sheet but not yet on any screen.

No gradients, glow, animation or neon. Radius 10 on sheets, 6 on controls, 4 on
badges.

## Type

**IBM Plex Sans** for interface and prose, **IBM Plex Mono** for every figure,
identifier, path and model name — with `font-variant-numeric: tabular-nums` on
all of them. Both are open-licensed and **must be self-hosted**: the strict CSP
(§2 of the plan) admits no external font host, and the canvas only loads them
from Google Fonts because it is a preview.

Ramp: verdict 46–52/600 (`-0.032em`) · metric 23/500 · section title 12.5/600 ·
body 13/1.55 · micro 11.5 · eyebrow 10/600 uppercase mono `0.1em`.

## Copy

Everything on screen is computed locally. Gap counts are timestamp deltas
bucketed at 300s and 3600s; error rate is the share of `<synthetic>` rows
(feasibility §6.2). No model is involved and none is needed.

Prose is deliberately thin: one interpolated sentence carries the reasoning
("11 of 49 gaps fell between 5 minutes and 1 hour"), and everything else is
label and number. That sentence is a locale string with a count — plural-form
aware, per the i18n requirement.

## Localization

`Expansion.dc.html` is the same results screen in German: ~30–40% longer
strings, comma decimals, trailing currency symbol, and much longer metric labels
in the six-column grid. Rules the layout follows so translation stays a
translation task:

- No fixed-width label columns that can clip.
- Buttons, badges and chips size to their content.
- The verdict is allowed to wrap to two lines (`text-wrap: balance`).
- No text inside a proportionally-sized bar, since its width is data-driven and
  a translated label cannot be guaranteed to fit. The one place a label sits
  inside a bar is the desktop cache-lifetime segment strip, where segments are
  wide enough and the text is clipped with `overflow: hidden`; below ~700px that
  strip drops its inline labels and moves them to a legend beneath
  (see `MobileResults.dc.html`).
- All numbers, currency, dates and durations through `Intl`, keyed to locale.

The German copy is a layout stress test, not shippable translation.

## Known gaps

- Not designed yet: the About page, the data policy page body, and the
  "not a session log" rejection state (the *valid with warnings* state is
  shown on `Main.dc.html`; danger tokens exist for the rejection).
- The subagent section (`subagentPromptCacheTtl`) appears only as the
  "not evaluated" line — the two-bucket layout needs a real subagent fixture
  from WP-06 before it can be designed honestly.
- Sample session values are illustrative and roughly reconciled, not engine
  output.
