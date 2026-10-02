import { KIND_COLORS } from '../catalog'
import {
  DIM,
  FAINT,
  FG,
  clamp,
  dot,
  hash,
  isClear,
  pick,
  rngOf,
  seedOf,
  sign,
  write,
} from '../kit'
import type { Canvas, Env, Scene } from '../kit'

// One lot of the day's street: where it stands, how wide it is, how many
// floors it may reach and how many it has.
type Lot = { x: number; wide: number; most: number; floors: number; tone: number }
type Car = { x: number; way: 1 | -1; color: string }
type Rocket = { x: number; y: number; age: number; color: string }
type Town = {
  day: string
  seed: number
  lots: Lot[]
  // The edits built into floors so far, and the lot the last one went to.
  built: number
  last: number
  // Ticks the newest floor still shines, and ticks the lights stay out.
  flash: number
  dark: number
  // Floors added since the last turn ended: what the fireworks are for.
  added: number
  cars: Car[]
  rockets: Rocket[]
}

const TONES = ['#546e7a', '#607d8b', '#78909c', '#8d6e63']
const UNLIT = '#37474f'
const LIT = '#ffd54f'
const NEW_FLOOR = '#eceff1'
const CRANE = '#ffb300'
const BEACON = '#ef5350'
const SUN = '#ffca28'
const MOON = '#fff59d'
const ROCKETS = ['#ef5350', '#ffca28', '#66bb6a', '#42a5f5', '#ec407a']
const FLASH_TICKS = 8
const DARK_TICKS = 22
const MOST_CARS = 12
const CAR_SPEED = 0.7
const RISE_TICKS = 6
const BURST_TICKS = 16
const MOST_ROCKETS = 3

const isNight = (hour: number): boolean => hour >= 19 || hour < 6

const laidOut = (day: string, env: Env): Town => {
  const seed = seedOf(day)
  const roll = rngOf(seed)
  const lots: Lot[] = []
  const tallest = Math.max(2, env.ph - 2)

  let x = 1

  while (x < env.pw - 3) {
    const wide = 3 + Math.floor(roll() * 4)
    lots.push({
      x,
      wide,
      most: 2 + Math.floor(roll() * (tallest - 1)),
      floors: 0,
      tone: Math.floor(roll() * TONES.length),
    })
    x += wide + (roll() < 0.3 ? 2 : 1)
  }

  return {
    day,
    seed,
    lots,
    built: 0,
    last: -1,
    flash: 0,
    dark: 0,
    added: 0,
    cars: [],
    rockets: [],
  }
}

/**
 * One more edit becomes a floor, on the lot its number draws or the next
 * free. A lot that may grow tall is drawn more often: towers rise first.
 */
const raised = (town: Town): void => {
  const count = town.lots.length
  const weights = town.lots.map(lot => lot.most * lot.most)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let left = hash(town.seed, town.built) * total
  const drawn = Math.max(
    0,
    weights.findIndex(weight => {
      left -= weight

      return left < 0
    }),
  )

  for (let probe = 0; probe < count; probe += 1) {
    const at = (drawn + probe) % count
    const lot = town.lots[at]

    if (lot !== undefined && lot.floors < lot.most) {
      lot.floors += 1
      town.last = at
      break
    }
  }

  town.built += 1
}

const paintSky = (canvas: Canvas, env: Env): void => {
  const { hour } = env.feed

  if (isNight(hour)) {
    const x = env.pw - 7
    dot(canvas, x + 1, 0, MOON)
    dot(canvas, x, 1, MOON)
    dot(canvas, x + 1, 2, MOON)
    dot(canvas, x, 2, MOON)

    return
  }

  // The sun crosses the band between six and seven in the evening.
  const x = Math.floor(((hour - 6) / 13) * (env.pw - 6)) + 2

  for (let dx = 0; dx < 3; dx += 1) {
    for (let dy = 0; dy < 3; dy += 1) {
      if (dx === 1 || dy === 1) {
        dot(canvas, x + dx, dy, SUN)
      }
    }
  }
}

const paintLot = (canvas: Canvas, town: Town, lot: Lot, at: number, env: Env): void => {
  const street = env.ph - 2
  const tone = TONES[lot.tone] ?? UNLIT
  const litOdds = isNight(env.feed.hour) ? 0.6 : 0.22
  const isFlickering = town.dark > 0 && town.dark < 8

  for (let floor = 0; floor < lot.floors; floor += 1) {
    const isNew = at === town.last && floor === lot.floors - 1 && town.flash > 0

    for (let dx = 0; dx < lot.wide; dx += 1) {
      const isWindow = dx % 2 === 1 && dx < lot.wide - 1
      // A window's light changes now and then, each on a clock of its own.
      const epoch = Math.floor((env.ticks + hash(at, floor * 31 + dx) * 300) / 300)
      const isLit =
        hash(at * 131 + floor, dx * 17 + epoch) < litOdds &&
        (town.dark === 0 || (isFlickering && hash(env.ticks, at + dx) < 0.4))
      const window = isLit ? LIT : UNLIT

      dot(canvas, lot.x + dx, street - floor, isNew ? NEW_FLOOR : isWindow ? window : tone)
    }
  }

  if (lot.floors === lot.most && lot.most >= env.ph - 4) {
    const isOn = Math.floor(env.ticks / 8) % 2 === 0
    dot(canvas, lot.x + Math.floor(lot.wide / 2), street - lot.floors, isOn ? BEACON : UNLIT)
  }
}

/** A crane on the lot the last floor went to, its hook going up and down. */
const paintCrane = (canvas: Canvas, lot: Lot, env: Env): void => {
  const mast = lot.x + Math.floor(lot.wide / 2)
  const top = env.ph - 2 - lot.floors - 3

  for (let up = 0; up < 3; up += 1) {
    dot(canvas, mast, top + up, CRANE)
  }

  for (let out = -1; out <= 3; out += 1) {
    dot(canvas, mast + out, top, CRANE)
  }

  dot(canvas, mast + 3, top + 1 + (Math.floor(env.ticks / 6) % 2), FAINT)
}

const paintRocket = (canvas: Canvas, rocket: Rocket): void => {
  if (rocket.age < RISE_TICKS) {
    dot(canvas, rocket.x, rocket.y - rocket.age, rocket.color)

    return
  }

  const reach = (rocket.age - RISE_TICKS) * 0.45 + 1
  const top = rocket.y - RISE_TICKS

  for (let spoke = 0; spoke < 8; spoke += 1) {
    const turn = (spoke / 8) * Math.PI * 2
    dot(
      canvas,
      Math.round(rocket.x + Math.cos(turn) * reach),
      Math.round(top + Math.sin(turn) * reach),
      rocket.color,
    )
  }
}

export const city: Scene<Town> = {
  start(env) {
    const town = laidOut(env.feed.city.day, env)

    // What the day built before the scene was looked at stands already.
    while (town.built < env.feed.city.edits) {
      raised(town)
    }

    return town
  },

  step(town, env) {
    const { day, edits } = env.feed.city

    if (day !== town.day) {
      // A new day: the street is laid out anew, its lots empty.
      Object.assign(town, laidOut(day, env))
    }

    while (town.built < edits) {
      raised(town)
      town.flash = FLASH_TICKS
      town.added += 1
    }

    town.flash = Math.max(0, town.flash - 1)
    town.dark = Math.max(0, town.dark - 1)
    town.cars = town.cars
      .map(car => ({ ...car, x: car.x + car.way * CAR_SPEED }))
      .filter(car => car.x > -3 && car.x < env.pw + 3)
    town.rockets = town.rockets
      .map(rocket => ({ ...rocket, age: rocket.age + 1 }))
      .filter(rocket => rocket.age < RISE_TICKS + BURST_TICKS)
  },

  hear(town, event, env) {
    if (event.type === 'tool' && event.kind !== 'edit') {
      // A call that builds nothing is traffic on the street.
      const way = env.roll() < 0.5 ? 1 : -1
      town.cars.push({ x: way > 0 ? -2 : env.pw + 1, way, color: KIND_COLORS[event.kind] })
      town.cars = town.cars.slice(-MOST_CARS)
    } else if (event.type === 'fail') {
      town.dark = DARK_TICKS
    } else if (event.type === 'turn') {
      // A turn that built something ends with fireworks over what it built.
      for (let made = 0; made < Math.min(town.added, MOST_ROCKETS); made += 1) {
        town.rockets.push({
          x: Math.floor(env.pw * (0.15 + env.roll() * 0.7)),
          y: env.ph - 3,
          age: -made * 4,
          color: pick(ROCKETS, env.roll()) ?? LIT,
        })
      }

      town.added = 0
    }
  },

  paint(town, canvas, env) {
    const road = env.ph - 1
    paintSky(canvas, env)
    town.lots.forEach((lot, at) => paintLot(canvas, town, lot, at, env))
    const last = town.lots[town.last]

    if (env.feed.isWorking && last !== undefined) {
      paintCrane(canvas, last, env)
    }

    for (let x = 0; x < env.pw; x += 1) {
      dot(canvas, x, road, FAINT)
    }

    for (const car of town.cars) {
      dot(canvas, car.x, road, car.color)
      dot(canvas, car.x + 1, road, car.color)
    }

    for (const rocket of town.rockets) {
      if (rocket.age >= 0) {
        paintRocket(canvas, rocket)
      }
    }

    if (isNight(env.feed.hour)) {
      for (let row = 0; row < env.h - 1; row += 1) {
        for (let x = 0; x < env.w; x += 1) {
          if (hash(x * 3 + 1, row * 7 + town.seed) < 0.035 && isClear(canvas, x, row)) {
            write(canvas, x, row, '.', FG, DIM)
          }
        }
      }
    }

    const floors = clamp(town.built, 0, env.feed.city.edits)
    const caption =
      floors === 0
        ? 'empty lots · every edit builds a floor'
        : `${floors} ${floors === 1 ? 'floor' : 'floors'} today`
    sign(canvas, 1, 0, caption, FG, DIM)
  },
}
