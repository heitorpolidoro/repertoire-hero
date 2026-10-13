import {
  advance,
  needsSpotifyFacts,
  pickSource,
  stepIndex,
  type PickedSource,
  type QueueSources,
  type SourceKind,
} from '@/lib/setlistPlayer'
import type { SongQueueEntry } from '@/lib/songQueue'
import type { PlaybackFacts } from '@/lib/spotifyPlayback'
import { useSetlistPlayerStore, type StartRequest } from '@/store/setlistPlayerStore'
import type { EngineEvents, EngineFactories, EngineHosts, SetlistEngine } from './types'

/** The server and route reads the player needs, injected by `AppShell` (F21). */
export interface SetlistPlayerActions {
  getSources: (versionId: string) => Promise<QueueSources>
  loadFacts: () => Promise<PlaybackFacts>
}

export interface RuntimeDeps {
  actions: SetlistPlayerActions
  engines: EngineFactories
  /** How long an engine gets to report playing before the browser is taken to have refused. */
  refusalMs: number
}

const store = () => useSetlistPlayerStore.getState()

function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The player did not start')), ms)
    promise.then(
      () => {
        clearTimeout(timer)
        resolve()
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

/**
 * The controller behind the setlist bar (RH-167): owns exactly one active
 * engine at a time, creates engines lazily, and never starts anything but from
 * a start request that a "Play setlist" tap produced. It holds no React state;
 * what the bar shows lives in `useSetlistPlayerStore`.
 */
export class SetlistRuntime {
  private engines: Partial<Record<SourceKind, SetlistEngine>> = {}
  private active: SourceKind | null = null
  private run = 0
  private sources = new Map<string, QueueSources>()
  private facts: Promise<PlaybackFacts | null> | null = null
  private offline = false

  /** The hoisted nodes, handed over by the bar's callback refs; `null` while unmounted. */
  private nodes: { audio: HTMLAudioElement | null; youtube: HTMLElement | null } = { audio: null, youtube: null }
  private readonly hosts: EngineHosts = { audio: () => this.nodes.audio, youtube: () => this.nodes.youtube }

  constructor(private readonly deps: RuntimeDeps) {}

  setAudioNode = (node: HTMLAudioElement | null): void => {
    this.nodes.audio = node
  }

  setYoutubeNode = (node: HTMLElement | null): void => {
    this.nodes.youtube = node
  }

  setOffline(offline: boolean): void {
    this.offline = offline
    if (!offline) return
    // The hoisted nodes unmount while offline: stop and let engines be rebuilt later.
    this.run++
    this.disposeEngines()
    if (store().status === 'playing') store().patch({ status: 'paused' })
  }

  async start({ entries, versionId, bandId }: StartRequest): Promise<void> {
    const index = Math.max(0, entries.findIndex((e) => e.versionId === versionId))
    this.disposeEngines()
    store().begin(entries, index, bandId)
    if (this.offline) {
      store().patch({ status: 'stopped' })
      return
    }
    await this.runFrom(index, 1)
  }

  next(): void {
    this.step(1)
  }

  prev(): void {
    this.step(-1)
  }

  async toggle(): Promise<void> {
    const { status, index } = store()
    const engine = this.active ? this.engines[this.active] : undefined
    if (this.offline) return
    if (status === 'playing') {
      engine?.pause()
      store().patch({ status: 'paused', refused: false })
    } else if (engine && status === 'paused') {
      await this.tryPlay(engine, this.run)
    } else if (status !== 'idle') {
      await this.runFrom(index, 1)
    }
  }

  dismiss(): void {
    this.run++
    this.disposeEngines()
    store().reset()
  }

  dispose(): void {
    this.run++
    this.disposeEngines()
  }

  private step(direction: 1 | -1): void {
    const { index, entries } = store()
    const target = stepIndex(index, entries.length, direction)
    if (target !== null && !this.offline) void this.runFrom(target, direction)
  }

  private disposeEngines(): void {
    Object.values(this.engines).forEach((engine) => engine.dispose())
    this.engines = {}
    this.active = null
  }

  private async fetchSources(entry: SongQueueEntry): Promise<QueueSources> {
    const cached = this.sources.get(entry.versionId)
    if (cached) return cached
    const fetched = await this.deps.actions.getSources(entry.versionId).catch((): QueueSources => ({}))
    this.sources.set(entry.versionId, fetched)
    return fetched
  }

  /** Lazy, one entry at a time; Spotify readiness only when an entry could use it. */
  private async resolve(entry: SongQueueEntry): Promise<PickedSource | null> {
    if (this.offline) return null
    const sources = await this.fetchSources(entry)
    let facts: PlaybackFacts | null = null
    if (needsSpotifyFacts(sources)) {
      this.facts ??= this.deps.actions.loadFacts().catch(() => null)
      facts = await this.facts
    }
    return pickSource({ sources, offline: false, facts })
  }

  private events(kind: SourceKind): EngineEvents {
    const live = (fn: () => void) => () => {
      if (this.active === kind) fn()
    }
    return {
      ended: live(() => void this.runFrom(store().index + 1, 1)),
      error: live(() => {
        // A source that fails is treated like one with no source.
        void this.runFrom(store().index + 1, 1, store().entries[store().index]?.title ?? null)
      }),
      playing: live(() => store().patch({ status: 'playing', refused: false })),
      paused: live(() => {
        if (store().status === 'playing') store().patch({ status: 'paused' })
      }),
    }
  }

  /** The engine for `kind`, created on first need; the previous one is paused on a switch. */
  private engineFor(kind: SourceKind): SetlistEngine | null {
    const previous = this.active ? this.engines[this.active] : undefined
    const switching = this.active !== kind
    this.active = kind
    if (switching) previous?.pause()
    const existing = this.engines[kind]
    if (existing) return existing
    const created = this.deps.engines[kind](this.events(kind), this.hosts)
    if (created) this.engines[kind] = created
    return created
  }

  private async tryPlay(engine: SetlistEngine, run: number): Promise<void> {
    store().patch({ refused: false })
    try {
      await withTimeout(engine.play(), this.deps.refusalMs)
      if (run === this.run) store().patch({ status: 'playing', refused: false })
    } catch {
      // Never retried and never skipped: the musician taps to start this entry.
      if (run !== this.run) return
      engine.pause()
      store().patch({ status: 'paused', refused: true })
    }
  }

  private async load(source: PickedSource): Promise<SetlistEngine | null> {
    const engine = this.engineFor(source.kind)
    if (!engine) return null
    try {
      await engine.load(source)
      return engine
    } catch {
      return null
    }
  }

  private async runFrom(from: number, direction: 1 | -1, skipped: string | null = null): Promise<void> {
    const run = ++this.run
    const { entries } = store()
    store().patch({ skipped, refused: false })
    let start = from
    while (run === this.run) {
      const found = await advance({
        entries,
        from: start,
        direction,
        resolve: (entry) => this.resolve(entry),
        onSkip: (title) => run === this.run && store().patch({ skipped: title }),
      })
      if (run !== this.run) return
      if (!found) {
        if (this.active) this.engines[this.active]?.pause()
        store().patch({ status: 'stopped' })
        return
      }
      store().patch({ index: found.index, kind: found.source.kind })
      const engine = await this.load(found.source)
      if (run !== this.run) return
      if (engine) return this.tryPlay(engine, run)
      store().patch({ skipped: entries[found.index].title })
      const following = stepIndex(found.index, entries.length, direction)
      if (following === null) {
        store().patch({ status: 'stopped' })
        return
      }
      start = following
    }
  }
}
