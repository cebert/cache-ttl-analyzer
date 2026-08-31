/**
 * The icon set, inline. Icons are markup rather than an image or font because
 * the CSP forbids external assets and an inline SVG inherits `currentColor`,
 * so an icon can never drift from the text it sits beside.
 *
 * Paths are lifted from the WP-D artboards (docs/design/wp-d-ux) so the shipped
 * shapes are the designed ones. Every icon is `aria-hidden`: each one in this
 * app accompanies a visible label, so announcing it would only repeat.
 */

import type { SVGProps } from 'react'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & { size?: number }

function Icon({
  size = 16,
  strokeWidth = 1.8,
  children,
  ...props
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export function ClockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2V12l3.4 2.1" />
    </Icon>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon strokeWidth={2.1} {...props}>
      <path d="M12 5.5v13M5.5 12h13" />
    </Icon>
  )
}

export function FileUpIcon(props: IconProps) {
  return (
    <Icon strokeWidth={1.4} {...props}>
      <path d="M14 3.2H7.4A1.9 1.9 0 0 0 5.5 5.1v13.8a1.9 1.9 0 0 0 1.9 1.9h9.2a1.9 1.9 0 0 0 1.9-1.9V7.7Z" />
      <path d="M14 3.2v4.5h4.5" />
      <path d="M12 17.2v-5.6" />
      <path d="M9.7 13.9 12 11.6l2.3 2.3" />
    </Icon>
  )
}

export function ShieldCheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.6 5.2 6.2v5.2c0 4 2.8 7.2 6.8 8.6 4-1.4 6.8-4.6 6.8-8.6V6.2Z" />
      <path d="M9.4 12 11.3 13.9l3.5-3.7" />
    </Icon>
  )
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <Icon strokeWidth={2} {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M8.6 12.2 11 14.6l4.4-4.6" />
    </Icon>
  )
}

export function SpinnerIcon(props: IconProps) {
  return (
    <Icon strokeWidth={2} {...props}>
      <path d="M12 3.6v3.2" />
      <path d="M12 17.2v3.2" />
      <path d="M20.4 12h-3.2" />
      <path d="M6.8 12H3.6" />
      <path d="M17.9 6.1 15.7 8.3" />
      <path d="M8.3 15.7 6.1 17.9" />
    </Icon>
  )
}

export function AlertCircleIcon(props: IconProps) {
  return (
    <Icon strokeWidth={1.9} {...props}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 8v4.6" />
      <path d="M12 16.2h.01" />
    </Icon>
  )
}

export function FolderIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6.2A1.7 1.7 0 0 1 5.7 4.5h4.1l2 2.4h6.5A1.7 1.7 0 0 1 20 8.6v9.7a1.7 1.7 0 0 1-1.7 1.7H5.7A1.7 1.7 0 0 1 4 18.3Z" />
    </Icon>
  )
}

export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9" y="9" width="11" height="11" rx="1.8" />
      <path d="M15 5.6A1.6 1.6 0 0 0 13.4 4H5.6A1.6 1.6 0 0 0 4 5.6v7.8A1.6 1.6 0 0 0 5.6 15" />
    </Icon>
  )
}

export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7.5h16" />
      <path d="M4 12h16" />
      <path d="M4 16.5h16" />
    </Icon>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 6.5l11 11" />
      <path d="M17.5 6.5l-11 11" />
    </Icon>
  )
}
