import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { COOKIE_NAME, getPrivacyCopy, resolveLocale } from '@/lib/i18n'

export const metadata: Metadata = {
  title: 'Privacy Policy — Repertoire Hero',
}

/**
 * RH-160 — the public privacy policy a Play listing requires.
 *
 * Deliberately no session lookup and absent from the `src/proxy.ts` matcher: a
 * reviewer, a crawler or a signed-out visitor must get a 200. The locale comes
 * from the cookie / Accept-Language, exactly like the signed-in home's banner.
 */
export default async function PrivacyPage() {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()])
  const copy = getPrivacyCopy(
    resolveLocale({
      cookieValue: cookieStore.get(COOKIE_NAME)?.value,
      acceptLanguage: headerStore.get('accept-language'),
    }),
  )

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-bold text-gray-900">{copy.title}</h1>
      {copy.sections.map((section) => (
        <section key={section.heading} className="mt-8">
          <h2 className="text-xl font-semibold text-gray-900">{section.heading}</h2>
          <p className="mt-2 text-sm leading-relaxed text-gray-700">{section.body}</p>
        </section>
      ))}
    </main>
  )
}
