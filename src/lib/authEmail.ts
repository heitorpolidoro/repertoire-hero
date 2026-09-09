import { logger } from '@/lib/logger'

/**
 * RH-42 — the one place the app sends an authentication email.
 *
 * Before RH-42 this plumbing lived inline in the password-reset callback of
 * `src/lib/auth.ts`, which was the only mail flow. The change-email flow adds
 * two more (the confirmation to the current address and the verification to the
 * new one), so the template and the provider handling live here once instead of
 * being copied twice - three copies of a 20-line HTML literal would be a jscpd
 * clone, and a template drift between "reset your password" and "confirm your
 * new address" is exactly the kind of divergence that goes unnoticed.
 */
export interface AuthEmail {
  /** Recipient. Which address this is differs per flow and is the caller's decision. */
  to: string
  subject: string
  /** e.g. `Hello, Jane!` */
  greeting: string
  /** One sentence of context, above the button. */
  body: string
  /** Button text, e.g. `Reset password`. */
  ctaLabel: string
  /** The link the button points at. */
  url: string
  /** Closing line, e.g. the "you can ignore this" reassurance. */
  footnote: string
}

/**
 * Escapes text destined for an HTML *text node*.
 *
 * Same three replacements, in the same order, as `parseLyricsMarkdown` in
 * `src/lib/lyricsMarkdown.ts` - `&` first, so an escaped entity is never
 * double-escaped. That helper is not reused directly because it goes on to
 * render mini-markdown, which has no business in a mail template.
 *
 * `"` and `'` are deliberately left alone here: inside a text node they cannot
 * end a tag, and the footnote is English prose full of apostrophes. Attribute
 * values get the stricter `escapeHtmlAttribute` below.
 */
function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Escapes text destined for a double-quoted HTML *attribute value*.
 *
 * Adds both quote characters on top of the text-node escapes, so a value can
 * never close the attribute and start a new one (`" onmouseover="...`).
 */
function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/**
 * The app's transactional-mail template. Pure, so it is unit-testable on its own.
 *
 * Every interpolated field is escaped, because every one of them is or can
 * become user-influenced: `greeting` embeds `user.name`, which Better Auth
 * validates as no more than `z.string()`. Since this task lets the change-email
 * flow mail an address the submitter picked, an unescaped name would deliver
 * attacker-authored markup inside a genuinely-sent, branded email. The house
 * rule from `parseLyricsMarkdown` holds here too: user text can never introduce
 * markup.
 */
export function renderAuthEmail(email: AuthEmail): string {
  const greeting = escapeHtmlText(email.greeting)
  const body = escapeHtmlText(email.body)
  const ctaLabel = escapeHtmlText(email.ctaLabel)
  const footnote = escapeHtmlText(email.footnote)
  const url = escapeHtmlAttribute(email.url)

  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
      <h2 style="color: #059669; margin-top: 0;">Repertoire Hero</h2>
      <p>${greeting}</p>
      <p>${body}</p>
      <div style="margin: 24px 0;">
        <a href="${url}" style="background-color: #059669; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">${ctaLabel}</a>
      </div>
      <p style="color: #6b7280; font-size: 14px;">${footnote}</p>
      <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
      <p style="color: #9ca3af; font-size: 12px;">This link will expire shortly.</p>
    </div>
  `
}

/**
 * Sends `email` through Resend, or echoes it to the console when no provider is
 * configured.
 *
 * The `console.log` echo is one of the two deliberate exceptions to the
 * "never write to the console" rule in AGENTS.md's error-handling section: it is
 * not an error report, it is the local development path (this repo's
 * `.env.local` carries no `RESEND_API_KEY`), and it must not become a Sentry
 * breadcrumb because the URL it prints is a single-use credential.
 *
 * A provider failure is swallowed and reported through `logger.error` - never
 * rethrown. Better Auth awaits these callbacks, so a rejection would surface as
 * a 500 on `/forget-password` and, on `/change-email`, as an observable
 * difference between the taken and the free address.
 */
export async function sendAuthEmail(email: AuthEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.EMAIL_FROM || 'onboarding@resend.dev'

  if (!apiKey) {
    console.log(`[AUTH] ${email.subject} for ${email.to}`)
    console.log(`[AUTH] URL: ${email.url}`)
    return
  }

  try {
    const { Resend } = await import('resend')
    const resend = new Resend(apiKey)
    await resend.emails.send({
      from: fromEmail,
      to: email.to,
      subject: email.subject,
      html: renderAuthEmail(email),
    })
  } catch (error) {
    logger.error(
      'Failed to send auth email',
      error instanceof Error ? error : new Error(String(error)),
    )
  }
}
