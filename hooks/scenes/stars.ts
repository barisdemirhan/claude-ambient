import { FAIL_COLOR, KINDS, KIND_COLORS, kindAt } from '../catalog'
import type { Kind } from '../catalog'
import { BOLD, DIM, FG, hash, isClear, pick, write } from '../kit'
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
const GAP = 8
// Where on the band the newest star is kept in view.
const LEAD = 0.72
const DRIFT = 0.012
const LABEL_TICKS = 80
const BRANCH_ODDS = 0.2
const MOST_FIGURES = 14
const LOGGED_STARS = 10

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
      row: Math.floor(env.roll() * env.h),
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
  const rows = Array.from({ length: env.h }, (_, row) => row).filter(
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

const paintLine = (canvas: Canvas, from: Star, to: Star, cam: number): void => {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.row - from.row))

  // A dotted line: every other cell, so the stars stay the brightest thing.
  for (let step = 2; step < steps - 1; step += 2) {
    const x = Math.round(from.x + ((to.x - from.x) * step) / steps - cam)
    const row = Math.round(from.row + ((to.row - from.row) * step) / steps)

    if (isClear(canvas, x, row)) {
      write(canvas, x, row, '·', FG, DIM)
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
          color: FG,
        })
      }
    }
  },

  paint(sky, canvas, env) {
    const cam = Math.floor(sky.cam)

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

    // The far stars drift slower than the near ones.
    const far = Math.floor(sky.cam * 0.4)

    for (let row = 0; row < env.h; row += 1) {
      for (let x = 0; x < env.w; x += 1) {
        const place = (x + far) * 31 + row
        const isOut = hash(x + far, row * 7 + 1) < 0.03
        const isLit = hash(place, Math.floor(env.ticks / 14)) > 0.25

        if (isOut && isLit && isClear(canvas, x, row)) {
          write(canvas, x, row, '.', FG, DIM)
        }
      }
    }

    for (const meteor of sky.meteors) {
      write(canvas, meteor.x - meteor.dx * 2, meteor.y - meteor.dy * 2, '.', meteor.color, DIM)
      write(canvas, meteor.x - meteor.dx, meteor.y - meteor.dy, '·', meteor.color)
      write(canvas, meteor.x, meteor.y, '*', meteor.color, BOLD)
    }

    if (sky.label !== undefined) {
      const x = Math.min(Math.max(1, sky.label.x - cam), env.w - sky.label.text.length - 1)
      write(canvas, x, sky.label.row, sky.label.text, sky.label.color)
    }
  },
}
