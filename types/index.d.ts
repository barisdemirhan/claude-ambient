/** A place the person named, for the weather scene to follow the sky over. */
export type AmbientPlace = { name: string; latitude: number; longitude: number }

/** What the sky does over that place now: its WMO weather code, day or night, degrees Celsius. */
export type AmbientSky = { code: number; isDay: boolean; temperature: number }

/**
 * What the person switched with `/ambient`: the scene the band shows, whether
 * the band is on at all, how tall it is, when it shows, whether a new scene
 * comes with every turn, whether the scene is heard and how loud, and the
 * place whose sky the weather scene follows, if they named one.
 */
export type AmbientSettings = {
  scene: string
  isOn: boolean
  rows: number
  when: 'always' | 'working'
  isShuffled: boolean
  isSoundOn: boolean
  volume: number
  place: AmbientPlace | null
}

/** One finished turn: how many tool calls it made and the kind it made most. */
export type AmbientTurn = { calls: number; kind: number }

/**
 * What Claude's work feeds the scenes, counted over the session: the tool
 * calls started and failed, the calls by kind, the turns finished, the calls
 * of the turn that is on, and the last finished turns.
 */
export type AmbientFeed = {
  calls: number
  fails: number
  kinds: number[]
  turns: number
  turn: number
  turnKinds: number[]
  log: AmbientTurn[]
}

/** The bonsai: what it grows from, the turns it has seen, the leaves it shed. */
export type AmbientTree = { seed: number; turns: number; shed: number }

/** The skyline of one day: the day it belongs to and the edits made in it. */
export type AmbientCity = { day: string; edits: number }

/** What lives on between sessions: the bonsai and today's skyline. */
export type AmbientWorld = { tree: AmbientTree; city: AmbientCity }

declare module 'claude-code' {
  interface PluginState {
    ambient: {
      settings: AmbientSettings
      feed: AmbientFeed
      world: AmbientWorld
      /** True while the scene picker is open: the band shows for it. */
      isPicking: boolean
      /** The sky over the person's place as last asked; null with no place. */
      sky: AmbientSky | null
    }
  }
}
