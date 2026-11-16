import { NextResponse } from 'next/server'
import { getPaymentAdapter } from '@/lib/billing'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// POST /api/billing/webhook (RH-202)
// The one provider-agnostic payment event endpoint. It holds no session: the
// caller is the payment provider, and authenticating the event (signature
// check) is the adapter's job, from the raw body and headers passed through
// untouched. The body is read as text so a signature over the exact bytes
// still verifies.
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  const rawBody = await request.text()
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  try {
    const adapter = getPaymentAdapter()
    await adapter.handleWebhook(rawBody, headers)
    return NextResponse.json({ received: true })
  } catch (error) {
    logger.error('[billing/webhook]', error instanceof Error ? error : undefined)
    return NextResponse.json({ error: 'Webhook could not be processed', code: 400 }, { status: 400 })
  }
}
