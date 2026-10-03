import type { Feed, Kind } from './catalog'

export type Rng = () => number

/**
 * What a scene is told of its surroundings on every call: the band's size in
 * cells and in pixels (a cell is two pixels tall), the ticks so far, the
 * feed, and the scene's own dice.
 */
export type Env = {
  w: number
  h: number
  pw: number
  ph: number
  ticks: number
  feed: Feed
  roll: Rng
}

/** What happened in Claude's work since the scene last looked. */
export type Happening =
  | { type: 'tool'; kind: Kind }
  | { type: 'fail' }
  | { type: 'turn' }
  | { type: 'work'; isOn: boolean }

/**
 * One scene: `start` makes its state, `step` moves it one tick, `hear` takes
 * in what happened, `paint` draws it. The state is the scene's own to change.
 */
export type Scene<T> = {
  start(env: Env): T
  step(sim: T, env: Env): void
  hear(sim: T, event: Happening, env: Env): void
  paint(sim: T, canvas: Canvas, env: Env): void
  /** Which of the scene's beds fits what it shows now; its first when absent. */
  bed?(sim: T, env: Env): string
}

/**
 * The band as it is painted: a pixel layer, two pixels to a cell, and a
 * glyph layer over it, a cell's glyph hiding its pixels.
 */
export type Canvas = {
  w: number
  h: number
  pw: number
  ph: number
  pixels: string[]
  glyphs: string[]
  inks: string[]
  styles: number[]
}

/** One stretch of a row drawn in one style. */
export type Run = {
  text: string
  color?: string
  backgroundColor?: string
  dimColor?: boolean
  bold?: boolean
}

export const DIM = 1
export const BOLD = 2
/** A pixel or glyph in the theme's own text color. */
export const FG = 'fg'
/** A pixel in the theme's own text color, dimmed. */
export const FAINT = 'faint'

const UPPER = '▀'
const LOWER = '▄'
const FULL = '█'

/** A seeded generator: the same seed draws the same numbers. */
export const rngOf = (seed: number): Rng => {
  let state = seed >>> 0

  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), state | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)

    return ((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 32
  }
}

/** A fixed number in [0, 1) for a pair of whole numbers. */
export const hash = (a: number, b = 0): number => {
  let mixed =
    Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^
    Math.imul((b | 0) ^ 0xc2b2ae35, 0x27d4eb2f)
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x2c1b3c6d)
  mixed = Math.imul(mixed ^ (mixed >>> 12), 0x297a2d39)

  return ((mixed ^ (mixed >>> 15)) >>> 0) / 2 ** 32
}

/** A whole number for a text, to seed a generator with. */
export const seedOf = (text: string): number =>
  [...text].reduce(
    (seed, letter) => Math.imul(seed ^ (letter.codePointAt(0) ?? 0), 16777619),
    2166136261,
  ) >>> 0

export const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value))

/** One of a list, by a number in [0, 1). */
export const pick = <T>(list: readonly T[], at: number): T | undefined =>
  list[Math.min(list.length - 1, Math.floor(at * list.length))]

/** A `#rrggbb` color with each channel scaled: under 1 darker, over 1 lighter. */
export const shade = (color: string, factor: number): string => {
  const scaled = [1, 3, 5].map(at => {
    const channel = Number.parseInt(color.slice(at, at + 2), 16)

    return clamp(Math.round(channel * factor), 0, 255)
      .toString(16)
      .padStart(2, '0')
  })

  return `#${scaled.join('')}`
}

/** Two `#rrggbb` colors mixed: the first at 0, the second at 1. */
export const mix = (from: string, to: string, at: number): string => {
  const share = clamp(at, 0, 1)
  const mixed = [1, 3, 5].map(index => {
    const one = Number.parseInt(from.slice(index, index + 2), 16)
    const other = Number.parseInt(to.slice(index, index + 2), 16)

    return Math.round(one + (other - one) * share)
      .toString(16)
      .padStart(2, '0')
  })

  return `#${mixed.join('')}`
}

/**
 * The color at a point along stops spread evenly from 0 to 1, in as many
 * steps as given: neighbouring pixels then share a color, and a row of the
 * band costs fewer runs.
 */
export const along = (stops: readonly string[], at: number, steps = 0): string => {
  const first = stops[0] ?? '#000000'

  if (stops.length < 2) {
    return first
  }

  const share = steps > 1 ? Math.round(clamp(at, 0, 1) * (steps - 1)) / (steps - 1) : clamp(at, 0, 1)
  const reach = share * (stops.length - 1)
  const low = Math.min(stops.length - 2, Math.floor(reach))

  return mix(stops[low] ?? first, stops[low + 1] ?? first, reach - low)
}

export const canvasOf = (w: number, h: number): Canvas => ({
  w,
  h,
  pw: w,
  ph: h * 2,
  pixels: new Array<string>(w * h * 2).fill(''),
  glyphs: new Array<string>(w * h).fill(''),
  inks: new Array<string>(w * h).fill(''),
  styles: new Array<number>(w * h).fill(0),
})

/** Colors one pixel, counted from the top left; off the canvas, nothing. */
export const dot = (canvas: Canvas, x: number, y: number, color: string): void => {
  const column = Math.floor(x)
  const row = Math.floor(y)

  if (column >= 0 && column < canvas.pw && row >= 0 && row < canvas.ph) {
    canvas.pixels[row * canvas.pw + column] = color
  }
}

/** Colors a rectangle of pixels, its top left at a pixel. */
export const fill = (
  canvas: Canvas,
  x: number,
  y: number,
  wide: number,
  tall: number,
  color: string,
): void => {
  const left = Math.max(0, Math.floor(x))
  const top = Math.max(0, Math.floor(y))
  const right = Math.min(canvas.pw, Math.floor(x + wide))
  const bottom = Math.min(canvas.ph, Math.floor(y + tall))

  for (let row = top; row < bottom; row += 1) {
    canvas.pixels.fill(color, row * canvas.pw + left, row * canvas.pw + Math.max(left, right))
  }
}

/**
 * Paints the whole band top to bottom through the stops, one color to a
 * pixel row: a sky, deep water, a wall.
 */
export const backdrop = (canvas: Canvas, stops: readonly string[]): void => {
  for (let row = 0; row < canvas.ph; row += 1) {
    fill(canvas, 0, row, canvas.pw, 1, along(stops, canvas.ph > 1 ? row / (canvas.ph - 1) : 0))
  }
}

/**
 * Rounds every raw color on the canvas to a coarser one, each channel to a
 * multiple of the step: neighbours that differed a little then match, and
 * their cells join one run.
 */
export const coarsen = (canvas: Canvas, step: number): void => {
  const coarse = (color: string): string =>
    color.startsWith('#')
      ? `#${[1, 3, 5]
          .map(at =>
            clamp(Math.round(Number.parseInt(color.slice(at, at + 2), 16) / step) * step, 0, 255)
              .toString(16)
              .padStart(2, '0'),
          )
          .join('')}`
      : color

  canvas.pixels = canvas.pixels.map(coarse)
  canvas.inks = canvas.inks.map(coarse)
}

/** The color of one pixel, empty where none is set or off the canvas. */
export const dotAt = (canvas: Canvas, x: number, y: number): string =>
  x >= 0 && x < canvas.pw && y >= 0 && y < canvas.ph
    ? (canvas.pixels[Math.floor(y) * canvas.pw + Math.floor(x)] ?? '')
    : ''

/**
 * Draws a sprite of pixels with its top left at a pixel: each letter is the
 * palette's color for it, a letter the palette lacks is left clear.
 */
export const stamp = (
  canvas: Canvas,
  x: number,
  y: number,
  sprite: readonly string[],
  palette: Readonly<Record<string, string>>,
): void => {
  sprite.forEach((line, row) => {
    for (const [column, letter] of [...line].entries()) {
      const color = palette[letter]

      if (color !== undefined) {
        dot(canvas, Math.floor(x) + column, Math.floor(y) + row, color)
      }
    }
  })
}

/**
 * Writes glyphs into a row of cells from a column on: a space leaves the
 * cell as it was, a glyph off the canvas is dropped.
 */
export const write = (
  canvas: Canvas,
  x: number,
  row: number,
  text: string,
  color = FG,
  style = 0,
): void => {
  const line = Math.floor(row)

  if (line < 0 || line >= canvas.h) {
    return
  }

  for (const [offset, glyph] of [...text].entries()) {
    const column = Math.floor(x) + offset

    if (glyph !== ' ' && column >= 0 && column < canvas.w) {
      const at = line * canvas.w + column
      canvas.glyphs[at] = glyph
      canvas.inks[at] = color
      canvas.styles[at] = style
    }
  }
}

/** Empties a stretch of cells in a row: their glyphs and their pixels. */
export const wipe = (canvas: Canvas, x: number, row: number, wide: number): void => {
  for (let column = Math.max(0, x); column < Math.min(canvas.w, x + wide); column += 1) {
    if (row >= 0 && row < canvas.h) {
      canvas.glyphs[row * canvas.w + column] = ''
      canvas.pixels[row * 2 * canvas.pw + column] = ''
      canvas.pixels[(row * 2 + 1) * canvas.pw + column] = ''
    }
  }
}

/**
 * Writes a caption over the scene: its cells are emptied first, so nothing
 * of the scene shows through the gaps between its words.
 */
export const sign = (
  canvas: Canvas,
  x: number,
  row: number,
  text: string,
  color = FG,
  style = 0,
): void => {
  wipe(canvas, Math.floor(x), Math.floor(row), [...text].length)
  write(canvas, x, row, text, color, style)
}

/** True where a cell holds neither a glyph nor a pixel. */
export const isClear = (canvas: Canvas, x: number, row: number): boolean =>
  x >= 0 &&
  x < canvas.w &&
  row >= 0 &&
  row < canvas.h &&
  canvas.glyphs[row * canvas.w + x] === '' &&
  canvas.pixels[row * 2 * canvas.pw + x] === '' &&
  canvas.pixels[(row * 2 + 1) * canvas.pw + x] === ''

type Cell = { glyph: string; ink: string; back: string; style: number }

const BLANK: Cell = { glyph: ' ', ink: '', back: '', style: 0 }

const isHex = (color: string): boolean => color.startsWith('#')

const cellAt = (canvas: Canvas, x: number, row: number): Cell => {
  const at = row * canvas.w + x
  const glyph = canvas.glyphs[at] ?? ''
  const upper = canvas.pixels[row * 2 * canvas.pw + x] ?? ''
  const lower = canvas.pixels[(row * 2 + 1) * canvas.pw + x] ?? ''

  if (glyph !== '') {
    // A glyph over painted pixels keeps them behind it, as its background:
    // the lower one, which a scene's ground or water most often is.
    return {
      glyph,
      ink: canvas.inks[at] ?? FG,
      back: [lower, upper].find(isHex) ?? '',
      style: canvas.styles[at] ?? 0,
    }
  }

  if (upper === '' && lower === '') {
    return BLANK
  }

  if (upper === lower) {
    // A cell of one raw color is a space on that background: it shows no
    // ink, so it joins any run beside it on the same background.
    return isHex(upper)
      ? { glyph: ' ', ink: '', back: upper, style: 0 }
      : { glyph: FULL, ink: upper, back: '', style: 0 }
  }

  if (upper === '') {
    return { glyph: LOWER, ink: lower, back: '', style: 0 }
  }

  if (lower === '') {
    return { glyph: UPPER, ink: upper, back: '', style: 0 }
  }

  // Two colors in one cell: the lower one is the cell's background, which
  // only a raw color can be.
  return isHex(lower)
    ? { glyph: UPPER, ink: upper, back: lower, style: 0 }
    : { glyph: LOWER, ink: lower, back: isHex(upper) ? upper : '', style: 0 }
}

/** The same two colors the other way up: the upper half's color as the background. */
const flipped = (cell: Cell): Cell | undefined =>
  (cell.glyph === UPPER || cell.glyph === LOWER) && isHex(cell.ink) && isHex(cell.back)
    ? {
        glyph: cell.glyph === UPPER ? LOWER : UPPER,
        ink: cell.back,
        back: cell.ink,
        style: cell.style,
      }
    : undefined

const runOf = (text: string, cell: Cell): Run => ({
  text,
  ...(isHex(cell.ink) ? { color: cell.ink } : {}),
  ...(cell.back === '' ? {} : { backgroundColor: cell.back }),
  ...(cell.ink === FAINT || (cell.style & DIM) !== 0 ? { dimColor: true } : {}),
  ...((cell.style & BOLD) === 0 ? {} : { bold: true }),
})

/**
 * True where a cell can be drawn in the run's style: on the same background,
 * as a space, or in the run's ink, or as the first ink of a run of spaces.
 */
const isJoinable = (run: Cell, cell: Cell): boolean =>
  run.back === cell.back &&
  (cell.glyph === ' ' ||
    run.ink === '' ||
    (run.ink === cell.ink && run.style === cell.style))

/**
 * The canvas as rows of runs. A space shows no ink, so it joins the run
 * beside it on its background, and a cell of two colors is turned the way
 * up the run beside it draws: a row costs a run per change of style and no
 * more.
 */
export const rowsOf = (canvas: Canvas): Run[][] =>
  Array.from({ length: canvas.h }, (_, row) => {
    const runs: Run[] = []
    let text = ''
    let run: Cell = BLANK

    for (let x = 0; x < canvas.w; x += 1) {
      const drawn = cellAt(canvas, x, row)
      const turned = flipped(drawn)
      const cell =
        text !== '' && !isJoinable(run, drawn) && turned !== undefined && isJoinable(run, turned)
          ? turned
          : drawn

      if (text !== '' && !isJoinable(run, cell)) {
        runs.push(runOf(text, run))
        text = ''
        run = BLANK
      }

      if (text === '' || (run.ink === '' && cell.glyph !== ' ')) {
        run = { ...cell, glyph: '', ink: cell.glyph === ' ' ? '' : cell.ink }
      }

      text += cell.glyph
    }

    runs.push(runOf(text, run))

    return runs
  })
