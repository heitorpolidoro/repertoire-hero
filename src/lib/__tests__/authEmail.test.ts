/**
 * RH-42 — the single auth-mail sender.
 *
 * `sendAuthEmail` is the extraction of the Resend/dev-echo plumbing that used
 * to live inline in the password-reset callback of `src/lib/auth.ts`, and it now
 * serves all three auth mails (password reset, change-email confirmation,
 * new-address verification). The behaviour asserted here is the behaviour that
 * file had at 890a27b, verbatim:
 * with no `RESEND_API_KEY` the URL is echoed to `console.log` and nothing is
 * sent (that is the local path in this repo, not a fallback — `.env.local`
 * carries no key), and a provider failure is swallowed through `logger.error`
 * so a mail outage can never become a 500 or an enumeration oracle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { resendCtor, sendMock } = vi.hoisted(() => {
  const sendMock = vi.fn()
  // `new Resend(key)` — an arrow function cannot be constructed, so the mock is
  // a `function` whose returned object wins over the fresh `this`.
  const resendCtor = vi.fn(function ResendMock() {
    return { emails: { send: sendMock } }
  })
  return { resendCtor, sendMock }
})

vi.mock('resend', () => ({ Resend: resendCtor }))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { renderAuthEmail, sendAuthEmail, type AuthEmail } from '../authEmail'
import { logger } from '@/lib/logger'

const EMAIL: AuthEmail = {
  to: 'jane@example.com',
  subject: 'Confirm your new Repertoire Hero email',
  greeting: 'Hello, Jane!',
  body: 'Open the link below to confirm the address.',
  ctaLabel: 'Confirm new email',
  url: 'https://example.com/api/auth/verify-email?token=abc123',
  footnote: "If you didn't request this, you can safely ignore this email.",
}

const ORIGINAL_KEY = process.env.RESEND_API_KEY
const ORIGINAL_FROM = process.env.EMAIL_FROM

beforeEach(() => {
  resendCtor.mockClear()
  sendMock.mockReset()
  sendMock.mockResolvedValue({ data: { id: 'mail-1' }, error: null })
  vi.mocked(logger.error).mockClear()
  delete process.env.RESEND_API_KEY
  delete process.env.EMAIL_FROM
})

afterEach(() => {
  vi.restoreAllMocks()
  if (ORIGINAL_KEY === undefined) delete process.env.RESEND_API_KEY
  else process.env.RESEND_API_KEY = ORIGINAL_KEY
  if (ORIGINAL_FROM === undefined) delete process.env.EMAIL_FROM
  else process.env.EMAIL_FROM = ORIGINAL_FROM
})

describe('renderAuthEmail', () => {
  it('embeds the URL and the CTA label in the rendered body', () => {
    const html = renderAuthEmail(EMAIL)

    expect(html).toContain(EMAIL.url)
    expect(html).toContain(EMAIL.ctaLabel)
    expect(html).toContain(EMAIL.greeting)
    expect(html).toContain(EMAIL.body)
    expect(html).toContain(EMAIL.footnote)
  })

  /**
   * The greeting carries `user.name`, which Better Auth validates as nothing
   * more than `z.string()` at sign-up. Since RH-42 the change-email flow mails
   * the verification to an address the submitter chose, so an unescaped name
   * would put attacker-authored markup — their own `<a href>` — inside a
   * genuinely-sent, branded Repertoire Hero email delivered anywhere. Same rule
   * as `parseLyricsMarkdown`: user text can never introduce markup.
   */
  it('escapes markup in the greeting so a hostile name cannot introduce tags', () => {
    // The payload's raw `<` is what matters, not its handler body: the usual
    // `onerror=alert(1)` spelling would trip the repo-wide native-dialog guard
    // in `noBrowserDialogs.test.ts`, which greps all of `src/` for `alert(`.
    const html = renderAuthEmail({
      ...EMAIL,
      greeting: 'Hello, <img src=x onerror=steal>!',
    })

    expect(html).toContain('&lt;img src=x onerror=steal&gt;')
    expect(html).not.toContain('<img')
  })

  it('escapes markup in the body, CTA label and footnote', () => {
    const html = renderAuthEmail({
      ...EMAIL,
      body: '<script>a</script>',
      ctaLabel: '<b>Click</b>',
      footnote: 'Tom & <i>Jerry</i>',
    })

    expect(html).not.toContain('<script')
    expect(html).not.toContain('<b>')
    expect(html).not.toContain('<i>')
    expect(html).toContain('&lt;script&gt;a&lt;/script&gt;')
    expect(html).toContain('&lt;b&gt;Click&lt;/b&gt;')
    expect(html).toContain('Tom &amp; &lt;i&gt;Jerry&lt;/i&gt;')
  })

  it('leaves a normal URL untouched in the CTA href', () => {
    const href = renderAuthEmail(EMAIL).match(/href="([^"]*)"/)?.[1]

    expect(href).toBe(EMAIL.url)
  })

  it('escapes quotes and ampersands so a URL cannot break out of the href', () => {
    const html = renderAuthEmail({
      ...EMAIL,
      url: 'https://x.test/?t=1&c=/" onmouseover="steal',
    })

    const href = html.match(/href="([^"]*)"/)?.[1]
    expect(href).toBe('https://x.test/?t=1&amp;c=/&quot; onmouseover=&quot;steal')
  })
})

describe('sendAuthEmail with no provider configured', () => {
  it('resolves, echoes the URL to console.log and never constructs a Resend client', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(sendAuthEmail(EMAIL)).resolves.toBeUndefined()

    const printed = log.mock.calls.map((call) => call.join(' ')).join('\n')
    expect(printed).toContain(EMAIL.url)
    expect(printed).toContain(EMAIL.to)
    expect(resendCtor).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
  })
})

describe('sendAuthEmail with a provider configured', () => {
  it('sends exactly once with the recipient, subject, default from and the URL in the HTML', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await sendAuthEmail(EMAIL)

    expect(resendCtor).toHaveBeenCalledTimes(1)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const payload = sendMock.mock.calls[0][0] as {
      from: string
      to: string
      subject: string
      html: string
    }
    expect(payload.to).toBe(EMAIL.to)
    expect(payload.subject).toBe(EMAIL.subject)
    expect(payload.from).toBe('onboarding@resend.dev')
    expect(payload.html).toContain(EMAIL.url)
    expect(log).not.toHaveBeenCalled()
  })

  it('uses EMAIL_FROM as the sender when it is set', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    process.env.EMAIL_FROM = 'noreply@repertoirehero.app'

    await sendAuthEmail(EMAIL)

    const payload = sendMock.mock.calls[0][0] as { from: string }
    expect(payload.from).toBe('noreply@repertoirehero.app')
  })

  it('resolves and reports through logger.error when the send rejects', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    sendMock.mockRejectedValue(new Error('Resend is down'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(sendAuthEmail(EMAIL)).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledTimes(1)
    const [message, error] = vi.mocked(logger.error).mock.calls[0]
    expect(message).toContain('Failed to send auth email')
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Resend is down')
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('narrows a non-Error rejection into an Error before logging it', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    sendMock.mockRejectedValue('string failure')

    await expect(sendAuthEmail(EMAIL)).resolves.toBeUndefined()

    const [, error] = vi.mocked(logger.error).mock.calls[0]
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('string failure')
  })
})
