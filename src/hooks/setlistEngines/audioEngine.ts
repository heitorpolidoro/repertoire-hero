import type { EngineFactory } from './types'

/** Drives the hoisted `<audio>` element; the same node serves every file entry. */
export const createAudioEngine: EngineFactory = (events, hosts) => {
  const el = hosts.audio()
  if (!el) return null

  const onEnded = () => events.ended()
  const onError = () => events.error()
  const onPlaying = () => events.playing()
  const onPause = () => {
    if (!el.ended) events.paused()
  }
  el.addEventListener('ended', onEnded)
  el.addEventListener('error', onError)
  el.addEventListener('playing', onPlaying)
  el.addEventListener('pause', onPause)

  return {
    async load(source) {
      if (source.kind !== 'file') throw new Error('Not a file source')
      el.src = source.url
      el.load()
    },
    async play() {
      await el.play()
    },
    pause: () => el.pause(),
    dispose() {
      el.pause()
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('error', onError)
      el.removeEventListener('playing', onPlaying)
      el.removeEventListener('pause', onPause)
    },
  }
}
