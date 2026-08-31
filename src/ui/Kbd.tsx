/**
 * A keystroke, drawn as a key.
 *
 * The instructions for finding a session log turn on one shortcut per
 * platform, and a shortcut written inline as plain text ("press ⌘ + Shift + G")
 * is the part readers skim past. Giving each key its own outline makes the
 * sequence the most visible thing in the sentence, which is what it is.
 */

import type { ReactNode } from 'react'

// `children` is optional because `Trans` clones this element to wrap the
// text inside each <kbd> tag in the catalog, and so constructs it bare.
export function Kbd({ children }: { children?: ReactNode }) {
  return (
    <kbd className="mx-[1px] inline-flex h-[21px] min-w-[21px] items-center justify-center rounded-[5px] border border-line bg-surface px-[5px] align-[-4px] font-mono text-[12px] font-semibold text-ink shadow-[0_1px_0_var(--color-line)]">
      {children}
    </kbd>
  )
}
