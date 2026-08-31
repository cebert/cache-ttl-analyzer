/**
 * The one container shape in the app (WP-D: "one sheet per region, not a card
 * grid"). A sheet is a white panel with a hairline border; regions inside it
 * are separated by rules rather than by gaps, so a page reads as one object.
 *
 * Elevation is deliberately absent — shadows are reserved for dialogs, which
 * makes a shadow mean "modal" everywhere in the app.
 */

import type { ReactNode } from 'react'

export function Sheet({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface ${className}`}
    >
      {children}
    </div>
  )
}

/** A region inside a sheet. Regions after the first draw their own top rule. */
export function SheetSection({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`p-4 sm:px-5 ${className}`}>{children}</div>
}

export function SheetRule() {
  return <div className="h-px shrink-0 bg-line-soft" role="presentation" />
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-[12.5px] font-semibold text-ink">{children}</h2>
}

/** The uppercase mono label used above dense regions. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[10px] font-semibold tracking-[0.1em] text-slate-400 uppercase">
      {children}
    </span>
  )
}

export function Micro({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-[11.5px] leading-[1.5] text-slate-500 ${className}`}>{children}</p>
}
