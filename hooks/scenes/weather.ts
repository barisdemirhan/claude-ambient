import { along, backdrop, clamp, dot, fill, hash, mix, shade, stamp, wipe, write } from '../kit'
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
// A cloud's three tones: its sunlit top, its body, its shaded underside.
type Tones = { top: string; body: string; under: string }
type Light = { isDark: boolean; isDusk: boolean; isSnow: boolean; hour: number }

// The sky top to horizon: by day, at dawn and dusk, by night, and under a
// storm by day and by night; a snowy sky is paler.
const DAY_SKY = ['#3f86cf', '#78b3e6', '#c2e1f5']
const DUSK_SKY = ['#3b4b8a', '#b9708e', '#f4b26e']
const NIGHT_SKY = ['#070b1f', '#111a3d', '#25315e']
const STORM_SKY = ['#4a525e', '#69727e', '#8e969f']
const SNOW_SKY = ['#8fa3b8', '#b4c3d1', '#dce5ed']
const STORM_NIGHT_SKY = ['#090b11', '#141821', '#222733']
const FLASH = '#e3e9f7'
const SUN = '#ffcc33'
const SUN_CORE = '#fff1b3'
const DUSK_SUN = '#ff9a3c'
const GLOW = '#fff0b8'
const MOON = '#e9edf6'
const MOON_SHADOW = '#b7bfd0'
const STARS = ['#e8ecff', '#9aa3c8']
const RAIN = '#a9d9f5'
const HEAVY_RAIN = '#d6eeff'
const SNOW = ['#ffffff', '#dbe7f2']
const BOLT = '#fffbe0'
const BIRD = '#2d3a4a'
const CAPTION = '#eef3f8'
const FAIR_CLOUD: Tones = { top: '#ffffff', body: '#eef3f8', under: '#c6d1dc' }
const GREY_CLOUD: Tones = { top: '#d7dde4', body: '#aab4be', under: '#87919c' }
const STORM_CLOUD: Tones = { top: '#8c959f', body: '#69727c', under: '#4b535c' }
const NIGHT_CLOUD: Tones = { top: '#4d587b', body: '#3a446b', under: '#2b3457' }
const NIGHT_STORM_CLOUD: Tones = { top: '#30353f', body: '#22262f', under: '#181b22' }
const LIT_CLOUD: Tones = { top: '#ffffff', body: '#f0f3fa', under: '#c9d0de' }
// The three hills far to near, as summer, winter and night paint them.
const HILLS = ['#8fb3a8', '#62a35a', '#46913f']
const HILL_EDGE = '#78c463'
const FLOWERS = ['#fff59d', '#ffffff', '#f8bbd0']
const WINTER_HILLS = ['#b9c7d5', '#d3dee7', '#e9eff4']
const NIGHT_HILLS = ['#1e2c3d', '#19302b', '#15291f']
const NIGHT_WINTER_HILLS = ['#3a4662', '#4a5774', '#5b6886']
const STORM_GREY = '#59626a'
// What the low sun of dawn and dusk casts over the land and the clouds.
const DUSK_TINT = '#8a4f62'
const DUSK_GLOW = '#ffc2a3'
const BOW = ['#ff5252', '#ffab40', '#ffee58', '#69f0ae', '#40c4ff', '#7c4dff']
const TREE = '#2e6f34'
const TREE_LIGHT = '#43944a'
const TRUNK = '#5d4037'
const SMOKE = '#d9dee4'
// The house on the near hill, big where the band is tall: `c` its chimney,
// `r` its roof, `w` its walls, `y` its window, `d` its door.
const HOUSE = ['......c..', '..rrrrcr.', 'rrrrrrrrr', '.wyywwdw.', '.wyywwdw.']
const SMALL_HOUSE = ['...c.', '.rrrr', 'rrrrr', '.ywd.']
const HOUSE_COLORS = {
  c: '#6d4c41',
  r: '#a0473a',
  w: '#efe2cf',
  y: '#ffd54f',
  d: '#7a4b32',
}
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
// Raindrops and snowflakes in the air at once, for each column of the band.
const DROPS_A_COLUMN = 0.35

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

const lightOf = (env: Env): Light => {
  const { hour } = env.feed
  const isDarkNow = isDark(env)

  return {
    isDark: isDarkNow,
    isDusk: !isDarkNow && [6, 7, 17, 18].includes(hour),
    isSnow: isSnowing(env),
    hour,
  }
}

/** The top pixel of each hill at a column, far to near. */
const hillTops = (x: number, env: Env): [number, number, number] => {
  const far = 0.45 + Math.sin(x * 0.055 + 1) * 0.13 + Math.sin(x * 0.019) * 0.08
  const middle = 0.32 + Math.sin(x * 0.08 + 3) * 0.09 + Math.sin(x * 0.027 + 2) * 0.06
  const near = 0.16 + Math.sin(x * 0.12) * 0.05 + Math.sin(x * 0.035 + 2) * 0.05

  return [far, middle, near].map(share =>
    env.ph - clamp(Math.round(share * env.ph), 1, env.ph - 1),
  ) as [number, number, number]
}

const nearTop = (x: number, env: Env): number => hillTops(Math.floor(x), env)[2]

const cloudOf = (x: number, env: Env): Cloud => ({
  x,
  y: Math.floor(env.roll() * Math.max(1, env.ph * 0.3)),
  wide: 9 + Math.floor(env.roll() * 12),
  puff: Math.floor(env.roll() * 1000),
})

const cloudsWanted = (mood: number, env: Env): number =>
  Math.round(1 + mood * (env.pw / 14))

/** How far the storm has taken the sky, from fair at 0 to black at 1. */
const gloomOf = (mood: number): number => clamp((mood - 0.15) / 0.6, 0, 1)

const skyOf = (climate: Climate, light: Light): string[] => {
  const fair = light.isDark ? NIGHT_SKY : light.isDusk ? DUSK_SKY : DAY_SKY
  const grey = light.isDark ? STORM_NIGHT_SKY : light.isSnow ? SNOW_SKY : STORM_SKY
  const gloom = gloomOf(climate.mood)
  const flash = climate.bolt === undefined ? 0 : 0.55

  return fair.map((color, at) => mix(mix(color, grey[at] ?? color, gloom), FLASH, flash))
}

const tonesOf = (climate: Climate, light: Light): Tones => {
  if (climate.bolt !== undefined) {
    return LIT_CLOUD
  }

  const gloom = gloomOf(climate.mood)
  const [fair, middle, dark] = light.isDark
    ? [NIGHT_CLOUD, NIGHT_STORM_CLOUD, NIGHT_STORM_CLOUD]
    : [FAIR_CLOUD, GREY_CLOUD, STORM_CLOUD]
  const tone = (key: keyof Tones): string =>
    along([fair[key], middle[key], dark[key]], gloom, 5)

  const glow = light.isDusk ? 0.35 * (1 - gloom) : 0

  return {
    top: mix(tone('top'), DUSK_GLOW, glow),
    body: mix(tone('body'), DUSK_GLOW, glow * 0.8),
    under: mix(tone('under'), DUSK_TINT, glow),
  }
}

/** A cloud of round puffs: a lit top, a body, a shaded flat underside. */
const paintCloud = (canvas: Canvas, cloud: Cloud, tones: Tones, env: Env): void => {
  const tall = env.ph >= 8 ? 4 : 3
  const bottom = cloud.y + tall - 1

  for (let dx = 0; dx < cloud.wide; dx += 1) {
    const edge = Math.min(dx, cloud.wide - 1 - dx)
    const bump = hash(cloud.puff, Math.floor(dx / 3)) < 0.5 ? 1 : 0
    const top = cloud.y + clamp(2 - edge + bump, 0, tall - 1)
    const x = Math.floor(cloud.x) + dx
    fill(canvas, x, top, 1, bottom - top + 1, tones.body)
    dot(canvas, x, top, tones.top)
    dot(canvas, x, bottom, tones.under)
  }
}

/** Under a storm, a deck of cloud closes over the top of the sky. */
const paintDeck = (canvas: Canvas, climate: Climate, tones: Tones, env: Env): void => {
  const depth = (climate.mood - 0.55) / 0.45

  if (depth <= 0) {
    return
  }

  for (let x = 0; x < env.pw; x += 1) {
    const wave = Math.sin(x * 0.17 + env.ticks * 0.02) + Math.sin(x * 0.05 + 1)
    const reach = Math.round(depth * env.ph * 0.25 + (wave > 0.6 ? 1 : 0))
    fill(canvas, x, 0, 1, reach, tones.body)
    dot(canvas, x, reach - 1, tones.under)
  }
}

/** The sun, low and orange at dawn and dusk, high at noon; by night the moon and stars. */
const paintLight = (canvas: Canvas, climate: Climate, light: Light, env: Env): void => {
  // The moon keeps to the left; the sun crosses the sky with the hours.
  const day = clamp((light.hour - 6) / 13, 0, 1)
  const x = light.isDark ? Math.max(4, Math.round(env.pw * 0.12)) : Math.round(env.pw * (0.08 + day * 0.6))

  if (light.isDark) {
    if (climate.mood < 0.45) {
      for (let at = 0; at < env.pw; at += 1) {
        const y = Math.floor(hash(at, 41) * env.ph * 0.5)
        const isLit = hash(at, Math.floor(env.ticks / 12) + 7) > 0.3

        if (hash(at, 40) < 0.05 && isLit) {
          dot(canvas, at, y, STARS[hash(at, 42) < 0.4 ? 0 : 1] ?? '#ffffff')
        }
      }
    }

    fill(canvas, x - 1, 1, 3, 4, MOON)
    fill(canvas, x - 2, 2, 5, 2, MOON)
    fill(canvas, x + 1, 1, 2, 3, MOON_SHADOW)

    return
  }

  const y = Math.round(2 + (1 - Math.sin(day * Math.PI)) * env.ph * 0.3)
  const body = light.isDusk ? DUSK_SUN : SUN
  const sky = skyOf(climate, light)

  for (let dy = -3; dy <= 4; dy += 1) {
    for (let dx = -3; dx <= 4; dx += 1) {
      const far = Math.hypot(dx - 0.5, dy - 0.5)

      if (far <= 1.9) {
        dot(canvas, x + dx, y + dy, dx + dy <= 0 ? SUN_CORE : body)
      } else if (far <= 3.3) {
        const behind = along(sky, (y + dy) / Math.max(1, env.ph - 1))
        dot(canvas, x + dx, y + dy, mix(behind, GLOW, 0.35))
      }
    }
  }
}

const paintBow = (canvas: Canvas, sky: readonly string[], env: Env, ticks: number): void => {
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
        const behind = along(sky, (floor - up) / Math.max(1, env.ph - 1))
        dot(canvas, middle + dx, floor - up, mix(behind, color, 0.6))
      }
    }
  }
}

/** The hills far to near, snowed on in winter, dark by night, greyed by a storm. */
const paintHills = (canvas: Canvas, climate: Climate, light: Light, env: Env): void => {
  const colors = light.isDark
    ? light.isSnow ? NIGHT_WINTER_HILLS : NIGHT_HILLS
    : light.isSnow ? WINTER_HILLS : HILLS
  const gloom = gloomOf(climate.mood)
  const grey = gloom * (light.isDark ? 0.15 : 0.4)
  // The low sun warms the land at dawn and dusk; a storm greys and darkens it.
  const lit = (color: string): string => {
    const tinted = light.isDusk ? shade(mix(color, DUSK_TINT, 0.3), 0.85) : color

    return shade(mix(tinted, STORM_GREY, grey), 1 - gloom * 0.2)
  }
  const greyed = colors.map(lit)
  const edge = light.isSnow ? lit('#ffffff') : light.isDark ? shade(greyed[2] ?? HILL_EDGE, 1.4) : lit(HILL_EDGE)

  for (let x = 0; x < env.pw; x += 1) {
    hillTops(x, env).forEach((top, layer) => {
      const color = greyed[layer] ?? STORM_GREY
      fill(canvas, x, top, 1, env.ph - top, color)
      // Each hill's crest catches a little more light than its slope.
      dot(canvas, x, top, shade(color, layer === 0 ? 1.05 : 1.12))
    })
    dot(canvas, x, nearTop(x, env), edge)

    // In the warm months the near hill flowers, seen by day.
    const isBlooming =
      !light.isDark && !light.isSnow && gloom < 0.4 && env.feed.month >= 4 && env.feed.month <= 9

    if (isBlooming && hash(x, 31) < 0.07 && nearTop(x, env) < env.ph - 1) {
      dot(canvas, x, env.ph - 1 - Math.floor(hash(x, 32) * 2), FLOWERS[Math.floor(hash(x, 33) * FLOWERS.length)] ?? '#ffffff')
    }
  }
}

/** A few trees on the near hill: round in summer, pines under snow. */
const paintTrees = (canvas: Canvas, light: Light, houseAt: number, env: Env): void => {
  const count = Math.max(2, Math.floor(env.pw / 26))
  const crown = light.isDark ? shade(TREE, 0.45) : TREE
  const lit = light.isSnow ? '#f4f8fb' : light.isDark ? shade(TREE_LIGHT, 0.45) : TREE_LIGHT
  const sprite = light.isSnow ? ['.s.', 'gsg', 'ggg', '.t.'] : ['.l.', 'lgg', 'ggg', '.t.']

  for (let tree = 0; tree < count; tree += 1) {
    const x = Math.floor(hash(tree, 21) * (env.pw - 3))

    if (Math.abs(x - houseAt) > 9 && env.ph >= 8) {
      stamp(canvas, x, nearTop(x + 1, env) - sprite.length + 1, sprite, {
        g: crown,
        l: lit,
        s: lit,
        t: light.isDark ? shade(TRUNK, 0.5) : TRUNK,
      })
    }
  }
}

/** The house, its window lit by night and in the rain, smoke from its chimney. */
const paintHouse = (canvas: Canvas, climate: Climate, light: Light, at: number, env: Env): void => {
  const sprite = env.ph >= 8 ? HOUSE : SMALL_HOUSE
  const top = nearTop(at + 4, env) - sprite.length + 1
  const isLit = light.isDark || climate.mood >= RAINY
  const dim = light.isDark ? 0.55 : 1
  stamp(canvas, at, top, sprite, {
    c: shade(HOUSE_COLORS.c, dim),
    r: light.isSnow ? '#f4f7fa' : shade(HOUSE_COLORS.r, dim),
    w: shade(HOUSE_COLORS.w, dim),
    y: isLit ? HOUSE_COLORS.y : shade('#5b6b80', dim),
    d: shade(HOUSE_COLORS.d, dim),
  })

  const chimney = [...(sprite[0] ?? '')].indexOf('c')
  const sky = skyOf(climate, light)

  for (let puff = 0; puff < 3 && top > 1; puff += 1) {
    const rise = (env.ticks * 0.04 + puff / 3) % 1
    const y = top - 1 - rise * Math.min(4, top)
    const behind = along(sky, y / Math.max(1, env.ph - 1))
    dot(canvas, at + chimney + rise * 3, y, mix(SMOKE, behind, rise))
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
      climate.clouds.push(cloudOf(-22, env))
    }

    const isSnow = isSnowing(env)
    const fall = isSnow ? 0.3 : 1
    const slant = isSnow ? Math.sin(env.ticks * 0.2) * 0.3 : 0.2 + climate.mood * 0.5
    climate.drops = climate.drops
      .map(drop => ({ x: drop.x + slant, y: drop.y + fall }))
      .filter(drop => drop.y < nearTop(drop.x, env))

    if (climate.mood >= RAINY) {
      // Snow lingers in the air three times as long, so less of it starts.
      const rate = (climate.mood - RAINY + 0.1) * env.pw * (isSnow ? 0.025 : 0.08)
      const falling = Math.floor(rate) + (env.roll() < rate % 1 ? 1 : 0)

      for (let made = 0; made < falling; made += 1) {
        climate.drops.push({ x: env.roll() * env.pw - 4, y: 3 + env.roll() * 2 })
      }

      climate.drops = climate.drops.slice(-Math.ceil(env.pw * DROPS_A_COLUMN))
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
    const light = lightOf(env)
    const sky = skyOf(climate, light)
    const tones = tonesOf(climate, light)
    const houseAt = Math.floor(env.pw * 0.78)
    backdrop(canvas, sky)

    if (climate.mood < 0.55) {
      paintLight(canvas, climate, light, env)
    }

    if (climate.bow > 0) {
      paintBow(canvas, sky, env, climate.bow)
    }

    paintDeck(canvas, climate, tones, env)

    for (const cloud of climate.clouds) {
      paintCloud(canvas, cloud, tones, env)
    }

    climate.bolt?.path.forEach((x, down) => {
      dot(canvas, x, BOLT_TOP + down, BOLT)
    })
    paintHills(canvas, climate, light, env)
    paintTrees(canvas, light, houseAt, env)
    paintHouse(canvas, climate, light, houseAt, env)

    for (const drop of climate.drops) {
      const row = Math.floor(drop.y / 2)

      if (light.isSnow) {
        const isBig = hash(Math.floor(drop.x * 7), Math.floor(drop.y)) < 0.4
        write(canvas, drop.x, row, isBig ? '*' : '·', isBig ? SNOW[0] : SNOW[1])
      } else {
        write(canvas, drop.x, row, '\\', climate.mood >= STORMY ? HEAVY_RAIN : RAIN)
      }
    }

    for (const bird of climate.birds) {
      const isUp = Math.floor(env.ticks / 4 + bird.row) % 2 === 0
      write(canvas, bird.x, bird.row, isUp ? 'v' : '-', BIRD)
    }

    if (env.feed.sky !== null) {
      // The real sky, named at the top right on a darker plate of the sky:
      // a plate of one color keeps the words one run and easy to read.
      const caption = `${env.feed.place} ${Math.round(env.feed.sky.temperature)}° ${outsideOf(env.feed.sky.code).name}`
      const x = env.w - caption.length - 5
      // Rain or a bird written there before goes, or it shows between the words.
      wipe(canvas, x - 1, 0, caption.length + 2)
      fill(canvas, x - 1, 0, caption.length + 2, 2, shade(sky[0] ?? '#000000', 0.62))
      write(canvas, x, 0, caption, CAPTION)
    }
  },
}
