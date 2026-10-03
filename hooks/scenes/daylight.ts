import { along, fill, mix, wipe, write } from '../kit'
import type { Canvas } from '../kit'

// Skies from the top of the band down, by the hour on the person's clock.
const NIGHT = ['#060a1c', '#0e1734', '#1b2850']
const DAWN = ['#223060', '#7d5c8c', '#f0a57c']
const MORNING = ['#3b7dd0', '#79b4e6', '#cde8f6']
const DAY = ['#2f7dd6', '#62ace8', '#b6def5']
const GOLDEN = ['#3a6cbe', '#8fb2d8', '#f4cd92']
const DUSK = ['#262c6a', '#984e7a', '#ef985c']
const TWILIGHT = ['#111940', '#332f69', '#6a4977']
// The plate a caption sits on: the sky behind it, darkened.
const PLATE = '#05070f'
// Each part of the day from its first hour on: the sky from the top of the
// band down, and how much daylight falls.
const HOURS = [
  { from: 0, sky: NIGHT, light: 0.42 },
  { from: 5, sky: DAWN, light: 0.62 },
  { from: 6, sky: DAWN, light: 0.82 },
  { from: 7, sky: MORNING, light: 1 },
  { from: 10, sky: DAY, light: 1 },
  { from: 16, sky: GOLDEN, light: 1 },
  { from: 18, sky: DUSK, light: 0.82 },
  { from: 20, sky: TWILIGHT, light: 0.62 },
  { from: 21, sky: NIGHT, light: 0.42 },
] as const

/** What night does to everything not lit from within: it goes this blue. */
export const NIGHT_TINT = '#090f28'

const partOf = (hour: number) => HOURS.filter(part => part.from <= hour).at(-1) ?? HOURS[0]

/** The sky at an hour, from the top of the band down. */
export const skyOf = (hour: number): readonly string[] => partOf(hour).sky

/** How much daylight falls at an hour: 1 by day, under half at night. */
export const lightOf = (hour: number): number => partOf(hour).light

/**
 * Writes a caption at the start of a row, on a plate of the sky darkened
 * behind it: one color all the way, so the caption and the spaces in it stay
 * one run of text.
 */
export const label = (canvas: Canvas, row: number, text: string, sky: readonly string[]): void => {
  const plate = mix(along(sky, (row * 2) / Math.max(1, canvas.ph - 1)), PLATE, 0.5)
  // Whatever was written there before goes, or it shows through the spaces.
  wipe(canvas, 0, row, [...text].length + 2)
  fill(canvas, 0, row * 2, [...text].length + 2, 2, plate)
  write(canvas, 1, row, text, mix(plate, '#ffffff', 0.8))
}
