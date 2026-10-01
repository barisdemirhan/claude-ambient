import { KINDS, KIND_COLORS, kindAt } from '../catalog'
import type { Kind } from '../catalog'
import { BOLD, DIM, FG, clamp, hash, write } from '../kit'
import type { Canvas, Env, Scene } from '../kit'

type Way = 1 | -1
type Fish = {
  kind: Kind
  x: number
  row: number
  way: Way
  speed: number
  // True once the tank is full and this one swims out to make room.
  isLeaving: boolean
  // Ticks it keeps fleeing the shark.
  fear: number
}
type Bubble = { x: number; y: number }
type Flake = { x: number; y: number }
type Shark = { x: number; row: number; way: Way }
type Tank = {
  fish: Fish[]
  bubbles: Bubble[]
  flakes: Flake[]
  shark: Shark | undefined
}
type Look = { right: readonly string[]; left: readonly string[] }

const WEED = '#66bb6a'
const FLAKE = '#ffca28'
const SHARK = '#b0bec5'
// Each kind of tool call is a species; the crab walks the sand, the jellyfish
// is two rows tall.
const LOOKS: Readonly<Record<Kind, Look>> = {
  read: { right: ['><>'], left: ['<><'] },
  search: { right: ['}°>'], left: ['<°{'] },
  edit: { right: ['><))°>'], left: ['<°((><'] },
  shell: { right: ['v°°v'], left: ['^°°^'] },
  web: { right: ['.-.', "'|'"], left: ['.-.', "|'|"] },
  agent: { right: ['><(((((°>'], left: ['<°)))))><'] },
  mcp: { right: ['>|°>'], left: ['<°|<'] },
  other: { right: ['>->'], left: ['<-<'] },
}
const SHARK_RIGHT = ['      /|', '>=<=======°>']
const SHARK_LEFT = ['    |\\', '<°=======>=<']
const SHARK_LENGTH = 12
const SHARK_SPEED = 1.1
const FEAR_REACH = 18
const FEAR_TICKS = 24
const FLAKES = 7
const MOST_BUBBLES = 40
const STOCKED = 3

const lengthOf = (kind: Kind): number => LOOKS[kind].right[0]?.length ?? 3

const mostFish = (env: Env): number => clamp(Math.floor(env.w / 8), 4, 14)

/** The lowest row a kind swims in: the crab walks the sand, the rest stay over it. */
const deepest = (kind: Kind, env: Env): number =>
  kind === 'shell' ? env.h - 1 : Math.max(0, env.h - 1 - LOOKS[kind].right.length)

const rowFor = (kind: Kind, env: Env): number =>
  kind === 'shell' ? env.h - 1 : Math.floor(env.roll() * (deepest(kind, env) + 1))

const wayOf = (env: Env): Way => (env.roll() < 0.5 ? 1 : -1)

const fishOf = (kind: Kind, env: Env, isInside: boolean): Fish => {
  const way = wayOf(env)
  const outside = way > 0 ? -lengthOf(kind) : env.w

  return {
    kind,
    x: isInside ? env.roll() * (env.w - lengthOf(kind)) : outside,
    row: rowFor(kind, env),
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
    fish.row =
      env.roll() < 0.1
        ? clamp(fish.row + Math.sign(Math.floor(flake.y) - fish.row), 0, deepest(fish.kind, env))
        : fish.row
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

  if (fish.kind !== 'shell' && fish.fear === 0 && env.roll() < 0.02) {
    fish.row = clamp(fish.row + (env.roll() < 0.5 ? 1 : -1), 0, deepest(fish.kind, env))
  }
}

const isInTank = (fish: Fish, env: Env): boolean =>
  fish.x > -lengthOf(fish.kind) - 2 && fish.x < env.w + 2

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
      .map(flake => ({ ...flake, y: flake.y + 0.1 }))
      .filter(
        flake =>
          flake.y < env.h - 1 &&
          !tank.fish.some(
            fish =>
              fish.row === Math.floor(flake.y) &&
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
          : { x: fish.x + (fish.way > 0 ? lengthOf(fish.kind) : -1), y: fish.row },
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
        row: clamp(Math.floor(env.h / 2), 1, Math.max(1, env.h - 2)),
      }
    } else if (event.type === 'turn') {
      // The turn is done: feeding time.
      const middle = env.w * (0.2 + env.roll() * 0.6)

      for (let made = 0; made < FLAKES; made += 1) {
        tank.flakes.push({
          x: Math.floor(middle + (env.roll() - 0.5) * 12),
          y: -env.roll() * 2,
        })
      }
    }
  },

  paint(tank, canvas: Canvas, env) {
    const floor = env.h - 1

    for (let x = 0; x < env.w; x += 1) {
      const grain = hash(x, 3)
      const sand = grain < 0.6 ? '.' : grain < 0.75 ? ',' : grain < 0.85 ? '_' : ' '
      write(canvas, x, floor, sand, FG, DIM)

      if (hash(x, 7) < 0.07) {
        const tall = 1 + Math.floor(hash(x, 8) * clamp(env.h - 2, 1, 3))

        for (let up = 0; up < tall; up += 1) {
          const sway = (Math.floor(env.ticks / 7) + up + x) % 2 === 0
          write(canvas, x, floor - up, sway ? '(' : ')', WEED)
        }
      }
    }

    for (const flake of tank.flakes) {
      write(canvas, flake.x, flake.y, '·', FLAKE)
    }

    for (const bubble of tank.bubbles) {
      const size = bubble.y > env.h * 0.6 ? '.' : bubble.y > env.h * 0.3 ? 'o' : 'O'
      write(canvas, bubble.x, bubble.y, size, FG, DIM)
    }

    for (const fish of tank.fish) {
      const look = LOOKS[fish.kind]
      // The crab and the jellyfish have no sides: their two looks are a beat.
      const isBeating = fish.kind === 'shell' || fish.kind === 'web'
      const isFirst = isBeating
        ? Math.floor(env.ticks / 5) % 2 === 0
        : fish.way > 0
      const lines = isFirst ? look.right : look.left

      lines.forEach((line, down) => {
        write(canvas, fish.x, fish.row + down, line, KIND_COLORS[fish.kind])
      })
    }

    if (tank.shark !== undefined) {
      const { shark } = tank
      const lines = shark.way > 0 ? SHARK_RIGHT : SHARK_LEFT

      lines.forEach((line, down) => {
        write(canvas, shark.x, shark.row - 1 + down, line, SHARK, BOLD)
      })
    }
  },
}
