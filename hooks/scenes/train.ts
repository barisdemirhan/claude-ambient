import { KIND_COLORS, kindAt } from '../catalog'
import type { Kind } from '../catalog'
import { DIM, FAINT, FG, clamp, dot, hash, shade, sign, stamp } from '../kit'
import type { Canvas, Env, Scene } from '../kit'

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

const ENGINE = [
  '        ss  ',
  ' cccc   ss  ',
  ' cwwcRRRRRR ',
  ' cccRRRRRRRR',
  'kkkkkkkkkkkk',
  ' oo  oo  oo ',
]
const ENGINE_COLORS = {
  s: '#546e7a',
  c: '#c62828',
  w: '#ffd54f',
  R: '#e53935',
  k: '#37474f',
}
const ENGINE_WIDE = 12
const STACK = 8.5
// A wagon for every kind of call: box car, hopper, flat car with crates,
// tank car, container, coach, striped box and a low gondola.
const WAGONS: Readonly<Record<Kind, readonly string[]>> = {
  read: ['AAAAAAA', 'AaAAAaA', 'AAAAAAA', ' o   o '],
  search: ['A     A', 'AAAAAAA', ' AAAAA ', ' o   o '],
  edit: ['  BB b ', ' BBB bb', 'AAAAAAA', ' o   o '],
  shell: [' AAAAA ', 'AAAAAAA', ' AAAAA ', ' o   o '],
  web: ['AAAaAAA', 'AAAaAAA', 'AAAaAAA', ' o   o '],
  agent: ['AAAAAAA', 'AwAwAwA', 'AAAAAAA', ' o   o '],
  mcp: ['AAAAAAA', 'aaaaaaa', 'AAAAAAA', ' o   o '],
  other: ['       ', 'AAAAAAA', 'AAAAAAA', ' o   o '],
}
const WAGON_WIDE = 7
const WAGON_PITCH = WAGON_WIDE + 1
const STATION = [' rrrrrrrrrr ', 'rrrrrrrrrrrr', ' yywyyddywy ', ' yyyyyddyyy ']
const STATION_COLORS = { r: '#8d6e63', y: '#bcaaa4', w: '#ffd54f', d: '#5d4037' }
const PLATFORM = '#90a4ae'
const PLATFORM_BEHIND = 26
const PLATFORM_AHEAD = 14
const WHEELS = ['#78909c', '#b0bec5']
const CRATE = '#bcaaa4'
const CRATE_SHADE = '#a1887f'
const LIT = '#ffd54f'
const COUPLING = '#37474f'
const SLEEPER = '#8d6e63'
const SPARKS = ['#ffeb3b', '#ef5350']
const TRUNK = '#795548'
const CANOPY = '#66bb6a'
const SMOKE = ['#b0bec5', '#90a4ae']
const TOP_SPEED = 1.2
const PULL = 0.03
const LAG = 12
const MOST_WAGONS = 40
const PUFF_LIFE = 20
// The scenery has something every so many pixels of line, or nothing.
const SCENERY_PITCH = 11

/** The engine's left edge on the band: it holds its place, the world moves. */
const engineAt = (env: Env): number => clamp(env.pw - 30, 4, Math.max(4, env.pw - ENGINE_WIDE))

/** Where the station comes to rest: just ahead of the engine. */
const stopAt = (env: Env): number => engineAt(env) + ENGINE_WIDE + 3

const wagonAt = (index: number, wagon: Wagon, env: Env): number =>
  engineAt(env) - (index + 1) * WAGON_PITCH - wagon.lag

const paintWagon = (
  canvas: Canvas,
  x: number,
  wagon: Pick<Wagon, 'kind' | 'isBroken'>,
  env: Env,
  wheel: string,
): void => {
  const color = shade(KIND_COLORS[wagon.kind], wagon.isBroken ? 0.45 : 1)
  const lines = WAGONS[wagon.kind]
  stamp(canvas, x, env.ph - 1 - lines.length, lines, {
    A: color,
    a: shade(color, 0.65),
    B: CRATE,
    b: CRATE_SHADE,
    w: LIT,
    o: wheel,
  })

  if (wagon.isBroken) {
    // A failed call's wagon limps along, throwing sparks.
    const at = Math.floor(env.ticks / 2)
    dot(canvas, x + 1 + (at % 5), env.ph - 2, SPARKS[at % 2] ?? LIT)
  }
}

const paintScenery = (canvas: Canvas, railway: Railway, env: Env): void => {
  const scrolled = Math.floor(railway.dist)
  const first = Math.floor(scrolled / SCENERY_PITCH) - 1
  const ground = env.ph - 2

  for (let place = first; place <= first + env.pw / SCENERY_PITCH + 2; place += 1) {
    const x = place * SCENERY_PITCH - scrolled
    const what = hash(place, 77)

    if (what < 0.14) {
      dot(canvas, x, ground, TRUNK)
      dot(canvas, x, ground - 1, TRUNK)

      for (let dx = -1; dx <= 1; dx += 1) {
        dot(canvas, x + dx, ground - 2, CANOPY)
        dot(canvas, x + dx, ground - 3, CANOPY)
      }
    } else if (what < 0.22) {
      for (let up = 0; up < 4; up += 1) {
        dot(canvas, x, ground - up, FAINT)
      }
    } else if (what < 0.3) {
      dot(canvas, x, ground, CANOPY)
      dot(canvas, x + 1, ground, CANOPY)
    }
  }
}

const paintStation = (canvas: Canvas, railway: Railway, env: Env): void => {
  if (railway.station === undefined) {
    return
  }

  const x = Math.floor(railway.station - railway.dist)
  const ground = env.ph - 2
  const top = ground - STATION.length

  for (let dx = -PLATFORM_BEHIND; dx < PLATFORM_AHEAD; dx += 1) {
    dot(canvas, x + dx, ground, PLATFORM)
  }

  stamp(canvas, x, top, STATION, STATION_COLORS)
  sign(canvas, x, Math.floor(top / 2) - 1, `Turn ${railway.stop}`, FG, DIM)
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
    if (env.ticks % (railway.speed > 0.1 ? 3 : 14) === 0) {
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
    const rail = env.ph - 1
    const scrolled = Math.floor(railway.dist)
    const wheel = WHEELS[railway.speed > 0 ? scrolled % 2 : 0] ?? FAINT
    paintScenery(canvas, railway, env)
    paintStation(canvas, railway, env)

    for (let x = 0; x < env.pw; x += 1) {
      dot(canvas, x, rail, (x + scrolled) % 4 === 0 ? SLEEPER : FAINT)
    }

    for (const wagon of railway.parked) {
      paintWagon(canvas, Math.floor(wagon.at - railway.dist), wagon, env, WHEELS[0] ?? FAINT)
    }

    railway.wagons.forEach((wagon, index) => {
      const x = Math.floor(wagonAt(index, wagon, env))
      paintWagon(canvas, x, wagon, env, wheel)
      dot(canvas, x + WAGON_WIDE, env.ph - 3, COUPLING)
    })

    stamp(canvas, engineAt(env), rail - ENGINE.length, ENGINE, {
      ...ENGINE_COLORS,
      o: wheel,
    })

    for (const puff of railway.puffs) {
      dot(canvas, puff.x, puff.y, puff.age < 7 ? (SMOKE[0] ?? FAINT) : puff.age < 13 ? (SMOKE[1] ?? FAINT) : FAINT)
    }

    const count = railway.wagons.length

    if (count > 0) {
      sign(canvas, 1, 0, `${count} ${count === 1 ? 'wagon' : 'wagons'}`, FG, DIM)
    }
  },
}
