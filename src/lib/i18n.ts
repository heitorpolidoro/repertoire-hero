import ptBRDict from '../i18n/dictionaries/pt-BR.json'
import enDict from '../i18n/dictionaries/en.json'

export const SUPPORTED_LOCALES = ['pt-BR', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'pt-BR'
export const COOKIE_NAME = 'NEXT_LOCALE'

const dictionaries: Record<Locale, typeof ptBRDict> = {
  'pt-BR': ptBRDict,
  en: enDict,
}

export function isSupportedLocale(locale: string | null | undefined): locale is Locale {
  if (!locale) return false
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale)
}

export function parseAcceptLanguage(acceptLanguageHeader: string | null | undefined): Locale {
  if (!acceptLanguageHeader) return DEFAULT_LOCALE

  const languages = acceptLanguageHeader
    .split(',')
    .map((lang) => {
      const [code, priority] = lang.trim().split(';q=')
      return {
        code: code.trim().toLowerCase(),
        quality: priority ? parseFloat(priority) : 1.0,
      }
    })
    .sort((a, b) => b.quality - a.quality)

  for (const lang of languages) {
    if (lang.code.startsWith('en')) {
      return 'en'
    }
    if (lang.code.startsWith('pt')) {
      return 'pt-BR'
    }
  }

  return DEFAULT_LOCALE
}

export function resolveLocale(options: {
  cookieValue?: string | null
  acceptLanguage?: string | null
}): Locale {
  const { cookieValue, acceptLanguage } = options

  if (cookieValue && isSupportedLocale(cookieValue)) {
    return cookieValue
  }

  return parseAcceptLanguage(acceptLanguage)
}

/** The signed-in home's correction-outcome banner copy (RH-111). */
export type SuggestionOutcomeCopy = typeof enDict.suggestionOutcomes

/**
 * Banner copy for the signed-in home, resolved on the server and handed to the
 * banner as a prop. It is deliberately not a `getDictionary` call site: the
 * application UI is not dictionary-driven (AGENTS.md, "Internationalisation"),
 * and this one block of copy is the single, spec-mandated exception, so the
 * client component never reads a dictionary itself.
 */
export function getSuggestionOutcomeCopy(locale: Locale): SuggestionOutcomeCopy {
  return (dictionaries[locale] || dictionaries[DEFAULT_LOCALE]).suggestionOutcomes
}

/** The public `/privacy` page copy (RH-160); same server-resolved exception as above. */
export function getPrivacyCopy(locale: Locale): typeof enDict.privacy {
  return (dictionaries[locale] || dictionaries[DEFAULT_LOCALE]).privacy
}

/** The band-mode indicator copy (RH-180). */
export type BandIndicatorCopy = typeof enDict.bandIndicator

/** The band-mode indicator's label and Exit text; same server-resolved exception as above. */
export function getBandIndicatorCopy(locale: Locale): BandIndicatorCopy {
  return (dictionaries[locale] || dictionaries[DEFAULT_LOCALE]).bandIndicator
}

/**
 * Every locale's indicator copy, built by the static root layout (RH-180).
 *
 * The root layout cannot read `cookies()` or `headers()`: that would make every
 * route dynamic, and `/offline` must stay prerendered for the service worker's
 * precache (RH-78). So the server hands down both locales' copy - two short
 * strings each - and the client picks one with `resolveBrowserLocale`.
 */
export function getBandIndicatorCopies(): Record<Locale, BandIndicatorCopy> {
  return { 'pt-BR': getBandIndicatorCopy('pt-BR'), en: getBandIndicatorCopy('en') }
}

/**
 * The browser-side twin of `resolveLocale`: the `NEXT_LOCALE` cookie read out of
 * a `document.cookie` string, then `navigator.languages`, then the default.
 */
export function resolveBrowserLocale(cookieString: string, languages: readonly string[]): Locale {
  const cookieValue = cookieString
    .split(';')
    .map((pair) => pair.trim().split('='))
    .find(([name]) => name === COOKIE_NAME)?.[1]
  return resolveLocale({ cookieValue, acceptLanguage: languages.join(',') })
}

export function getDictionary(locale: Locale) {
  return dictionaries[locale] || dictionaries[DEFAULT_LOCALE]
}
