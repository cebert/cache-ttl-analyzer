/**
 * A small tinted label. Each tone maps to the one meaning its accent owns on
 * the WP-D palette sheet, so a badge's color is never decorative.
 */

import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'primary' | 'indigo' | 'amber' | 'red' | 'green'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-line-soft text-ink-2',
  primary: 'bg-primary-tint text-primary',
  indigo: 'bg-indigo-tint text-indigo-600',
  amber: 'bg-amber-tint text-amber-ink',
  red: 'bg-red-tint text-red-ink',
  green: 'bg-green-tint text-green',
}

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex h-[21px] shrink-0 items-center rounded-[4px] px-2 font-mono text-[11.5px] font-semibold ${TONES[tone]}`}
    >
      {children}
    </span>
  )
}
