import { describe, it, expect } from 'vitest'
import {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  COOKIE_NAME,
  parseAcceptLanguage,
  resolveLocale,
  getDictionary,
  getBandIndicatorCopy,
  getBandIndicatorCopies,
  resolveBrowserLocale,
} from '../i18n'

describe('i18n module', () => {
  describe('constants', () => {
    it('should define supported locales and default locale', () => {
      expect(SUPPORTED_LOCALES).toContain('pt-BR')
      expect(SUPPORTED_LOCALES).toContain('en')
      expect(DEFAULT_LOCALE).toBe('pt-BR')
      expect(COOKIE_NAME).toBe('NEXT_LOCALE')
    })
  })

  describe('parseAcceptLanguage', () => {
    it('should match pt-BR when header requests Portuguese', () => {
      expect(parseAcceptLanguage('pt-BR,pt;q=0.9,en-US;q=0.8')).toBe('pt-BR')
      expect(parseAcceptLanguage('pt')).toBe('pt-BR')
    })

    it('should match en when header requests English', () => {
      expect(parseAcceptLanguage('en-US,en;q=0.9,pt-BR;q=0.8')).toBe('en')
      expect(parseAcceptLanguage('en')).toBe('en')
    })

    it('should fallback to DEFAULT_LOCALE when header is empty or unsupported', () => {
      expect(parseAcceptLanguage(null)).toBe('pt-BR')
      expect(parseAcceptLanguage('')).toBe('pt-BR')
      expect(parseAcceptLanguage('fr-FR,fr;q=0.9')).toBe('pt-BR')
    })
  })

  describe('resolveLocale', () => {
    it('should prioritize cookie value if valid', () => {
      expect(resolveLocale({ cookieValue: 'en', acceptLanguage: 'pt-BR' })).toBe('en')
      expect(resolveLocale({ cookieValue: 'pt-BR', acceptLanguage: 'en-US' })).toBe('pt-BR')
    })

    it('should fallback to acceptLanguage header if cookie is missing or invalid', () => {
      expect(resolveLocale({ cookieValue: null, acceptLanguage: 'en-US' })).toBe('en')
      expect(resolveLocale({ cookieValue: 'invalid-lang', acceptLanguage: 'en-US' })).toBe('en')
    })

    it('should fallback to DEFAULT_LOCALE if neither cookie nor acceptLanguage matches', () => {
      expect(resolveLocale({ cookieValue: null, acceptLanguage: null })).toBe('pt-BR')
      expect(resolveLocale({ cookieValue: undefined, acceptLanguage: 'de-DE' })).toBe('pt-BR')
    })
  })

  describe('getBandIndicatorCopy (RH-180)', () => {
    it('returns the Portuguese band-mode copy for pt-BR', () => {
      expect(getBandIndicatorCopy('pt-BR')).toEqual({ label: 'Modo banda', exit: 'Sair' })
    })

    it('returns the English band-mode copy for en', () => {
      expect(getBandIndicatorCopy('en')).toEqual({ label: 'Band mode', exit: 'Exit' })
    })

    it('hands every supported locale its copy in one map', () => {
      expect(getBandIndicatorCopies()).toEqual({
        'pt-BR': getBandIndicatorCopy('pt-BR'),
        en: getBandIndicatorCopy('en'),
      })
    })
  })

  describe('resolveBrowserLocale (RH-180)', () => {
    it('reads the NEXT_LOCALE cookie out of a document.cookie string', () => {
      expect(resolveBrowserLocale('a=1; NEXT_LOCALE=en; b=2', ['pt-BR'])).toBe('en')
      expect(resolveBrowserLocale('NEXT_LOCALE=pt-BR', ['en-US'])).toBe('pt-BR')
    })

    it('falls back to the browser languages when the cookie is absent or invalid', () => {
      expect(resolveBrowserLocale('', ['en-US', 'pt-BR'])).toBe('en')
      expect(resolveBrowserLocale('NEXT_LOCALE=fr', ['pt-PT'])).toBe('pt-BR')
    })

    it('falls back to the default locale when nothing matches', () => {
      expect(resolveBrowserLocale('', [])).toBe('pt-BR')
      expect(resolveBrowserLocale('other=x', ['de-DE'])).toBe('pt-BR')
    })
  })

  describe('getDictionary', () => {
    it('should return dictionary object for pt-BR', () => {
      const dict = getDictionary('pt-BR')
      expect(dict).toBeDefined()
      expect(dict.common).toBeDefined()
      expect(dict.common.appName).toBe('Repertoire Hero')
    })

    it('should return dictionary object for en', () => {
      const dict = getDictionary('en')
      expect(dict).toBeDefined()
      expect(dict.common).toBeDefined()
      expect(dict.common.appName).toBe('Repertoire Hero')
    })
  })
})
