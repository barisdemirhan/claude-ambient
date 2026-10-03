import { KINDS, KIND_COLORS, kindAt } from '../catalog'
import type { Kind } from '../catalog'
import { along, backdrop, clamp, dot, fill, hash, mix, shade, stamp, write } from '../kit'
import type { Canvas, Env, Scene } from '../kit'

type Way = 1 | -1
// A fish swims at a pixel: `x` across, `y` down from the water's surface.
type Fish = {
  kind: Kind
  x: number
  y: number
  way: Way
  speed: number
  // True once the tank is full and this one swims out to make room.
  isLeaving: boolean
  // Ticks it keeps fleeing the shark.
  fear: number
}
// A bubble rises through the rows of cells; a flake sinks through pixels.
type Bubble = { x: number; y: number }
type Flake = { x: number; y: number }
type Shark = { x: number; y: number; way: Way }
type Tank = {
  fish: Fish[]
  bubbles: Bubble[]
  flakes: Flake[]
  shark: Shark | undefined
}
type Palette = Readonly<Record<string, string>>

// The water, from the lit surface down to the deep over the sand.
const WATER = ['#3aa6c2', '#2788b3', '#1c6a9e', '#165283', '#103d68']
const SURFACE = '#63c7dc'
const GLINT = '#c4f3fa'
const RAY = '#a8e6f2'
const SAND = '#c8a76c'
const SAND_LIGHT = '#dcc08a'
const SAND_DARK = '#a98a55'
const ROCK = '#56687a'
const ROCK_LIGHT = '#7a8fa3'
const ROCK_DARK = '#3d4c5b'
const CORALS = ['#ff6f91', '#ffa05c', '#c77dff']
const WEEDS = ['#2f9e5b', '#4fa83c', '#2a8a6e']
const FLAKE = '#ffd54f'
const BUBBLES = ['#7fcbe2', '#a9e2f2', '#ddf7ff']
const EYE = '#08182a'
const WHITE = '#ffffff'
const SHARK_PALETTE: Palette = {
  b: '#8ea2b1',
  d: '#61768a',
  l: '#e3ebf0',
  e: EYE,
  w: WHITE,
}
// Each kind of tool call is a species, drawn facing right: `b` its body, `t`
// its fins and tail, `l` its belly, `e` its eye, `w` white. The crab walks the
// sand and the jellyfish pulses, so theirs are two beats, not two sides.
const LOOKS: Readonly<Record<Kind, readonly (readonly string[])[]>> = {
  read: [['t..b.', 'tbbeb', 't.ll.']],
  search: [['t..bbbbe..', 'ttbllllbbb']],
  edit: [['t..bwbbb.', 'ttbwbwbeb', 't..lwll..']],
  shell: [
    ['t.e.e.t', 'tbbbbbt', '.l.l.l.'],
    ['.te.et.', 'tbbbbbt', 'l.l.l.l'],
  ],
  web: [
    ['.lll.', 'bbbbb', 't.t.t', '.t.t.'],
    ['.lll.', '.bbb.', '.ttt.', 't.t.t'],
  ],
  agent: [['t......bbbb..', 'tt..bbbbbbbbb', '.tbbbbbbbbwbb', 't..lllllllll.']],
  mcp: [['...bb..', 't.bbbb.', 'tbbbbeb', '...ll..']],
  other: [['t.bb.', 'tbbeb']],
}
const SHARK_RIGHT = [
  '.........dd.....',
  'd......dddbbbb..',
  'ddbbbbbbbbbbbbeb',
  'd..llllllllllww.',
]
const SHARK_LENGTH = 16
const SHARK_SPEED = 1.1
const FEAR_REACH = 18
const FEAR_TICKS = 24
const FLAKES = 7
const MOST_BUBBLES = 40
const STOCKED = 3
// The light through the surface: a slanting ray every so many columns,
// drifting slowly across the tank, down through this share of the rows.
const RAY_SPACING = 40
const RAY_DRIFT = 0.04
const RAY_REACH = 0.5

const isBeating = (kind: Kind): boolean => kind === 'shell' || kind === 'web'

const lengthOf = (kind: Kind): number => LOOKS[kind][0]?.[0]?.length ?? 3

const heightOf = (kind: Kind): number => LOOKS[kind][0]?.length ?? 2

const paletteOf = (kind: Kind): Palette => {
  const body = KIND_COLORS[kind]

  return {
    b: body,
    t: shade(body, 0.72),
    l: mix(body, WHITE, 0.45),
    e: kind === 'agent' ? WHITE : EYE,
    w: WHITE,
  }
}

const mostFish = (env: Env): number => clamp(Math.floor(env.w / 14), 4, 12)

/** How deep the sand lies under a column, in pixels: low dunes. */
const sandDepth = (x: number, env: Env): number => {
  const dune = Math.sin(x * 0.11) + Math.sin(x * 0.037 + 1.3) > 0.4 ? 1 : 0

  return (env.ph >= 14 ? 2 : 1) + dune
}

const sandTop = (x: number, env: Env): number => env.ph - sandDepth(Math.floor(x), env)

/** The pixel rows a kind swims between: the crab walks the sand, the rest swim over it. */
const highest = (env: Env): number => (env.ph >= 8 ? 1 : 0)

const deepest = (kind: Kind, env: Env): number =>
  Math.max(highest(env), env.ph - (env.ph >= 14 ? 3 : 2) - heightOf(kind))

const crabY = (x: number, env: Env): number =>
  sandTop(x + lengthOf('shell') / 2, env) - heightOf('shell')

const yFor = (kind: Kind, x: number, env: Env): number =>
  kind === 'shell'
    ? crabY(x, env)
    : highest(env) + Math.floor(env.roll() * (deepest(kind, env) - highest(env) + 1))

const wayOf = (env: Env): Way => (env.roll() < 0.5 ? 1 : -1)

const fishOf = (kind: Kind, env: Env, isInside: boolean): Fish => {
  const way = wayOf(env)
  const outside = way > 0 ? -lengthOf(kind) : env.w
  const x = isInside ? env.roll() * (env.w - lengthOf(kind)) : outside

  return {
    kind,
    x,
    y: yFor(kind, x, env),
    way,
    speed: 0.12 + env.roll() * 0.3,
    isLeaving: false,
    fear: 0,
  }
}

/** A new fish swims in; in a full tank the eldest swims out for it. */
const stocked = (tank: Tank, kind: Kind, env: Env): void => {
  tank.fish.push(fishOf(kind, env, false))
  const staying = tank.fish.filter(fish => !fish.isLeaving)
  const eldest = staying[0]

  if (staying.length > mostFish(env) && eldest !== undefined) {
    eldest.isLeaving = true
  }
}

/** Where a fish heads: after the nearest flake, away from the shark, or on. */
const steered = (fish: Fish, tank: Tank, env: Env): void => {
  const { shark } = tank

  if (shark !== undefined && Math.abs(fish.x - shark.x) < FEAR_REACH) {
    fish.fear = FEAR_TICKS
    fish.way = fish.x >= shark.x ? 1 : -1

    return
  }

  if (fish.isLeaving || fish.fear > 0) {
    return
  }

  const flake = fish.kind === 'shell' ? undefined : tank.flakes[0]

  if (flake !== undefined && Math.abs(flake.x - fish.x) > 1) {
    fish.way = flake.x > fish.x ? 1 : -1
    const middle = fish.y + heightOf(fish.kind) / 2
    fish.y =
      env.roll() < 0.15
        ? clamp(fish.y + Math.sign(flake.y - middle), highest(env), deepest(fish.kind, env))
        : fish.y
  } else if (fish.x < 1) {
    fish.way = 1
  } else if (fish.x > env.w - lengthOf(fish.kind) - 1) {
    fish.way = -1
  } else if (env.roll() < 0.004) {
    fish.way = fish.way > 0 ? -1 : 1
  }
}

const swum = (fish: Fish, tank: Tank, env: Env): void => {
  const pace = env.feed.isWorking ? 1 : 0.5
  steered(fish, tank, env)
  fish.x += fish.way * fish.speed * (fish.fear > 0 ? 3 : pace)
  fish.fear = Math.max(0, fish.fear - 1)

  if (fish.kind === 'shell') {
    fish.y = crabY(fish.x, env)
  } else if (fish.fear === 0 && env.roll() < 0.03) {
    fish.y = clamp(fish.y + (env.roll() < 0.5 ? 1 : -1), highest(env), deepest(fish.kind, env))
  }
}

const isInTank = (fish: Fish, env: Env): boolean =>
  fish.x > -lengthOf(fish.kind) - 2 && fish.x < env.w + 2

const mirrored = (sprite: readonly string[]): string[] =>
  sprite.map(line => [...line].reverse().join(''))

/** The water's color at a pixel row, as the backdrop paints it. */
const waterAt = (y: number, env: Env): string =>
  along(WATER, env.ph > 1 ? y / (env.ph - 1) : 0)

/**
 * Soft rays of light slanting down from the surface into the upper water,
 * drifting across. A ray steps a column a row of cells, so both pixels of a
 * cell are lit alike and the row costs no more runs than it must.
 */
const paintRays = (canvas: Canvas, env: Env): void => {
  const drift = env.ticks * RAY_DRIFT
  const first = Math.floor(-drift / RAY_SPACING) - 2
  const last = Math.ceil((env.pw - drift) / RAY_SPACING) + 1
  const reach = Math.max(1, Math.floor(env.h * RAY_REACH))

  for (let ray = first; ray <= last; ray += 1) {
    const start = ray * RAY_SPACING + drift - reach
    const wide = 2 + Math.floor(hash(ray, 5) * 3)

    for (let row = 0; row < reach; row += 1) {
      for (const y of [row * 2, row * 2 + 1]) {
        // Brighter near the surface, fading into the deep.
        const light = row === 0 ? 0.18 : row < reach / 2 ? 0.13 : 0.08
        fill(canvas, Math.round(start + row), y, wide, 1, mix(waterAt(y, env), RAY, light))
      }
    }
  }
}

/** The surface: a lighter line whose glints run along it. */
const paintSurface = (canvas: Canvas, env: Env): void => {
  fill(canvas, 0, 0, env.pw, 1, SURFACE)

  for (let x = 0; x < env.pw; x += 1) {
    const wave = Math.sin(x * 0.5 + env.ticks * 0.15) * Math.sin(x * 0.07 - env.ticks * 0.03)

    if (wave > 0.78) {
      dot(canvas, x, 0, GLINT)
    }
  }
}

const paintSand = (canvas: Canvas, env: Env): void => {
  for (let x = 0; x < env.pw; x += 1) {
    const top = sandTop(x, env)
    fill(canvas, x, top, 1, env.ph - top, SAND)
    dot(canvas, x, top, sandDepth(x, env) > 1 ? SAND_LIGHT : SAND)

    if (hash(x, 3) < 0.03) {
      dot(canvas, x, env.ph - 1, SAND_DARK)
    }
  }
}

/** Rocks, coral and weed, rooted where the column's dice say. */
const paintBed = (canvas: Canvas, env: Env): void => {
  const isRoomy = env.ph >= 8

  for (let x = 0; x < env.pw; x += 1) {
    const ground = sandTop(x, env)

    if (hash(x, 11) < 0.024) {
      const wide = 3 + Math.floor(hash(x, 12) * 3)
      const tall = isRoomy ? 2 : 1
      fill(canvas, x, ground - tall, wide, tall, ROCK)
      fill(canvas, x + 1, ground - tall, wide - 2, 1, ROCK_LIGHT)
      dot(canvas, x + wide - 1, ground - 1, ROCK_DARK)
    } else if (isRoomy && hash(x, 13) < 0.017) {
      const color = CORALS[Math.floor(hash(x, 14) * CORALS.length)] ?? '#ff6f91'
      const coral = env.ph >= 12 ? ['c.c.c', 'c.c.c', '.ccc.', '..c..'] : ['c.c.c', '.ccc.', '..c..']
      stamp(canvas, x, ground - coral.length, coral, { c: color })
    } else if (hash(x, 7) < 0.045) {
      const tall = 2 + Math.floor(hash(x, 8) * Math.max(1, env.ph * 0.45))
      const color = WEEDS[Math.floor(hash(x, 9) * WEEDS.length)] ?? '#2f9e5b'

      for (let up = 0; up < tall; up += 1) {
        const sway = Math.round(
          Math.sin(env.ticks * 0.06 + x * 0.9 + up * 0.5) * (up / tall) * 1.4,
        )
        dot(canvas, x + sway, ground - 1 - up, up === tall - 1 ? shade(color, 1.3) : color)

        if (up % 3 === 1) {
          dot(canvas, x + sway + (up % 6 === 1 ? 1 : -1), ground - 1 - up, shade(color, 1.25))
        }
      }
    }
  }
}

export const aquarium: Scene<Tank> = {
  start(env) {
    const tank: Tank = { fish: [], bubbles: [], flakes: [], shark: undefined }

    // The calls the session made before the tank was looked at swim in it.
    KINDS.forEach((_, index) => {
      const calls = Math.min(STOCKED, env.feed.kinds[index] ?? 0)

      for (let made = 0; made < calls && tank.fish.length < mostFish(env); made += 1) {
        tank.fish.push(fishOf(kindAt(index), env, true))
      }
    })

    return tank
  },

  step(tank, env) {
    for (const fish of tank.fish) {
      swum(fish, tank, env)
    }

    tank.fish = tank.fish.filter(fish => isInTank(fish, env))
    tank.flakes = tank.flakes
      .map(flake => ({ ...flake, y: flake.y + 0.2 }))
      .filter(
        flake =>
          flake.y < sandTop(flake.x, env) &&
          !tank.fish.some(
            fish =>
              flake.y >= fish.y &&
              flake.y < fish.y + heightOf(fish.kind) &&
              flake.x >= fish.x &&
              flake.x <= fish.x + lengthOf(fish.kind),
          ),
      )
    tank.bubbles = tank.bubbles
      .map(bubble => ({ ...bubble, y: bubble.y - 0.25 }))
      .filter(bubble => bubble.y >= 0)
      .slice(-MOST_BUBBLES)

    if (env.roll() < (env.feed.isWorking ? 0.12 : 0.04)) {
      const fish = tank.fish[Math.floor(env.roll() * tank.fish.length)]
      tank.bubbles.push(
        fish === undefined || fish.kind === 'shell'
          ? { x: Math.floor(env.roll() * env.w), y: env.h - 1 }
          : {
              x: fish.x + (fish.way > 0 ? lengthOf(fish.kind) : -1),
              y: Math.floor(fish.y / 2),
            },
      )
    }

    if (tank.shark !== undefined) {
      tank.shark.x += tank.shark.way * SHARK_SPEED
      const isGone =
        tank.shark.x < -SHARK_LENGTH - 2 || tank.shark.x > env.w + 2
      tank.shark = isGone ? undefined : tank.shark
    }
  },

  hear(tank, event, env) {
    if (event.type === 'tool') {
      stocked(tank, event.kind, env)
    } else if (event.type === 'fail' && tank.shark === undefined) {
      const way = wayOf(env)
      tank.shark = {
        way,
        x: way > 0 ? -SHARK_LENGTH : env.w,
        y: clamp(Math.floor(env.ph / 2) - 2, 0, Math.max(0, env.ph - 6)),
      }
    } else if (event.type === 'turn') {
      // The turn is done: feeding time.
      const middle = env.w * (0.2 + env.roll() * 0.6)

      for (let made = 0; made < FLAKES; made += 1) {
        tank.flakes.push({
          x: Math.floor(middle + (env.roll() - 0.5) * 12),
          y: -env.roll() * 4,
        })
      }
    }
  },

  paint(tank, canvas: Canvas, env) {
    backdrop(canvas, WATER)
    paintRays(canvas, env)
    paintSurface(canvas, env)
    paintSand(canvas, env)
    paintBed(canvas, env)

    for (const fish of tank.fish) {
      const looks = LOOKS[fish.kind]
      const beat = Math.floor(env.ticks / 5) % 2
      const sprite = isBeating(fish.kind)
        ? (looks[beat] ?? looks[0] ?? [])
        : fish.way > 0
          ? (looks[0] ?? [])
          : mirrored(looks[0] ?? [])
      stamp(canvas, fish.x, fish.y, sprite, paletteOf(fish.kind))
    }

    if (tank.shark !== undefined) {
      const { shark } = tank
      stamp(
        canvas,
        shark.x,
        shark.y,
        shark.way > 0 ? SHARK_RIGHT : mirrored(SHARK_RIGHT),
        SHARK_PALETTE,
      )
    }

    for (const flake of tank.flakes) {
      dot(canvas, flake.x, flake.y, FLAKE)
    }

    for (const bubble of tank.bubbles) {
      const height = bubble.y / Math.max(1, env.h)
      const [glyph, color] =
        height > 0.6 ? ['·', BUBBLES[0]] : height > 0.3 ? ['o', BUBBLES[1]] : ['O', BUBBLES[2]]
      write(canvas, bubble.x, bubble.y, glyph, color)
    }
  },
}
