import { KIND_COLORS, kindAt } from '../catalog'
import type { Kind } from '../catalog'
import { along, backdrop, clamp, dot, fill, hash, mix, shade, stamp, wipe, write } from '../kit'
import type { Canvas, Env, Scene } from '../kit'

import { NIGHT_TINT, label, lightOf, skyOf } from './daylight'

// A wagon coupled behind the engine: `lag` is how far it still trails the
// place it is rolling up to.
type Wagon = { kind: Kind; lag: number; isBroken: boolean }
// A wagon left standing at a station, by its place along the line.
type Parked = { kind: Kind; at: number; isBroken: boolean }
type Puff = { x: number; y: number; age: number }
type Railway = {
  phase: 'station' | 'run' | 'arrive'
  speed: number
  // Pixels of line the train has run: the scenery scrolls by it.
  dist: number
  wagons: Wagon[]
  parked: Parked[]
  // Where along the line the station stands, and the turn it is named for.
  station: number | undefined
  stop: number
  puffs: Puff[]
}

// A red cab, a black boiler banded in brass, red wheels on steel tyres.
const ENGINE = [
  ' rrrrrr     sss  ',
  ' RwwRR   GG  s   ',
  ' RwwRRBBBBBBBBBB ',
  ' RRRRRBGBBBGBBBBL',
  'xkkkkkkkkkkkkkkkc',
  '  oOo oOo oOo  o ',
]
const ENGINE_COLORS = {
  r: '#8e1c1c',
  R: '#c62828',
  B: '#2b2f36',
  G: '#e0b04a',
  s: '#1f2227',
  k: '#1c1e22',
  x: '#d84315',
  c: '#9aa3ad',
}
const ENGINE_WIDE = 17
const STACK = 13
const LAMP_ROW = 3
// A wagon for every kind of call: box car, hopper, flat car with crates,
// tank car, container, coach, striped box and a low gondola.
const WAGONS: Readonly<Record<Kind, readonly string[]>> = {
  read: ['ddddddd', 'AAAAAAA', 'AAAAAAA', 'ookkkoo'],
  search: ['A     A', 'AAAAAAA', ' aAAAa ', 'ookkkoo'],
  edit: [' BBb b ', ' BBb bb', 'AAAAAAA', 'ookkkoo'],
  shell: [' dAAAd ', 'AAAAAAA', ' aaaaa ', 'ookkkoo'],
  web: ['AAAAAAA', 'AAAAAAA', 'aaaaaaa', 'ookkkoo'],
  agent: ['ddddddd', 'AwAwAwA', 'AAAAAAA', 'ookkkoo'],
  mcp: ['ddddddd', 'aaaaaaa', 'AAAAAAA', 'ookkkoo'],
  other: ['       ', 'AcccccA', 'AAAAAAA', 'ookkkoo'],
}
const WAGON_WIDE = 7
const WAGON_PITCH = WAGON_WIDE + 1
const STATION = [' tttttttttt ', 'tttttttttttt', ' ccwccddcwc ', ' ccccdccccc ']
const STATION_COLORS = { t: '#a0442f', c: '#e8dcc0', d: '#6b4a32' }
const WINDOW_DAY = '#7fa7c4'
const PLATFORM = '#a3a9b0'
const PLATFORM_EDGE = '#e0c34a'
const PLATFORM_BEHIND = 30
const PLATFORM_AHEAD = 16
const BOARD = '#24453a'
const BOARD_TEXT = '#f2efe6'
const WHEELS = ['#9aa3ad', '#b71c1c']
const FRAME = '#1c1e22'
const CRATE = '#c9a77a'
const CRATE_SHADE = '#9c7b52'
const COAL = '#3a3a3f'
const LIT = '#ffd36e'
const LAMP = '#fff3c4'
const SPARKS = ['#ffeb3b', '#ef5350']
const RAIL = '#aab2bb'
const BALLAST = '#6e6459'
const MEADOW = '#6aa84f'
const TRUNK = '#5d4037'
const CANOPY = ['#4e9a3e', '#3a7a30']
const POLE = '#6d5a48'
const MOUNTAIN = '#56678a'
const SNOW = '#eef3f8'
const HILL = '#4f8f43'
const SMOKE = '#d9dee3'
const TOP_SPEED = 1.2
const PULL = 0.03
const LAG = 12
const MOST_WAGONS = 40
const PUFF_LIFE = 22
// The scenery has something every so many pixels of line, or nothing.
const SCENERY_PITCH = 11
// How fast the far mountains and the hills go by, of the train's speed.
const FAR_DRIFT = 0.1
const HILL_DRIFT = 0.3



/** The engine's left edge on the band: it holds its place, the world moves. */
const engineAt = (env: Env): number => clamp(env.pw - 32, 4, Math.max(4, env.pw - ENGINE_WIDE))

/** Where the station comes to rest: just ahead of the engine. */
const stopAt = (env: Env): number => engineAt(env) + ENGINE_WIDE + 3

const wagonAt = (index: number, wagon: Wagon, env: Env): number =>
  engineAt(env) - (index + 1) * WAGON_PITCH - wagon.lag

/** The height of a row of peaks or hills at a column of the scrolled line. */
const ridgeAt = (
  x: number,
  seed: number,
  pitch: number,
  tall: number,
  isPeaked: boolean,
): number => {
  const first = Math.floor(x / pitch) - 1
  let most = 0

  for (let bump = first; bump <= first + 2; bump += 1) {
    const middle = (bump + hash(bump, seed)) * pitch
    const reach = pitch * (0.7 + hash(bump, seed + 1) * 0.6)
    const far = Math.abs(x - middle) / reach

    if (far < 1) {
      const height = tall * (0.45 + hash(bump, seed + 2) * 0.55)
      most = Math.max(most, height * (isPeaked ? 1 - far : Math.cos((far * Math.PI) / 2)))
    }
  }

  return Math.round(most)
}

/**
 * The land behind the line: snowy peaks far off, green hills nearer, both
 * going by slower than the train, and the meadow along the track.
 */
const paintLand = (
  canvas: Canvas,
  railway: Railway,
  env: Env,
  sky: readonly string[],
  light: number,
): void => {
  const haze = sky.at(-1) ?? NIGHT_TINT
  const lit = (color: string): string => mix(NIGHT_TINT, color, light)
  const far = lit(mix(haze, MOUNTAIN, 0.55))
  const snow = lit(mix(haze, SNOW, 0.8))
  const hill = lit(mix(haze, HILL, 0.8))
  const meadow = env.ph - 3
  const farShift = Math.floor(railway.dist * FAR_DRIFT)
  const hillShift = Math.floor(railway.dist * HILL_DRIFT)

  for (let x = 0; x < env.pw; x += 1) {
    const peak = ridgeAt(x + farShift, 5, 22, env.ph * 0.62, true)
    fill(canvas, x, meadow - peak, 1, peak, far)

    if (peak >= env.ph * 0.42) {
      fill(canvas, x, meadow - peak, 1, peak >= env.ph * 0.55 ? 2 : 1, snow)
    }

    const rise = Math.max(1, ridgeAt(x + hillShift, 9, 15, env.ph * 0.3, false))
    fill(canvas, x, meadow - rise, 1, rise, hill)
  }

  fill(canvas, 0, meadow, env.pw, 1, lit(MEADOW))
}

/** The sun by day and the moon by night, on an arc over the line. */
const paintSun = (canvas: Canvas, env: Env, sky: readonly string[]): void => {
  const { hour } = env.feed
  const isDay = hour >= 6 && hour < 20
  const share = isDay ? (hour - 6 + 0.5) / 14 : (((hour + 4) % 24) + 0.5) / 10
  // It keeps to the sky the smoke leaves clear, behind the train.
  const x = Math.round(3 + share * env.pw * 0.55)
  const y = Math.round((1 - Math.sin(share * Math.PI)) * env.ph * 0.35) + 1
  const isLow = hour < 8 || hour >= 17
  const core = isDay ? (isLow ? '#ffdca6' : '#fff8d6') : '#f4f0d4'
  const rim = isDay ? (isLow ? '#ffa05c' : '#ffd54f') : '#d9d4b4'

  for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]] as const) {
    dot(canvas, x + dx, y + dy, rim)
  }

  dot(canvas, x, y, core)
  const behind = along(sky, (y + 1) / Math.max(1, env.ph - 1))
  dot(canvas, x + 1, y + 1, mix(behind, rim, isDay ? 0.45 : 0.2))
}

/** Trees, bushes and telegraph poles by the line, going by at its pace. */
const paintScenery = (canvas: Canvas, railway: Railway, env: Env, light: number): void => {
  const lit = (color: string): string => mix(NIGHT_TINT, color, light)
  const scrolled = Math.floor(railway.dist)
  const first = Math.floor(scrolled / SCENERY_PITCH) - 1
  const ground = env.ph - 3

  for (let place = first; place <= first + env.pw / SCENERY_PITCH + 2; place += 1) {
    const x = place * SCENERY_PITCH - scrolled
    const what = hash(place, 77)

    if (what < 0.2) {
      const tall = env.ph >= 12 && hash(place, 78) < 0.5 ? 2 : 1
      fill(canvas, x, ground - tall, 1, tall, lit(TRUNK))
      fill(canvas, x - 1, ground - tall - 2, 3, 1, lit(CANOPY[0] ?? MEADOW))
      fill(canvas, x - 1, ground - tall - 1, 3, 1, lit(CANOPY[1] ?? MEADOW))
      dot(canvas, x, ground - tall - 3, lit(CANOPY[0] ?? MEADOW))
    } else if (what < 0.32) {
      fill(canvas, x, ground - 4, 1, 4, lit(POLE))
      fill(canvas, x - 1, ground - 4, 3, 1, lit(POLE))
    } else if (what < 0.45) {
      fill(canvas, x, ground - 1, 2, 1, lit(CANOPY[1] ?? MEADOW))
    }
  }
}

const paintTrack = (canvas: Canvas, env: Env, light: number): void => {
  const lit = (color: string): string => mix(NIGHT_TINT, color, light)
  fill(canvas, 0, env.ph - 2, env.pw, 1, lit(RAIL))
  fill(canvas, 0, env.ph - 1, env.pw, 1, lit(BALLAST))
}

/** The station: its platform, a house with a tiled roof, and its name board. */
const paintStation = (canvas: Canvas, railway: Railway, env: Env, light: number): void => {
  if (railway.station === undefined) {
    return
  }

  const lit = (color: string): string => mix(NIGHT_TINT, color, light)
  const isNight = light < 0.7
  const x = Math.floor(railway.station - railway.dist)
  const ground = env.ph - 3
  const top = ground - STATION.length
  const long = PLATFORM_BEHIND + PLATFORM_AHEAD
  fill(canvas, x - PLATFORM_BEHIND, ground, long, 1, lit(PLATFORM))
  fill(canvas, x - PLATFORM_BEHIND, ground - 1, long, 1, lit(PLATFORM_EDGE))
  stamp(canvas, x, top, STATION, {
    t: lit(STATION_COLORS.t),
    c: lit(STATION_COLORS.c),
    d: lit(STATION_COLORS.d),
    w: isNight ? LIT : lit(WINDOW_DAY),
  })

  // The board names the turn, on the row of cells over the roof.
  const name = `Turn ${railway.stop}`
  const row = Math.floor(top / 2) - 1

  if (row >= 0) {
    const left = x + 6 - Math.floor((name.length + 2) / 2)
    fill(canvas, left, row * 2, name.length + 2, 2, lit(BOARD))
    write(canvas, left + 1, row, name, BOARD_TEXT)
  }
}

const paintWagon = (
  canvas: Canvas,
  x: number,
  wagon: Pick<Wagon, 'kind' | 'isBroken'>,
  env: Env,
  light: number,
): void => {
  const lit = (color: string): string => mix(NIGHT_TINT, color, light)
  const color = shade(KIND_COLORS[wagon.kind], wagon.isBroken ? 0.45 : 1)
  const lines = WAGONS[wagon.kind]
  stamp(canvas, x, env.ph - 1 - lines.length, lines, {
    A: lit(color),
    a: lit(shade(color, 0.7)),
    d: lit(shade(color, 0.55)),
    B: lit(CRATE),
    b: lit(CRATE_SHADE),
    c: lit(COAL),
    w: light < 0.7 ? LIT : lit(mix(color, '#ffffff', 0.55)),
    k: FRAME,
    // Steel wheels on the steel rail: the frame between them shows them.
    o: lit(RAIL),
  })

  if (wagon.isBroken) {
    // A failed call's wagon limps along, throwing sparks.
    const at = Math.floor(env.ticks / 2)
    dot(canvas, x + 1 + (at % 5), env.ph - 2, SPARKS[at % 2] ?? LIT)
  }
}

export const train: Scene<Railway> = {
  start(env) {
    const { isWorking, turnKinds, turns } = env.feed
    const wagons = turnKinds
      .flatMap((calls, index) =>
        Array.from({ length: calls }, (): Wagon => ({ kind: kindAt(index), lag: 0, isBroken: false })),
      )
      .slice(-MOST_WAGONS)

    return {
      phase: isWorking ? 'run' : 'station',
      speed: isWorking ? TOP_SPEED : 0,
      dist: 0,
      wagons: isWorking ? wagons : [],
      parked: [],
      station: isWorking ? undefined : stopAt(env),
      stop: turns,
      puffs: [],
    }
  },

  step(railway, env) {
    if (railway.phase === 'run') {
      railway.speed = Math.min(TOP_SPEED, railway.speed + PULL)
    } else if (railway.phase === 'arrive' && railway.station !== undefined) {
      const left = railway.station - railway.dist - stopAt(env)
      railway.speed = clamp(left * 0.07, 0.08, Math.min(TOP_SPEED, railway.speed + PULL))

      if (left <= 0.5) {
        railway.phase = 'station'
      }
    }

    if (railway.phase === 'station') {
      railway.speed = 0
    }

    railway.dist += railway.speed
    railway.wagons = railway.wagons.map(wagon => ({
      ...wagon,
      lag: Math.max(0, wagon.lag - 1.5),
    }))
    railway.parked = railway.parked.filter(
      wagon => wagon.at - railway.dist > -WAGON_PITCH,
    )

    if (
      railway.phase === 'run' &&
      railway.station !== undefined &&
      railway.station - railway.dist < -PLATFORM_AHEAD - ENGINE_WIDE
    ) {
      railway.station = undefined
    }

    // The engine puffs along the line and only breathes at the platform.
    if (env.ticks % (railway.speed > 0.1 ? 4 : 14) === 0) {
      railway.puffs.push({
        x: engineAt(env) + STACK,
        y: env.ph - 2 - ENGINE.length,
        age: 0,
      })
    }

    railway.puffs = railway.puffs
      .map(puff => ({
        x: puff.x - 0.25 - railway.speed * 0.8,
        y: puff.y - 0.3,
        age: puff.age + 1,
      }))
      .filter(puff => puff.age < PUFF_LIFE)
  },

  hear(railway, event, env) {
    if (event.type === 'work' && event.isOn && railway.phase !== 'run') {
      // A new turn: the engine leaves the last one's wagons at the platform.
      railway.parked = railway.wagons.map((wagon, index) => ({
        kind: wagon.kind,
        isBroken: wagon.isBroken,
        at: wagonAt(index, wagon, env) + railway.dist,
      }))
      railway.wagons = []
      railway.phase = 'run'
    } else if (event.type === 'tool') {
      railway.wagons = [
        ...railway.wagons,
        { kind: event.kind, lag: LAG, isBroken: false },
      ].slice(-MOST_WAGONS)
    } else if (event.type === 'fail') {
      const last = railway.wagons.at(-1)

      if (last !== undefined) {
        last.isBroken = true
      }
    } else if (
      (event.type === 'turn' || (event.type === 'work' && !event.isOn)) &&
      railway.phase === 'run'
    ) {
      // The turn is over: the next station comes into view.
      railway.phase = 'arrive'
      railway.station = railway.dist + env.pw + PLATFORM_BEHIND
      railway.stop = env.feed.turns
    }
  },

  bed(railway) {
    return railway.phase === 'station' ? 'station' : 'run'
  },

  paint(railway, canvas, env) {
    const sky = skyOf(env.feed.hour)
    const light = lightOf(env.feed.hour)
    const scrolled = Math.floor(railway.dist)
    const isTurning = railway.speed > 0 && scrolled % 2 === 1
    // The wheels' rims and hubs trade places as they turn.
    const [rim, hub] = isTurning ? [WHEELS[1], WHEELS[0]] : [WHEELS[0], WHEELS[1]]
    backdrop(canvas, sky)
    paintSun(canvas, env, sky)
    paintLand(canvas, railway, env, sky, light)
    paintScenery(canvas, railway, env, light)
    paintStation(canvas, railway, env, light)
    paintTrack(canvas, env, light)

    for (const wagon of railway.parked) {
      paintWagon(canvas, Math.floor(wagon.at - railway.dist), wagon, env, light)
    }

    railway.wagons.forEach((wagon, index) => {
      const x = Math.floor(wagonAt(index, wagon, env))
      paintWagon(canvas, x, wagon, env, light)
      dot(canvas, x + WAGON_WIDE, env.ph - 3, FRAME)
    })

    const engine = engineAt(env)
    const lit = (color: string): string => mix(NIGHT_TINT, color, light)
    stamp(canvas, engine, env.ph - 1 - ENGINE.length, ENGINE, {
      ...Object.fromEntries(
        Object.entries(ENGINE_COLORS).map(([key, color]) => [key, lit(color)]),
      ),
      w: light < 0.7 ? LIT : lit('#ffe7a8'),
      L: LAMP,
      o: rim ?? FRAME,
      O: hub ?? FRAME,
    })

    if (light < 0.7) {
      // At night the lamp lights the line ahead.
      const row = env.ph - 1 - ENGINE.length + LAMP_ROW

      for (let ahead = 1; ahead <= 6; ahead += 1) {
        const behind = along(sky, row / Math.max(1, env.ph - 1))
        const beam = mix(behind, LAMP, 0.4 - ahead * 0.05)
        dot(canvas, engine + ENGINE_WIDE - 1 + ahead, row, beam)
      }
    }

    for (const puff of railway.puffs) {
      const behind = along(sky, clamp(puff.y, 0, env.ph - 1) / Math.max(1, env.ph - 1))
      const color = mix(lit(SMOKE), behind, puff.age / PUFF_LIFE)
      const size = puff.age < 6 ? 1 : 2
      fill(canvas, puff.x, puff.y, size, size, color)
    }

    const count = railway.wagons.length

    if (count > 0) {
      label(canvas, 0, `${count} ${count === 1 ? 'wagon' : 'wagons'}`, sky)
    }
  },
}
