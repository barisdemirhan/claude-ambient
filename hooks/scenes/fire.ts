import { clamp, dot, fill, hash, mix, stamp } from '../kit'
import type { Canvas, Env, Happening, Scene } from '../kit'

type Spark = { x: number; y: number; drift: number; life: number }
/**
 * Where the fireplace stands, in pixels: its outer edges with the mantel's
 * overhang, the brick pillars' inner edges, the firebox from its top row to
 * the bed of coals, and the row of the hearth and the floor.
 */
type Layout = {
  left: number
  right: number
  overhang: number
  boxLeft: number
  boxRight: number
  boxTop: number
  coals: number
  floor: number
  wainscot: number
}
type Hearth = {
  layout: Layout
  // Heat over the firebox, row by row from its top: 0 is cold, HOTTEST
  // white. Each heat covers `grain` pixels across.
  heat: number[]
  grain: number
  fuel: number
  // The chance a pixel cools on its way up: a taller firebox cools slower,
  // so a fire at work reaches its top whatever the band's height.
  cooling: number
  // Ticks the flames stay blue after a failed call fell into them.
  blue: number
  sparks: Spark[]
}

const HOTTEST = 8
// A color for every heat, from the smoky tips to the white heart; the blue
// ones for a failed call.
const FLAMES = ['', '#4e170c', '#8a230c', '#c2370f', '#e65a13', '#f7841d', '#ffae33', '#ffd762', '#fff4c2']
const BLUE_FLAMES = ['', '#0c1d47', '#0f2f78', '#1647ae', '#1f6fdf', '#3c9bf4', '#72c4ff', '#aae5ff', '#e9faff']
const SPARK = '#ffe082'
const SPARK_COOL = '#ff8a3d'
const BLUE_SPARK = '#b3e5ff'
// The room in the dark and in the fire's full light.
const WALL = ['#1d1519', '#683b29']
const WAINSCOT = ['#130d0c', '#47271a']
const RAIL = ['#2a1b15', '#7a4a2e']
const FLOOR = ['#1c120d', '#5e3520']
const BRICKS = ['#7a3322', '#8f3e28', '#6c2c1e', '#843823']
const MORTAR = '#3d2e28'
const MANTEL = '#5a3820'
const MANTEL_TOP = '#8c5c37'
const SOOT = ['#090504', '#2a0f07']
const HEARTH = ['#4f4945', '#b48468']
const BARK = ['#7a4a2a', '#43281a']
const LOG_END = ['#c6763a', '#ffb24a']
const COALS = ['#a62d0b', '#ff5d16', '#ff9a2e']
const GLOW = '#ff9547'
const BLUE_GLOW = '#5c9dff'
const BRASS = '#c49a48'
const WAX = '#efe2c6'
const FRAME = '#8a6630'
const SHADOW = '#140e10'
const CHAIR = ['#5a1a22', '#6c2029', '#7c2731']
const WOOD_END = ['#6e4224', '#a8723f', '#3b2414']
const WORKING_FUEL = 0.62
const IDLE_FUEL = 0.3
const LOG_FUEL = 0.1
const MOST_FUEL = 0.95
const BLUE_TICKS = 16
// A firebox of more pixels than this burns in flames two pixels wide: its
// band would otherwise draw too many pieces to hand the engine.
const FINE_PIXELS = 300
const BARE_FINE_PIXELS = 1200
// The heat from which a flame shows in front of a log.
const LICKING = 5
const MOST_SPARKS = 40
// The glow on the room falls off in a few steps, so a row of wall is drawn
// in a few long stretches rather than one per column.
const GLOW_STEPS = 4
const GLOW_REACH = 0.55
// Side view of an armchair facing the fire on its left: arm, seat, back, legs.
const ARMCHAIR = [
  '.........BBB',
  '.........BBB',
  'AAA......BBB',
  'AAASSSSSSBBB',
  'AAASSSSSSBBB',
  '.L.......L..',
]
// A plant in a pot: leaves light and dark, the pot and its rim.
const PLANT = [
  '.L.L.',
  'LLDLL',
  '.DDD.',
  '..D..',
  '.RRR.',
  '.PPP.',
]
const LEAVES = ['#3f6b35', '#2a4a26']
const POT = '#8a4b2c'
const POT_RIM = '#a85e38'
// Log ends stacked by the fireplace, from the floor up.
const WOODPILE = [3, 2, 1]
const LOG_END_WIDE = 3

const layoutOf = (env: Env): Layout => {
  const { pw, ph } = env

  // With no backdrop, there is no fireplace: the fire burns the whole band
  // across, on the terminal, its bed of coals the band's last pixel row.
  if (!env.feed.hasBackdrop) {
    return {
      left: 0,
      right: pw,
      overhang: 0,
      boxLeft: 0,
      boxRight: pw,
      boxTop: 0,
      coals: ph - 1,
      floor: ph,
      wainscot: ph,
    }
  }
  const wide = clamp(Math.round(pw * 0.5), Math.min(pw - 2, 24), 88)
  const pillar = wide >= 40 ? 5 : 3
  const overhang = pw - wide >= 4 ? 2 : 0
  const left = Math.floor((pw - wide) / 2)
  const floor = ph - 1
  const mantel = ph >= 14 ? 2 : 1

  return {
    left,
    right: left + wide,
    overhang,
    boxLeft: left + pillar,
    boxRight: left + wide - pillar,
    boxTop: mantel,
    coals: floor - 1,
    floor,
    wainscot: Math.max(2, Math.round(ph * 0.62)),
  }
}

/** How hot the embers under a column burn, wandering along the bed of coals. */
const emberOf = (x: number, ticks: number): number =>
  0.6 + 0.4 * Math.sin(x * 0.21 + ticks * 0.07 + Math.sin(x * 0.05 - ticks * 0.03) * 2)

/** How brightly the fire lights the room now: its fuel, with a flicker. */
const brightnessOf = (hearth: Hearth, ticks: number): number =>
  hearth.fuel * (0.86 + 0.14 * Math.sin(ticks * 0.31 + Math.sin(ticks * 0.13) * 2))

const sparked = (hearth: Hearth, count: number, env: Env): void => {
  const { boxLeft, boxRight, coals } = hearth.layout

  for (let made = 0; made < count; made += 1) {
    hearth.sparks.push({
      x: boxLeft + env.roll() * (boxRight - boxLeft),
      y: coals - 1 - env.roll() * 2,
      drift: (env.roll() - 0.5) * 0.5,
      life: 6 + Math.floor(env.roll() * 10),
    })
  }

  hearth.sparks = hearth.sparks.slice(-MOST_SPARKS)
}

/**
 * The room's wall, wainscot and floor, lit by the fire: brightest by the
 * fireplace, falling off toward the band's ends.
 */
const room = (canvas: Canvas, hearth: Hearth, light: number, glow: string): void => {
  const { left, right, wainscot, floor } = hearth.layout
  const middle = (left + right) / 2
  const reach = Math.max(1, canvas.pw * GLOW_REACH)

  for (let x = 0; x < canvas.pw; x += 1) {
    const near = clamp(1 - Math.abs(x - middle) / reach, 0, 1)
    const lit = (Math.round(near * GLOW_STEPS) / GLOW_STEPS) * light
    const tint = (pair: readonly string[]): string =>
      mix(mix(pair[0] ?? '#000000', pair[1] ?? '#000000', lit), glow, lit * 0.12)
    fill(canvas, x, 0, 1, wainscot, tint(WALL))
    fill(canvas, x, wainscot, 1, floor - wainscot, tint(WAINSCOT))
    dot(canvas, x, wainscot, tint(RAIL))
    dot(canvas, x, floor, tint(FLOOR))
  }
}

/** A candle in a brass holder on the wall, its flame on its own flicker. */
const sconce = (canvas: Canvas, x: number, y: number, ticks: number): void => {
  const flicker = hash(Math.floor(ticks / 2), x) < 0.5
  dot(canvas, x, y, flicker ? '#ffd36a' : '#ffa43a')
  dot(canvas, x, y + 1, WAX)
  fill(canvas, x - 1, y + 2, 3, 1, BRASS)
}

/** A small framed painting, a dusk over hills, as lit as the wall by it. */
const painting = (canvas: Canvas, x: number, top: number, tall: number, lit: number): void => {
  const wide = tall * 3
  const seen = (color: string): string => mix(SHADOW, color, 0.35 + lit * 0.65)
  fill(canvas, x, top, wide, tall, seen(FRAME))

  for (let row = 1; row < tall - 1; row += 1) {
    const share = (row - 1) / Math.max(1, tall - 3)
    fill(canvas, x + 1, top + row, wide - 2, 1, seen(mix('#2c3f63', '#d9825a', share)))
  }

  fill(canvas, x + 1, top + tall - 2, wide - 2, 1, seen('#2f3d2a'))
  dot(canvas, x + wide - 4, top + Math.max(1, tall - 3), seen('#ffe0a0'))
}

/** A tall plant in a clay pot, its leaves catching the firelight. */
const plant = (canvas: Canvas, x: number, floor: number, lit: number, glow: string): void => {
  const leaf = (color: string): string => mix(color, glow, lit)
  stamp(canvas, x, floor - PLANT.length, PLANT, {
    L: leaf(LEAVES[0] ?? ''),
    D: leaf(LEAVES[1] ?? ''),
    P: leaf(POT),
    R: leaf(POT_RIM),
  })
}

/** Logs stacked end on, ready for the fire. */
const woodpile = (canvas: Canvas, x: number, floor: number, layers: number): void => {
  const stack = WOODPILE.slice(-layers)
  const base = stack[0] ?? 0

  stack.forEach((count, layer) => {
    const row = floor - (layer + 1) * 2
    // Each layer sits centred on the one under it.
    const start = x + ((base - count) * LOG_END_WIDE) / 2

    for (let log = 0; log < count; log += 1) {
      const at = Math.floor(start + log * LOG_END_WIDE)
      fill(canvas, at, row, LOG_END_WIDE, 2, WOOD_END[0] ?? '')
      dot(canvas, at + 1, row, WOOD_END[1] ?? '')
      dot(canvas, at + LOG_END_WIDE - 1, row + 1, WOOD_END[2] ?? '')
    }
  })
}

/** The fireplace: mantel, brick pillars, the firebox and the hearth. */
const fireplace = (canvas: Canvas, hearth: Hearth, light: number, glow: string, env: Env): void => {
  const { left, right, overhang, boxLeft, boxRight, boxTop, coals, floor } = hearth.layout
  const brickLit = light * 0.32

  // The brick surround, running bond: each course shifted by half a brick.
  for (let y = boxTop; y < floor; y += 1) {
    for (let x = left; x < right; x += 1) {
      const course = Math.floor((y - boxTop) / 3)
      const isJoint = (y - boxTop) % 3 === 2 || (x - left + (course % 2) * 2) % 4 === 3
      const brick = BRICKS[Math.floor(hash(Math.floor((x - left + (course % 2) * 2) / 4), course) * BRICKS.length)] ?? ''
      dot(canvas, x, y, mix(isJoint ? MORTAR : brick, glow, brickLit))
    }
  }

  fill(canvas, left - overhang, 0, right - left + overhang * 2, boxTop, MANTEL)
  fill(canvas, left - overhang, 0, right - left + overhang * 2, 1, boxTop > 1 ? MANTEL_TOP : mix(MANTEL, MANTEL_TOP, 0.5))

  // The firebox: soot above, the fire's light on its back wall below.
  for (let y = boxTop; y <= coals; y += 1) {
    const share = (y - boxTop) / Math.max(1, coals - boxTop)
    fill(canvas, boxLeft, y, boxRight - boxLeft, 1, mix(mix(SOOT[0] ?? '', SOOT[1] ?? '', share), glow, share * light * 0.25))
  }

  burning(canvas, hearth, env)
  fill(canvas, left - overhang, floor, right - left + overhang * 2, 1, mix(HEARTH[0] ?? '', HEARTH[1] ?? '', light))
}

/** The fire itself: the logs, the flames over them, the bed of coals, the sparks. */
const burning = (canvas: Canvas, hearth: Hearth, env: Env): void => {
  const { boxLeft, boxRight, boxTop, coals } = hearth.layout
  const flames = hearth.blue > 0 ? BLUE_FLAMES : FLAMES
  const wide = Math.ceil((boxRight - boxLeft) / hearth.grain)
  const logged = logPixels(hearth, env)

  for (const [at, color] of logged) {
    dot(canvas, at % canvas.pw, Math.floor(at / canvas.pw), color)
  }

  // The flames burn behind the logs, and lick over them where they are hot.
  hearth.heat.forEach((heat, at) => {
    const y = boxTop + Math.floor(at / wide)
    // A fire the whole band across draws two heats in one color: the fewer
    // the colors, the longer the stretches the band draws in one piece.
    const shown = env.feed.hasBackdrop || heat === 0 ? heat : Math.min(HOTTEST, heat + (heat % 2))
    const color = flames[shown] ?? ''

    for (let part = 0; part < hearth.grain && color !== ''; part += 1) {
      const x = boxLeft + (at % wide) * hearth.grain + part

      if (x < boxRight && (heat >= LICKING || !logged.has(y * canvas.pw + x))) {
        dot(canvas, x, y, color)
      }
    }
  })

  // The bed of coals, glowing in patches that drift along.
  for (let x = boxLeft; x < boxRight; x += 1) {
    const patch = hash(Math.floor((x + Math.floor(env.ticks / 9)) / 5), 11)
    dot(canvas, x, coals, hearth.blue > 0 ? '#1f6fdf' : (COALS[Math.floor(patch * COALS.length)] ?? ''))
  }

  for (const spark of hearth.sparks) {
    const color = hearth.blue > 0 ? BLUE_SPARK : spark.life > 5 ? SPARK : SPARK_COOL
    dot(canvas, spark.x, spark.y, color)
  }
}

/**
 * The logs on the coals, as pixels: more of them the more the fire was fed,
 * the first three side by side and a fourth across them, higher up.
 */
const logPixels = (hearth: Hearth, env: Env): Map<number, string> => {
  const { boxLeft, boxRight, coals, boxTop } = hearth.layout
  const wide = boxRight - boxLeft
  // A firebox with room for it holds logs two pixels thick.
  const thick = coals - boxTop >= 9 ? 2 : 1
  const count = clamp(1 + Math.floor(hearth.fuel * 4), 1, 4)
  const length = clamp(Math.floor(wide / 4), 3, 14)
  const glow = Math.floor(env.ticks / 4) % 3 === 0 ? 1 : 0
  const pixels = new Map<number, string>()

  for (let log = 0; log < count; log += 1) {
    const isUpper = log >= 3
    const slot = isUpper ? log - 3 + 0.5 : log
    const top = coals - thick * (isUpper ? 2 : 1)
    const x = Math.floor(boxLeft + ((slot + 0.5) * wide) / 3 - length / 2)

    for (let along = 0; along < length && top > boxTop; along += 1) {
      for (let down = 0; down < thick; down += 1) {
        const isEnd = along === 0 || along === length - 1
        const end = LOG_END[along === 0 ? glow : 1 - glow] ?? ''
        // A thin log shows its lit top; a thick one its shadowed side below.
        const bark = BARK[down > 0 ? 1 : 0] ?? ''
        pixels.set((top + down) * env.pw + x + along, isEnd ? end : bark)
      }
    }
  }

  return pixels
}

export const fire: Scene<Hearth> = {
  start(env) {
    const layout = layoutOf(env)
    const tall = layout.coals - layout.boxTop + 1
    const wide = Math.max(0, layout.boxRight - layout.boxLeft)
    // A fire with no backdrop behind it costs far fewer runs a pixel.
    const grain = wide * tall > (env.feed.hasBackdrop ? FINE_PIXELS : BARE_FINE_PIXELS) ? 2 : 1

    return {
      layout,
      heat: new Array<number>(Math.ceil(wide / grain) * tall).fill(0),
      grain,
      fuel: env.feed.isWorking ? WORKING_FUEL : IDLE_FUEL,
      cooling: clamp(5.5 / tall + 0.05, 0.25, 0.85),
      blue: 0,
      sparks: [],
    }
  },

  step(hearth, env) {
    const { boxLeft, boxRight, boxTop, coals } = hearth.layout
    const wide = Math.ceil((boxRight - boxLeft) / hearth.grain)
    const tall = coals - boxTop + 1
    const target = env.feed.isWorking ? WORKING_FUEL : IDLE_FUEL
    hearth.fuel += (target - hearth.fuel) * 0.03
    hearth.blue = Math.max(0, hearth.blue - 1)

    for (let x = 0; x < wide; x += 1) {
      hearth.heat[(tall - 1) * wide + x] = clamp(
        Math.round(HOTTEST * hearth.fuel * emberOf(x * hearth.grain, env.ticks)),
        0,
        HOTTEST,
      )
    }

    // Every pixel takes the heat of the one under it, a little cooler and a
    // little to the side: the flames lick upward and lean.
    for (let y = 0; y < tall - 1; y += 1) {
      for (let x = 0; x < wide; x += 1) {
        const below = hearth.heat[(y + 1) * wide + x] ?? 0
        const cooled = below - (env.roll() < hearth.cooling ? 1 : 0)
        const lean = Math.floor(env.roll() * 3) - 1
        hearth.heat[y * wide + clamp(x + lean, 0, wide - 1)] = Math.max(0, cooled)
      }
    }

    hearth.sparks = hearth.sparks
      .map(spark => ({
        ...spark,
        x: clamp(spark.x + spark.drift, boxLeft, boxRight - 1),
        y: spark.y - 0.5,
        life: spark.life - 1,
      }))
      .filter(spark => spark.life > 0 && spark.y >= boxTop)
  },

  hear(hearth, event: Happening, env) {
    if (event.type === 'tool') {
      hearth.fuel = Math.min(MOST_FUEL, hearth.fuel + LOG_FUEL)
      sparked(hearth, 3, env)
    } else if (event.type === 'fail') {
      hearth.blue = BLUE_TICKS
      sparked(hearth, 12, env)
    }
  },

  paint(hearth, canvas: Canvas, env) {
    // With no backdrop asked for, the fire burns on the terminal itself,
    // with no room or fireplace around it.
    if (!env.feed.hasBackdrop) {
      burning(canvas, hearth, env)

      return
    }

    const { left, right, overhang, wainscot, floor } = hearth.layout
    const light = clamp(brightnessOf(hearth, env.ticks), 0, 1)
    const glow = hearth.blue > 0 ? BLUE_GLOW : GLOW
    room(canvas, hearth, light, glow)

    const leftWall = left - overhang
    const rightWall = canvas.pw - right - overhang

    // Candles either side of the fireplace, where the wall has room.
    if (leftWall >= 4 && wainscot >= 4) {
      sconce(canvas, leftWall - 3, wainscot - 4, env.ticks)
      sconce(canvas, right + overhang + 2, wainscot - 4, env.ticks + 7)
    }

    // Logs stacked by the hearth, low enough to leave the candle clear.
    if (leftWall >= 16 && floor >= 5) {
      woodpile(canvas, leftWall - 14, floor, floor >= 13 ? 3 : 2)
    }

    if (leftWall >= 28 && wainscot >= 5) {
      const tall = clamp(wainscot - 2, 4, 6)
      painting(canvas, leftWall - 27, Math.max(0, Math.floor((wainscot - tall) / 2)), tall, light * 0.5)
    }

    if (rightWall >= 20 && floor >= 6) {
      const chair = Math.floor(right + overhang + 6)
      const lit = light * 0.3
      stamp(canvas, chair, floor - ARMCHAIR.length, ARMCHAIR, {
        A: mix(CHAIR[2] ?? '', glow, lit),
        S: mix(CHAIR[1] ?? '', glow, lit * 0.7),
        B: mix(CHAIR[0] ?? '', glow, lit * 0.4),
        L: '#24160f',
      })
    }

    if (rightWall >= 28 && floor >= 6) {
      plant(canvas, right + overhang + 21, floor, light * 0.25, glow)
    }

    fireplace(canvas, hearth, light, glow, env)
  },
}
