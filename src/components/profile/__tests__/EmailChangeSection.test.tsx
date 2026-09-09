// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

import { EmailChangeSection, type EmailChangeActions } from '../EmailChangeSection'

afterEach(cleanup)

const CURRENT = 'jane@example.com'
const NEW = 'moved@example.com'
/** A second fixture address, standing in for one that already has an account. */
const TAKEN = 'someone-else@example.com'

function makeActions(overrides: Partial<EmailChangeActions> = {}) {
  return {
    requestEmailChange: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as EmailChangeActions & { requestEmailChange: ReturnType<typeof vi.fn> }
}

function setup(actions = makeActions()) {
  render(<EmailChangeSection currentEmail={CURRENT} actions={actions} />)
  return { actions }
}

const field = () => screen.getByLabelText('Email') as HTMLInputElement
const changeButton = () => screen.getByRole('button', { name: 'Change' }) as HTMLButtonElement
const type = (value: string) => fireEvent.change(field(), { target: { value } })
const bodyText = () => document.body.textContent ?? ''

describe('EmailChangeSection', () => {
  it('starts on the current address with the submit button disabled', () => {
    setup()

    expect(field().value).toBe(CURRENT)
    expect(changeButton().disabled).toBe(true)
  })

  it('keeps the button disabled when the field is emptied', () => {
    setup()

    type('   ')

    expect(changeButton().disabled).toBe(true)
  })

  it('promises the mail before it is requested, naming the address that stays', () => {
    setup()

    type(NEW)

    expect(changeButton().disabled).toBe(false)
    expect(bodyText()).toContain(
      `We will email a confirmation link to ${NEW}. Your sign-in address stays ${CURRENT} until you open it.`,
    )
  })

  it('renders the pending copy after a successful request and keeps the current address as the sign-in one', async () => {
    const { actions } = setup()

    type(NEW)
    fireEvent.click(changeButton())

    await waitFor(() => expect(actions.requestEmailChange).toHaveBeenCalledWith(NEW))
    expect(bodyText()).toContain(
      `Confirmation link sent to ${NEW}. Your sign-in address is still ${CURRENT} and only changes when you open that link.`,
    )
    expect(bodyText()).toContain('check your spam folder')
  })

  it('renders the same copy for an address that already belongs to someone else', async () => {
    // No mail is ever sent in that case (`update-user.mjs` L431-435). The UI
    // must not be able to tell the two apart, or it becomes the enumeration
    // oracle the server side avoids - which is also why the recourse line
    // exists: it is the only guidance the user gets.
    const { actions } = setup()

    type(TAKEN)
    fireEvent.click(changeButton())

    await waitFor(() => expect(actions.requestEmailChange).toHaveBeenCalledWith(TAKEN))
    expect(bodyText()).toContain(
      `Confirmation link sent to ${TAKEN}. Your sign-in address is still ${CURRENT} and only changes when you open that link.`,
    )
    expect(bodyText()).toContain('check your spam folder')
  })

  it('reads Sending... while the request is in flight', async () => {
    let release: (() => void) | undefined
    const actions = makeActions({
      requestEmailChange: vi.fn(() => new Promise<void>((resolve) => { release = resolve })),
    })
    setup(actions)

    type(NEW)
    fireEvent.click(changeButton())

    const pending = await screen.findByRole('button', { name: 'Sending...' })
    expect((pending as HTMLButtonElement).disabled).toBe(true)

    release!()
    await waitFor(() => expect(bodyText()).toContain('Confirmation link sent to'))
  })

  it('surfaces a rejection in an error banner and renders no pending copy', async () => {
    const actions = makeActions({
      requestEmailChange: vi.fn().mockRejectedValue(new Error('Enter a valid email address')),
    })
    setup(actions)

    type('not-an-email@x')
    fireEvent.click(changeButton())

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined())
    expect(screen.getByRole('alert').textContent).toContain('Enter a valid email address')
    expect(bodyText()).not.toContain('Confirmation link sent to')
  })

  it('clears a previous failure when the next request succeeds', async () => {
    const requestEmailChange = vi
      .fn()
      .mockRejectedValueOnce(new Error('Enter a valid email address'))
      .mockResolvedValueOnce(undefined)
    setup(makeActions({ requestEmailChange }))

    type('not-an-email@x')
    fireEvent.click(changeButton())
    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined())

    type(NEW)
    fireEvent.click(changeButton())

    await waitFor(() => expect(bodyText()).toContain('Confirmation link sent to'))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
