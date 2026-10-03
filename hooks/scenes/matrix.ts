import { KIND_COLORS } from '../catalog'
import { BOLD, along, fill, hash, mix, pick, wipe, write } from '../kit'
import type { Canvas, Env, Scene } from '../kit'

// One falling column: `y` is its head's row, `tint` the head's color, and a
// far one falls slow and dim behind the near ones.
type Drop = {
  column: number
  y: number
  speed: number
  tail: number
  tint: string
  isRed: boolean
  isFar: boolean
}
type Rain = {
  drops: Drop[]
  // Ticks since the turn ended, while its message is on the screen.
  message: number | undefined
}

const GLYPHS = [...'ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ0123456789:.=*+-<>|Z']
// The screen behind the rain: black at the top, deep green at the foot.
const SCREEN = ['#010402', '#020905', '#03120a', '#052114']
// A near column's tail, from just behind its head to its end.
const GREENS = ['#a8ffc8', '#3ef08a', '#19b85a', '#0e7a3a', '#0b5a2c']
const FAR_GREENS = ['#1f8a4a', '#146436', '#0e4526']
const REDS = ['#ff8a80', '#ef5350', '#c62828', '#7f1d1d']
const HEAD = '#eafff0'
const RED_HEAD = '#ffe3e0'
// The glow a near head casts on the screen around it, as its cell's back.
const GLOW = '#16572f'
const FAR_GLOW = '#0c3019'
const RED_GLOW = '#4a1010'
const GLOW_STEPS = 3
const PANEL = '#010402'
const MESSAGE_INK = '#d9ffe6'
const CURSOR = '#3ef08a'
const CURSOR_TICKS = 4
const MESSAGE = ' turn complete '
// The message decodes letter by letter, stands, then scrambles away.
const DECODE_TICKS = 14
const HOLD_TICKS = 45
const MESSAGE_TICKS = 60
// The share of the band's cells the rain may light at once.
const MOST_LIT = 0.2
// The screen opens with a far column for about this many of its columns.
const OPENING_COLUMNS = 10
const WORKING_ODDS = 0.55
const IDLE_ODDS = 0.16
// Far columns fall whether Claude works or not: the depth behind the rain.
const FAR_ODDS = 0.3
// A kind's tail fades from its color into the screen in this many steps.
const KIND_STEPS = 4

/** The glyph a cell shows now: it changes on a beat of the cell's own. */
const glyphAt = (column: number, row: number, ticks: number): string =>
  pick(GLYPHS, hash(column * 131 + row, Math.floor(ticks / 4 + hash(column, row) * 4))) ?? '0'

const dropOf = (env: Env, tint: string, isRed: boolean, isFar = false): Drop => ({
  column: Math.floor(env.roll() * env.w),
  y: -env.roll() * 3,
  speed: isFar ? 0.1 + env.roll() * 0.18 : 0.35 + env.roll() * 0.55,
  tail: 3 + Math.floor(env.roll() * (env.h + (isFar ? 3 : 1))),
  tint,
  isRed,
  isFar,
})

/**
 * The most cells of the band a drop will light: all of its tail once it is
 * in, for one still coming down, and what is left of it on the way out.
 */
const litBy = (drop: Drop, env: Env): number => {
  const head = Math.floor(drop.y)

  return head < env.h
    ? Math.min(drop.tail, env.h)
    : Math.max(0, env.h - (head - drop.tail + 1))
}

/** True for a drop that only falls for the look of it, not for a call. */
const isPlain = (drop: Drop): boolean => drop.isFar || (drop.tint === HEAD && !drop.isRed)

/**
 * The rain with one more drop, unless its column still has one near the
 * top. Every lit cell splits its row into more runs, and a band past the
 * engine's size is not drawn at all, so the rain lights no more than a
 * share of the band: past it, a call's drop takes the place of the plain
 * drops lowest on the screen, and a plain drop waits.
 */
const poured = (rain: Rain, drop: Drop, env: Env): void => {
  const isTaken = rain.drops.some(
    other =>
      other.column === drop.column &&
      other.isFar === drop.isFar &&
      other.y - other.tail < 1,
  )

  if (isTaken) {
    return
  }

  const most = Math.max(env.h, Math.floor(env.w * env.h * MOST_LIT))
  let lit = rain.drops.reduce((sum, other) => sum + litBy(other, env), 0)
  const room = (): boolean => lit + drop.tail <= most

  if (!room() && !isPlain(drop)) {
    const leaving = rain.drops
      .filter(isPlain)
      .sort((one, other) => other.y - other.tail - (one.y - one.tail))

    for (const other of leaving) {
      if (room()) {
        break
      }

      lit -= litBy(other, env)
      rain.drops = rain.drops.filter(kept => kept !== other)
    }
  }

  if (room()) {
    rain.drops.push(drop)
  }
}

/**
 * The screen's color at a row: one color to a cell, not to a pixel, so a
 * glyph's back matches the empty cells beside it.
 */
const screenAt = (row: number, env: Env): string =>
  along(SCREEN, env.h > 1 ? row / (env.h - 1) : 1)

/** The colors a tail fades through: greens, reds, or its kind's own color. */
const tailOf = (drop: Drop, back: string): readonly string[] => {
  if (drop.isRed) {
    return REDS
  }

  if (drop.isFar) {
    return FAR_GREENS
  }

  if (drop.tint === HEAD) {
    return GREENS
  }

  return Array.from({ length: KIND_STEPS }, (_, step) =>
    mix(drop.tint, back, 0.1 + (step / KIND_STEPS) * 0.6),
  )
}

/** One column's head and tail, lighting the screen behind them as they fall. */
const painted = (drop: Drop, canvas: Canvas, env: Env): void => {
  const head = Math.floor(drop.y)

  for (let back = drop.tail - 1; back >= 0; back -= 1) {
    const row = head - back

    if (row < 0 || row >= env.h) {
      continue
    }

    const glyph = glyphAt(drop.column, row, env.ticks)
    const screen = screenAt(row, env)
    // How far down the tail the cell is: 0 at the head, near 1 at its end.
    const fade = back / drop.tail
    const shades = tailOf(drop, screen)
    const ink = shades[Math.min(shades.length - 1, Math.floor(fade * shades.length))] ?? screen

    if (env.feed.hasBackdrop) {
      const glow = drop.isRed ? RED_GLOW : drop.isFar ? FAR_GLOW : GLOW
      // The glow behind a cell fades with the tail, in steps that cells share.
      const lit = Math.round((1 - fade) * GLOW_STEPS) / GLOW_STEPS
      fill(canvas, drop.column, row * 2, 1, 2, mix(screen, glow, drop.isFar ? lit * 0.6 : lit))
    }

    if (back === 0 && !drop.isFar) {
      const headInk = drop.isRed ? RED_HEAD : drop.tint === HEAD ? HEAD : mix(drop.tint, '#ffffff', 0.45)
      write(canvas, drop.column, row, glyph, headInk, BOLD)
    } else {
      write(canvas, drop.column, row, glyph, ink)
    }
  }
}

export const matrix: Scene<Rain> = {
  start(env) {
    const rain: Rain = { drops: [], message: undefined }

    // The screen opens mid-rain, the far columns already falling.
    for (let made = 0; made < Math.ceil(env.w / OPENING_COLUMNS); made += 1) {
      const drop = dropOf(env, HEAD, false, true)
      rain.drops.push({ ...drop, y: env.roll() * (env.h + drop.tail) })
    }

    return rain
  },

  step(rain, env) {
    const widthShare = env.w / 80
    const odds = (env.feed.isWorking ? WORKING_ODDS : IDLE_ODDS) * widthShare

    if (env.roll() < odds) {
      poured(rain, dropOf(env, HEAD, false), env)
    }

    if (env.roll() < FAR_ODDS * widthShare) {
      poured(rain, dropOf(env, HEAD, false, true), env)
    }

    rain.drops = rain.drops
      .map(drop => ({ ...drop, y: drop.y + drop.speed }))
      .filter(drop => drop.y - drop.tail < env.h)

    // The rain thins out at rest, but the band is never left bare: with no
    // near drop on it, one starts at its top edge at once.
    const isBare = !rain.drops.some(
      drop => !drop.isFar && drop.y >= 0 && Math.floor(drop.y) - drop.tail + 1 < env.h,
    )

    if (isBare) {
      rain.drops.push({ ...dropOf(env, HEAD, false), y: 0 })
    }

    if (rain.message !== undefined) {
      rain.message = rain.message + 1 < MESSAGE_TICKS ? rain.message + 1 : undefined
    }
  },

  hear(rain, event, env) {
    if (event.type === 'tool') {
      // A call rains down in its kind's color.
      for (let made = 0; made < 3; made += 1) {
        poured(rain, dropOf(env, KIND_COLORS[event.kind], false), env)
      }
    } else if (event.type === 'fail') {
      for (let made = 0; made < 6; made += 1) {
        poured(rain, dropOf(env, REDS[0] ?? HEAD, true), env)
      }
    } else if (event.type === 'turn') {
      rain.message = 0
    }
  },

  paint(rain, canvas, env) {
    // With no backdrop asked for, the rain falls on the terminal itself.
    for (let row = 0; row < env.h && env.feed.hasBackdrop; row += 1) {
      fill(canvas, 0, row * 2, env.w, 2, screenAt(row, env))
    }

    // The far columns first, so the near ones fall in front of them.
    for (const drop of rain.drops.filter(one => one.isFar)) {
      painted(drop, canvas, env)
    }

    for (const drop of rain.drops.filter(one => !one.isFar)) {
      painted(drop, canvas, env)
    }

    if (rain.message === undefined || env.w < MESSAGE.length + 2) {
      return
    }

    const age = rain.message
    const left = Math.floor((env.w - MESSAGE.length) / 2)
    const row = Math.floor(env.h / 2)

    // The message stands on a strip of its own, the rain cleared from it,
    // dark where there is a backdrop, and a cursor blinks at its end as a
    // terminal's does.
    wipe(canvas, left - 1, row, MESSAGE.length + 2)

    if (env.feed.hasBackdrop) {
      fill(canvas, left - 1, row * 2, MESSAGE.length + 2, 2, PANEL)
    }

    if (Math.floor(age / CURSOR_TICKS) % 2 === 0) {
      fill(canvas, left + MESSAGE.length - 1, row * 2, 1, 2, CURSOR)
    }

    for (const [at, letter] of [...MESSAGE].entries()) {
      const turn = 2 + hash(at, 3) * (DECODE_TICKS - 2)
      const isClear = age >= turn && age < HOLD_TICKS + turn

      if (isClear) {
        write(canvas, left + at, row, letter, MESSAGE_INK, BOLD)
      } else {
        write(canvas, left + at, row, glyphAt(at, age, env.ticks), GREENS[1] ?? MESSAGE_INK)
      }
    }
  },
}
