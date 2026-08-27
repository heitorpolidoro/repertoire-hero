# RH-14 — Adicionar suporte a i18n (PT-BR e EN) com detecção via navegador e persistência via cookie

## Scope
This task covers implementing internationalization (i18n) for Português (PT-BR) and English (EN) in Repertoire Hero.
It includes:
- Browser language detection via `Accept-Language` request header in server context / middleware and `navigator.language` in client context fallback when no locale cookie is set.
- Cookie-based locale persistence (`NEXT_LOCALE` cookie) updated when user manually changes language.
- Locale provider / helper utility for accessing translation dictionaries in both React Server Components (RSC) and Client Components.
- A Language Selector UI component integrated into the main navigation layout (`src/components/layout/Navbar.tsx` / `AppLayout.tsx`).
- Translation dictionaries for `pt-BR` (`src/i18n/dictionaries/pt-BR.json`) and `en` (`src/i18n/dictionaries/en.json`).
- Unit and integration tests in `src/lib/__tests__/i18n.test.ts` covering locale detection, cookie setting, and dictionary translation resolution.

Explicitly out of scope:
- Translating dynamic user-generated database content (song titles, artist names, personal lyrics).

## Approach
1. **i18n Core Module (`src/lib/i18n.ts` & `src/i18n/`)**:
   - Create JSON translation dictionaries for `pt-BR` and `en`.
   - Implement `getLocale()` helper for Server Components and API context that checks `cookies()`, `headers()` (`Accept-Language`), and defaults to `pt-BR`.
   - Create a client hook/context `useTranslation` or `getDictionary` for accessing translations.
2. **Middleware / Proxy (`src/proxy.ts`)**:
   - Ensure middleware preserves and handles locale cookies or headers without breaking existing session gating.
3. **UI Language Selector (`src/components/layout/LanguageSelector.tsx`)**:
   - Create a dropdown or toggle button component allowing selection between PT-BR and EN.
   - On change, set the `NEXT_LOCALE` cookie (max-age 1 year) and update state or refresh.
   - Add the Language Selector component into `Sidebar.tsx` / `AppLayout.tsx`.
4. **Testing**:
   - Write comprehensive tests in `src/lib/__tests__/i18n.test.ts` using Vitest to verify locale resolution precedence (cookie > header > default), dictionary lookup, and fallback handling.

## Expected Results
- [ ] Application detects browser preferred language (PT-BR or EN) via Accept-Language header or navigator.language when no locale cookie is present
- [ ] Language selector component exists in UI and allows toggling between PT-BR and EN
- [ ] Selecting a language persists choice in a cookie accessible to both client and server components
- [ ] SSR and Server Components respect locale cookie and render translated content accordingly
- [ ] Unit and integration tests pass verifying locale detection, cookie setting, and dictionary translations

## Out of Scope
- Translating user-submitted database data (song titles, artist names, custom notes).
