import type { ClientModule, ClientSurface } from 'claude-code'

import { KINDS } from './catalog'
import type { Feed } from './catalog'
import { canvasOf, coarsen, rowsOf } from './kit'
import type { Env, Happening, Scene } from './kit'
import { aquarium } from './scenes/aquarium'
import { bonsai } from './scenes/bonsai'
import { city } from './scenes/city'
import { fire } from './scenes/fire'
import { life } from './scenes/life'
import { lofi } from './scenes/lofi'
import { matrix } from './scenes/matrix'
import { pulse } from './scenes/pulse'
import { stars } from './scenes/stars'
import { train } from './scenes/train'
import { weather } from './scenes/weather'

/** What of the feed the scene has taken in already. */
type Seen = {
  kinds: readonly number[]
  fails: number
  turns: number
  isWorking: boolean
}
type Band = {
  scene: string
  columns: number
  rows: number
  sim: unknown
  ticks: number
  seed: number
  // Ticks since the feed last had news.
  calm: number
  // The bed the scene last asked for, as the hooks module was told.
  bed: string
  seen: Seen
  feed: Feed
  // The feed as text: props come anew with every redraw, alike or not.
  stamp: string
}

const TICK_MS = 100
// With Claude at rest and no news for this many ticks, the scene moves at
// half the pace: an idle session should cost little.
const CALM_TICKS = 100
const MAX_COLUMNS = 160
const MIN_COLUMNS = 20
const MIN_ROWS = 3
// The most of one burst a scene is told about: a long quiet stretch of the
// band (collapsed, or behind a dialog) must not flood it when it shows again.
const MOST_CALLS = 12
const MOST_FAILS = 4
// The most runs a frame is drawn in: the engine refuses a tree that
// serializes to more than 100,000 characters, and a run costs about a
// hundred. Past it the colors are rounded by these steps, coarser each time.
const MOST_RUNS = 500
const COARSER = [16, 32, 64] as const
const SCENE_OF: Readonly<Record<string, Scene<unknown>>> = {
  aquarium,
  bonsai,
  city,
  stars,
  weather,
  train,
  life,
  pulse,
  fire,
  matrix,
  lofi,
}

const seenOf = (feed: Feed): Seen => ({
  kinds: feed.kinds,
  fails: feed.fails,
  turns: feed.turns,
  isWorking: feed.isWorking,
})

const envOf = (band: Band): Env => ({
  w: band.columns,
  h: band.rows,
  pw: band.columns,
  ph: band.rows * 2,
  ticks: band.ticks,
  feed: band.feed,
  roll: () => {
    band.seed = (Math.imul(band.seed, 1664525) + 1013904223) >>> 0

    return band.seed / 2 ** 32
  },
})

/** What the feed says happened since the scene last looked, oldest first. */
const newsOf = (seen: Seen, feed: Feed): Happening[] => {
  const news: Happening[] = []

  if (feed.isWorking && !seen.isWorking) {
    news.push({ type: 'work', isOn: true })
  }

  KINDS.forEach((kind, index) => {
    const calls = (feed.kinds[index] ?? 0) - (seen.kinds[index] ?? 0)

    for (let told = 0; told < Math.min(calls, MOST_CALLS); told += 1) {
      news.push({ type: 'tool', kind })
    }
  })

  for (let told = 0; told < Math.min(feed.fails - seen.fails, MOST_FAILS); told += 1) {
    news.push({ type: 'fail' })
  }

  if (feed.turns > seen.turns) {
    news.push({ type: 'turn' })
  }

  if (!feed.isWorking && seen.isWorking) {
    news.push({ type: 'work', isOn: false })
  }

  return news
}

const fresh = (feed: Feed, columns: number, rows: number, seed: number): Band => {
  const band: Band = {
    scene: feed.scene,
    columns,
    rows,
    sim: undefined,
    ticks: 0,
    seed,
    calm: 0,
    bed: '',
    seen: seenOf(feed),
    feed,
    stamp: JSON.stringify(feed),
  }
  band.sim = SCENE_OF[feed.scene]?.start(envOf(band))

  return band
}

/**
 * The band with the feed taken in: the same one where nothing moved, a new
 * scene where the pick, the room or the backdrop changed, else the scene
 * told the news.
 */
const caughtUp = (
  band: Band,
  feed: Feed,
  columns: number,
  rows: number,
): Band => {
  if (
    band.scene !== feed.scene ||
    band.columns !== columns ||
    band.rows !== rows ||
    band.feed.hasBackdrop !== feed.hasBackdrop
  ) {
    return fresh(feed, columns, rows, band.seed)
  }

  const stamp = JSON.stringify(feed)

  if (band.stamp === stamp) {
    return band
  }

  const news = newsOf(band.seen, feed)
  const next: Band = {
    ...band,
    feed,
    stamp,
    seen: seenOf(feed),
    calm: news.length > 0 ? 0 : band.calm,
  }
  const scene = SCENE_OF[band.scene]
  const env = envOf(next)

  for (const event of news) {
    scene?.hear(next.sim, event, env)
  }

  return next
}

const sized = (surface: ClientSurface<Band>): [number, number] => [
  Math.min(surface.columns, MAX_COLUMNS),
  surface.rows,
]

const start = (surface: ClientSurface<Band>, feed: Feed): Band => {
  const band = fresh(feed, ...sized(surface), Math.floor(Math.random() * 2 ** 32))
  let beats = 0
  surface.setState(band)
  surface.every(TICK_MS, () => {
    const now = surface.state
    beats += 1

    if (now === undefined || now.columns < MIN_COLUMNS || now.rows < MIN_ROWS) {
      return
    }

    const isResting = !now.feed.isWorking && now.calm >= CALM_TICKS

    if (isResting && beats % 2 === 1) {
      return
    }

    const next: Band = { ...now, ticks: now.ticks + 1, calm: now.calm + 1 }
    const scene = SCENE_OF[next.scene]
    scene?.step(next.sim, envOf(next))
    const bed = scene?.bed?.(next.sim, envOf(next)) ?? ''

    if (bed !== next.bed) {
      // The scene sounds different now: the hooks module plays its beds.
      next.bed = bed
      surface.post({ scene: next.scene, bed })
    }

    surface.setState(next)
  })

  return band
}

const Ambient: ClientModule<Feed, Band> = (feed, surface) => {
  const { Box, Text } = surface.elements
  const known = surface.state ?? start(surface, feed)
  const band = caughtUp(known, feed, ...sized(surface))

  if (band !== known) {
    surface.setState(band)
  }

  const scene = SCENE_OF[band.scene]

  if (scene === undefined || band.columns < MIN_COLUMNS || band.rows < MIN_ROWS) {
    return <Text dimColor> </Text>
  }

  const canvas = canvasOf(band.columns, band.rows)
  scene.paint(band.sim, canvas, envOf(band))
  let rows = rowsOf(canvas)

  // A frame of too many runs is refused by the engine, and the band goes:
  // its colors are made coarser until neighbours match and it fits.
  for (const step of COARSER) {
    if (rows.reduce((runs, row) => runs + row.length, 0) <= MOST_RUNS) {
      break
    }

    coarsen(canvas, step)
    rows = rowsOf(canvas)
  }

  return (
    <Box flexDirection="column">
      {rows.map(runs => (
        <Box>
          {runs.map(({ text, ...style }) => (
            <Text {...style} wrap="truncate-end">
              {text}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

export default Ambient
