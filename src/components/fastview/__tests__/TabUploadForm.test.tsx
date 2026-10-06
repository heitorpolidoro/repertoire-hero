// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TabUploadForm } from '../TabUploadForm'

afterEach(cleanup)

function renderForm(overrides: Partial<React.ComponentProps<typeof TabUploadForm>> = {}) {
  const onTitleChange = vi.fn()
  const onFileChange = vi.fn()
  const onSubmit = vi.fn()
  const file = new File(['chart'], 'Rosanna.pdf', { type: 'application/pdf' })
  const view = render(
    <TabUploadForm
      title="Guitar Solo"
      file={file}
      uploading={false}
      error={null}
      inputRef={{ current: null }}
      onTitleChange={onTitleChange}
      onFileChange={onFileChange}
      onSubmit={onSubmit}
      {...overrides}
    />,
  )
  return { ...view, onTitleChange, onFileChange, onSubmit, file }
}

describe('TabUploadForm', () => {
  it('submits without reloading and asks the controller to upload', () => {
    const { onSubmit, container } = renderForm()

    const form = container.querySelector('form') as HTMLFormElement
    const submitted = fireEvent.submit(form)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    // `fireEvent` returns false when a handler called preventDefault().
    expect(submitted).toBe(false)
  })

  it('shows the inline upload error when there is one', () => {
    renderForm({ error: 'File size exceeds the 10MB limit' })

    expect(screen.getByText('File size exceeds the 10MB limit')).toBeDefined()
  })

  it('disables the submit button while no file is selected', () => {
    renderForm({ file: null })

    const button = screen.getByRole('button', { name: 'Upload PDF' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('shows the uploading label and disables the inputs while an upload is running', () => {
    const { container } = renderForm({ uploading: true })

    expect(screen.getByRole('button').textContent).toContain('Uploading...')
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
    const inputs = container.querySelectorAll('input')
    expect([...inputs].every((input) => (input as HTMLInputElement).disabled)).toBe(true)
  })

  /**
   * ER11 (RH-127). RH-127 taught the *action* to ingest images; opening the
   * picker to them is RH-128. Until that lands the picker must stay PDF-only,
   * because an image chosen today would upload successfully and then have
   * nothing in the stage able to render it. So this asserts both halves: the
   * `accept` hint, and that the component's source mentions no image type or
   * image extension anywhere — which is what catches someone widening the hint
   * in a comment-sized edit.
   */
  it('keeps the picker PDF-only until RH-128 (ER11)', () => {
    const { container } = renderForm()

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput.getAttribute('accept')).toBe('application/pdf')

    const source = readFileSync(resolve(__dirname, '../TabUploadForm.tsx'), 'utf8').toLowerCase()
    for (const needle of ['image/', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.avif', '.gif']) {
      expect(source, `TabUploadForm.tsx must not mention ${needle}`).not.toContain(needle)
    }
  })

  it('reports the chosen file to the controller', () => {
    const { onFileChange, onTitleChange, container } = renderForm()

    const titleInput = container.querySelector('input[type="text"]') as HTMLInputElement
    fireEvent.change(titleInput, { target: { value: 'Bass' } })
    expect(onTitleChange).toHaveBeenCalledWith('Bass')

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput.getAttribute('accept')).toBe('application/pdf')

    const picked = new File(['chart'], 'Africa.pdf', { type: 'application/pdf' })
    fireEvent.change(fileInput, { target: { files: [picked] } })
    expect(onFileChange).toHaveBeenCalledWith(picked)

    fireEvent.change(fileInput, { target: { files: [] } })
    expect(onFileChange).toHaveBeenLastCalledWith(null)
  })
})
