import {
  along,
  backdrop,
  clamp,
  dot,
  fill,
  hash,
  mix,
  pick,
  rngOf,
  stamp,
  wipe,
  write,
} from '../kit'
import type { Canvas, Env, Rng, Scene } from '../kit'

import { NIGHT_TINT, label, lightOf, skyOf } from './daylight'

// One pixel of the tree: its place from the pot's middle and from the pot's
// rim upward, and the age of the tree at which it shows.
type Bud = { x: number; y: number; at: number }
// A leaf a failure shed, or what the season lets drift: petals, leaves, snow.
type Drift = { x: number; y: number; sway: number; color: string }
type Moth = { x: number; y: number; color: string }
type Garden = {
  wood: Bud[]
  leaves: Bud[]
  // The age at which the whole tree shows.
  full: number
  // The turns the tree had when the scene last looked, and how long the new
  // growth still glows.
  turns: number
  glow: number
  falling: Drift[]
  drifting: Drift[]
  moths: Moth[]
}
/**
 * What a season dresses the garden in: the foliage lit, between and in
 * shade, the far hills, the lawn's two rows, and what drifts on the air.
 */
type Season = {
  leaves: readonly [string, string, string]
  hill: string
  lawn: readonly [string, string]
  drift: readonly string[]
}

const SPRING: Season = {
  leaves: ['#ffdbe9', '#f5a3c1', '#d46b94'],
  hill: '#5f9e4b',
  lawn: ['#86c25a', '#5d983d'],
  drift: ['#ffdbe9', '#f5a3c1'],
}
const SUMMER: Season = {
  leaves: ['#b4e07a', '#6aac4c', '#3a7838'],
  hill: '#4c8c3f',
  lawn: ['#7dbd4c', '#558f38'],
  drift: [],
}
const AUTUMN: Season = {
  leaves: ['#ffd15c', '#f08a26', '#bf3d29'],
  hill: '#998c41',
  lawn: ['#a4a34e', '#7c7c35'],
  drift: ['#f08a26', '#bf3d29', '#ffd15c'],
}
// Winter keeps the needles green under a cap of snow.
const WINTER: Season = {
  leaves: ['#f2f7fb', '#4c7a59', '#30523c'],
  hill: '#c3d1dc',
  lawn: ['#edf3f7', '#cbd8e2'],
  drift: ['#ffffff', '#dfeaf3'],
}
const BARK = ['#3e2723', '#5d4037', '#8d6e63']
const NEW_GROWTH = '#e8f8c8'
const FRUIT = '#e53935'
const STEM = '#4f8a35'
const PETALS = ['#f06292', '#fdd835', '#ba68c8', '#4fc3f7', '#ff8a65', '#ffffff']
const BUTTERFLIES = ['#ffb74d', '#ba68c8', '#4fc3f7', '#fff176']
const FIREFLY = '#fff59d'
// The pot: a shallow glazed dish, its rim catching the light at one end.
const RIM = '#4f8fb3'
const RIM_SHINE = '#a3d3ec'
const GLAZE = '#2c6082'
const FOOT = '#1b3243'
// A stone lantern at the garden's edge, lit at night.
const LANTERN = [' rrr ', 'rrrrr', ' sLs ', '  s  ', ' sss ']
const STONE = '#9aa3ab'
const ROOF = '#76808a'
const PAPER = '#d8caa0'
const FLAME = '#ffcf5e'
const ROCKS = [' mgg ', 'gggggg']
const ROCKS_WIDE = 6
const ROCK = '#8b9088'
const MOSS = '#6f8f4f'
const POT_ROWS = 2
// The age a tree starts at, and what a turn adds: about forty turns to grow.
const SAPLING = 3
const TRUNK_AGE = 1.5
const AGE_A_TURN = 0.6
const GLOW_TICKS = 30
// Leaves a failed call takes off, and the most that fall at once.
const SHED_A_FAIL = 2
const MOST_FALLING = 24
const MOST_SHED = 0.5
const MOST_DRIFTING = 9
const TURNS_A_PLANT = 2
const TURNS_A_FRUIT = 4
const MOST_FRUIT = 10
const STAR_ODDS = 0.012
const FOREGROUND_LIGHT = 0.62
const SPRIG = [[0, 1], [-1, 1], [1, 2]] as const

// The season each month of the year wears, from January on.
const SEASONS = [
  WINTER,
  WINTER,
  ...[SPRING, SPRING, SPRING],
  ...[SUMMER, SUMMER, SUMMER],
  ...[AUTUMN, AUTUMN, AUTUMN],
  WINTER,
]

const seasonOf = (month: number): Season => SEASONS[month - 1] ?? WINTER




const isDark = (hour: number): boolean => lightOf(hour) < 0.7

const ageOf = (turns: number): number => SAPLING + turns * AGE_A_TURN

/**
 * The whole tree a seed grows into, for the room there is: every pixel of
 * wood and leaf with the age it appears at, so a turn only ever adds to it.
 * A leaning trunk, a branch or two to the sides, and a pad of leaves at
 * every tip.
 */
const grown = (
  seed: number,
  half: number,
  top: number,
): Pick<Garden, 'wood' | 'leaves' | 'full'> => {
  const roll: Rng = rngOf(seed)
  const wood: Bud[] = []
  const leaves: Bud[] = []
  const pad = (x: number, y: number, wide: number, tall: number, born: number): void => {
    for (let dx = -wide; dx <= wide; dx += 1) {
      for (let dy = -tall; dy <= tall; dy += 1) {
        const far = Math.hypot(dx / (wide + 0.5), dy / (tall + 0.5))

        if (far <= 1 && roll() < 0.93) {
          leaves.push({
            x: clamp(x + dx, -half, half),
            y: clamp(y + dy, 1, top - 1),
            at: born + 1 + Math.round(far * 4),
          })
        }
      }
    }
  }
  const height = Math.max(2, top - 3)
  const branches = top >= 12 ? 3 : 2
  const forks = Array.from({ length: branches }, (_, index) =>
    Math.max(1, Math.round(height * (0.3 + (0.5 * index) / branches))),
  )
  let lean = roll() < 0.5 ? -1 : 1
  let x = 0

  for (let y = 0; y <= height; y += 1) {
    const at = y * TRUNK_AGE
    // The trunk leans one way, then back: the curve a bonsai is wired into.
    lean = y === Math.ceil(height / 2) ? -lean : lean
    x = clamp(x + (y > 0 && roll() < 0.5 ? lean : 0), -half, half)
    wood.push({ x, y, at })

    if (y < height / 2) {
      wood.push({ x: x + 1, y, at })
    }

    const fork = forks.indexOf(y)

    if (fork >= 0) {
      const side = fork % 2 === 0 ? -lean : lean
      const reach = clamp(3 + Math.floor(roll() * 4), 2, half)
      let tipX = x
      let tipY = y

      for (let out = 1; out <= reach; out += 1) {
        tipX = clamp(tipX + side, -half, half)
        tipY = Math.min(top - 2, tipY + (roll() < 0.3 ? 1 : 0))
        wood.push({ x: tipX, y: tipY, at: at + out })
      }

      pad(tipX, tipY + 1, 2 + Math.floor(roll() * 3), top >= 12 ? 2 : 1, at + reach)
    }
  }

  pad(x, height + 1, 3 + Math.floor(roll() * 3), top >= 12 ? 2 : 1, height * TRUNK_AGE)
  const byAge = (one: Bud, other: Bud): number => one.at - other.at

  return {
    wood: wood.sort(byAge),
    leaves: leaves.sort(byAge),
    full: Math.max(0, ...leaves.map(leaf => leaf.at), ...wood.map(bud => bud.at)),
  }
}

/** The leaves that show: those the tree is old enough for, less those shed. */
const shownLeaves = (garden: Garden, env: Env): Bud[] => {
  const age = ageOf(env.feed.tree.turns)
  const out = garden.leaves.filter(leaf => leaf.at <= age)
  const shed = Math.min(
    Math.floor(out.length * MOST_SHED),
    env.feed.tree.shed * SHED_A_FAIL,
  )

  return out.slice(0, out.length - shed)
}

/** How far the pot reaches each side of its middle: a wide, shallow dish. */
const potHalfOf = (env: Env): number => clamp(Math.round(env.pw / 14), 3, 7)

/** The sun by day and the moon by night, on an arc over the garden. */
const paintSky = (canvas: Canvas, env: Env, sky: readonly string[]): void => {
  const { hour } = env.feed
  const isDay = hour >= 6 && hour < 20
  const share = isDay ? (hour - 6 + 0.5) / 14 : (((hour + 4) % 24) + 0.5) / 10
  // The sun and the moon keep to the sky right of the tree, never behind it.
  const x = Math.round(env.pw * 0.64 + share * (env.pw * 0.3))
  const y = Math.round((1 - Math.sin(share * Math.PI)) * env.ph * 0.4) + 1
  const isLow = hour < 8 || hour >= 17
  const core = isDay ? (isLow ? '#ffdca6' : '#fff8d6') : '#f4f0d4'
  const rim = isDay ? (isLow ? '#ffa05c' : '#ffd54f') : '#d9d4b4'
  const halo = mix(along(sky, y / Math.max(1, env.ph - 1)), rim, 0.45)

  if (isDark(hour)) {
    const top = Math.floor(env.ph * 0.7)

    for (let row = 0; row < top; row += 1) {
      for (let column = 0; column < env.pw; column += 1) {
        if (hash(column * 7 + 3, row * 13 + 5) < STAR_ODDS) {
          // Most stars are faint; a few are bright, and they twinkle.
          const isBright =
            hash(column, row) > 0.7 && hash(column, row + Math.floor(env.ticks / 9)) > 0.2
          const faint = mix(sky[0] ?? NIGHT_TINT, '#c5cff0', 0.55)
          dot(canvas, column, row, isBright ? '#f4f6ff' : faint)
        }
      }
    }
  }

  dot(canvas, x - 1, y - 1, halo)
  dot(canvas, x + 1, y - 1, halo)
  dot(canvas, x - 1, y + 1, halo)
  // The moon's shadowed edge: a crescent rather than a full disc.
  dot(canvas, x + 1, y + 1, isDay ? halo : mix(halo, NIGHT_TINT, 0.6))
  dot(canvas, x, y - 1, rim)
  dot(canvas, x - 1, y, rim)
  dot(canvas, x + 1, y, rim)
  dot(canvas, x, y + 1, rim)
  dot(canvas, x, y, core)
}

/**
 * The height of a row of rounded hills at a column: a few bumps, each with a
 * place and a breadth of its own, the tallest one showing.
 */
const hillAt = (x: number, seed: number, pitch: number, tall: number): number => {
  const first = Math.floor(x / pitch) - 1
  let most = 0

  for (let bump = first; bump <= first + 2; bump += 1) {
    const middle = (bump + hash(bump, seed)) * pitch
    const reach = pitch * (0.7 + hash(bump, seed + 1) * 0.6)
    const far = (x - middle) / reach

    if (Math.abs(far) < 1) {
      const height = tall * (0.55 + hash(bump, seed + 2) * 0.45)
      most = Math.max(most, height * Math.cos((far * Math.PI) / 2))
    }
  }

  return Math.round(most)
}

/** Two rows of hills behind the lawn, the far one half lost in the haze. */
const paintHills = (
  canvas: Canvas,
  env: Env,
  sky: readonly string[],
  light: number,
): void => {
  const { hill } = seasonOf(env.feed.month)
  const haze = sky.at(-1) ?? NIGHT_TINT
  const far = mix(NIGHT_TINT, mix(haze, hill, 0.4), light)
  const near = mix(NIGHT_TINT, mix(haze, hill, 0.75), light)
  const ground = env.ph - 2
  const { seed } = env.feed.tree

  for (let x = 0; x < env.pw; x += 1) {
    const back = Math.max(1, hillAt(x, seed, 26, env.ph * 0.42))
    const front = Math.max(1, hillAt(x + 9, seed + 7, 17, env.ph * 0.22))
    fill(canvas, x, ground - back, 1, back, far)
    fill(canvas, x, ground - front, 1, front, near)
  }
}

/**
 * The lawn, a stone lantern and some rocks, and the garden around the
 * tree: a plant sprouts every other turn and grows with the turns after it.
 */
const paintGarden = (
  canvas: Canvas,
  env: Env,
  middle: number,
  room: number,
  light: number,
): void => {
  const { seed, turns } = env.feed.tree
  const season = seasonOf(env.feed.month)
  const lit = (color: string): string => mix(NIGHT_TINT, color, light)
  const floor = env.ph - 1
  fill(canvas, 0, floor - 1, env.pw, 1, lit(season.lawn[0]))
  fill(canvas, 0, floor, env.pw, 1, lit(season.lawn[1]))

  // Tufts of grass at the lawn's back edge.
  for (let x = 0; x < env.pw; x += 1) {
    if (hash(x, seed + 3) < 0.07) {
      dot(canvas, x, floor - 1, lit(season.lawn[1]))
    }
  }

  const lantern = middle - room - 9

  if (env.ph >= 8 && lantern >= 1) {
    const isNight = isDark(env.feed.hour)
    stamp(canvas, lantern, floor - 1 - LANTERN.length + 1, LANTERN, {
      r: lit(ROOF),
      s: lit(STONE),
      L: isNight ? FLAME : lit(PAPER),
    })

    if (isNight) {
      // The flame lights the lawn under it.
      fill(canvas, lantern, floor - 1, 5, 1, mix(lit(season.lawn[0]), FLAME, 0.25))
    }
  }

  const rocks = middle + room + 6

  if (rocks + ROCKS_WIDE < env.pw - 1) {
    stamp(canvas, rocks, floor - 2, ROCKS, { g: lit(ROCK), m: lit(MOSS) })
  }

  const plants = Math.min(Math.floor(turns / TURNS_A_PLANT), Math.floor(env.pw / 5))

  for (let plant = 0; plant < plants; plant += 1) {
    const x = Math.floor(hash(seed, plant * 13 + 1) * env.pw)
    const stage = clamp(1 + Math.floor((turns - plant * TURNS_A_PLANT) / 3), 1, 3)

    if (Math.abs(x - middle) > room + 2 && Math.abs(x - lantern - 2) > 3) {
      for (let up = 1; up <= Math.min(stage, 2); up += 1) {
        dot(canvas, x, floor - up, lit(STEM))
      }

      if (stage === 3 && hash(seed, plant * 13 + 2) < 0.7) {
        dot(canvas, x, floor - 3, lit(pick(PETALS, hash(seed, plant * 13 + 3)) ?? FRUIT))
      }
    }
  }
}

/** The dish the tree grows in: a bright rim, a deep glaze and two feet. */
const paintPot = (canvas: Canvas, env: Env, middle: number, light: number): void => {
  const half = potHalfOf(env)
  const lit = (color: string): string => mix(NIGHT_TINT, color, light)
  const rim = env.ph - POT_ROWS
  fill(canvas, middle - half, rim, half * 2 + 1, 1, lit(RIM))
  fill(canvas, middle - half + 1, rim, 2, 1, lit(RIM_SHINE))
  fill(canvas, middle - half + 1, rim + 1, half * 2 - 1, 1, lit(GLAZE))
  dot(canvas, middle - half + 1, rim + 1, lit(FOOT))
  dot(canvas, middle + half - 1, rim + 1, lit(FOOT))
}

/** The tree: wood lit from the right, leaves lit from above. */
const paintTree = (
  canvas: Canvas,
  garden: Garden,
  env: Env,
  middle: number,
  light: number,
): void => {
  const { turns } = env.feed.tree
  const lit = (color: string): string => mix(NIGHT_TINT, color, light)
  // The pixel row the pot's rim is in: the tree stands on it.
  const rim = env.ph - 1 - POT_ROWS
  const age = ageOf(turns)
  // What the last turn added glows for a moment.
  const before = garden.glow > 0 ? ageOf(turns - 1) : age
  const [bright, mid, deep] = seasonOf(env.feed.month).leaves
  const wood = garden.wood.filter(bud => bud.at <= age)
  const isWood = new Set(wood.map(bud => `${bud.x},${bud.y}`))

  for (const bud of wood) {
    const isThickLeft = isWood.has(`${bud.x + 1},${bud.y}`)
    const isThickRight = isWood.has(`${bud.x - 1},${bud.y}`)
    const knot = hash(bud.x * 5, bud.y * 3) < 0.15
    const bark = isThickLeft || knot ? BARK[0] : isThickRight ? BARK[2] : BARK[1]
    const color = bud.at > before ? NEW_GROWTH : lit(bark ?? NIGHT_TINT)
    dot(canvas, middle + bud.x, rim - bud.y, color)
  }

  const leaves = shownLeaves(garden, env)
  const isLeaf = new Set(leaves.map(leaf => `${leaf.x},${leaf.y}`))
  const tip = wood.at(-1)

  // A sapling too young for its first pad of leaves wears a sprig.
  if (leaves.length < SPRIG.length && tip !== undefined) {
    for (const [dx, dy] of SPRIG) {
      dot(canvas, middle + tip.x + dx, rim - tip.y - dy, lit(mid))
    }
  }

  for (const leaf of leaves) {
    const isTop = !isLeaf.has(`${leaf.x},${leaf.y + 1}`)
    const isUnder = !isLeaf.has(`${leaf.x},${leaf.y - 1}`)
    const color = isTop ? bright : isUnder ? deep : mid
    dot(canvas, middle + leaf.x, rim - leaf.y, leaf.at > before ? NEW_GROWTH : lit(color))
  }

  // A grown tree bears fruit, one more every few turns.
  const ripe = Math.floor((age - garden.full) / AGE_A_TURN / TURNS_A_FRUIT)

  for (let fruit = 0; fruit < Math.min(ripe, MOST_FRUIT, leaves.length); fruit += 1) {
    const leaf = leaves[Math.floor(hash(fruit, env.feed.tree.seed) * leaves.length)]

    if (leaf !== undefined) {
      dot(canvas, middle + leaf.x, rim - leaf.y, lit(FRUIT))
    }
  }
}

const drifted = (drift: Drift, env: Env, fall: number): Drift => ({
  ...drift,
  y: drift.y + fall,
  x: drift.x + Math.sin(env.ticks * 0.25 + drift.sway) * 0.35,
})

export const bonsai: Scene<Garden> = {
  start(env) {
    const top = Math.max(3, env.ph - POT_ROWS)
    const half = clamp(Math.floor(env.pw / 2) - 2, 4, top * 2)

    return {
      ...grown(env.feed.tree.seed, half, top),
      turns: env.feed.tree.turns,
      glow: 0,
      falling: [],
      drifting: [],
      moths: [],
    }
  },

  step(garden, env) {
    const floor = env.ph - 1
    garden.glow = Math.max(0, garden.glow - 1)
    garden.falling = garden.falling
      .map(leaf => drifted(leaf, env, 0.22))
      .filter(leaf => leaf.y < floor)

    // The season drifts across the garden on its own: petals, leaves, snow.
    const { drift } = seasonOf(env.feed.month)

    if (drift.length > 0 && garden.drifting.length < MOST_DRIFTING && env.roll() < 0.06) {
      garden.drifting.push({
        x: env.roll() * env.pw,
        y: -1,
        sway: env.roll() * 6,
        color: pick(drift, env.roll()) ?? '#ffffff',
      })
    }

    garden.drifting = garden.drifting
      .map(flake => ({ ...drifted(flake, env, 0.12), x: flake.x + 0.15 }))
      .filter(flake => flake.y < floor)

    // Moths come out while Claude works and wander off when it rests.
    if (env.feed.isWorking && garden.moths.length < 2 && env.roll() < 0.02) {
      garden.moths.push({
        x: env.roll() * env.pw,
        y: env.roll() * (env.ph - 3),
        color: pick(BUTTERFLIES, env.roll()) ?? FRUIT,
      })
    }

    garden.moths = garden.moths
      .map(moth => ({
        ...moth,
        x: moth.x + (env.roll() - 0.5) * 1.6,
        y: clamp(moth.y + (env.roll() - 0.5) * 0.9, 0, env.ph - 3),
      }))
      .filter(() => env.feed.isWorking || env.roll() > 0.02)
  },

  hear(garden, event, env) {
    if (event.type === 'turn') {
      // An interrupted turn grows nothing, so nothing glows for it.
      garden.glow = env.feed.tree.turns > garden.turns ? GLOW_TICKS : 0
      garden.turns = env.feed.tree.turns
    } else if (event.type === 'fail') {
      const middle = Math.floor(env.pw / 2)
      const rim = env.ph - 1 - POT_ROWS
      const palette = seasonOf(env.feed.month).leaves
      const out = shownLeaves(garden, env)

      for (let made = 0; made < SHED_A_FAIL; made += 1) {
        const leaf = out[Math.floor(env.roll() * out.length)]

        if (leaf !== undefined) {
          garden.falling.push({
            x: middle + leaf.x,
            y: rim - leaf.y,
            sway: env.roll() * 6,
            color: pick(palette, env.roll()) ?? STEM,
          })
        }
      }

      garden.falling = garden.falling.slice(-MOST_FALLING)
    }
  },

  paint(garden, canvas, env) {
    const { turns } = env.feed.tree
    const { hour } = env.feed
    const middle = Math.floor(env.pw / 2)
    const sky = skyOf(hour)
    const light = lightOf(hour)
    const room = Math.max(potHalfOf(env), ...garden.wood.map(bud => Math.abs(bud.x)))

    backdrop(canvas, sky)
    paintSky(canvas, env, sky)
    paintHills(canvas, env, sky, light)
    paintGarden(canvas, env, middle, room, light)
    // The tree is what the garden is for: the night takes less of it.
    paintPot(canvas, env, middle, Math.max(light, FOREGROUND_LIGHT))
    paintTree(canvas, garden, env, middle, Math.max(light, FOREGROUND_LIGHT))

    for (const drift of [...garden.drifting, ...garden.falling]) {
      dot(canvas, drift.x, drift.y, mix(NIGHT_TINT, drift.color, Math.max(light, 0.6)))
    }

    for (const moth of garden.moths) {
      if (isDark(hour)) {
        // At night the moths are fireflies, glowing on and off.
        if (hash(Math.floor(moth.x), Math.floor(env.ticks / 4)) < 0.7) {
          dot(canvas, moth.x, moth.y, FIREFLY)
        }
      } else if (Math.floor(env.ticks / 2) % 2 === 0) {
        // Two wings spread, then folded to one pixel.
        dot(canvas, moth.x - 1, moth.y, moth.color)
        dot(canvas, moth.x + 1, moth.y, moth.color)
      } else {
        dot(canvas, moth.x, moth.y, moth.color)
      }
    }

    const caption = turns === 1 ? '1 turn old' : `${turns} turns old`
    const text = turns === 0 ? 'just planted' : caption
    label(canvas, 0, text, sky)
  },
}
