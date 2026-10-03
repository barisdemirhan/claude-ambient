import { FAIL_COLOR, KIND_COLORS, kindAt } from '../catalog'
import { BOLD, along, clamp, fill, mix, wipe, write } from '../kit'
import type { Canvas, Env, Scene } from '../kit'

// One point of the trace: how far off the baseline, and whether a failed
// call drew it.
type Sample = { level: number; isBad: boolean }
type Monitor = {
  // The trace across the screen, two points to a cell. A sweep writes it
  // from left to right and starts over at the left, as a monitor does.
  trace: Sample[]
  // Where the sweep writes next.
  cursor: number
  // The points still to be drawn, in the order they will be.
  queue: Sample[]
  // The ticks at which the last minute's beats fell.
  beats: number[]
  // Ticks since anything but the baseline was drawn.
  quiet: number
}

// The screen: near black at the top, a deep green at the foot, a grid over
// it as on the paper a trace is printed on.
const SCREEN = ['#010704', '#03100a', '#05190f']
const GRID = '#072414'
const GRID_MARK = '#145a32'
const GRID_COLUMNS = 16
const GRID_ROWS = 4
// The sweep's head and the light it leaves on the screen behind it.
const SWEEP = '#0b3a1f'
const SWEEP_CELLS = 2
// The trace fades with its age behind the sweep, newest first; a beat out
// of step is red, fading the same way.
const GREENS = ['#e2ffe9', '#6dffa4', '#33c46e', '#1b7c43', '#125630']
const REDS = ['#ffd6d2', '#ff6b61', '#d63c35', '#8f2621', '#5e1a17']
// The shares of the sweep each fade step covers, from the head back.
const FADES = [0.02, 0.2, 0.45, 0.75]
// The points kept clear ahead of the sweep, where the old trace is wiped.
const GAP = 6
// The readout beside the trace: its back, its edge, and its inks.
const PANEL = '#020a06'
const PANEL_EDGE = '#0a3019'
const PANEL_COLUMNS = 14
const PANEL_FROM = 48
const RATE_INK = '#7dffad'
const LABEL_INK = '#3f8f5f'
const QUIET_INK = '#2d6a46'
// A beat as the monitor draws it: the small P wave, the tall QRS spike, the
// T wave after it.
const BEAT = [
  0, 0.1, 0.18, 0.1, 0, -0.12, 0.55, 1, 0.3, -0.4, -0.12, 0, 0.1, 0.24, 0.24,
  0.1,
]
// A failed call is a beat out of step: wide, and upside down first.
const BAD_BEAT = [0, -0.2, -0.6, -1, -0.5, 0.3, 0.9, 0.6, 0.2, -0.2, -0.35, -0.2, 0]
const RESTING = 0.45
const REST_TICKS = 28
const POINTS_A_TICK = 2
// The points that may wait to be drawn: calls that come faster than the
// monitor draws are one racing heart, not a backlog.
const MOST_QUEUED = 24
const MINUTE = 600
// Braille dots by their place in a cell: two across, four down.
const DOTS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
]
const BRAILLE = 0x2800
const HEART = '♥'

const flat = (): Sample => ({ level: 0, isBad: false })

/** The cells the trace runs across: all of the band, or all but the readout. */
const traceColumns = (env: Env): number =>
  env.w >= PANEL_FROM ? env.w - PANEL_COLUMNS : env.w

const queued = (monitor: Monitor, shape: readonly number[], scale: number, isBad: boolean): void => {
  if (monitor.queue.length < MOST_QUEUED) {
    monitor.queue.push(...shape.map(level => ({ level: level * scale, isBad })))
  }
}

/**
 * The screen's color at a pixel: its gradient, the grid's lines across it,
 * and a brighter mark on them where a line down would cross. Lines down the
 * band would split every row into many more runs for little more to see.
 */
const screenAt = (x: number, y: number, env: Env): string => {
  if (y % (GRID_ROWS * 2) === GRID_ROWS * 2 - 1) {
    return x % GRID_COLUMNS === GRID_COLUMNS - 1 ? GRID_MARK : GRID
  }

  return along(SCREEN, env.h > 1 ? Math.floor(y / 2) / (env.h - 1) : 1)
}

/** How far behind the sweep a point is, as a share of the whole trace. */
const ageOf = (monitor: Monitor, at: number): number =>
  ((monitor.cursor - 1 - at + monitor.trace.length) % monitor.trace.length) /
  monitor.trace.length

/** The fade step a point is drawn in, by its age behind the sweep. */
const stepOf = (age: number): number => {
  const step = FADES.findIndex(share => age < share)

  return step === -1 ? FADES.length : step
}

/**
 * The screen and the sweep's light on it, where a backdrop is asked for,
 * and the trace drawn in braille: with no backdrop, on the terminal itself.
 */
const traced = (monitor: Monitor, canvas: Canvas, env: Env, columns: number): void => {
  if (env.feed.hasBackdrop) {
    for (let y = 0; y < env.ph; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        canvas.pixels[y * canvas.pw + x] = screenAt(x, y, env)
      }
    }

    const head = Math.floor(monitor.cursor / 2)

    for (let back = 0; back < SWEEP_CELLS; back += 1) {
      const column = (head - back + columns) % columns
      fill(canvas, column, 0, 1, env.ph, mix(SWEEP, along(SCREEN, 0.5), back / SWEEP_CELLS))
    }
  }

  const tall = env.h * 4
  const baseline = Math.floor(tall * 0.58)
  const reach = tall * 0.42
  const heightOf = (sample: Sample | undefined): number =>
    clamp(Math.round(baseline - (sample?.level ?? 0) * reach), 0, tall - 1)
  const bits = new Array<number>(columns * env.h).fill(0)
  const steps = new Array<number>(columns * env.h).fill(FADES.length)
  const bad = new Array<boolean>(columns * env.h).fill(false)
  const length = monitor.trace.length

  monitor.trace.forEach((sample, at) => {
    const age = ageOf(monitor, at)

    // The trace just ahead of the sweep is wiped, for the new one to come.
    if (age * length > length - GAP) {
      return
    }

    // Every point is joined to the one before it, so a spike is a line and
    // not two dots; the first point of the sweep is joined to nothing.
    const from = heightOf(at === 0 ? sample : (monitor.trace[at - 1] ?? sample))
    const to = heightOf(sample)
    const step = stepOf(age)

    for (let y = Math.min(from, to); y <= Math.max(from, to); y += 1) {
      const cell = (y >> 2) * columns + (at >> 1)
      bits[cell] = (bits[cell] ?? 0) | (DOTS[y & 3]?.[at & 1] ?? 0)
      steps[cell] = Math.min(steps[cell] ?? FADES.length, step)
      bad[cell] = bad[cell] === true || sample.isBad
    }
  })

  bits.forEach((cell, at) => {
    if (cell !== 0) {
      const shades = bad[at] === true ? REDS : GREENS
      const step = steps[at] ?? FADES.length
      const glyph = String.fromCodePoint(BRAILLE + cell)
      write(canvas, at % columns, Math.floor(at / columns), glyph, shades[step] ?? GREENS[4], step === 0 ? BOLD : 0)
    }
  })
}

/**
 * The readout beside the trace: the heart and its beats per minute, the
 * beats and the skipped ones of the session, and a bar for each of the last
 * turns, as tall as the calls it made and in the color of their kind.
 */
const readout = (monitor: Monitor, canvas: Canvas, env: Env, left: number): void => {
  if (env.feed.hasBackdrop) {
    fill(canvas, left, 0, env.w - left, env.ph, PANEL)
    fill(canvas, left, 0, 1, env.ph, PANEL_EDGE)
  }

  const last = monitor.beats.at(-1)
  const isBeating = last !== undefined && env.ticks - last < 4
  const rate = `${monitor.beats.length}/min`
  write(canvas, left + 2, 0, HEART, isBeating ? '#ff5a52' : '#a33a35', BOLD)
  write(canvas, left + 4, 0, rate, RATE_INK, BOLD)
  write(canvas, left + 2, 1, `${env.feed.calls} beats`, LABEL_INK)
  const skipped = env.feed.fails
  write(canvas, left + 2, 2, `${skipped} skipped`, skipped > 0 ? REDS[2] ?? FAIL_COLOR : QUIET_INK)

  const rows = env.h - 3

  if (rows < 1) {
    return
  }

  const turns = env.feed.log.slice(-(env.w - left - 3))
  const most = Math.max(1, ...turns.map(turn => turn.calls))
  const bottom = env.ph

  turns.forEach((turn, at) => {
    const tall = Math.max(1, Math.round((turn.calls / most) * rows * 2))
    const color = mix(KIND_COLORS[kindAt(turn.kind)], PANEL, 0.25)
    fill(canvas, left + 2 + at, bottom - tall, 1, tall, color)
  })
}

export const pulse: Scene<Monitor> = {
  start(env) {
    return {
      trace: Array.from({ length: traceColumns(env) * 2 }, flat),
      cursor: 0,
      queue: [],
      beats: [],
      quiet: 0,
    }
  },

  step(monitor, env) {
    monitor.quiet += 1

    // At rest the heart still beats, slow and small.
    if (!env.feed.isWorking && monitor.queue.length === 0 && monitor.quiet > REST_TICKS) {
      queued(monitor, BEAT, RESTING, false)
    }

    for (let drawn = 0; drawn < POINTS_A_TICK; drawn += 1) {
      const next = monitor.queue.shift()
      monitor.quiet = next === undefined ? monitor.quiet : 0
      monitor.trace[monitor.cursor] = next ?? { level: (env.roll() - 0.5) * 0.04, isBad: false }
      monitor.cursor = (monitor.cursor + 1) % monitor.trace.length
    }

    monitor.beats = monitor.beats.filter(tick => env.ticks - tick < MINUTE)
  },

  hear(monitor, event, env) {
    if (event.type === 'tool') {
      queued(monitor, BEAT, 1, false)
      monitor.beats.push(env.ticks)
    } else if (event.type === 'fail') {
      queued(monitor, BAD_BEAT, 1, true)
    }
  },

  paint(monitor, canvas, env) {
    const columns = traceColumns(env)
    traced(monitor, canvas, env, columns)

    if (columns < env.w) {
      readout(monitor, canvas, env, columns)

      return
    }

    // With no room for the readout, the rate stands in the corner, on a
    // strip of its own, dark where there is a backdrop.
    const rate = `${monitor.beats.length}/min`
    // The trace written there before goes, or it shows between the words.
    wipe(canvas, 0, 0, rate.length + 4)

    if (env.feed.hasBackdrop) {
      fill(canvas, 0, 0, rate.length + 4, 2, PANEL)
    }

    write(canvas, 1, 0, HEART, '#ff5a52', BOLD)
    write(canvas, 3, 0, rate, RATE_INK)
  },
}
