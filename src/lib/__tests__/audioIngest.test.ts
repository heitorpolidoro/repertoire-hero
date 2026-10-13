import { describe, it, expect } from 'vitest'
import { sniffAudioContentType, storedAudioFileName } from '@/lib/audioIngest'
import { validateAudioFile } from '@/lib/audioLibrary'

const pad = (head: number[]) => Buffer.concat([Buffer.from(head), Buffer.alloc(16)])

describe('sniffAudioContentType', () => {
  it('reads an ID3-tagged file as MP3', () => {
    expect(sniffAudioContentType(Buffer.from('ID3\x04\x00 padding.....'))).toBe('audio/mpeg')
  })
  it('reads an MPEG frame sync as MP3', () => {
    expect(sniffAudioContentType(pad([0xff, 0xfb, 0x90, 0x00]))).toBe('audio/mpeg')
  })
  it('refuses a sync pattern with reserved layer bits', () => {
    expect(sniffAudioContentType(pad([0xff, 0xf9, 0x90, 0x00]))).toBeNull()
  })
  it('reads an ftyp box at offset 4 as M4A', () => {
    expect(sniffAudioContentType(Buffer.from([0, 0, 0, 0x20, ...Buffer.from('ftypM4A '), 0, 0, 0, 0]))).toBe(
      'audio/mp4',
    )
  })
  it('refuses a too-short buffer, a PDF and a WAV', () => {
    expect(sniffAudioContentType(Buffer.from('ID'))).toBeNull()
    expect(sniffAudioContentType(Buffer.from('%PDF-1.4 hello'))).toBeNull()
    expect(sniffAudioContentType(Buffer.from('RIFF....WAVEfmt '))).toBeNull()
  })
})

describe('storedAudioFileName', () => {
  it('sanitises and swaps the extension for the real one', () => {
    expect(storedAudioFileName('my song (1).wav', 'audio/mpeg')).toBe('my_song__1_.mp3')
    expect(storedAudioFileName('take.mp3', 'audio/mp4')).toBe('take.m4a')
    expect(storedAudioFileName('.mp3', 'audio/mpeg')).toBe('upload.mp3')
  })
})

describe('validateAudioFile', () => {
  it('refuses over 10MB and allows exactly 10MB', () => {
    expect(validateAudioFile({ size: 10 * 1024 * 1024 }).ok).toBe(true)
    expect(validateAudioFile({ size: 10 * 1024 * 1024 + 1 }).ok).toBe(false)
  })
})
