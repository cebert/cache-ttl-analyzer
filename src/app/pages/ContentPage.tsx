/**
 * The frame the three prose pages share: a top bar, a readable measure, and a
 * single sheet. Prose sections are `<section>`s with real headings so the
 * pages are navigable by heading, which is how anyone using a screen reader
 * will read a policy.
 */

import type { ReactNode } from 'react'

import { MainPane, TopBar } from '../Shell'
import { Sheet, SheetRule } from '../../ui/Sheet'

export function ContentPage({
  title,
  lead,
  wide = false,
  children,
}: {
  title: string
  lead?: ReactNode
  /**
   * Widen past the reading measure. Prose keeps the 760px measure; a page
   * whose body is a set of side-by-side columns rather than paragraphs needs
   * the room, and squeezing those into a measure meant for sentences is what
   * made the log locations hard to read.
   */
  wide?: boolean
  children: ReactNode
}) {
  return (
    <>
      <TopBar title={title} />
      <MainPane>
        <div
          className={`flex flex-col gap-4 px-4 pt-7 pb-10 sm:px-6 sm:pt-10 ${
            wide ? 'max-w-[1040px]' : 'max-w-[760px]'
          }`}
        >
          <div className="flex flex-col gap-2">
            <h1 className="text-[28px] leading-[1.15] font-semibold tracking-[-0.03em] text-balance">
              {title}
            </h1>
            {lead && <p className="text-[16px] leading-[1.55] text-ink-2">{lead}</p>}
          </div>
          <Sheet>{children}</Sheet>
        </div>
      </MainPane>
    </>
  )
}

/** One titled block of prose inside a content page's sheet. */
export function Prose({
  heading,
  children,
  first = false,
}: {
  heading: string
  children: ReactNode
  first?: boolean
}) {
  return (
    <>
      {!first && <SheetRule />}
      <section className="flex flex-col gap-1.5 p-5 sm:px-6">
        <h2 className="text-[14px] font-semibold text-ink">{heading}</h2>
        <div className="flex flex-col gap-2 text-[14.5px] leading-[1.6] text-ink-2">{children}</div>
      </section>
    </>
  )
}
