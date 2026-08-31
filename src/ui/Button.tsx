/**
 * The three button weights from the WP-D control sheet: a filled primary, an
 * outlined secondary, and a bare ghost. Buttons size to their content and are
 * never given a fixed width — a translated label runs ~30% longer than the
 * English one and must not clip (docs/PLAN.md, D10).
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-strong',
  secondary: 'border border-line bg-surface text-ink hover:bg-ground',
  ghost: 'text-slate-500 hover:bg-ground hover:text-ink',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-[30px] px-[13px] text-[12.5px]',
  md: 'h-[34px] px-[15px] text-[13px]',
  lg: 'h-[46px] px-5 text-[15px]',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  children: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 items-center justify-center gap-[7px] rounded-[6px] font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
