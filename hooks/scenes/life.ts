import { FAIL_COLOR, KINDS, KIND_COLORS } from '../catalog'
import type { Kind } from '../catalog'
import { dot, shade } from '../kit'
import type { Env, Scene } from '../kit'

type Dish = {
  wide: number
  tall: number
  // Every cell, row by row: 0 is dead, else one more than its color's index.
  cells: number[]
  // The generations each cell has lived.
  ages: number[]
}
type Shape = readonly (readonly [number, number])[]

// The colors a cell can carry: one per kind of call, and the blight's last.
const COLORS = [...KINDS.map(kind => KIND_COLORS[kind]), FAIL_COLOR]
const OLD_COLORS = COLORS.map(color => shade(color, 0.6))
const BLIGHT = COLORS.length
const OLD_AGE = 12
const SOUP = 0.14
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

/** The next generation: a birth takes the color most of its parents carry. */
const bred = (dish: Dish): void => {
  const cells = new Array<number>(dish.cells.length).fill(0)
  const ages = new Array<number>(dish.cells.length).fill(0)

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
      }
    }
  }

  dish.cells = cells
  dish.ages = ages
}

export const life: Scene<Dish> = {
  start(env) {
    const size = env.pw * env.ph

    // A thin soup to begin with, so there is life before the first call.
    return {
      wide: env.pw,
      tall: env.ph,
      cells: Array.from({ length: size }, () =>
        env.roll() < SOUP ? 1 + Math.floor(env.roll() * KINDS.length) : 0,
      ),
      ages: new Array<number>(size).fill(0),
    }
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

  paint(dish, canvas) {
    dish.cells.forEach((cell, at) => {
      if (cell !== 0) {
        const colors = (dish.ages[at] ?? 0) > OLD_AGE ? OLD_COLORS : COLORS
        dot(canvas, at % dish.wide, Math.floor(at / dish.wide), colors[cell - 1] ?? FAIL_COLOR)
      }
    })
  },
}
