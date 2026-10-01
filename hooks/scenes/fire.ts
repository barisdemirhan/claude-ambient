import { clamp, dot } from '../kit'
import type { Canvas, Env, Happening, Scene } from '../kit'

type Spark = { x: number; y: number; drift: number; life: number }
type Hearth = {
  // Heat of every pixel, row by row from the top: 0 is cold, HOTTEST white.
  heat: number[]
  fuel: number
  // Ticks the flames stay blue after a failed call fell into them.
  blue: number
  sparks: Spark[]
}

const HOTTEST = 8
// A color for every heat, two heats to a color: the fewer the colors, the
// longer the stretches the band draws in one piece.
const FLAMES = [
  '',
  '#8c2308',
  '#8c2308',
  '#d84315',
  '#d84315',
  '#ff9800',
  '#ff9800',
  '#ffc107',
  '#ffeb3b',
]
const BLUE_FLAMES = [
  '',
  '#0d47a1',
  '#0d47a1',
  '#1e88e5',
  '#1e88e5',
  '#29b6f6',
  '#29b6f6',
  '#80deea',
  '#e0f7fa',
]
const SPARK = '#ffeb3b'
const WORKING_FUEL = 0.62
const IDLE_FUEL = 0.3
const LOG_FUEL = 0.1
const MOST_FUEL = 0.95
const COOLING_ODDS = 0.82
const BLUE_TICKS = 16
const MOST_SPARKS = 60

/** How hot the embers under a column burn, wandering along the hearth. */
const emberOf = (x: number, ticks: number): number =>
  0.6 +
  0.4 *
    Math.sin(x * 0.21 + ticks * 0.07 + Math.sin(x * 0.05 - ticks * 0.03) * 2)

const sparked = (hearth: Hearth, count: number, env: Env): void => {
  for (let made = 0; made < count; made += 1) {
    hearth.sparks.push({
      x: env.roll() * env.pw,
      y: env.ph - 2 - env.roll() * env.ph * 0.4,
      drift: (env.roll() - 0.5) * 0.6,
      life: 8 + Math.floor(env.roll() * 10),
    })
  }

  hearth.sparks = hearth.sparks.slice(-MOST_SPARKS)
}

export const fire: Scene<Hearth> = {
  start(env) {
    return {
      heat: new Array<number>(env.pw * env.ph).fill(0),
      fuel: env.feed.isWorking ? WORKING_FUEL : IDLE_FUEL,
      blue: 0,
      sparks: [],
    }
  },

  step(hearth, env) {
    const { pw, ph } = env
    const target = env.feed.isWorking ? WORKING_FUEL : IDLE_FUEL
    hearth.fuel += (target - hearth.fuel) * 0.03
    hearth.blue = Math.max(0, hearth.blue - 1)

    for (let x = 0; x < pw; x += 1) {
      hearth.heat[(ph - 1) * pw + x] = clamp(
        Math.round(HOTTEST * hearth.fuel * emberOf(x, env.ticks)),
        0,
        HOTTEST,
      )
    }

    // Every pixel takes the heat of the one under it, a little cooler and a
    // little to the side: the flames lick upward and lean.
    for (let y = 0; y < ph - 1; y += 1) {
      for (let x = 0; x < pw; x += 1) {
        const below = hearth.heat[(y + 1) * pw + x] ?? 0
        const cooled = below - (env.roll() < COOLING_ODDS ? 1 : 0)
        const lean = Math.floor(env.roll() * 3) - 1
        hearth.heat[y * pw + clamp(x + lean, 0, pw - 1)] = Math.max(0, cooled)
      }
    }

    hearth.sparks = hearth.sparks
      .map(spark => ({
        ...spark,
        x: spark.x + spark.drift,
        y: spark.y - 0.6,
        life: spark.life - 1,
      }))
      .filter(spark => spark.life > 0 && spark.y >= 0)
  },

  hear(hearth, event: Happening, env) {
    if (event.type === 'tool') {
      hearth.fuel = Math.min(MOST_FUEL, hearth.fuel + LOG_FUEL)
      sparked(hearth, 2, env)
    } else if (event.type === 'fail') {
      hearth.blue = BLUE_TICKS
      sparked(hearth, 12, env)
    }
  },

  paint(hearth, canvas: Canvas) {
    const flames = hearth.blue > 0 ? BLUE_FLAMES : FLAMES

    hearth.heat.forEach((heat, at) => {
      const color = flames[heat] ?? ''

      if (color !== '') {
        dot(canvas, at % canvas.pw, Math.floor(at / canvas.pw), color)
      }
    })

    for (const spark of hearth.sparks) {
      dot(canvas, spark.x, spark.y, SPARK)
    }
  },
}
