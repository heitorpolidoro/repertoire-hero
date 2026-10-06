/**
 * RH-127 — unit suite for `src/lib/fileIngest.ts`.
 *
 * `sharp` is used for real here (it is installed and is a direct dependency as
 * of this task); the fixtures are generated in-test rather than committed as
 * binaries, so what is asserted is always what this environment's codec
 * actually produces. Random noise is the fixture of choice for the bound tests
 * because it is the only content whose size cannot be argued away: a codec that
 * silently got better would still not compress it.
 *
 * The one case no real image can produce — over the byte bound even at the
 * 512px floor — is covered at the bottom of the file by stubbing `sharp`
 * itself, which is also how the "ladder exhausted at 2048px, re-resize" path is
 * reached (no real JPEG of ours is over 2MB at 2048px at quality 40).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { randomFillSync } from 'node:crypto'
import sharp from 'sharp'

/**
 * libvips defaults its thread pool to the core count, and the fixtures below
 * are deliberately large. Left alone, one worker running this file saturates
 * every core and the jsdom suites running beside it miss their 5 s timeouts —
 * so the budget is pinned to one thread here. It says nothing about production,
 * where an upload is one request and the parallelism is wanted.
 */
sharp.concurrency(1)

import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_EDGE_PX,
  MIN_IMAGE_EDGE_PX,
  IMAGE_DECODE_MESSAGE,
  IMAGE_TOO_LARGE_MESSAGE,
  UNSUPPORTED_UPLOAD_MESSAGE,
  prepareUploadBytes,
  sniffUploadContentType,
  storedFileName,
} from '../fileIngest'

const PDF_BYTES = Buffer.from('%PDF-1.4\nminimal chart\n%%EOF\n', 'latin1')

type ImageFormat = 'jpeg' | 'png' | 'webp'

/** The three accepted image families, as (content type, sharp format) pairs. */
const IMAGE_FAMILIES = [
  ['image/jpeg', 'jpeg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
] as const

/**
 * Fixtures are encoded at maximum fidelity so nothing the ingest is asked to
 * assert is an artefact of the fixture's own lossy pass.
 */
async function encodeAtBestQuality(
  pipeline: ReturnType<typeof sharp>,
  format: ImageFormat,
): Promise<Buffer> {
  if (format === 'png') return pipeline.png().toBuffer()
  if (format === 'webp') return pipeline.webp({ lossless: true }).toBuffer()
  return pipeline.jpeg({ quality: 100 }).toBuffer()
}

/** An incompressible image of `width`x`height`, encoded in `format`. */
async function noiseImage(width: number, height: number, format: ImageFormat): Promise<Buffer> {
  const raw = randomFillSync(Buffer.allocUnsafe(width * height * 3))
  return encodeAtBestQuality(sharp(raw, { raw: { width, height, channels: 3 } }), format)
}

/** A flat-colour image, cheap to produce when the content does not matter. */
async function flatImage(width: number, height: number, format: ImageFormat): Promise<Buffer> {
  return encodeAtBestQuality(
    sharp({ create: { width, height, channels: 3, background: { r: 180, g: 40, b: 40 } } }),
    format,
  )
}

/** The dimensions every rotation fixture below starts at — deliberately non-square. */
const FIXTURE_WIDTH = 200
const FIXTURE_HEIGHT = 100

/**
 * A non-square fixture, optionally carrying an EXIF Orientation tag. All three
 * families can carry one: JPEG in its APP1 segment, PNG in an `eXIf` chunk,
 * WebP in an `EXIF` chunk — so all three can arrive from a phone rotated, and
 * all three are covered below.
 */
async function orientedImage(format: ImageFormat, orientation?: number): Promise<Buffer> {
  const created = sharp({
    create: {
      width: FIXTURE_WIDTH,
      height: FIXTURE_HEIGHT,
      channels: 3,
      background: { r: 180, g: 40, b: 40 },
    },
  })
  return encodeAtBestQuality(
    orientation === undefined ? created : created.withMetadata({ orientation }),
    format,
  )
}

/** A recognisable string planted in the EXIF, searched for in the output bytes. */
const EXIF_NEEDLE = 'RH-127-must-not-survive'

const XMP_PACKET =
  '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>' +
  '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF ' +
  'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
  `<dc:creator><rdf:Seq><rdf:li>${EXIF_NEEDLE}</rdf:li></rdf:Seq></dc:creator>` +
  '</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="r"?>'

/**
 * The same fixture, carrying every metadata block `sharp` is able to write: an
 * Orientation tag, an EXIF IFD0 `Copyright`, an EXIF **GPS** block (the one
 * this whole task exists for), a Display-P3 ICC profile and an XMP packet.
 */
async function taggedImage(format: ImageFormat): Promise<Buffer> {
  const created = sharp({
    create: {
      width: FIXTURE_WIDTH,
      height: FIXTURE_HEIGHT,
      channels: 3,
      background: { r: 180, g: 40, b: 40 },
    },
  })
    .withMetadata({
      orientation: 6,
      exif: {
        IFD0: { Copyright: EXIF_NEEDLE },
        GPS: { GPSLatitudeRef: 'N', GPSLatitude: '51/1 30/1 0/1' },
      },
    })
    .withIccProfile('p3')
    .withXmp(XMP_PACKET)

  return encodeAtBestQuality(created, format)
}

async function longestEdge(bytes: Buffer): Promise<number> {
  const { width = 0, height = 0 } = await sharp(bytes).metadata()
  return Math.max(width, height)
}

describe('the two bounds are literals of this task (ER5)', () => {
  it('exports 2048px, a 512px floor and 2MB', () => {
    expect(MAX_IMAGE_EDGE_PX).toBe(2048)
    expect(MIN_IMAGE_EDGE_PX).toBe(512)
    expect(MAX_IMAGE_BYTES).toBe(2 * 1024 * 1024)
  })
})

describe('sniffUploadContentType reads the leading magic bytes (ER2)', () => {
  it('accepts the %PDF- signature', () => {
    expect(sniffUploadContentType(PDF_BYTES)).toBe('application/pdf')
  })

  it('accepts the FF D8 FF JPEG signature', async () => {
    expect(sniffUploadContentType(await flatImage(8, 8, 'jpeg'))).toBe('image/jpeg')
  })

  it('accepts the 89 50 4E 47 0D 0A 1A 0A PNG signature', async () => {
    expect(sniffUploadContentType(await flatImage(8, 8, 'png'))).toBe('image/png')
  })

  it('accepts RIFF....WEBP', async () => {
    expect(sniffUploadContentType(await flatImage(8, 8, 'webp'))).toBe('image/webp')
  })

  it('rejects a buffer matching no signature', () => {
    expect(sniffUploadContentType(Buffer.from('GIF89a and then some', 'latin1'))).toBeNull()
  })

  it('rejects a RIFF container that is not WEBP (a .wav, say)', () => {
    const riff = Buffer.alloc(32)
    riff.write('RIFF', 0, 'latin1')
    riff.write('WAVE', 8, 'latin1')
    expect(sniffUploadContentType(riff)).toBeNull()
  })

  it('rejects a buffer shorter than any signature without throwing', () => {
    expect(sniffUploadContentType(Buffer.from([0xff]))).toBeNull()
  })
})

describe('prepareUploadBytes', () => {
  it('passes a PDF through byte-identical (ER9)', async () => {
    const prepared = await prepareUploadBytes(PDF_BYTES, 'application/pdf')

    expect(prepared.contentType).toBe('application/pdf')
    expect(prepared.bytes.equals(PDF_BYTES)).toBe(true)
  })

  it('refuses a buffer whose content type was never recognised', async () => {
    await expect(
      prepareUploadBytes(PDF_BYTES, null as unknown as 'application/pdf'),
    ).rejects.toThrow(UNSUPPORTED_UPLOAD_MESSAGE)
  })

  it('surfaces a decode failure as a validation error', async () => {
    // A valid JPEG signature over bytes that are not a JPEG.
    const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64, 0x41)])

    await expect(prepareUploadBytes(corrupt, 'image/jpeg')).rejects.toThrow(IMAGE_DECODE_MESSAGE)
  })

  // ER3/ER4 run over all three families, not just JPEG. A phone hands over
  // whichever the camera app chose, and PNG and WebP both carry an EXIF chunk,
  // so a strip or a bake that worked for only one of the three would be a
  // silent hole in exactly the two formats nobody tested.
  it.each(IMAGE_FAMILIES)(
    'bakes the EXIF rotation into %s pixels (ER3)',
    async (contentType, format) => {
      const tagged = await taggedImage(format)

      const input = await sharp(tagged).metadata()
      expect([input.width, input.height]).toEqual([FIXTURE_WIDTH, FIXTURE_HEIGHT])
      expect(input.orientation).toBe(6)

      const prepared = await prepareUploadBytes(tagged, contentType)
      const output = await sharp(prepared.bytes).metadata()

      // Width and height swapped relative to the input: the rotation is in the
      // pixels, not in a flag a future renderer could read differently.
      expect([output.width, output.height]).toEqual([input.height, input.width])
      expect(output.orientation).toBeUndefined()
      expect(output.format).toBe(format)
    },
    30_000,
  )

  // The counterpart, and not implied by the case above: `.rotate()` applied
  // unconditionally would turn an upright photo on its side. `never upscales`
  // cannot catch that — a 90-degree turn preserves the longest edge — so the
  // dimensions are asserted in order here, for an absent tag and for an
  // explicit Orientation 1.
  it.each(
    IMAGE_FAMILIES.flatMap(([contentType, format]) =>
      [undefined, 1].map((orientation) => [format, orientation, contentType] as const),
    ),
  )(
    'leaves an upright %s (orientation %s) at its original dimensions (ER3)',
    async (format, orientation, contentType) => {
      const upright = await orientedImage(format, orientation)

      const prepared = await prepareUploadBytes(upright, contentType)
      const output = await sharp(prepared.bytes).metadata()

      expect([output.width, output.height]).toEqual([FIXTURE_WIDTH, FIXTURE_HEIGHT])
      expect(output.orientation).toBeUndefined()
    },
    30_000,
  )

  it.each(IMAGE_FAMILIES)(
    'strips every metadata block from %s, EXIF/GPS included (ER4)',
    async (contentType, format) => {
      const tagged = await taggedImage(format)

      // The fixture really carries each block the assertions below check for,
      // so none of them is vacuous. `iptc` is the exception and is deliberately
      // *not* asserted: sharp's writers are `withExif`, `withIccProfile` and
      // `withXmp` — there is no IPTC writer, so no fixture this suite can build
      // would carry one, and an `expect(meta.iptc).toBeUndefined()` would pass
      // against an implementation that strips nothing. IPTC is covered by
      // mechanism rather than by assertion: sharp carries *no* block over
      // unless `withMetadata`/`keepMetadata` is called, this module calls
      // neither, and the three blocks that can be planted prove that default is
      // in force.
      const input = await sharp(tagged).metadata()
      expect(input.exif).toBeDefined()
      expect(input.icc).toBeDefined()
      expect(input.xmp).toBeDefined()
      expect(input.orientation).toBe(6)

      const prepared = await prepareUploadBytes(tagged, contentType)
      const meta = await sharp(prepared.bytes).metadata()

      expect(meta.exif).toBeUndefined()
      expect(meta.icc).toBeUndefined()
      expect(meta.xmp).toBeUndefined()
      expect(meta.orientation).toBeUndefined()

      // Not just "sharp does not parse one out of it": the planted payload is
      // not in the stored bytes at all, in any container or encoding sharp
      // might have moved it to.
      expect(prepared.bytes.includes(Buffer.from(EXIF_NEEDLE, 'latin1'))).toBe(false)
    },
    30_000,
  )

  it('downscales an oversized, incompressible photo under both bounds (ER6)', async () => {
    const source = await noiseImage(4000, 3000, 'jpeg')

    // The input really is over both bounds, so the assertions below prove a
    // downscale happened rather than restating the input.
    expect(await longestEdge(source)).toBeGreaterThan(2048)
    expect(source.length).toBeGreaterThan(2097152)

    const prepared = await prepareUploadBytes(source, 'image/jpeg')

    expect(await longestEdge(prepared.bytes)).toBeLessThanOrEqual(2048)
    expect(prepared.bytes.length).toBeLessThanOrEqual(2097152)
    expect(prepared.contentType).toBe('image/jpeg')

    // The ceiling is applied on the *first* attempt, not arrived at by the
    // halving loop. 2048 is not any halving of 4000, so these exact dimensions
    // are only reachable by clamping to `MAX_IMAGE_EDGE_PX` — which is what
    // makes this assertion, and not only the stubbed walk below, pin the
    // ceiling. Dropping the clamp lands this fixture at 2000x1500 instead.
    const { width, height } = await sharp(prepared.bytes).metadata()
    expect([width, height]).toEqual([2048, 1536])
  }, 60_000)

  it('keeps a PNG a PNG when its lossless rung reaches the bound', async () => {
    const source = await flatImage(900, 600, 'png')

    const prepared = await prepareUploadBytes(source, 'image/png')

    expect(prepared.contentType).toBe('image/png')
    expect((await sharp(prepared.bytes).metadata()).format).toBe('png')
  }, 30_000)

  it('falls back to the JPEG ladder when PNG lossless cannot reach the bound', async () => {
    const source = await noiseImage(2048, 1536, 'png')
    expect(source.length).toBeGreaterThan(MAX_IMAGE_BYTES)

    const prepared = await prepareUploadBytes(source, 'image/png')

    expect(prepared.contentType).toBe('image/jpeg')
    expect((await sharp(prepared.bytes).metadata()).format).toBe('jpeg')
    expect(prepared.bytes.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES)
  }, 60_000)

  it('keeps a WebP a WebP', async () => {
    const source = await flatImage(300, 200, 'webp')

    const prepared = await prepareUploadBytes(source, 'image/webp')

    expect(prepared.contentType).toBe('image/webp')
    expect((await sharp(prepared.bytes).metadata()).format).toBe('webp')
  }, 30_000)

  it('never upscales an image already inside the edge bound', async () => {
    const source = await flatImage(640, 480, 'jpeg')

    const prepared = await prepareUploadBytes(source, 'image/jpeg')

    expect(await longestEdge(prepared.bytes)).toBe(640)
  }, 30_000)
})

describe('storedFileName maps the extension onto what was produced (ER8)', () => {
  it.each([
    ['my chart!.pdf', 'application/pdf', 'my_chart_.pdf'],
    ['photo.HEIC', 'image/jpeg', 'photo.jpg'],
    ['scan.jpeg', 'image/png', 'scan.png'],
    ['stand shot.jpg', 'image/webp', 'stand_shot.webp'],
    ['no-extension', 'application/pdf', 'no-extension.pdf'],
    ['.hidden', 'image/jpeg', 'upload.jpg'],
  ] as const)('maps %s + %s to %s', (name, contentType, expected) => {
    expect(storedFileName(name, contentType)).toBe(expected)
  })
})

/**
 * The terminal case. No real image of ours is over 2MB at 2048px at quality 40,
 * so the re-resize and the eventual refusal are reached by stubbing the encoder
 * instead of by pretending some fixture does it. The stub records every edge it
 * was asked for, which is what makes "it halved, then halved again, then
 * stopped at the floor" an assertion rather than a claim.
 */
describe('the byte bound is never violated when the ladder is exhausted (ER7)', () => {
  const OVER_BOUND = MAX_IMAGE_BYTES + 1

  /**
   * The ladder each family is expected to walk at one edge, as
   * `<format>@<quality>` rungs in order. This is what pins the spec's
   * legibility-first rule: the quality is lowered all the way down *before* the
   * dimension is touched, because an illegible chart is a worse failure than a
   * large file. Shortening `LOSSY_QUALITIES` in the module under test — to
   * `[82]`, say — would halve the edge of a chart that quality 40 would have
   * fitted, and fails here.
   */
  const LADDER_QUALITIES = [82, 70, 60, 50, 40]
  const EXPECTED_LADDER: Record<string, string[]> = {
    'image/jpeg': LADDER_QUALITIES.map((quality) => `jpeg@${quality}`),
    'image/webp': LADDER_QUALITIES.map((quality) => `webp@${quality}`),
    // PNG's one lossless rung, then the JPEG ladder — which is also what
    // changes the stored content type.
    'image/png': ['png@lossless', ...LADDER_QUALITIES.map((quality) => `jpeg@${quality}`)],
  }

  afterEach(() => {
    vi.doUnmock('sharp')
    vi.resetModules()
  })

  async function withStubbedEncoder(
    sizeFor: (edge: number) => number,
    metadata: () => Promise<{ width?: number; height?: number }> = async () => ({
      width: 4000,
      height: 3000,
    }),
  ) {
    const edges: number[] = []
    /** One entry per encode attempt: the edge it ran at and the rung it used. */
    const attempts: Array<{ edge: number; rung: string }> = []
    vi.resetModules()
    vi.doMock('sharp', () => {
      const stub = () => {
        let edge = Number.POSITIVE_INFINITY
        const record = (format: string, options?: { quality?: number }) => {
          attempts.push({ edge, rung: `${format}@${options?.quality ?? 'lossless'}` })
          return pipeline
        }
        const pipeline = {
          rotate: () => pipeline,
          resize: ({ width }: { width: number }) => {
            edge = width
            edges.push(width)
            return pipeline
          },
          jpeg: (options?: { quality?: number }) => record('jpeg', options),
          png: (options?: { quality?: number }) => record('png', options),
          webp: (options?: { quality?: number }) => record('webp', options),
          metadata,
          toBuffer: async () => Buffer.alloc(sizeFor(edge)),
        }
        return pipeline
      }
      return { default: stub, concurrency: () => 1 }
    })
    const mod = await import('../fileIngest')
    return { edges, attempts, prepare: mod.prepareUploadBytes }
  }

  it.each(['image/jpeg', 'image/png', 'image/webp'] as const)(
    'walks the whole %s ladder at the ceiling before halving the edge',
    async (contentType) => {
      const { edges, attempts, prepare } = await withStubbedEncoder((edge) =>
        edge >= MAX_IMAGE_EDGE_PX ? OVER_BOUND : 4096,
      )

      const prepared = await prepare(Buffer.from('fake'), contentType)

      expect(prepared.bytes.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES)

      // Every rung of the family's ladder, in order, at the ceiling …
      const expected = EXPECTED_LADDER[contentType]
      expect(
        attempts.filter((attempt) => attempt.edge === MAX_IMAGE_EDGE_PX).map((a) => a.rung),
      ).toEqual(expected)
      // … and not one attempt below the ceiling until all of them are spent.
      expect(attempts.findIndex((attempt) => attempt.edge < MAX_IMAGE_EDGE_PX)).toBe(
        expected.length,
      )

      expect(edges[0]).toBe(MAX_IMAGE_EDGE_PX)
      // The rung that succeeded asked for a strictly smaller edge than 2048.
      expect(edges[edges.length - 1]).toBe(1024)
      expect(edges[edges.length - 1]).toBeLessThan(MAX_IMAGE_EDGE_PX)
    },
  )

  it('refuses the upload when even the 512px floor is over the bound', async () => {
    const { edges, attempts, prepare } = await withStubbedEncoder(() => OVER_BOUND)

    await expect(prepare(Buffer.from('fake'), 'image/jpeg')).rejects.toThrow(
      IMAGE_TOO_LARGE_MESSAGE,
    )

    // 2048 -> 1024 -> 512, and then it stops: the floor is a floor.
    expect([...new Set(edges)]).toEqual([MAX_IMAGE_EDGE_PX, 1024, MIN_IMAGE_EDGE_PX])
    expect(Math.min(...edges)).toBe(MIN_IMAGE_EDGE_PX)
    expect(edges.every((edge) => edge >= MIN_IMAGE_EDGE_PX)).toBe(true)

    // The full ladder is walked at every edge, floor included.
    const expected = EXPECTED_LADDER['image/jpeg']
    expect(
      attempts.filter((attempt) => attempt.edge === MIN_IMAGE_EDGE_PX).map((a) => a.rung),
    ).toEqual(expected)
    expect(attempts).toHaveLength(expected.length * 3)
  })

  // A decoder that answers without dimensions is not a decoder we can bound
  // an image with, so it is a decode failure like any other rather than a
  // silent `Math.max(0, 0)` resize to nothing.
  it('treats an image reporting no dimensions as a decode failure', async () => {
    const { prepare } = await withStubbedEncoder(
      () => 1,
      async () => ({ width: 0, height: 0 }),
    )

    await expect(prepare(Buffer.from('fake'), 'image/jpeg')).rejects.toThrow(IMAGE_DECODE_MESSAGE)
  })

  // The non-`Error` throw the `instanceof` narrowing exists for (AGENTS.md:
  // never `catch (x: any)`, never `error as Error`).
  it('narrows a non-Error rejection instead of casting it', async () => {
    const { prepare } = await withStubbedEncoder(
      () => 1,
      () => Promise.reject('libvips said no'),
    )

    await expect(prepare(Buffer.from('fake'), 'image/jpeg')).rejects.toThrow(IMAGE_DECODE_MESSAGE)
  })
})
