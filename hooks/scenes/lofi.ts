import { FAIL_COLOR, KIND_COLORS } from '../catalog'
import type { Kind } from '../catalog'
import { BOLD, along, dot, dotAt, fill, hash, mix, stamp, write } from '../kit'
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
// A thing in the room: how wide it is in columns, how many pixels tall it
// stands at the least, and how it is drawn, given the pixel row of the
// desk's top it stands on.
type Thing = {
  wide: number
  tall: number
  paint: (canvas: Canvas, x: number, desk: number, room: Room, env: Env) => void
}

// The wall in the evening, top to bottom, and the desk along the band's foot.
const WALL = ['#241d33', '#32273f', '#3b2d46']
const DESK_TOP = '#8a5b3d'
const DESK_FRONT = '#563624'
const DESK_SHADOW = '#3e271b'
const LAMP_LIGHT = '#ff9a3c'
const STRING = '#1d1729'
const BULBS = ['#ffcf6e', '#ff8fa3', '#8fd3ff', '#ffe9a8']
// The window: its frame, the night outside, the city and the rain on it.
const FRAME = '#4c3d55'
const SILL = '#6a5674'
const NIGHT = ['#0e1633', '#2a2a5e', '#5a3466']
const MOON = '#f3e6c0'
const TOWERS = '#141225'
const TOWERS_FAR = '#2a2546'
const LIT = ['#ffcf73', '#ff9f6b', '#9fd6ff']
const RAIN = ['#a9cdf5', '#7393c2']
const BEZEL = '#2a2b33'
const DECK = '#a9adb8'
const SCREEN = '#16213b'
const SCREEN_FAILED = '#3a1420'
const MUG = '#e9e2d4'
const MUG_SHADE = '#c4b9a6'
const STEAM = '#9a8fae'
const SHADE = '#e0913f'
const SHADE_DARK = '#a8622a'
const BULB = '#fff1c4'
const STAND = '#2e2a33'
const RADIO = '#5b3b2b'
const RADIO_EDGE = '#3c261c'
const PANEL = '#0f1418'
const GRILL = '#2a1a13'
const EQUALIZER = '#7ddc8a'
const SNORE_INK = '#b9a9d6'
const POT = '#b0643f'
const POT_RIM = '#c97a50'
const LEAVES = ['#5f9e57', '#3f7440']
// The cat, an orange tabby: asleep in a curl, and sat up with a start.
const CAT_COLORS: Readonly<Record<string, string>> = {
  O: '#f0a35a',
  D: '#c4743a',
  L: '#ffd9a8',
  K: '#3a2418',
  E: '#ffe066',
  P: '#ff9aa8',
}
const CAT_ASLEEP = [
  '.O.O........',
  '.OOOO.DOODO.',
  'OLKOOODOOOOO',
  'LLLLOOOOOOOD',
]
const CAT_AWAKE = [
  'O..O......D.',
  'OOOO......D.',
  'EOEO..DOODO.',
  'OPOOODOOOOO.',
  'LLLOOOOOOOO.',
]
const LAMP = [
  '..SSSS..',
  '.SSSSSS.',
  'HHHBBHHH',
  '....N...',
  '....N...',
  '...TTT..',
]
const PLANT = [
  'L.L.D',
  '.LDL.',
  'DLLDL',
  '.DLD.',
  '.RRR.',
  '.PPP.',
]
const BARS = [...'▁▂▃▄▅▆▇█']
const BAR_COUNT = 9
const RADIO_WIDE = BAR_COUNT + 4
const LAPTOP_WIDE = 16
const SCREEN_WIDE = 12
const WINDOW_WIDE = 24
const SNORE = 'zZz'
const STARTLE_TICKS = 32
const DONE_TICKS = 45
const NOTE_LIFE = 34
const MOST_NOTES = 8
const GAP = 2
// The shelf a tall band hangs on its wall, and the books along it.
const PLANK = '#6e4a33'
const PLANK_SHADOW = '#2a2034'
const SPINES = ['#b5574b', '#d9a441', '#4f7fa8', '#6c9a5b', '#9a6ab0', '#c9c1b0']
// A desk this far down the band leaves the wall room for a shelf.
const SHELF_DESK = 11
// One fairy light every this many columns along the top of the wall.
const BULB_EVERY = 9

/**
 * The row of cells the laptop's screen and the radio's panel show their
 * glyphs in: a cell's two pixels must both be screen, so it is the lowest
 * whole cell above the bezel or the radio's foot.
 */
const screenRowOf = (desk: number): number => Math.max(0, Math.floor((desk - 4) / 2))

/** A window on the rainy city at night, its glass running with rain. */
const windowThing: Thing = {
  wide: WINDOW_WIDE,
  tall: 3,
  paint(canvas, x, desk, _room, env) {
    const sill = desk - 1
    const top = desk >= 8 ? 1 : 0
    const glass = sill - top - 1

    fill(canvas, x, top, WINDOW_WIDE, sill - top, FRAME)
    fill(canvas, x - 1, sill, WINDOW_WIDE + 2, 1, SILL)

    for (let row = 0; row < glass; row += 1) {
      fill(canvas, x + 1, top + 1 + row, WINDOW_WIDE - 2, 1, along(NIGHT, glass > 1 ? row / (glass - 1) : 1, 4))
    }

    // The moon over the city, in the upper pane.
    if (glass >= 4) {
      fill(canvas, x + WINDOW_WIDE - 7, top + 1, 2, 1, MOON)
    }

    // The city: far towers in the haze, near ones darker, a few windows lit.
    for (let column = 1; column < WINDOW_WIDE - 1; column += 1) {
      const far = Math.floor(hash(Math.floor((x + column) / 2), 31) * Math.min(5, glass))
      const near = Math.floor(hash(Math.floor((x + column) / 4), 21) * Math.min(3, glass - 1))

      for (let up = 0; up < Math.max(far, near); up += 1) {
        const y = sill - 1 - up
        const isNear = up < near
        // Lit windows every other row, so no two stack into a bar.
        const isLit = y % 2 === 0 && hash(x + column, y) < (isNear ? 0.3 : 0.14)
        const glow = Math.floor(env.ticks / 40 + hash(column, y) * 3) % 3
        const tower = isNear ? TOWERS : TOWERS_FAR
        dot(canvas, x + column, y, isLit ? (LIT[glow] ?? '') : tower)
      }
    }

    // The mullion, and in a tall window the transom, split the panes.
    fill(canvas, x + Math.floor(WINDOW_WIDE / 2), top, 1, sill - top, FRAME)

    if (glass >= 7) {
      fill(canvas, x, top + 1 + Math.floor(glass / 2), WINDOW_WIDE, 1, FRAME)
    }

    // The rain runs down the glass, a drop to a column of cells.
    const rows = Math.floor(glass / 2)
    const firstRow = Math.ceil((top + 1) / 2)

    for (let column = 1; column < WINDOW_WIDE - 1; column += 1) {
      if (column !== Math.floor(WINDOW_WIDE / 2) && hash(x + column, 9) < 0.5 && rows > 0) {
        const fall = rows + 2
        const head = Math.floor(env.ticks * (0.12 + hash(column, 4) * 0.1) + hash(column, 7) * fall) % fall

        if (head < rows) {
          write(canvas, x + column, firstRow + head, head % 2 === 0 ? "'" : ',', RAIN[head === rows - 1 ? 1 : 0] ?? '')
        }
      }
    }
  },
}

/** A laptop that types what Claude is doing, and a mug that steams beside it. */
const deskThing: Thing = {
  wide: LAPTOP_WIDE + 6,
  tall: 3,
  paint(canvas, x, desk, room, env) {
    const textRow = screenRowOf(desk)
    const screenTop = textRow * 2
    const screenBottom = desk - 3
    const isFailed = room.startle > 0
    const screen = isFailed ? SCREEN_FAILED : SCREEN

    fill(canvas, x + 1, Math.max(0, screenTop - 1), LAPTOP_WIDE - 2, desk - 1 - Math.max(0, screenTop - 1), BEZEL)
    fill(canvas, x + 2, screenTop, SCREEN_WIDE, screenBottom - screenTop + 1, screen)
    fill(canvas, x, desk - 1, LAPTOP_WIDE, 1, DECK)

    // Lines of code under the one being typed, in the kind's color, faint.
    const ink = isFailed ? FAIL_COLOR : room.last === undefined ? '#c9d3e6' : KIND_COLORS[room.last]

    for (let y = screenTop + 2; y <= screenBottom; y += 1) {
      const length = 3 + Math.floor(hash(y, Math.floor(env.ticks / 30)) * (SCREEN_WIDE - 5))
      fill(canvas, x + 3, y, length, 1, mix(screen, ink, 0.35))
    }

    const isBlinking = Math.floor(env.ticks / 5) % 2 === 0
    const busy = env.feed.isWorking ? (room.last ?? '') : ''
    const typed = room.done > 0 ? '>done ✓' : `>${busy}${isBlinking ? '_' : ''}`
    const color = room.done > 0 && !isFailed ? EQUALIZER : ink
    write(canvas, x + 2, textRow, (isFailed ? '>error!' : typed).slice(0, SCREEN_WIDE), color)

    // The mug, and its steam curling up over the wall.
    const mug = x + LAPTOP_WIDE + 2
    fill(canvas, mug, desk - 3, 3, 3, MUG)
    fill(canvas, mug + 2, desk - 3, 1, 3, MUG_SHADE)
    dot(canvas, mug + 3, desk - 2, MUG_SHADE)
    const sway = Math.floor(env.ticks / 6) % 2

    if (desk >= 6) {
      write(canvas, mug + sway, Math.floor((desk - 4) / 2), '~', STEAM)
    }
  },
}

/** A desk lamp: a warm halo round its shade, and its light pooled on the desk. */
const lampThing: Thing = {
  wide: LAMP[0]?.length ?? 8,
  tall: LAMP.length,
  paint(canvas, x, desk) {
    const top = desk - LAMP.length
    const middle = x + 3.5

    // The halo fades in two steps round the shade, the pool in two along the desk.
    for (let y = Math.max(0, top - 2); y <= desk; y += 1) {
      const isDesk = y === desk
      const reach = isDesk ? 11 : 6
      const rise = isDesk ? 0 : Math.abs(y - (top + 1)) * 1.6

      for (let column = Math.floor(middle - reach); column <= middle + reach; column += 1) {
        const away = (Math.abs(column + 0.5 - middle) + rise) / reach
        const share = away < 0.5 ? 0.3 : away < 1 ? 0.14 : 0
        const under = dotAt(canvas, column, y)

        if (share > 0 && under.startsWith('#')) {
          dot(canvas, column, y, mix(under, LAMP_LIGHT, share))
        }
      }
    }

    stamp(canvas, x, top, LAMP, { S: SHADE, H: SHADE_DARK, B: BULB, N: STAND, T: STAND })
  },
}

/** A little radio whose panel bounces with the calls, sending notes up. */
const radioThing: Thing = {
  wide: RADIO_WIDE,
  tall: 3,
  paint(canvas, x, desk, room, env) {
    const panelRow = Math.max(0, Math.floor((desk - 2) / 2))
    const top = Math.max(0, panelRow * 2 - 1)

    fill(canvas, x, top, RADIO_WIDE, desk - top, RADIO)
    fill(canvas, x, desk - 1, RADIO_WIDE, 1, RADIO_EDGE)
    fill(canvas, x + 1, panelRow * 2, BAR_COUNT, 2, PANEL)
    fill(canvas, x + BAR_COUNT + 1, panelRow * 2, 2, 2, GRILL)

    const bars = room.levels
      .map(level => BARS[Math.min(BARS.length - 1, Math.floor(level * BARS.length))] ?? '▁')
      .join('')
    const color = room.last === undefined ? EQUALIZER : KIND_COLORS[room.last]
    write(canvas, x + 1, panelRow, bars, color)

    room.notes.forEach((note, at) => {
      const sway = Math.round(Math.sin(env.ticks * 0.2 + at) * 1.5)
      const row = panelRow - 1 - Math.floor(note.y)
      const ink = note.age > NOTE_LIFE * 0.6 ? mix(color, WALL[1] ?? '', 0.5) : color
      write(canvas, x + 1 + note.x + sway, row, at % 2 === 0 ? '♪' : '♫', ink)
    })
  },
}

/** A cat asleep on the desk; a failed call wakes it with a start. */
const catThing: Thing = {
  wide: (CAT_ASLEEP[0]?.length ?? 12) + 3,
  tall: CAT_ASLEEP.length,
  paint(canvas, x, desk, room, env) {
    const isStartled = room.startle > 0
    const look = isStartled ? CAT_AWAKE : CAT_ASLEEP
    stamp(canvas, x, desk - look.length, look, CAT_COLORS)
    const above = Math.floor((desk - look.length - 1) / 2)

    if (isStartled) {
      write(canvas, x + 4, above, '!?', FAIL_COLOR, BOLD)

      return
    }

    // The snores rise one letter at a time, the nearest to the cat first.
    const heard = Math.floor(env.ticks / 6) % (SNORE.length + 1)

    for (let letter = 0; letter < heard; letter += 1) {
      write(canvas, x + 2 + letter, above - letter, SNORE[letter] ?? '', SNORE_INK)
    }
  },
}

const plantThing: Thing = {
  wide: PLANT[0]?.length ?? 5,
  tall: 4,
  paint(canvas, x, desk) {
    stamp(canvas, x, desk - PLANT.length, PLANT, {
      L: LEAVES[0] ?? '',
      D: LEAVES[1] ?? '',
      R: POT_RIM,
      P: POT,
    })
  },
}

// The room from left to right, and which thing goes first when the band is
// too narrow for them all.
const ROOM = [windowThing, deskThing, lampThing, radioThing, catThing, plantThing]
const KEPT_FIRST = [catThing, deskThing, windowThing, radioThing, lampThing, plantThing]

/** The things the band has room for, in the room's order. */
const fitting = (wide: number, desk: number): Thing[] => {
  const kept: Thing[] = []
  let taken = GAP

  for (const thing of KEPT_FIRST) {
    if (thing.tall <= desk && taken + thing.wide + GAP <= wide) {
      kept.push(thing)
      taken += thing.wide + GAP
    }
  }

  return ROOM.filter(thing => kept.includes(thing))
}

/** A shelf of books on the wall, between two columns of pixels. */
const shelf = (canvas: Canvas, from: number, to: number, y: number): void => {
  fill(canvas, from, y, to - from, 1, PLANK)
  fill(canvas, from, y + 1, to - from, 1, PLANK_SHADOW)

  for (let x = from + 1; x < to - 1; x += 1) {
    // Books stand in runs of a color, a gap now and then.
    const book = Math.floor((x - from) / 2)
    const tall = 2 + Math.floor(hash(book, 41) * 3)

    if (hash(book, 43) > 0.15) {
      fill(canvas, x, y - tall, 1, tall, SPINES[Math.floor(hash(book, 47) * SPINES.length)] ?? '')
    }
  }
}

/** A string of fairy lights along the top of the wall, twinkling in turn. */
const fairyLights = (canvas: Canvas, env: Env): void => {
  for (let x = 0; x < canvas.pw; x += 1) {
    const dip = (x % BULB_EVERY) / BULB_EVERY
    const sag = Math.sin(dip * Math.PI) > 0.6 ? 1 : 0
    dot(canvas, x, sag, STRING)

    if (x % BULB_EVERY === Math.floor(BULB_EVERY / 2)) {
      const bulb = Math.floor(x / BULB_EVERY)
      const isBright = Math.floor(env.ticks / 8 + hash(bulb, 3) * 4) % 4 !== 0
      const color = BULBS[bulb % BULBS.length] ?? ''
      const lit = isBright ? color : mix(color, WALL[0] ?? '', 0.55)
      dot(canvas, x, sag + 1, lit)

      // A bright bulb throws a little light on the wall beside it.
      if (isBright) {
        for (const side of [-1, 1]) {
          const under = dotAt(canvas, x + side, sag + 1)
          dot(canvas, x + side, sag + 1, under.startsWith('#') ? mix(under, color, 0.25) : under)
        }
      }
    }
  }
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
    // A short band keeps one row of desk; a taller one shows its front too.
    const desk = env.ph - (env.ph >= 8 ? 3 : 2)

    for (let y = 0; y < desk; y += 1) {
      fill(canvas, 0, y, env.pw, 1, along(WALL, desk > 1 ? y / (desk - 1) : 0, 5))
    }

    fill(canvas, 0, desk, env.pw, 1, DESK_TOP)
    fill(canvas, 0, desk + 1, env.pw, env.ph - desk - 1, DESK_FRONT)

    if (env.ph - desk > 2) {
      fill(canvas, 0, env.ph - 1, env.pw, 1, DESK_SHADOW)
    }

    if (desk >= 6) {
      fairyLights(canvas, env)
    }

    const things = fitting(env.w, desk)
    const taken = things.reduce((sum, thing) => sum + thing.wide, 0)
    const gap = Math.floor((env.w - taken) / (things.length + 1))
    const placed = things.map((thing, at) => ({
      thing,
      x: gap + things.slice(0, at).reduce((sum, before) => sum + before.wide + gap, 0),
    }))
    const radio = placed.find(({ thing }) => thing === radioThing)
    const cat = placed.find(({ thing }) => thing === catThing)

    // A tall band has wall to spare over the radio and the cat: a shelf.
    if (desk >= SHELF_DESK && radio !== undefined && cat !== undefined) {
      shelf(canvas, radio.x - 1, cat.x + cat.thing.wide, Math.round(desk * 0.45))
    }

    for (const { thing, x } of placed) {
      thing.paint(canvas, x, desk, room, env)
    }
  },
}
