import { KIND_COLORS } from '../catalog'
import { BOLD, FG, hash, pick, wipe, write } from '../kit'
import type { Env, Scene } from '../kit'

// One falling column: `y` is its head's row, `tint` the head's color.
type Drop = {
  column: number
  y: number
  speed: number
  tail: number
  tint: string
  isRed: boolean
}
type Rain = {
  drops: Drop[]
  // Ticks since the turn ended, while its message is on the screen.
  message: number | undefined
}

const GLYPHS = [...'ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ0123456789:.=*+-<>|Z']
const GREENS = ['#69f0ae', '#00c853', '#2e7d32']
const REDS = ['#ff8a80', '#ef5350', '#c62828']
const MESSAGE = ' turn complete '
// The message decodes letter by letter, stands, then scrambles away.
const DECODE_TICKS = 14
const HOLD_TICKS = 45
const MESSAGE_TICKS = 60
const MOST_DROPS = 400
const WORKING_ODDS = 0.5
const IDLE_ODDS = 0.16

/** The glyph a cell shows now: it changes on a beat of the cell's own. */
const glyphAt = (column: number, row: number, ticks: number): string =>
  pick(GLYPHS, hash(column * 131 + row, Math.floor(ticks / 4 + hash(column, row) * 4))) ?? '0'

const dropOf = (env: Env, tint: string, isRed: boolean): Drop => ({
  column: Math.floor(env.roll() * env.w),
  y: -env.roll() * 3,
  speed: 0.25 + env.roll() * 0.55,
  tail: 3 + Math.floor(env.roll() * (env.h + 1)),
  tint,
  isRed,
})

/** The rain with one more drop, unless its column still has one near the top. */
const poured = (rain: Rain, drop: Drop): void => {
  const isTaken = rain.drops.some(
    other => other.column === drop.column && other.y - other.tail < 1,
  )

  if (!isTaken && rain.drops.length < MOST_DROPS) {
    rain.drops.push(drop)
  }
}

export const matrix: Scene<Rain> = {
  start() {
    return { drops: [], message: undefined }
  },

  step(rain, env) {
    const odds = (env.feed.isWorking ? WORKING_ODDS : IDLE_ODDS) * (env.w / 80)

    if (env.roll() < odds) {
      poured(rain, dropOf(env, FG, false))
    }

    rain.drops = rain.drops
      .map(drop => ({ ...drop, y: drop.y + drop.speed }))
      .filter(drop => drop.y - drop.tail < env.h)

    if (rain.message !== undefined) {
      rain.message = rain.message + 1 < MESSAGE_TICKS ? rain.message + 1 : undefined
    }
  },

  hear(rain, event, env) {
    if (event.type === 'tool') {
      // A call rains down in its kind's color.
      for (let made = 0; made < 3; made += 1) {
        poured(rain, dropOf(env, KIND_COLORS[event.kind], false))
      }
    } else if (event.type === 'fail') {
      for (let made = 0; made < 6; made += 1) {
        poured(rain, dropOf(env, REDS[0] ?? FG, true))
      }
    } else if (event.type === 'turn') {
      rain.message = 0
    }
  },

  paint(rain, canvas, env) {
    for (const drop of rain.drops) {
      const shades = drop.isRed ? REDS : GREENS
      const head = Math.floor(drop.y)

      for (let back = 0; back < drop.tail; back += 1) {
        const glyph = glyphAt(drop.column, head - back, env.ticks)

        if (back === 0) {
          write(canvas, drop.column, head, glyph, drop.tint, BOLD)
        } else {
          const fade = back === 1 ? 0 : back < drop.tail * 0.6 ? 1 : 2
          write(canvas, drop.column, head - back, glyph, shades[fade] ?? FG)
        }
      }
    }

    if (rain.message === undefined || env.w < MESSAGE.length) {
      return
    }

    const age = rain.message
    const left = Math.floor((env.w - MESSAGE.length) / 2)
    const row = Math.floor(env.h / 2)

    wipe(canvas, left, row, MESSAGE.length)

    for (const [at, letter] of [...MESSAGE].entries()) {
      const turn = 2 + hash(at, 3) * (DECODE_TICKS - 2)
      const isClear = age >= turn && age < HOLD_TICKS + turn

      if (isClear) {
        write(canvas, left + at, row, letter, FG, BOLD)
      } else {
        write(canvas, left + at, row, glyphAt(at, age, env.ticks), GREENS[1] ?? FG)
      }
    }
  },
}
