import { describe, it, expect } from 'vitest'
import { scrubAuthorizationHeader } from '../sentryScrub'

describe('sentryScrub', () => {
  it('removes Authorization and authorization headers while keeping other headers', () => {
    const event = {
      request: {
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer rh_pat_secret1234567890abcdefghijklmnopqrstuvwxyz',
          'x-custom-header': 'value',
        },
      },
    }

    const scrubbed = scrubAuthorizationHeader(event)
    expect(scrubbed.request?.headers).toEqual({
      'Content-Type': 'application/json',
      'x-custom-header': 'value',
    })
  })

  it('removes lowercase authorization and mixed-case headers', () => {
    const event = {
      request: {
        headers: {
          authorization: 'Bearer rh_pat_lowercase',
          AUTHORIZATION: 'Bearer rh_pat_uppercase',
          accept: 'application/json',
        },
      },
    }

    const scrubbed = scrubAuthorizationHeader(event)
    expect(scrubbed.request?.headers).toEqual({
      accept: 'application/json',
    })
  })

  it('handles events without request or headers safely', () => {
    expect(scrubAuthorizationHeader({})).toEqual({})
    expect(scrubAuthorizationHeader({ request: {} })).toEqual({ request: {} })
  })
})
