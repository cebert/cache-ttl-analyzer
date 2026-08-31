/**
 * i18n foundation (docs/PLAN.md, D10). MVP ships English only, but nothing
 * about the wiring is English-specific: adding a language means adding a
 * catalog file and a `resources` entry, not touching a component.
 *
 * Why react-i18next rather than a hand-rolled `t`: plural selection,
 * fallbacks and the React re-render on language change are all things a
 * translator-facing project eventually needs, and the ecosystem's tooling
 * (extraction, translation-management imports) speaks this format.
 *
 * The catalog is a TypeScript module rather than JSON so `CustomTypeOptions`
 * below can make keys and interpolation variables compile-time checked — a
 * missing key in a future locale is a type error, not a runtime fallback.
 */

import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'

import { en } from './en'

export const DEFAULT_LOCALE = 'en'
export const SUPPORTED_LOCALES = [DEFAULT_LOCALE] as const

export const NAMESPACE = 'app'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof NAMESPACE
    resources: { app: typeof en }
  }
}

void i18next.use(initReactI18next).init({
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  defaultNS: NAMESPACE,
  ns: [NAMESPACE],
  resources: { en: { app: en } },
  // React escapes every interpolated value on render, and nothing in this app
  // is injected as HTML (log-derived strings are rendered as text nodes only,
  // docs/PLAN.md §2), so i18next's own escaping would only double-encode.
  interpolation: { escapeValue: false },
  returnNull: false,
})

export default i18next
