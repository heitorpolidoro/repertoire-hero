import { describe, it, expect, vi, beforeEach } from 'vitest'

const handleWebhook = vi.fn()
const getPaymentAdapter = vi.fn()
vi.mock('@/lib/billing', () => ({ getPaymentAdapter: () => getPaymentAdapter() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))

import { POST } from '../route'

function webhookRequest(body: string): Request {
  return new Request('http://localhost/api/billing/webhook', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', 'x-mock-signature': 'sig-1' },
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  getPaymentAdapter.mockReturnValue({ provider: 'mock', handleWebhook })
})

describe('POST /api/billing/webhook', () => {
  it('hands the raw body and headers to the active adapter and acknowledges', async () => {
    const body = '{"type":"checkout.completed","sessionId":"mock_cs_monthly_u1"}'
    handleWebhook.mockResolvedValue({ handled: true, eventType: 'checkout.completed' })
    const res = await POST(webhookRequest(body))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
    expect(handleWebhook).toHaveBeenCalledTimes(1)
    const [rawBody, headers] = handleWebhook.mock.calls[0]
    expect(rawBody).toBe(body)
    expect(headers).toMatchObject({ 'content-type': 'application/json', 'x-mock-signature': 'sig-1' })
  })

  it('acknowledges an event the adapter did not act on', async () => {
    handleWebhook.mockResolvedValue({ handled: false, eventType: 'invoice.created' })
    const res = await POST(webhookRequest('{"type":"invoice.created"}'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
  })

  it('answers 400 with a fixed message when the adapter rejects the payload', async () => {
    handleWebhook.mockRejectedValue(new Error('Invalid mock webhook payload'))
    const res = await POST(webhookRequest('nope'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Webhook could not be processed', code: 400 })
  })
})
