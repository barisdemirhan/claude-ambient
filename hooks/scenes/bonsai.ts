import { DIM, FG, clamp, dot, hash, pick, rngOf, sign, stamp } from '../kit'
import type { Canvas, Env, Rng, Scene } from '../kit'

// One pixel of the tree: its place from the pot's middle and from the pot's
// rim upward, and the age of the tree at which it shows.
type Bud = { x: number; y: number; at: number }
type Leaf = { x: number; y: number; sway: number; color: string }
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
  falling: Leaf[]
  moths: Moth[]
}

const WOOD = ['#8d6e63', '#795548', '#6d4c41']
const NEW_GROWTH = '#dcedc8'
const FRUIT = '#e53935'
const GRASS = '#7cb342'
const SOIL = '#558b2f'
const STEM = '#558b2f'
const PETALS = ['#f06292', '#fdd835', '#ba68c8', '#4fc3f7', '#ff8a65']
const MOTHS = ['#ffb74d', '#ba68c8', '#4fc3f7']
// What the leaves wear, by the month on the person's clock.
const SPRING = ['#f06292', '#f48fb1', '#81c784']
const SUMMER = ['#66bb6a', '#43a047', '#9ccc65']
const AUTUMN = ['#ff8f00', '#e64a19', '#fbc02d']
const WINTER = ['#4d7c5a', '#5f8f6b', '#90a4ae']
const POT = ['ppppppp', ' ppppp ']
const POT_COLORS = { p: '#b0714a' }
const POT_HALF = 3
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
const TURNS_A_PLANT = 2
const TURNS_A_FRUIT = 4
const MOST_FRUIT = 10
const SPRIG = [[0, 1], [-1, 1], [1, 2]] as const

const leavesOf = (month: number): readonly string[] => {
  if (month >= 3 && month <= 5) {
    return SPRING
  }

  if (month >= 6 && month <= 8) {
    return SUMMER
  }

  return month >= 9 && month <= 11 ? AUTUMN : WINTER
}

const ageOf = (turns: number): number => SAPLING + turns * AGE_A_TURN

/**
 * The whole tree a seed grows into, for the room there is: every pixel of
 * wood and leaf with the age it appears at, so a turn only ever adds to it.
 * A leaning trunk, a branch or two to the sides, and a pad of leaves at
 * every tip.
 */
const grown = (seed: number, half: number, top: number): Pick<Garden, 'wood' | 'leaves' | 'full'> => {
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

const paintGround = (canvas: Canvas, env: Env, middle: number, half: number): void => {
  const floor = env.ph - 1
  const { seed, turns } = env.feed.tree

  for (let x = 0; x < env.pw; x += 1) {
    dot(canvas, x, floor, hash(x, seed) < 0.5 ? GRASS : SOIL)
  }

  // The garden around the tree: a plant sprouts every other turn and grows
  // with the turns after it.
  const plants = Math.min(Math.floor(turns / TURNS_A_PLANT), Math.floor(env.pw / 5))

  for (let plant = 0; plant < plants; plant += 1) {
    const x = Math.floor(hash(seed, plant * 13 + 1) * env.pw)
    const stage = clamp(1 + Math.floor((turns - plant * TURNS_A_PLANT) / 3), 1, 3)

    if (Math.abs(x - middle) > half + 2) {
      for (let up = 1; up <= Math.min(stage, 2); up += 1) {
        dot(canvas, x, floor - up, STEM)
      }

      if (stage === 3 && hash(seed, plant * 13 + 2) < 0.7) {
        dot(canvas, x, floor - 3, pick(PETALS, hash(seed, plant * 13 + 3)) ?? FRUIT)
      }
    }
  }
}

export const bonsai: Scene<Garden> = {
  start(env) {
    const top = Math.max(3, env.ph - POT_ROWS)
    const half = clamp(Math.floor(env.pw / 2) - 2, 4, top * 2)

    return {
      ...grown(env.feed.tree.seed, half, top),
      turns: env.feed.tree.turns,
      glow: 0,
      falling: [],
      moths: [],
    }
  },

  step(garden, env) {
    const floor = env.ph - 1
    garden.glow = Math.max(0, garden.glow - 1)
    garden.falling = garden.falling
      .map(leaf => ({
        ...leaf,
        y: leaf.y + 0.22,
        x: leaf.x + Math.sin(env.ticks * 0.25 + leaf.sway) * 0.35,
      }))
      .filter(leaf => leaf.y < floor)

    // Moths come out while Claude works and wander off when it rests.
    if (env.feed.isWorking && garden.moths.length < 2 && env.roll() < 0.02) {
      garden.moths.push({
        x: env.roll() * env.pw,
        y: env.roll() * (env.ph - 3),
        color: pick(MOTHS, env.roll()) ?? FRUIT,
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
      const palette = leavesOf(env.feed.month)
      const out = shownLeaves(garden, env)

      for (let made = 0; made < SHED_A_FAIL; made += 1) {
        const leaf = out[Math.floor(env.roll() * out.length)]

        if (leaf !== undefined) {
          garden.falling.push({
            x: middle + leaf.x,
            y: rim - leaf.y,
            sway: env.roll() * 6,
            color: pick(palette, env.roll()) ?? GRASS,
          })
        }
      }

      garden.falling = garden.falling.slice(-MOST_FALLING)
    }
  },

  paint(garden, canvas, env) {
    const { turns } = env.feed.tree
    const middle = Math.floor(env.pw / 2)
    // The pixel row the pot's rim is in: the tree stands on it.
    const rim = env.ph - 1 - POT_ROWS
    const age = ageOf(turns)
    // What the last turn added glows for a moment.
    const before = garden.glow > 0 ? ageOf(turns - 1) : age
    const palette = leavesOf(env.feed.month)

    paintGround(canvas, env, middle, POT_HALF + 1)
    stamp(canvas, middle - POT_HALF, rim + 1, POT, POT_COLORS)

    for (const bud of garden.wood) {
      if (bud.at <= age) {
        const color = pick(WOOD, hash(bud.x, bud.y)) ?? FG
        dot(canvas, middle + bud.x, rim - bud.y, bud.at > before ? NEW_GROWTH : color)
      }
    }

    const leaves = shownLeaves(garden, env)
    const tip = garden.wood.filter(bud => bud.at <= age).at(-1)

    // A sapling too young for its first pad of leaves wears a sprig.
    if (leaves.length < SPRIG.length && tip !== undefined) {
      for (const [dx, dy] of SPRIG) {
        dot(canvas, middle + tip.x + dx, rim - tip.y - dy, palette[0] ?? GRASS)
      }
    }

    for (const leaf of leaves) {
      const color = pick(palette, hash(leaf.x * 7, leaf.y * 13)) ?? GRASS
      dot(canvas, middle + leaf.x, rim - leaf.y, leaf.at > before ? NEW_GROWTH : color)
    }

    // A grown tree bears fruit, one more every few turns.
    const ripe = Math.floor((age - garden.full) / AGE_A_TURN / TURNS_A_FRUIT)

    for (let fruit = 0; fruit < Math.min(ripe, MOST_FRUIT, leaves.length); fruit += 1) {
      const leaf = leaves[Math.floor(hash(fruit, env.feed.tree.seed) * leaves.length)]

      if (leaf !== undefined) {
        dot(canvas, middle + leaf.x, rim - leaf.y, FRUIT)
      }
    }

    for (const leaf of garden.falling) {
      dot(canvas, leaf.x, leaf.y, leaf.color)
    }

    for (const moth of garden.moths) {
      // Two wings spread, then folded to one pixel.
      if (Math.floor(env.ticks / 2) % 2 === 0) {
        dot(canvas, moth.x - 1, moth.y, moth.color)
        dot(canvas, moth.x + 1, moth.y, moth.color)
      } else {
        dot(canvas, moth.x, moth.y, moth.color)
      }
    }

    const caption = turns === 1 ? '1 turn old' : `${turns} turns old`
    sign(canvas, 1, 0, turns === 0 ? 'just planted' : caption, FG, DIM)
  },
}
