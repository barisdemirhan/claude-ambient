import { FAIL_COLOR, KINDS, KIND_COLORS } from '../catalog'
import type { Kind } from '../catalog'
import { along, dot, fill, mix, shade, write } from '../kit'
import type { Canvas, Env, Scene } from '../kit'

type Dish = {
  wide: number
  tall: number
  // Every cell, row by row: 0 is dead, else one more than its color's index.
  cells: number[]
  // The generations each cell has lived.
  ages: number[]
  // What a cell that died leaves: the color it had, as `cells` counts them,
  // and how bright its afterglow still is, fading a step a generation.
  ghosts: number[]
  glows: number[]
  // The generations bred since the dish was set out.
  generation: number
}
type Shape = readonly (readonly [number, number])[]

// The colors a cell can carry: one per kind of call, and the blight's last.
const COLORS = [...KINDS.map(kind => KIND_COLORS[kind]), FAIL_COLOR]
const OLD_COLORS = COLORS.map(color => shade(color, 0.6))
// A cell just born shines brighter than it will once it has settled.
const NEW_COLORS = COLORS.map(color => mix(color, '#ffffff', 0.5))
const NEW_AGE = 1
const BLIGHT = COLORS.length
// The lab screen the dish is shown on: darkest at its edges, a faint grid
// over it every few pixels, and a readout of the generation in a corner.
const SCREEN = ['#04090d', '#08141c', '#0c1d28']
const GRID = '#0c1b25'
const GRID_MARK = '#1a3442'
const GRID_COLUMNS = 20
const GRID_ROWS = 5
const SCREEN_STEPS = 3
const READOUT = '#5b8b9b'
const READOUT_BACK = '#050b10'
const READOUT_COLUMNS = 40
// How bright a dead cell's afterglow starts, in steps, and how much of its
// color the brightest step carries.
const GLOW_STEPS = 3
const GLOW_SHARE = 0.5
const GLOW_BASE = '#08141c'
const OLD_AGE = 12
// The dish opens with a pattern for about this many columns of it, so there
// is life before the first call.
const OPENING_COLUMNS = 12
// The share of the dish's pixels that may live at once. Every lit pixel on a
// painted screen splits its row's runs, and a band past the engine's size is
// not drawn at all: on a crowded dish the oldest settle out, fading as any
// cell that dies.
const MOST_ALIVE = 0.045
const BLIGHT_REACH = 4
const WORKING_PACE = 2
const IDLE_PACE = 6
const GLIDER: Shape = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]]
const TOAD: Shape = [[1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1]]
const R_PENTOMINO: Shape = [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]]
const SPACESHIP: Shape = [[1, 0], [4, 0], [0, 1], [0, 2], [4, 2], [0, 3], [1, 3], [2, 3], [3, 3]]
const ACORN: Shape = [[1, 0], [3, 1], [0, 2], [1, 2], [4, 2], [5, 2], [6, 2]]
const PI: Shape = [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]]
const DIEHARD: Shape = [[6, 0], [0, 1], [1, 1], [1, 2], [5, 2], [6, 2], [7, 2]]
// What each kind of call drops into the dish.
const SHAPES: Readonly<Record<Kind, Shape>> = {
  read: GLIDER,
  search: TOAD,
  edit: R_PENTOMINO,
  shell: SPACESHIP,
  web: ACORN,
  agent: PI,
  mcp: DIEHARD,
  other: GLIDER,
}

/** A cell's place in the list: the dish wraps around at every edge. */
const placeOf = (dish: Dish, x: number, y: number): number =>
  ((y + dish.tall) % dish.tall) * dish.wide + ((x + dish.wide) % dish.wide)

/** The most cells a dish may hold alive at once. */
const mostOf = (dish: Dish): number => Math.floor(dish.cells.length * MOST_ALIVE)

/** The oldest cells over the most a dish may hold settle out into afterglow. */
const thinned = (
  cells: number[],
  ages: number[],
  ghosts: number[],
  glows: number[],
  most: number,
): void => {
  const alive = cells.flatMap((cell, at) => (cell === 0 ? [] : [at]))

  if (alive.length <= most) {
    return
  }

  const oldest = alive.sort((one, other) => (ages[other] ?? 0) - (ages[one] ?? 0))

  for (const at of oldest.slice(0, alive.length - most)) {
    ghosts[at] = cells[at] ?? 0
    glows[at] = GLOW_STEPS
    cells[at] = 0
    ages[at] = 0
  }
}

const seeded = (dish: Dish, kind: Kind, env: Env): void => {
  const left = Math.floor(env.roll() * dish.wide)
  const top = Math.floor(env.roll() * dish.tall)
  const isFlipped = env.roll() < 0.5
  const isTurned = env.roll() < 0.5
  const color = KINDS.indexOf(kind) + 1

  for (const [dx, dy] of SHAPES[kind]) {
    const at = placeOf(dish, left + (isFlipped ? -dx : dx), top + (isTurned ? -dy : dy))
    dish.cells[at] = color
    dish.ages[at] = 0
  }

  // A burst of calls must not crowd the dish past its most either.
  thinned(dish.cells, dish.ages, dish.ghosts, dish.glows, mostOf(dish))
}

/** A failed call clears a patch of the dish and leaves a red tangle in it. */
const blighted = (dish: Dish, env: Env): void => {
  const middleX = Math.floor(env.roll() * dish.wide)
  const middleY = Math.floor(env.roll() * dish.tall)

  for (let dx = -BLIGHT_REACH; dx <= BLIGHT_REACH; dx += 1) {
    for (let dy = -BLIGHT_REACH; dy <= BLIGHT_REACH; dy += 1) {
      const far = Math.hypot(dx, dy)

      if (far <= BLIGHT_REACH) {
        const at = placeOf(dish, middleX + dx, middleY + dy)
        dish.cells[at] = far <= BLIGHT_REACH - 1 && env.roll() < 0.5 ? BLIGHT : 0
        dish.ages[at] = 0
      }
    }
  }
}

/**
 * The next generation: a birth takes the color most of its parents carry,
 * and a cell that dies glows on for a few generations where it was.
 */
const bred = (dish: Dish): void => {
  const cells = new Array<number>(dish.cells.length).fill(0)
  const ages = new Array<number>(dish.cells.length).fill(0)
  const ghosts = [...dish.ghosts]
  const glows = dish.glows.map(glow => Math.max(0, glow - 1))

  for (let y = 0; y < dish.tall; y += 1) {
    for (let x = 0; x < dish.wide; x += 1) {
      const parents: number[] = []

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const neighbor = dish.cells[placeOf(dish, x + dx, y + dy)] ?? 0

          if (neighbor !== 0 && (dx !== 0 || dy !== 0)) {
            parents.push(neighbor)
          }
        }
      }

      const at = y * dish.wide + x
      const own = dish.cells[at] ?? 0

      if (own !== 0 && (parents.length === 2 || parents.length === 3)) {
        cells[at] = own
        ages[at] = (dish.ages[at] ?? 0) + 1
      } else if (own === 0 && parents.length === 3) {
        const [first = 0, second = 0, third = 0] = parents
        cells[at] = second === third ? second : first
      } else if (own !== 0) {
        ghosts[at] = own
        glows[at] = GLOW_STEPS
      }
    }
  }

  thinned(cells, ages, ghosts, glows, mostOf(dish))
  dish.cells = cells
  dish.ages = ages
  dish.ghosts = ghosts
  dish.glows = glows
  dish.generation += 1
}

/** The screen's color at a pixel: lighter toward its middle, in steps. */
const screenAt = (dish: Dish, x: number, y: number): string => {
  // The grid's lines run across; where a column of it would cross them, a
  // brighter mark stands. Lines down the band would split every row into
  // many more runs for little more to see.
  if (y % GRID_ROWS === GRID_ROWS - 1) {
    return x % GRID_COLUMNS === GRID_COLUMNS - 1 ? GRID_MARK : GRID
  }

  // The light falls off in rings, round as the dish under it.
  const across = Math.abs(x / Math.max(1, dish.wide - 1) - 0.5) * 2
  const down = Math.abs(y / Math.max(1, dish.tall - 1) - 0.5) * 2

  return along(SCREEN, 1 - Math.hypot(across, down * 0.7), SCREEN_STEPS)
}

/** The color a living cell shows: bright when new, settled, then dimmer. */
const livingColor = (cell: number, age: number): string => {
  const colors = age <= NEW_AGE ? NEW_COLORS : age > OLD_AGE ? OLD_COLORS : COLORS

  return colors[cell - 1] ?? FAIL_COLOR
}

/** The generation in a corner, on the screen, where the band is wide enough. */
const readout = (dish: Dish, canvas: Canvas, env: Env): void => {
  const alive = dish.cells.filter(cell => cell !== 0).length
  const text = `gen ${dish.generation} · ${alive} alive`

  if (env.w >= READOUT_COLUMNS) {
    // The readout sits on a dark strip of its own, so no cell shows through
    // behind its letters.
    const left = env.w - text.length - 2
    fill(canvas, left, env.ph - 2, text.length + 2, 2, READOUT_BACK)
    write(canvas, left + 1, env.h - 1, text, READOUT)
  }
}

export const life: Scene<Dish> = {
  start(env) {
    const size = env.pw * env.ph
    const dish: Dish = {
      wide: env.pw,
      tall: env.ph,
      cells: new Array<number>(size).fill(0),
      ages: new Array<number>(size).fill(0),
      ghosts: new Array<number>(size).fill(0),
      glows: new Array<number>(size).fill(0),
      generation: 0,
    }

    for (let made = 0; made < Math.max(1, Math.round(env.pw / OPENING_COLUMNS)); made += 1) {
      seeded(dish, KINDS[Math.floor(env.roll() * KINDS.length)] ?? 'read', env)
    }

    return dish
  },

  step(dish, env) {
    if (env.ticks % (env.feed.isWorking ? WORKING_PACE : IDLE_PACE) === 0) {
      bred(dish)
    }
  },

  hear(dish, event, env) {
    if (event.type === 'tool') {
      seeded(dish, event.kind, env)
    } else if (event.type === 'fail') {
      blighted(dish, env)
    }
  },

  paint(dish, canvas, env) {
    for (let y = 0; y < dish.tall; y += 1) {
      for (let x = 0; x < dish.wide; x += 1) {
        const at = y * dish.wide + x
        const cell = dish.cells[at] ?? 0
        const glow = dish.glows[at] ?? 0
        const screen = screenAt(dish, x, y)

        if (cell !== 0) {
          dot(canvas, x, y, livingColor(cell, dish.ages[at] ?? 0))
        } else if (glow > 0) {
          // Faded against one color of the screen, not the ring it lies in:
          // a trail is then one color along its length, and costs one run.
          const color = COLORS[(dish.ghosts[at] ?? 1) - 1] ?? FAIL_COLOR
          dot(canvas, x, y, mix(GLOW_BASE, color, (glow / GLOW_STEPS) * GLOW_SHARE))
        } else {
          dot(canvas, x, y, screen)
        }
      }
    }

    readout(dish, canvas, env)
  },
}
