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

export function getDictionary(locale: Locale) {
  return dictionaries[locale] || dictionaries[DEFAULT_LOCALE]
}
