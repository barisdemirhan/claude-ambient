import { FAIL_COLOR } from '../catalog'
import { BOLD, DIM, FG, clamp, wipe, write } from '../kit'
import type { Scene } from '../kit'

// One point of the trace: how far off the baseline, and whether a failed
// call drew it.
type Sample = { level: number; isBad: boolean }
type Monitor = {
  // The trace across the band, two points to a cell, the newest last.
  trace: Sample[]
  // The points still to be drawn, in the order they will be.
  queue: Sample[]
  // The ticks at which the last minute's beats fell.
  beats: number[]
  // Ticks since anything but the baseline was drawn.
  quiet: number
}

const TRACE = '#66bb6a'
const RESTING_TRACE = '#388e3c'
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

const flat = (): Sample => ({ level: 0, isBad: false })

const queued = (monitor: Monitor, shape: readonly number[], scale: number, isBad: boolean): void => {
  if (monitor.queue.length < MOST_QUEUED) {
    monitor.queue.push(...shape.map(level => ({ level: level * scale, isBad })))
  }
}

export const pulse: Scene<Monitor> = {
  start(env) {
    return {
      trace: Array.from({ length: env.w * 2 }, flat),
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
      monitor.trace.push(next ?? { level: (env.roll() - 0.5) * 0.04, isBad: false })
    }

    monitor.trace = monitor.trace.slice(-env.w * 2)
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
    const tall = env.h * 4
    const baseline = Math.floor(tall * 0.58)
    const reach = tall * 0.42
    const heightOf = (sample: Sample | undefined): number =>
      clamp(Math.round(baseline - (sample?.level ?? 0) * reach), 0, tall - 1)
    const bits = new Array<number>(env.w * env.h).fill(0)
    const bad = new Array<boolean>(env.w * env.h).fill(false)

    // Every point is joined to the one before it, so a spike is a line and
    // not two dots.
    monitor.trace.forEach((sample, at) => {
      const from = heightOf(monitor.trace[at - 1] ?? sample)
      const to = heightOf(sample)

      for (let y = Math.min(from, to); y <= Math.max(from, to); y += 1) {
        const cell = (y >> 2) * env.w + (at >> 1)
        bits[cell] = (bits[cell] ?? 0) | (DOTS[y & 3]?.[at & 1] ?? 0)
        bad[cell] = bad[cell] === true || sample.isBad
      }
    })

    const color = env.feed.isWorking ? TRACE : RESTING_TRACE

    bits.forEach((cell, at) => {
      if (cell !== 0) {
        const glyph = String.fromCodePoint(BRAILLE + cell)
        write(canvas, at % env.w, Math.floor(at / env.w), glyph, bad[at] === true ? FAIL_COLOR : color)
      }
    })

    const last = monitor.beats.at(-1)
    const isBeating = last !== undefined && env.ticks - last < 4
    const rate = `${monitor.beats.length}/min`
    wipe(canvas, 0, 0, rate.length + 4)
    write(canvas, 1, 0, '♥', FAIL_COLOR, isBeating ? BOLD : DIM)
    write(canvas, 3, 0, rate, FG, DIM)
  },
}
