import { FAIL_COLOR, KINDS, KIND_COLORS, kindAt } from '../catalog'
import type { Kind } from '../catalog'
import { BOLD, along, backdrop, dot, fill, hash, mix, pick, stamp, wipe, write } from '../kit'
import type { Canvas, Env, Scene } from '../kit'

// A star at a place in the sky, which scrolls: `x` counts cells from where
// the session's first star rose. `link` is the star it is joined to.
type Star = { x: number; row: number; kind: Kind; link: number }
type Figure = { stars: Star[]; name: string; isDone: boolean }
type Meteor = { x: number; y: number; dx: number; dy: number; life: number; color: string }
type Label = { text: string; x: number; row: number; ticks: number; color: string }
type Sky = {
  figures: Figure[]
  // The sky's column at the band's left edge.
  cam: number
  meteors: Meteor[]
  label: Label | undefined
}

// A constellation is named for the kind of call its turn made most.
const FIRST_NAMES: Readonly<Record<Kind, string>> = {
  read: 'Lector',
  search: 'Vestigator',
  edit: 'Scriptor',
  shell: 'Testudo',
  web: 'Aranea',
  agent: 'Legatus',
  mcp: 'Machina',
  other: 'Incognita',
}
const LAST_NAMES = ['Major', 'Minor', 'Borealis', 'Australis', 'Prima', 'Nova']
// The night from the top of the band down to the glow over the horizon.
const NIGHT = ['#03040b', '#080b22', '#10143a', '#1d1c4c']
const MILKY_WAY = '#5f64a8'
const DUST = '#9aa0d6'
const LINE = '#7a81c2'
const SHOOTING = '#f2f4ff'
// The far stars, faint to bright, as the glyph each shows.
const FAR_STARS: readonly (readonly [string, string])[] = [
  ['.', '#4a5084'],
  ['·', '#9aa2d8'],
  ['·', '#f2f4ff'],
]
const HORIZON = '#07080f'
const TREE = '#04050a'
const PINE = ['..t..', '.ttt.', 'ttttt']
const GAP = 8
// Where on the band the newest star is kept in view.
const LEAD = 0.72
const DRIFT = 0.012
const LABEL_TICKS = 80
const BRANCH_ODDS = 0.2
const MOST_FIGURES = 14
const LOGGED_STARS = 10
// How much slower than the constellations the far sky and the land scroll.
const FAR_PACE = 0.25
const LAND_PACE = 0.6

/** The rows a star may rise in: the bottom one is the horizon's, where it can spare it. */
const skyRows = (env: Env): number => (env.h >= 3 ? env.h - 1 : env.h)

const rightOf = (figure: Figure | undefined): number =>
  Math.max(0, ...(figure?.stars.map(star => star.x) ?? []))

const risen = (sky: Sky, kind: Kind, env: Env): void => {
  const open = sky.figures.at(-1)
  const figure: Figure =
    open === undefined || open.isDone ? { stars: [], name: '', isDone: false } : open
  const last = figure.stars.at(-1)

  if (figure !== open) {
    sky.figures.push(figure)
    sky.figures = sky.figures.slice(-MOST_FIGURES)
  }

  if (last === undefined) {
    figure.stars.push({
      x: Math.max(rightOf(open) + GAP, Math.floor(sky.cam + env.w * 0.4)),
      row: Math.floor(env.roll() * skyRows(env)),
      kind,
      link: -1,
    })

    return
  }

  // Mostly the stars join in a line; now and then one branches off an elder.
  const isBranch = figure.stars.length > 2 && env.roll() < BRANCH_ODDS
  const link = isBranch
    ? Math.floor(env.roll() * (figure.stars.length - 1))
    : figure.stars.length - 1
  const from = figure.stars[link] ?? last
  const rows = Array.from({ length: skyRows(env) }, (_, row) => row).filter(
    row => row !== from.row,
  )

  figure.stars.push({
    x: last.x + 2 + Math.floor(env.roll() * 5),
    row: pick(rows, env.roll()) ?? from.row,
    kind,
    link,
  })
}

/** The open constellation is finished: it gets its name. */
const named = (sky: Sky, env: Env): Figure | undefined => {
  const figure = sky.figures.at(-1)

  if (figure === undefined || figure.isDone || figure.stars.length === 0) {
    return undefined
  }

  const counts = KINDS.map(kind => figure.stars.filter(star => star.kind === kind).length)
  const most = kindAt(counts.indexOf(Math.max(...counts)))
  figure.isDone = true
  figure.name = `${FIRST_NAMES[most]} ${pick(LAST_NAMES, env.roll()) ?? 'Major'}`

  return figure
}

/** True where no glyph is written yet: the sky behind is all painted. */
const isFree = (canvas: Canvas, x: number, row: number): boolean =>
  x >= 0 && x < canvas.w && row >= 0 && row < canvas.h && canvas.glyphs[row * canvas.w + x] === ''

const nightAt = (y: number, env: Env): string =>
  along(NIGHT, env.ph > 1 ? y / (env.ph - 1) : 0)

const paintLine = (canvas: Canvas, from: Star, to: Star, cam: number): void => {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.row - from.row))

  // A dotted line: every third cell, so the stars stay the brightest thing.
  for (let step = 2; step < steps - 1; step += 3) {
    const x = Math.round(from.x + ((to.x - from.x) * step) / steps - cam)
    const row = Math.round(from.row + ((to.row - from.row) * step) / steps)

    if (isFree(canvas, x, row)) {
      write(canvas, x, row, '·', LINE)
    }
  }
}

/**
 * The Milky Way: a faint river of light winding across the sky, scrolling
 * slower than the constellations, with a little dust of stars along it. Its
 * glow is judged a row of cells at a time, so a star's cell never sits on
 * its edge.
 */
const paintMilkyWay = (canvas: Canvas, far: number, env: Env): void => {
  const half = Math.max(1, env.ph * 0.16)

  for (let x = 0; x < env.pw; x += 1) {
    const middle = env.ph * 0.42 + Math.sin((x + far) * 0.025) * env.ph * 0.3

    for (let y = 0; y < env.ph; y += 1) {
      const off = Math.abs(Math.floor(y / 2) * 2 + 0.5 - middle) / half
      const glow = off < 0.5 ? 0.2 : off < 1 ? 0.09 : 0

      if (glow > 0) {
        dot(canvas, x, y, mix(nightAt(y, env), MILKY_WAY, glow))
      }

      if (off < 0.6 && hash(x + far, y * 13 + 5) < 0.03) {
        dot(canvas, x, y, mix(nightAt(y, env), DUST, 0.4))
      }
    }
  }
}

/** The far stars, each twinkling on a beat of its own. */
const paintFarStars = (canvas: Canvas, far: number, env: Env): void => {
  for (let row = 0; row < skyRows(env); row += 1) {
    for (let x = 0; x < env.w; x += 1) {
      if (hash(x + far, row * 7 + 1) < 0.024 && isFree(canvas, x, row)) {
        const beat = hash((x + far) * 31 + row, Math.floor(env.ticks / 14))
        const level = beat < 0.25 ? 0 : hash(x + far, row) < 0.3 ? 2 : 1
        const [glyph = '.', color = '#ffffff'] = FAR_STARS[level] ?? []
        write(canvas, x, row, glyph, color)
      }
    }
  }
}

/** The land against the sky: low hills and pines, scrolling between the two. */
const paintHorizon = (canvas: Canvas, cam: number, env: Env): void => {
  const land = Math.floor(cam * LAND_PACE)
  const isRoomy = env.ph >= 8

  for (let x = 0; x < env.pw; x += 1) {
    const at = x + land
    const swell = Math.sin(at * 0.07) + Math.sin(at * 0.023 + 2)
    const tall = Math.max(1, Math.floor(env.ph / 8)) + (swell > 0.4 ? 1 : 0) + (swell > 1.3 && isRoomy ? 1 : 0)
    fill(canvas, x, env.ph - tall, 1, tall, HORIZON)

    if (isRoomy && hash(at, 51) < 0.035) {
      stamp(canvas, x - 2, env.ph - tall - PINE.length + 1, PINE, { t: TREE })
    }
  }
}

export const stars: Scene<Sky> = {
  start(env) {
    const sky: Sky = { figures: [], cam: 0, meteors: [], label: undefined }

    // The turns the session finished before the sky was looked at are up
    // there already, and so are the calls of the turn that is on.
    for (const turn of env.feed.log) {
      for (let made = 0; made < Math.min(turn.calls, LOGGED_STARS); made += 1) {
        risen(sky, kindAt(turn.kind), env)
      }

      named(sky, env)
    }

    env.feed.turnKinds.forEach((calls, index) => {
      for (let made = 0; made < Math.min(calls, LOGGED_STARS); made += 1) {
        risen(sky, kindAt(index), env)
      }
    })
    sky.cam = Math.max(0, rightOf(sky.figures.at(-1)) - env.w * LEAD)

    return sky
  },

  step(sky, env) {
    const target = rightOf(sky.figures.at(-1)) - env.w * LEAD
    sky.cam += target > sky.cam ? (target - sky.cam) * 0.15 : DRIFT
    sky.meteors = sky.meteors
      .map(meteor => ({
        ...meteor,
        x: meteor.x + meteor.dx,
        y: meteor.y + meteor.dy,
        life: meteor.life - 1,
      }))
      .filter(meteor => meteor.life > 0)

    if (sky.label !== undefined) {
      sky.label.ticks -= 1
      sky.label = sky.label.ticks > 0 ? sky.label : undefined
    }
  },

  hear(sky, event, env) {
    if (event.type === 'tool') {
      risen(sky, event.kind, env)
    } else if (event.type === 'fail') {
      // The failed call's star falls out of its constellation.
      const fallen = sky.figures.at(-1)?.stars.pop()

      if (fallen !== undefined) {
        sky.meteors.push({
          x: fallen.x - sky.cam,
          y: fallen.row,
          dx: 0.7,
          dy: 0.3,
          life: 16,
          color: FAIL_COLOR,
        })
      }
    } else if (event.type === 'turn') {
      const figure = named(sky, env)
      const first = figure?.stars[0]

      if (figure !== undefined && first !== undefined) {
        const rows = figure.stars.map(star => star.row)
        const isHigh = rows.reduce((sum, row) => sum + row, 0) / rows.length < env.h / 2
        const count = figure.stars.length
        sky.label = {
          text: `${figure.name} · ${count} ${count === 1 ? 'star' : 'stars'}`,
          x: first.x,
          row: isHigh ? env.h - 1 : 0,
          ticks: LABEL_TICKS,
          color: KIND_COLORS[first.kind],
        }
        sky.meteors.push({
          x: env.w * (0.4 + env.roll() * 0.6),
          y: 0,
          dx: -1.6,
          dy: 0.28,
          life: 24,
          color: SHOOTING,
        })
      }
    }
  },

  paint(sky, canvas, env) {
    const cam = Math.floor(sky.cam)
    // The far sky drifts slower than the near stars.
    const far = Math.floor(sky.cam * FAR_PACE)
    backdrop(canvas, NIGHT)
    paintMilkyWay(canvas, far, env)

    for (const meteor of sky.meteors) {
      // The trail fades behind the head, pixel by pixel, into the night.
      for (let back = 1; back <= 4; back += 1) {
        const y = (meteor.y - meteor.dy * back * 0.8) * 2 + 1
        dot(canvas, meteor.x - meteor.dx * back * 0.8, y, mix(nightAt(y, env), meteor.color, 0.8 - back / 5))
      }
    }

    paintHorizon(canvas, sky.cam, env)

    sky.figures.forEach((figure, at) => {
      figure.stars.forEach((star, index) => {
        const x = star.x - cam
        // A star twinkles on a beat of its own; an open figure's burn bright.
        const isDim = hash(at * 53 + index, Math.floor(env.ticks / 6)) < 0.2
        const glyph = figure.isDone ? (isDim ? '+' : '*') : isDim ? '+' : '✦'
        write(canvas, x, star.row, glyph, KIND_COLORS[star.kind], figure.isDone ? 0 : BOLD)
      })
    })

    for (const figure of sky.figures) {
      for (const star of figure.stars) {
        const from = figure.stars[star.link]

        if (from !== undefined) {
          paintLine(canvas, from, star, cam)
        }
      }
    }

    paintFarStars(canvas, far, env)

    for (const meteor of sky.meteors) {
      write(canvas, meteor.x, meteor.y, '*', meteor.color, BOLD)
    }

    if (sky.label !== undefined) {
      const { row, text } = sky.label
      const x = Math.min(Math.max(1, sky.label.x - cam), env.w - text.length - 1)
      // The name stands on a strip of the night it is written on, or of the
      // land along the bottom: one color behind it keeps it whole.
      const plate = row === env.h - 1 ? HORIZON : nightAt(row * 2 + 1, env)
      // A far star written there before goes, or it shows between the words.
      wipe(canvas, x - 1, row, text.length + 2)
      fill(canvas, x - 1, row * 2, text.length + 2, 2, plate)
      write(canvas, x, row, text, sky.label.color, BOLD)
    }
  },
}
