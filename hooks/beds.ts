// Written by tools/sound/build.js from what it rendered; not by hand.
// The beds each scene has, the first the one it plays when it says no other,
// and the seconds from one play of a bed's file to the next: the file runs
// 2 seconds longer, and the two plays cross over.
export const BEDS = {
  aquarium: { water: 24 },
  bonsai: { garden: 24 },
  city: { street: 24 },
  stars: { night: 24 },
  weather: { fair: 24, rain: 24, storm: 24, snow: 24 },
  train: { station: 24, run: 24 },
  life: { dish: 24 },
  pulse: { rest: 24 },
  fire: { hearth: 24 },
  matrix: { rain: 24 },
  lofi: { tape: 53.3333 },
} as const

export const BED_OVERLAP = 2
