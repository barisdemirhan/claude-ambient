import { DIM, FG, clamp, dot, hash, isClear, stamp, write } from '../kit'
import type { Canvas, Env, Scene } from '../kit'

type Cloud = { x: number; y: number; wide: number; puff: number }
type Drop = { x: number; y: number }
// A lightning bolt: its column at every pixel row from the clouds down.
type Bolt = { path: number[]; ticks: number }
type Bird = { x: number; row: number }
type Climate = {
  // How stormy the failures say it should be, and how stormy it is: the
  // weather follows the first slowly.
  storm: number
  mood: number
  clouds: Cloud[]
  drops: Drop[]
  bolt: Bolt | undefined
  // Ticks the rainbow still stands, and whether it has rained since the last.
  bow: number
  isWet: boolean
  // The bed the weather sounds like now: fair, rain, storm or snow.
  bed: string
  birds: Bird[]
}

const SUN = '#ffca28'
const MOON = '#cfd8dc'
const RAIN = '#4fc3f7'
const BOLT = '#fff176'
const HILL = '#66bb6a'
const HILL_TOP = '#81c784'
const SNOW_CAP = '#b0bec5'
const CLOUDS = ['#b0bec5', '#90a4ae', '#78909c', '#546e7a']
const LIT_CLOUD = '#eceff1'
const BOW = ['#ef5350', '#ffa726', '#ffee58', '#66bb6a', '#42a5f5']
const HOUSE = [' rrr ', 'rrrrr', 'wwyww', 'wwwdw']
const HOUSE_COLORS = { r: '#8d6e63', w: '#bcaaa4', y: '#ffd54f', d: '#6d4c41' }
// What a failed call adds to the storm, and what a clean one leaves of it.
const FAIL_STORM = 0.35
const CLEAN_CALM = 0.95
const TURN_CALM = 0.6
const IDLE_CALM = 0.997
const RAINY = 0.4
const STORMY = 0.7
const CLEARED = 0.3
const BOW_TICKS = 140
const BOLT_ODDS = 0.035
const BOLT_TICKS = 3
// The pixel row the rain and the lightning leave the clouds at.
const BOLT_TOP = 3
const MOST_DROPS = 220

const isNight = (hour: number): boolean => hour >= 19 || hour < 6

const isWinter = (month: number): boolean => month === 12 || month <= 2

/**
 * What a WMO weather code means here: how stormy the scene is at the least,
 * whether what falls is snow, and what the caption calls it.
 */
const outsideOf = (code: number): { least: number; isSnow: boolean; name: string } => {
  if (code >= 95) {
    return { least: 0.85, isSnow: false, name: 'thunderstorm' }
  }

  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return { least: 0.52, isSnow: true, name: 'snow' }
  }

  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    return { least: 0.58, isSnow: false, name: 'rain' }
  }

  if (code >= 51 && code <= 57) {
    return { least: 0.45, isSnow: false, name: 'drizzle' }
  }

  if (code === 3 || code === 45 || code === 48) {
    return { least: 0.33, isSnow: false, name: code === 3 ? 'overcast' : 'fog' }
  }

  return code === 2
    ? { least: 0.18, isSnow: false, name: 'partly cloudy' }
    : { least: 0, isSnow: false, name: 'clear' }
}

/** The sky over the person's place, when they named one and it was asked. */
const outside = (env: Env) =>
  env.feed.sky === null ? undefined : outsideOf(env.feed.sky.code)

/** Snow falls where the real sky snows; with no place named, in winter. */
const isSnowing = (env: Env): boolean =>
  outside(env)?.isSnow ?? isWinter(env.feed.month)

const isDark = (env: Env): boolean =>
  env.feed.sky === null ? isNight(env.feed.hour) : !env.feed.sky.isDay

/** How tall the hills stand at a column, in pixels. */
const hillAt = (x: number, env: Env): number =>
  clamp(
    Math.round(1.6 + Math.sin(x * 0.09) * 0.9 + Math.sin(x * 0.031 + 2) * 0.9),
    1,
    Math.max(1, Math.floor(env.ph / 3)),
  )

const cloudOf = (x: number, env: Env): Cloud => ({
  x,
  y: Math.floor(env.roll() * Math.max(1, env.ph * 0.3)),
  wide: 6 + Math.floor(env.roll() * 8),
  puff: Math.floor(env.roll() * 1000),
})

const cloudsWanted = (mood: number, env: Env): number =>
  Math.round(1 + mood * (env.pw / 8))

const paintCloud = (canvas: Canvas, cloud: Cloud, color: string): void => {
  for (let dx = 0; dx < cloud.wide; dx += 1) {
    dot(canvas, cloud.x + dx, cloud.y + 2, color)

    if (dx > 0 && dx < cloud.wide - 1) {
      dot(canvas, cloud.x + dx, cloud.y + 1, color)
    }

    if (dx > 1 && dx < cloud.wide - 2 && hash(cloud.puff, dx >> 1) < 0.6) {
      dot(canvas, cloud.x + dx, cloud.y, color)
    }
  }
}

/** The sun with its turning rays, or by night the moon. */
const paintLight = (canvas: Canvas, env: Env): void => {
  const x = 6
  const y = 3

  if (isDark(env)) {
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
        const isMoon = dx * dx + dy * dy <= 5
        const isShadow = (dx - 1) * (dx - 1) + (dy + 1) * (dy + 1) <= 3

        if (isMoon && !isShadow) {
          dot(canvas, x + dx, y + dy, MOON)
        }
      }
    }

    return
  }

  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      dot(canvas, x + dx, y + dy, SUN)
    }
  }

  const isStraight = Math.floor(env.ticks / 8) % 2 === 0
  const rays = isStraight
    ? [[-3, 0], [3, 0], [0, -3], [0, 3]]
    : [[-2, -2], [2, -2], [-2, 2], [2, 2]]

  for (const [dx = 0, dy = 0] of rays) {
    dot(canvas, x + dx, y + dy, SUN)
  }
}

const paintBow = (canvas: Canvas, env: Env, ticks: number): void => {
  const reach = Math.min(env.ph - 1, 13)
  const middle = Math.floor(env.pw * 0.62)
  const floor = env.ph - 1

  for (let dx = -reach; dx <= reach; dx += 1) {
    for (let up = 0; up <= reach; up += 1) {
      const band = reach - Math.round(Math.hypot(dx, up))
      const color = BOW[band]
      // The rainbow thins out as it fades.
      const isFaded = ticks < 30 && hash(dx * 17 + up, 9) > ticks / 30

      if (color !== undefined && band >= 0 && !isFaded) {
        dot(canvas, middle + dx, floor - up, color)
      }
    }
  }
}

export const weather: Scene<Climate> = {
  start(env) {
    const { calls, fails } = env.feed
    const storm = calls > 0 ? clamp((fails / calls) * 2, 0, 0.6) : 0
    const mood = Math.max(storm, outside(env)?.least ?? 0)
    const count = cloudsWanted(mood, env)

    return {
      storm,
      mood,
      clouds: Array.from({ length: count }, () => cloudOf(env.roll() * env.pw, env)),
      drops: [],
      bolt: undefined,
      bow: 0,
      isWet: false,
      bed: 'fair',
      birds: [],
    }
  },

  step(climate, env) {
    climate.storm *= env.feed.isWorking ? 1 : IDLE_CALM
    // The real sky is the least the weather is; failures storm on top of it.
    const aim = Math.max(climate.storm, outside(env)?.least ?? 0)
    climate.mood += (aim - climate.mood) * 0.04
    climate.isWet = climate.isWet || climate.mood >= RAINY
    // The sound follows the sky, and holds on a little so it does not
    // flicker where one weather turns into another.
    const isFalling = climate.mood >= (climate.bed === 'fair' ? RAINY : CLEARED)
    const isLoud = climate.mood >= (climate.bed === 'storm' ? STORMY - 0.1 : STORMY)
    const falling = isSnowing(env) ? 'snow' : isLoud ? 'storm' : 'rain'
    climate.bed = isFalling ? falling : 'fair'

    if (climate.isWet && climate.mood < CLEARED) {
      // The rain has passed and the sun is back: a rainbow.
      climate.bow = BOW_TICKS
      climate.isWet = false
    }

    climate.bow = Math.max(0, climate.bow - 1)
    const wind = (0.06 + climate.mood * 0.25) * (env.feed.isWorking ? 1.6 : 1)
    climate.clouds = climate.clouds
      .map(cloud => ({ ...cloud, x: cloud.x + wind }))
      .filter(cloud => cloud.x < env.pw + 2)

    if (climate.clouds.length < cloudsWanted(climate.mood, env) && env.roll() < 0.2) {
      climate.clouds.push(cloudOf(-14, env))
    }

    const isSnow = isSnowing(env)
    const fall = isSnow ? 0.3 : 1
    const slant = isSnow ? Math.sin(env.ticks * 0.2) * 0.3 : 0.2 + climate.mood * 0.5
    climate.drops = climate.drops
      .map(drop => ({ x: drop.x + slant, y: drop.y + fall }))
      .filter(drop => drop.y < env.ph - hillAt(Math.floor(drop.x), env))

    if (climate.mood >= RAINY) {
      const falling = Math.ceil((climate.mood - RAINY + 0.1) * env.pw * 0.12)

      for (let made = 0; made < falling; made += 1) {
        climate.drops.push({ x: env.roll() * env.pw - 4, y: 3 + env.roll() * 2 })
      }

      climate.drops = climate.drops.slice(-MOST_DROPS)
    }

    if (climate.bolt !== undefined) {
      climate.bolt.ticks -= 1
      climate.bolt = climate.bolt.ticks > 0 ? climate.bolt : undefined
    } else if (climate.mood >= STORMY && env.roll() < BOLT_ODDS) {
      let x = Math.floor(env.roll() * env.pw)
      const path = Array.from({ length: Math.max(1, env.ph - BOLT_TOP - 1) }, () => {
        x += Math.floor(env.roll() * 3) - 1

        return x
      })
      climate.bolt = { path, ticks: BOLT_TICKS }
    }

    const isFair = climate.mood < 0.2 && !isDark(env)

    if (isFair && climate.birds.length < 3 && env.roll() < 0.01) {
      climate.birds.push({ x: env.w, row: Math.floor(env.roll() * Math.max(1, env.h - 2)) })
    }

    climate.birds = climate.birds
      .map(bird => ({ ...bird, x: bird.x - 0.35 }))
      .filter(bird => bird.x > -2)
  },

  hear(climate, event) {
    if (event.type === 'tool') {
      climate.storm *= CLEAN_CALM
    } else if (event.type === 'fail') {
      climate.storm = Math.min(1, climate.storm + FAIL_STORM)
    } else if (event.type === 'turn') {
      climate.storm *= TURN_CALM
    }
  },

  bed(climate) {
    return climate.bed
  },

  paint(climate, canvas, env) {
    const isSnow = isSnowing(env)
    const floor = env.ph - 1

    if (climate.mood < 0.55) {
      paintLight(canvas, env)
    }

    if (climate.bow > 0) {
      paintBow(canvas, env, climate.bow)
    }

    const tone = climate.bolt === undefined
      ? (CLOUDS[Math.min(CLOUDS.length - 1, Math.floor(climate.mood * CLOUDS.length))] ?? LIT_CLOUD)
      : LIT_CLOUD

    for (const cloud of climate.clouds) {
      paintCloud(canvas, cloud, tone)
    }

    for (const drop of climate.drops) {
      dot(canvas, drop.x, drop.y, isSnow ? FG : RAIN)
    }

    climate.bolt?.path.forEach((x, down) => {
      dot(canvas, x, BOLT_TOP + down, BOLT)
    })

    for (let x = 0; x < env.pw; x += 1) {
      const tall = hillAt(x, env)

      for (let up = 0; up < tall; up += 1) {
        const isTop = up === tall - 1
        dot(canvas, x, floor - up, isTop ? (isSnow ? SNOW_CAP : HILL_TOP) : HILL)
      }
    }

    const houseAt = Math.floor(env.pw * 0.78)
    const lit = isDark(env) || climate.mood >= RAINY
    stamp(canvas, houseAt, floor - hillAt(houseAt + 2, env) - HOUSE.length + 1, HOUSE, {
      ...HOUSE_COLORS,
      y: lit ? HOUSE_COLORS.y : HOUSE_COLORS.d,
    })

    for (const bird of climate.birds) {
      const isUp = Math.floor(env.ticks / 4 + bird.row) % 2 === 0

      // A bird behind a cloud is not seen.
      if (isClear(canvas, Math.floor(bird.x), bird.row)) {
        write(canvas, bird.x, bird.row, isUp ? 'v' : '-', FG, DIM)
      }
    }

    if (env.feed.sky !== null) {
      // The real sky, named: right of the sun, clear of the band's own mark.
      const caption = `${env.feed.place} ${Math.round(env.feed.sky.temperature)}° ${outsideOf(env.feed.sky.code).name}`
      write(canvas, env.w - caption.length - 5, 0, caption, FG, DIM)
    }
  },
}
