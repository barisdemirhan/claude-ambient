import { FAIL_COLOR, KIND_COLORS } from '../catalog'
import type { Kind } from '../catalog'
import { BOLD, DIM, FG, hash, write } from '../kit'
import type { Canvas, Env, Scene } from '../kit'

type Note = { x: number; y: number; age: number }
type Room = {
  // How high each bar of the equalizer stands, 0 to 1.
  levels: number[]
  notes: Note[]
  // The kind of the last call: what the laptop is busy with.
  last: Kind | undefined
  // Ticks the cat stays startled by a failed call, and ticks the laptop
  // still says the turn is done.
  startle: number
  done: number
}
// A thing in the room: how wide it is and how it is drawn, its bottom row
// standing on the desk.
type Thing = {
  wide: number
  paint: (canvas: Canvas, x: number, base: number, room: Room, env: Env) => void
}

const RAIN = '#4fc3f7'
const CAT = '#ffb74d'
const LEAF = '#66bb6a'
const POT = '#b0714a'
const EQUALIZER = '#66bb6a'
const WINDOW = ['┌─────┬─────┐', '│     │     │', '│     │     │', '└─────┴─────┘']
const LAPTOP = [' ┌────────┐', ' │        │', '╱━━━━━━━━━━╲']
const SCREEN_WIDE = 8
const MUG = 'c[_]'
const SLEEPING_CAT = [
  '      |\\      _,,,---,,_',
  "      /,`.-'`'    -.  ;-;;,_",
  "     |,4-  ) )-,_. ,\\ (  `'-'",
  "    '---''(_/--'  `-'\\_)",
]
const SNORE = 'ZZZzz'
const PLANT = ['\\|/', '\\|/', '[_]']
const BARS = [...'▁▂▃▄▅▆▇█']
const BAR_COUNT = 9
const STARTLE_TICKS = 32
const DONE_TICKS = 45
const NOTE_LIFE = 34
const MOST_NOTES = 8
const GAP = 2

const paintLines = (
  canvas: Canvas,
  x: number,
  base: number,
  lines: readonly string[],
  color = FG,
  style = 0,
): void => {
  lines.forEach((line, down) => {
    write(canvas, x, base - lines.length + 1 + down, line, color, style)
  })
}

/** A window with the rain running down its two panes. */
const windowThing: Thing = {
  wide: 13,
  paint(canvas, x, base, _room, env) {
    paintLines(canvas, x, base, WINDOW, FG, DIM)

    for (let column = 1; column < 12; column += 1) {
      const beat = Math.floor(env.ticks / 3 + hash(column, 5) * 6) % 6

      if (column !== 6 && beat < 2) {
        write(canvas, x + column, base - 2 + beat, beat === 0 ? "'" : ',', RAIN)
      }
    }
  },
}

/** A laptop that types what Claude is doing, and a mug that steams. */
const deskThing: Thing = {
  wide: 17,
  paint(canvas, x, base, room, env) {
    const isBlinking = Math.floor(env.ticks / 5) % 2 === 0
    const cursor = isBlinking ? '_' : ' '
    const busy = env.feed.isWorking ? (room.last ?? '') : ''
    const line = room.done > 0 ? '>done ✓' : `>${busy}${cursor}`
    const color = room.startle > 0 ? FAIL_COLOR : room.last === undefined ? FG : KIND_COLORS[room.last]
    paintLines(canvas, x, base, LAPTOP)
    write(canvas, x + 2, base - 1, (room.startle > 0 ? '>error!' : line).slice(0, SCREEN_WIDE), color)
    write(canvas, x + 13, base, MUG)

    const sway = Math.floor(env.ticks / 6) % 2
    write(canvas, x + 14 + sway, base - 1, '~', FG, DIM)
    write(canvas, x + 15 - sway, base - 2, '~', FG, DIM)
  },
}

/** An equalizer that bounces with the calls, and the notes it sends up. */
const equalizerThing: Thing = {
  wide: BAR_COUNT + 2,
  paint(canvas, x, base, room, env) {
    const bars = room.levels
      .map(level => BARS[Math.min(BARS.length - 1, Math.floor(level * BARS.length))] ?? '▁')
      .join('')
    const color = room.last === undefined ? EQUALIZER : KIND_COLORS[room.last]
    write(canvas, x + 1, base, bars, color)

    room.notes.forEach((note, at) => {
      const sway = Math.round(Math.sin(env.ticks * 0.2 + at) * 1.5)
      write(canvas, x + 1 + note.x + sway, base - 1 - note.y, at % 2 === 0 ? '♪' : '♫', color, note.age > NOTE_LIFE * 0.6 ? DIM : 0)
    })
  },
}

/** A cat asleep on the desk; a failed call wakes it with a start. */
const catThing: Thing = {
  wide: 29,
  paint(canvas, x, base, room, env) {
    paintLines(canvas, x, base, SLEEPING_CAT, CAT)

    if (room.startle > 0) {
      write(canvas, x + 2, base - 2, '!?', FAIL_COLOR, BOLD)

      return
    }

    // The snores come one letter at a time, the nearest to the cat first.
    const heard = Math.floor(env.ticks / 6) % (SNORE.length + 1)
    write(canvas, x + SNORE.length - heard, base - 2, SNORE.slice(SNORE.length - heard), FG, DIM)
  },
}

const plantThing: Thing = {
  wide: 3,
  paint(canvas, x, base) {
    paintLines(canvas, x, base - 1, PLANT.slice(0, 2), LEAF)
    paintLines(canvas, x, base, PLANT.slice(2), POT)
  },
}

// The room from left to right, and which thing goes first when the band is
// too narrow for them all.
const ROOM = [windowThing, deskThing, equalizerThing, catThing, plantThing]
const KEPT_FIRST = [catThing, deskThing, windowThing, equalizerThing, plantThing]

/** The things the band has room for, in the room's order. */
const fitting = (wide: number): Thing[] => {
  const kept: Thing[] = []
  let taken = GAP

  for (const thing of KEPT_FIRST) {
    if (taken + thing.wide + GAP <= wide) {
      kept.push(thing)
      taken += thing.wide + GAP
    }
  }

  return ROOM.filter(thing => kept.includes(thing))
}

export const lofi: Scene<Room> = {
  start() {
    return {
      levels: new Array<number>(BAR_COUNT).fill(0),
      notes: [],
      last: undefined,
      startle: 0,
      done: 0,
    }
  },

  step(room, env) {
    const { isWorking } = env.feed
    room.startle = Math.max(0, room.startle - 1)
    room.done = Math.max(0, room.done - 1)
    room.levels = room.levels.map(level => {
      const isKicked = isWorking && env.roll() < 0.22

      return isKicked ? Math.max(level, 0.25 + env.roll() * 0.5) : level * 0.84
    })

    if (isWorking && env.ticks % 11 === 0 && room.notes.length < MOST_NOTES) {
      room.notes.push({ x: Math.floor(env.roll() * BAR_COUNT), y: 0, age: 0 })
    }

    room.notes = room.notes
      .map(note => ({ ...note, y: note.y + 0.12, age: note.age + 1 }))
      .filter(note => note.age < NOTE_LIFE)
  },

  hear(room, event, env) {
    if (event.type === 'tool') {
      room.last = event.kind
      room.levels = room.levels.map(() => 0.65 + env.roll() * 0.35)
    } else if (event.type === 'fail') {
      // The record skips and the cat starts.
      room.startle = STARTLE_TICKS
      room.levels = room.levels.map(() => 0)
    } else if (event.type === 'turn') {
      room.done = DONE_TICKS
    }
  },

  paint(room, canvas, env) {
    const desk = env.h - 1
    const things = fitting(env.w)
    const taken = things.reduce((sum, thing) => sum + thing.wide, 0)
    const gap = Math.floor((env.w - taken) / (things.length + 1))
    let x = gap
    write(canvas, 0, desk, '─'.repeat(env.w), FG, DIM)

    for (const thing of things) {
      thing.paint(canvas, x, desk - 1, room, env)
      x += thing.wide + gap
    }
  },
}
