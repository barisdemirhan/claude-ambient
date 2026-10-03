import { KIND_COLORS } from '../catalog'
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
  seedOf,
  wipe,
  write,
} from '../kit'
import type { Canvas, Env, Scene } from '../kit'

import { NIGHT_TINT, label, lightOf, skyOf } from './daylight'

// One lot of the day's street: where it stands, how wide it is, how many
// floors it may reach, how many it has, and the kind of building it is.
type Lot = { x: number; wide: number; most: number; floors: number; tone: number }
type Car = { x: number; way: 1 | -1; color: string }
type Rocket = { x: number; y: number; age: number; color: string; spark: string }
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
/** A kind of building: its walls, its roof, its glass. */
type Facade = { wall: string; roof: string; glass: string }

// Glass, concrete, brick, sandstone and slate towers.
const FACADES: readonly Facade[] = [
  { wall: '#5d7f9c', roof: '#3a5063', glass: '#a9cbe3' },
  { wall: '#8f969e', roof: '#5b6169', glass: '#4b5866' },
  { wall: '#a3604b', roof: '#5e3a30', glass: '#3e3a44' },
  { wall: '#c4a57d', roof: '#7d6648', glass: '#55545e' },
  { wall: '#3f4a5c', roof: '#262d39', glass: '#7590ad' },
]
const FAR_TOWERS = '#33405a'
const LIT = '#ffd36e'
const WARM = '#ffb85c'
const UNLIT_NIGHT = '#1d2333'
const NEW_FLOOR = '#f4f7f9'
const CRANE = '#ffb300'
const CABLE = '#2b2f36'
const BEACON = '#ff5252'
const ASPHALT = '#30343c'
const ASPHALT_NIGHT = '#1b1e25'
const HEADLIGHT = '#fff4c2'
const TAILLIGHT = '#ff4545'
const ROCKETS = ['#ff5a5f', '#ffd166', '#7ae582', '#5ab0ff', '#ff6bcb', '#c792ff']
const FLASH_TICKS = 8
const DARK_TICKS = 22
const MOST_CARS = 12
const CAR_SPEED = 0.7
const RISE_TICKS = 6
const BURST_TICKS = 16
const MOST_ROCKETS = 3
const SPOKES = 10
const STAR_ODDS = 0.014

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
      tone: Math.floor(roll() * FACADES.length),
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

/** Stars at night, and the sun or the moon on an arc over the street. */
const paintSky = (canvas: Canvas, env: Env, sky: readonly string[]): void => {
  const { hour } = env.feed
  const isDay = hour >= 6 && hour < 20

  if (lightOf(hour) < 0.7) {
    for (let row = 0; row < env.ph - 3; row += 1) {
      for (let column = 0; column < env.pw; column += 1) {
        if (hash(column * 7 + 1, row * 11 + 9) < STAR_ODDS) {
          const isBright =
            hash(column, row) > 0.7 && hash(column, row + Math.floor(env.ticks / 9)) > 0.2
          const faint = mix(sky[0] ?? NIGHT_TINT, '#c5cff0', 0.5)
          dot(canvas, column, row, isBright ? '#f4f6ff' : faint)
        }
      }
    }
  }

  const share = isDay ? (hour - 6 + 0.5) / 14 : (((hour + 4) % 24) + 0.5) / 10
  const x = Math.round(4 + share * (env.pw - 10))
  const y = Math.round((1 - Math.sin(share * Math.PI)) * env.ph * 0.4) + 1
  const isLow = hour < 8 || hour >= 17
  const core = isDay ? (isLow ? '#ffdca6' : '#fff8d6') : '#f4f0d4'
  const rim = isDay ? (isLow ? '#ffa05c' : '#ffd54f') : '#d9d4b4'
  const halo = mix(along(sky, y / Math.max(1, env.ph - 1)), rim, 0.45)

  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1]] as const) {
    dot(canvas, x + dx, y + dy, halo)
  }

  dot(canvas, x + 1, y + 1, isDay ? halo : mix(halo, NIGHT_TINT, 0.6))

  for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]] as const) {
    dot(canvas, x + dx, y + dy, rim)
  }

  dot(canvas, x, y, core)
}

/**
 * The city beyond the street: towers lost in the haze, a few windows lit in
 * them at night. They are the day's too, and stand where the street's do not.
 */
const paintFarCity = (
  canvas: Canvas,
  town: Town,
  env: Env,
  sky: readonly string[],
): void => {
  const haze = sky[1] ?? NIGHT_TINT
  const night = lightOf(env.feed.hour) < 0.7
  const tower = mix(haze, night ? NIGHT_TINT : FAR_TOWERS, night ? 0.5 : 0.38)
  const glow = mix(tower, LIT, 0.45)
  const street = env.ph - 2
  let x = 0
  let block = 0

  while (x < env.pw) {
    const wide = 3 + Math.floor(hash(town.seed, block * 3) * 6)
    const tall = Math.round(env.ph * (0.15 + hash(town.seed, block * 3 + 1) * 0.3))
    fill(canvas, x, street - tall + 1, wide, tall, tower)

    if (night && town.dark === 0) {
      for (let up = 2; up < tall; up += 2) {
        const column = x + 1 + Math.floor(hash(block, up) * Math.max(1, wide - 2))

        if (hash(block * 7, up + town.seed) < 0.12) {
          dot(canvas, column, street - up, glow)
        }
      }
    }

    x += wide
    block += 1
  }
}

/**
 * One building: floors of glass between floors of wall, and a roof with
 * what stands on it. Its windows light at night, each floor on a clock of
 * its own.
 */
const paintLot = (canvas: Canvas, town: Town, lot: Lot, at: number, env: Env): void => {
  if (lot.floors === 0) {
    return
  }

  const street = env.ph - 2
  const light = lightOf(env.feed.hour)
  const lit = (color: string): string => mix(NIGHT_TINT, color, light)
  const facade = FACADES[lot.tone] ?? FACADES[0]
  const night = isNight(env.feed.hour)
  const litOdds = night ? 0.6 : 0
  const isFlickering = town.dark > 0 && town.dark < 8
  const unlit = night ? UNLIT_NIGHT : lit(facade?.glass ?? UNLIT_NIGHT)
  const wall = lit(facade?.wall ?? UNLIT_NIGHT)
  const top = street - lot.floors + 1
  fill(canvas, lot.x, top, lot.wide, lot.floors, wall)

  for (let floor = 0; floor < lot.floors; floor += 1) {
    const y = street - floor
    const isNew = at === town.last && floor === lot.floors - 1 && town.flash > 0

    if (isNew) {
      fill(canvas, lot.x, y, lot.wide, 1, NEW_FLOOR)
    } else if (floor % 2 === 1) {
      // Every other floor is a band of glass, lit floor by floor at night: an
      // office with its lights on or gone home.
      const epoch = Math.floor((env.ticks + hash(at, floor * 31) * 300) / 300)
      const isLit =
        hash(at * 131 + floor, epoch) < litOdds &&
        (town.dark === 0 || (isFlickering && hash(env.ticks, at + floor) < 0.4))
      const glow = hash(at, floor) < 0.35 ? WARM : LIT
      fill(canvas, lot.x, y, lot.wide, 1, isLit ? glow : unlit)
    }
  }

  // The roof's ledge stands over the top floor.
  const roof = street - lot.floors
  fill(canvas, lot.x, roof, lot.wide, 1, lit(facade?.roof ?? UNLIT_NIGHT))
  const isTall = lot.floors === lot.most && lot.most >= env.ph - 4

  if (isTall) {
    // The day's tallest towers carry a mast with a light that blinks.
    const mast = lot.x + Math.floor(lot.wide / 2)
    const isOn = Math.floor(env.ticks / 8) % 2 === 0
    dot(canvas, mast, roof - 1, isOn ? BEACON : lit('#5b6169'))
  } else if (lot.floors >= 3 && lot.wide >= 4 && hash(at, town.seed) < 0.4) {
    // A water tank on a lower roof.
    fill(canvas, lot.x + 1, roof - 1, 2, 1, lit('#7a5a44'))
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

  const hook = top + 1 + (Math.floor(env.ticks / 6) % 2)
  dot(canvas, mast + 3, hook, CABLE)
}

/** The street: asphalt, and the cars with their lights. */
const paintStreet = (canvas: Canvas, town: Town, env: Env): void => {
  const road = env.ph - 1
  const night = lightOf(env.feed.hour) < 0.7
  fill(canvas, 0, road, env.pw, 1, night ? ASPHALT_NIGHT : ASPHALT)

  for (const car of town.cars) {
    const back = Math.round(car.x)
    const front = back + (car.way > 0 ? 2 : -2)
    fill(canvas, Math.min(back, front), road, 3, 1, car.color)
    dot(canvas, front, road, night ? HEADLIGHT : '#e9eef2')
    dot(canvas, back, road, TAILLIGHT)

    if (night) {
      // The headlights reach a little way ahead on the dark road.
      dot(canvas, front + car.way, road, mix(ASPHALT_NIGHT, HEADLIGHT, 0.35))
    }
  }
}

/** A rocket going up, then its burst: sparks flying out and fading. */
const paintRocket = (
  canvas: Canvas,
  rocket: Rocket,
  sky: readonly string[],
  env: Env,
): void => {
  if (rocket.age < RISE_TICKS) {
    dot(canvas, rocket.x, rocket.y - rocket.age, '#fff2c4')
    dot(canvas, rocket.x, rocket.y - rocket.age + 1, mix(along(sky, 0.5), WARM, 0.5))

    return
  }

  const spent = (rocket.age - RISE_TICKS) / BURST_TICKS
  const reach = (rocket.age - RISE_TICKS) * 0.5 + 1
  const top = rocket.y - RISE_TICKS
  const behind = along(sky, top / Math.max(1, env.ph - 1))
  const fade = Math.max(0, spent - 0.4) * 1.4
  const color = spent < 0.15 ? '#ffffff' : mix(rocket.color, behind, fade)
  const spark = mix(rocket.spark, behind, spent)

  for (let spoke = 0; spoke < SPOKES; spoke += 1) {
    const turn = (spoke / SPOKES) * Math.PI * 2
    // Sparks fall a little as they burn out.
    const drop = spent * spent * 2
    const [across, down] = [Math.cos(turn) * reach, Math.sin(turn) * reach * 0.8 + drop]
    dot(canvas, Math.round(rocket.x + across), Math.round(top + down), color)
    dot(canvas, Math.round(rocket.x + across / 2), Math.round(top + down / 2), spark)
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
      .filter(car => car.x > -4 && car.x < env.pw + 4)
    town.rockets = town.rockets
      .map(rocket => ({ ...rocket, age: rocket.age + 1 }))
      .filter(rocket => rocket.age < RISE_TICKS + BURST_TICKS)
  },

  hear(town, event, env) {
    if (event.type === 'tool' && event.kind !== 'edit') {
      // A call that builds nothing is traffic on the street.
      const way = env.roll() < 0.5 ? 1 : -1
      town.cars.push({ x: way > 0 ? -3 : env.pw + 2, way, color: KIND_COLORS[event.kind] })
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
          spark: pick(ROCKETS, env.roll()) ?? WARM,
        })
      }

      town.added = 0
    }
  },

  paint(town, canvas, env) {
    const sky = skyOf(env.feed.hour)
    backdrop(canvas, sky)
    paintSky(canvas, env, sky)
    paintFarCity(canvas, town, env, sky)

    for (const rocket of town.rockets) {
      if (rocket.age >= 0) {
        paintRocket(canvas, rocket, sky, env)
      }
    }

    town.lots.forEach((lot, at) => paintLot(canvas, town, lot, at, env))
    const last = town.lots[town.last]

    if (env.feed.isWorking && last !== undefined) {
      paintCrane(canvas, last, env)
    }

    paintStreet(canvas, town, env)
    const floors = clamp(town.built, 0, env.feed.city.edits)
    const caption =
      floors === 0
        ? 'empty lots · every edit builds a floor'
        : `${floors} ${floors === 1 ? 'floor' : 'floors'} today`
    label(canvas, 0, caption, sky)
  },
}
