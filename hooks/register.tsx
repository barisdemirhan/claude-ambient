import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type {
  AmbientControl,
  AmbientFeed,
  AmbientPlace,
  AmbientSettings,
  AmbientWorld,
} from '../types'
import { BEDS } from './beds'
import { KINDS, SCENES, kindOf } from './catalog'
import type { Feed, SceneId } from './catalog'

/** What this session added that the store has not been told yet. */
type Unsaved = { edits: number; shed: number }
/**
 * Who plays the bed, as every session reads it in the store: the session,
 * when it last said it was there, and when its bed may start.
 */
type Owner = { id: string; at: number; ready: number }
/** The bed this session plays: what it is, what stops it, what plays it on. */
type Playing = { key: string; stop: AbortController; timer: Timer | undefined }

const PANE = 'ambient'
const BAND = 'band'
const SETTINGS = 'settings'
const WORLD = 'world'
const PLAYER = 'player'
// One session plays the bed, however many are open. Every session looks at
// who that is this often; the one that plays says so this often; and a
// session not heard from for this long has gone, its place free to take.
const TICK_MS = 2000
const BEAT_MS = 6000
const LEASE_MS = 20_000
// A session that takes the bed from one still playing waits this long, by
// when the other has looked and fallen silent. One that takes a free bed
// waits only long enough to see that no other took it in the same breath.
const SETTLE_MS = 2500
const CONFIRM_MS = 300
// The closest two calls' sounds come: Claude's calls can arrive in a burst.
const CALL_GAP_MS = 250
// How loud the bed and the short sounds are, of the volume the person set.
const BED_MIX = 0.55
const EVENT_MIX = 0.6
const VOLUME_STEP = 10
// Cells kept clear after the label on the hint line, and between it and what
// stands beside it: the line draws marks its text does not count.
const HINT_MARGIN = 6
const HINT_GAP = 2
// Other words for the sound going off and on.
const QUIET_WORDS = ['stop', 'mute', 'quiet', 'silent']
const LOUD_WORDS = ['play', 'unmute']
// Open-Meteo, asked only once the person names a place: where the place is,
// and what the sky does over it, every quarter of an hour.
const SKY_EVERY_MS = 15 * 60_000
const MIN_ROWS = 3
const MAX_ROWS = 10
const PICKER_ROWS = SCENES.length + 11
// The finished turns the feed remembers: the constellations still in the sky.
const LOG_TURNS = 12
// Leaves a failed call shed grow back, this many a turn.
const REGROWN = 2
// One key per scene in the picker, in the catalog's order.
const HOTKEYS = '123456789ab'
const EDIT = KINDS.indexOf('edit')
const SWITCH: Readonly<Record<string, boolean>> = { on: true, off: false }
const WHEN: Readonly<Record<string, AmbientSettings['when']>> = {
  always: 'always',
  working: 'working',
}
// The controls the row under the hint line can hold, in the row's order,
// each with its key in the picker and what the picker and the replies call it.
const CONTROLS: readonly { id: AmbientControl; hotkey: string; label: string }[] = [
  { id: 'name', hotkey: 'n', label: "the scene's name" },
  { id: 'band', hotkey: 'd', label: "the band's switch" },
  { id: 'when', hotkey: 'e', label: 'when the band shows' },
  { id: 'rows', hotkey: 'r', label: "the band's height" },
  { id: 'sound', hotkey: 'u', label: "the sound's switch" },
  { id: 'volume', hotkey: 'm', label: 'the volume' },
  { id: 'scenes', hotkey: 'c', label: "the picker's button" },
]
const ALIASES: Readonly<Record<string, SceneId>> = {
  fish: 'aquarium',
  tree: 'bonsai',
  garden: 'bonsai',
  skyline: 'city',
  constellation: 'stars',
  constellations: 'stars',
  storm: 'weather',
  conway: 'life',
  gol: 'life',
  ekg: 'pulse',
  heartbeat: 'pulse',
  fireplace: 'fire',
  cat: 'lofi',
}
const USAGE =
  'Usage: /ambient opens the picker, /ambient <scene> picks one, or /ambient list, next, prev, on, off, sound [on|off], mute, volume <0-100|up|down>, weather <city|auto|off>, shuffle [on|off], rows <3-10>, when [always|working], hint [name|band|when|rows|sound|volume|scenes] [on|off], backdrop [on|off], replant.'
const DEFAULTS: AmbientSettings = {
  scene: 'aquarium',
  isOn: true,
  rows: 5,
  when: 'always',
  isShuffled: false,
  isSoundOn: false,
  volume: 55,
  place: null,
  hasHint: true,
  controls: CONTROLS.map(control => control.id),
  hasBackdrop: false,
}
// What of the sound lasts only as long as this module does: who this session
// is among the others, the bed it plays, the bed each scene last asked for,
// and when it last said it plays and last sounded a call.
const stage: {
  id: string
  playing: Playing | undefined
  wanted: Readonly<Record<string, string>>
  ticker: Timer | undefined
  forecaster: Timer | undefined
  isOwner: boolean
  beatAt: number
  calledAt: number
} = {
  id: Math.random().toString(36).slice(2, 12),
  playing: undefined,
  wanted: {},
  ticker: undefined,
  forecaster: undefined,
  isOwner: false,
  beatAt: 0,
  calledAt: 0,
}

const noCounts = (): number[] => KINDS.map(() => 0)

const settings = atom({ plugin: 'ambient', key: 'settings' } as const, DEFAULTS)
const feed = atom({ plugin: 'ambient', key: 'feed' } as const, {
  calls: 0,
  fails: 0,
  kinds: noCounts(),
  turns: 0,
  turn: 0,
  turnKinds: noCounts(),
  log: [],
})
const world = atom({ plugin: 'ambient', key: 'world' } as const, {
  tree: { seed: 1, turns: 0, shed: 0 },
  city: { day: '', edits: 0 },
})
const isPicking = atom({ plugin: 'ambient', key: 'isPicking' } as const, false)
const sky = atom({ plugin: 'ambient', key: 'sky' } as const, null)
const isLoaded = atom({ plugin: 'ambient', key: 'isLoaded' } as const, false)

const toCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0

const fieldOf = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).find(([name]) => name === key)?.[1]
    : undefined

const sceneOf = (id: unknown) => SCENES.find(scene => scene.id === id)

const toRows = (value: unknown): number => {
  const rows = toCount(value)

  return rows >= MIN_ROWS && rows <= MAX_ROWS ? rows : DEFAULTS.rows
}

const toVolume = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value)))
    : DEFAULTS.volume

const toPlace = (value: unknown): AmbientPlace | null => {
  const name = fieldOf(value, 'name')
  const latitude = fieldOf(value, 'latitude')
  const longitude = fieldOf(value, 'longitude')

  return typeof name === 'string' &&
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
    ? { name, latitude, longitude }
    : null
}

/** The controls kept as shown, in the row's order; all of them where none were kept. */
const toControls = (value: unknown): AmbientControl[] =>
  Array.isArray(value)
    ? CONTROLS.map(control => control.id).filter(id => value.includes(id))
    : DEFAULTS.controls

const toSettings = (value: unknown): AmbientSettings => ({
  scene: sceneOf(fieldOf(value, 'scene'))?.id ?? DEFAULTS.scene,
  isOn: fieldOf(value, 'isOn') !== false,
  rows: toRows(fieldOf(value, 'rows')),
  when: fieldOf(value, 'when') === 'working' ? 'working' : 'always',
  isShuffled: fieldOf(value, 'isShuffled') === true,
  isSoundOn: fieldOf(value, 'isSoundOn') === true,
  volume: toVolume(fieldOf(value, 'volume')),
  place: toPlace(fieldOf(value, 'place')),
  hasHint: fieldOf(value, 'hasHint') !== false,
  controls: toControls(fieldOf(value, 'controls')),
  hasBackdrop: fieldOf(value, 'hasBackdrop') === true,
})

const toOwner = (value: unknown): Owner => {
  const id = fieldOf(value, 'id')

  return {
    id: typeof id === 'string' ? id : '',
    at: toCount(fieldOf(value, 'at')),
    ready: toCount(fieldOf(value, 'ready')),
  }
}

/** The bed a scene plays now: the one it asked for, or its first. */
const bedOf = (scene: string): { name: string; seconds: number } | undefined => {
  const beds = Object.entries(fieldOf(BEDS, scene) ?? {})
  const [name, seconds] =
    beds.find(([bed]) => bed === stage.wanted[scene]) ?? beds[0] ?? []

  return typeof name === 'string' && typeof seconds === 'number'
    ? { name, seconds }
    : undefined
}

const gainOf = (volume: number, mix: number): number =>
  Math.round(volume * mix * 10) / 1000

/** Stops the bed this session plays, if it plays one. */
const hushed = (): void => {
  stage.playing?.stop.abort()
  stage.playing?.timer?.cancel()
  stage.playing = undefined
}

/**
 * Plays a bed's file, and again one loop on, for as long as nothing stops
 * it. The file runs a little past the loop, so each play crosses into the
 * next: the engine's own loop leaves a second of silence between two plays.
 */
const looped = (
  $: EngineInterface,
  key: string,
  asset: string,
  seconds: number,
  gain: number,
): void => {
  hushed()
  const stop = new AbortController()
  const playing: Playing = { key, stop, timer: undefined }
  const again = (): void => {
    if (!stop.signal.aborted) {
      // A machine with no player has no sound; the scene goes on without it.
      void $.audio
        .play({ asset }, { gain, signal: stop.signal })
        .catch(() => undefined)
      playing.timer = $.clock.after(seconds * 1000, again)
    }
  }
  stage.playing = playing
  again()
}

/** Gives the bed up for another session to take, if this one holds it. */
const released = async ($: EngineInterface): Promise<void> => {
  hushed()

  if (stage.isOwner) {
    stage.isOwner = false

    if (toOwner(await $.store.get(PLAYER)).id === stage.id) {
      await $.store.delete(PLAYER)
    }
  }
}

/**
 * Makes the sound what it should be now. One session plays the bed, however
 * many are open: the one that holds the `player` entry of the store, which
 * every session of the mod reads. A session takes the entry when it is free,
 * or, as `isClaiming`, because the person just did something in it; the
 * others see that at their next look and fall silent.
 */
const tuned = async ($: EngineInterface, isClaiming = false): Promise<void> => {
  // The sound is one for every session: on, off and how loud are taken from
  // the store, where another session may have switched them since.
  const { isSoundOn, volume } = toSettings(await $.store.get(SETTINGS))
  const held = await read($, settings)
  const now =
    held.isSoundOn === isSoundOn && held.volume === volume
      ? held
      : await update($, settings, kept => ({ ...kept, isSoundOn, volume }))

  if (!now.isOn || !now.isSoundOn) {
    stage.ticker?.cancel()
    stage.ticker = undefined
    await released($)

    return
  }

  stage.ticker ??= $.clock.every(TICK_MS, () => {
    void tuned($)
  })
  const time = await $.clock.now()
  const owner = toOwner(await $.store.get(PLAYER))
  const isFree = owner.id === '' || time - owner.at > LEASE_MS

  if (owner.id !== stage.id) {
    hushed()
    stage.isOwner = false

    if (isFree || isClaiming) {
      const wait = isFree ? CONFIRM_MS : SETTLE_MS
      stage.isOwner = true
      stage.beatAt = time
      await $.store.set(PLAYER, { id: stage.id, at: time, ready: time + wait })
      $.clock.after(wait, () => {
        void tuned($)
      })
    }

    return
  }

  stage.isOwner = true

  if (time - stage.beatAt >= BEAT_MS) {
    stage.beatAt = time
    await $.store.set(PLAYER, { ...owner, at: time })
  }

  const bed = bedOf(now.scene)
  const gain = gainOf(now.volume, BED_MIX)
  const key = `${now.scene}-${bed?.name}@${gain}`

  if (time < owner.ready || bed === undefined || gain === 0) {
    if (gain === 0) {
      hushed()
    }

    return
  }

  if (stage.playing?.key !== key) {
    looped($, key, `sounds/${now.scene}-${bed.name}.m4a`, bed.seconds, gain)
  }
}

/** Plays one of the scene's short sounds: a call, a failure, a turn's end. */
const chimed = async ($: EngineInterface, name: string): Promise<void> => {
  const now = await read($, settings)
  const gain = gainOf(now.volume, EVENT_MIX)

  if (now.isOn && now.isSoundOn && gain > 0) {
    void $.audio
      .play({ asset: `sounds/${now.scene}-${name}.m4a` }, { gain })
      .catch(() => undefined)
  }
}

/** The day on the person's clock, as the skyline is kept by: `2026-10-02`. */
const dayOf = (ms: number): string => {
  const date = new Date(ms)

  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map(part => String(part).padStart(2, '0'))
    .join('-')
}

/** The world as kept, for a day: a skyline of another day starts over. */
const toWorld = (value: unknown, day: string): AmbientWorld => {
  const tree = fieldOf(value, 'tree')
  const city = fieldOf(value, 'city')

  return {
    tree: {
      seed: toCount(fieldOf(tree, 'seed')) || Math.floor(Math.random() * 2 ** 31) + 1,
      turns: toCount(fieldOf(tree, 'turns')),
      shed: toCount(fieldOf(tree, 'shed')),
    },
    city: {
      day,
      edits: fieldOf(city, 'day') === day ? toCount(fieldOf(city, 'edits')) : 0,
    },
  }
}

/**
 * The counts as kept, each a number: a value written before a reload stays
 * in the session's state, and may predate a count this version added.
 */
const toFeed = (kept: Partial<AmbientFeed>): AmbientFeed => ({
  calls: toCount(kept.calls),
  fails: toCount(kept.fails),
  kinds: KINDS.map((_, index) => toCount(kept.kinds?.[index])),
  turns: toCount(kept.turns),
  turn: toCount(kept.turn),
  turnKinds: KINDS.map((_, index) => toCount(kept.turnKinds?.[index])),
  log: Array.isArray(kept.log) ? kept.log : [],
})

const called = (kept: AmbientFeed, kind: number): AmbientFeed => {
  const now = toFeed(kept)
  const counted = (counts: number[]): number[] =>
    counts.map((count, index) => count + (index === kind ? 1 : 0))

  return {
    ...now,
    calls: now.calls + 1,
    kinds: counted(now.kinds),
    turn: now.turn + 1,
    turnKinds: counted(now.turnKinds),
  }
}

/** The feed with the turn that is on counted as done and logged. */
const finished = (kept: AmbientFeed): AmbientFeed => {
  const now = toFeed(kept)
  const most = Math.max(...now.turnKinds)
  const log =
    now.turn > 0
      ? [...now.log, { calls: now.turn, kind: now.turnKinds.indexOf(most) }]
      : now.log

  return {
    ...now,
    turns: now.turns + 1,
    turn: 0,
    turnKinds: noCounts(),
    log: log.slice(-LOG_TURNS),
  }
}

/**
 * Changes settings for this session and keeps them for the next ones: the
 * change itself, or what it is given the settings as they stand. Only what
 * changed is written over what the store holds: another session open at the
 * same time may have changed the rest since this one read it.
 */
const stored = async (
  $: EngineInterface,
  change:
    | Partial<AmbientSettings>
    | ((now: AmbientSettings) => Partial<AmbientSettings>),
): Promise<AmbientSettings> => {
  const changed =
    typeof change === 'function' ? change(await read($, settings)) : change
  const next = await update($, settings, now => ({ ...now, ...changed }))
  await $.store.set(SETTINGS, {
    ...toSettings(await $.store.get(SETTINGS)),
    ...changed,
  })
  // The person just did something in this session: its bed is the one heard.
  await tuned($, true)

  return next
}

/** The scene a word names: its id, its name, an alias, or what either starts with. */
const sceneNamed = (word: string) => {
  const exact = SCENES.find(
    scene => scene.id === word || scene.name.toLowerCase() === word,
  )
  const started = SCENES.filter(
    scene => scene.id.startsWith(word) || scene.name.toLowerCase().startsWith(word),
  )

  return exact ?? sceneOf(ALIASES[word]) ?? (started.length === 1 ? started[0] : undefined)
}

/** The scene a number of places after the one picked, around the catalog. */
const sceneAfter = (id: string, places: number) => {
  const at = SCENES.findIndex(scene => scene.id === id)

  return SCENES[(at + places + SCENES.length) % SCENES.length] ?? SCENES[0]
}

const summary = (now: AmbientSettings): string => {
  const name = sceneOf(now.scene)?.name ?? now.scene
  const shown = now.when === 'working' ? 'while Claude works' : 'always'

  const sound = now.isSoundOn ? `sound ${now.volume}%` : 'sound off'
  const place = now.place === null ? '' : ` · sky over ${now.place.name}`

  return `Ambient is ${now.isOn ? 'on' : 'off'} · ${name} · ${now.rows} rows · shows ${shown} · shuffle ${now.isShuffled ? 'on' : 'off'} · ${sound}${place}`
}

const listText = (now: AmbientSettings): string =>
  [
    summary(now),
    ...SCENES.map(scene => {
      const mark = now.isOn && scene.id === now.scene ? '●' : ' '

      return `${mark} ${scene.id.padEnd(9)} ${scene.about}`
    }),
  ].join('\n')

const picked = async ($: EngineInterface, id: string): Promise<string> => {
  const scene = sceneOf(id) ?? SCENES[0]
  await stored($, { scene: scene.id, isOn: true })

  return `Ambient: ${scene.name}, ${scene.about}.`
}

/**
 * `/ambient backdrop [on|off]`: whether the fireplace, the heart monitor and
 * the digital rain paint a backdrop, or show the terminal behind them. The
 * word's way, or the other way with no word.
 */
const backdropText = async ($: EngineInterface, word: string): Promise<string> => {
  const hasBackdrop = word === '' ? !(await read($, settings)).hasBackdrop : SWITCH[word]

  if (hasBackdrop === undefined) {
    return USAGE
  }

  await stored($, { hasBackdrop })

  return hasBackdrop
    ? 'Ambient paints a backdrop behind the fireplace, the heart monitor and the digital rain.'
    : 'Ambient shows the terminal behind the fireplace, the heart monitor and the digital rain.'
}

/** `/ambient shuffle [on|off]`: the word's way, or the other way with no word. */
const shuffleText = async ($: EngineInterface, word: string): Promise<string> => {
  const isShuffled =
    word === '' ? !(await read($, settings)).isShuffled : SWITCH[word]

  if (isShuffled === undefined) {
    return USAGE
  }

  await stored($, { isShuffled })

  return isShuffled
    ? 'Ambient shuffle is on: a new scene comes with every turn.'
    : 'Ambient shuffle is off.'
}

/** `/ambient sound [on|off]`: the word's way, or the other way with no word. */
const soundText = async ($: EngineInterface, word: string): Promise<string> => {
  const isSoundOn =
    word === '' ? !(await read($, settings)).isSoundOn : SWITCH[word]

  if (isSoundOn === undefined) {
    return USAGE
  }

  const { volume } = await stored($, { isSoundOn })

  return isSoundOn
    ? `Ambient sound is on at ${volume}%: the scene's bed plays in one session at a time, the one you last used.`
    : 'Ambient sound is off.'
}

/** What a host answered as JSON; undefined offline, refused, or not JSON. */
const jsonOf = (answer: { ok: boolean; text: string } | undefined): unknown => {
  try {
    return answer?.ok === true ? JSON.parse(answer.text) : undefined
  } catch {
    return undefined
  }
}

/**
 * Asks Open-Meteo what the sky does over the place the person named, now
 * and every quarter of an hour. With no place named it asks nothing: the
 * mod makes no request until `/ambient weather <city>`.
 */
const forecast = async ($: EngineInterface): Promise<void> => {
  const { place } = await read($, settings)

  if (place === null) {
    stage.forecaster?.cancel()
    stage.forecaster = undefined
    await update($, sky, () => null)

    return
  }

  stage.forecaster ??= $.clock.every(SKY_EVERY_MS, () => {
    void forecast($)
  })
  // The one host the forecast is asked of, and all that is sent: the place's
  // latitude and longitude.
  const answer = await $.http
    .fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,weather_code,is_day`,
    )
    .catch(() => undefined)
  const current = fieldOf(jsonOf(answer), 'current')
  const code = fieldOf(current, 'weather_code')
  const temperature = fieldOf(current, 'temperature_2m')

  // An answer that did not come leaves the sky as it was last seen.
  if (typeof code === 'number' && typeof temperature === 'number') {
    const isDay = fieldOf(current, 'is_day') !== 0
    await update($, sky, () => ({ code, isDay, temperature }))
  }
}

/** The city this machine's time zone is named for: `Europe/Istanbul`'s. */
const zoneCity = (): string => {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone

    return zone.includes('/') ? (zone.split('/').at(-1) ?? '').replaceAll('_', ' ') : ''
  } catch {
    return ''
  }
}

/**
 * `/ambient weather <city|auto|off>`: the place whose real sky the weather
 * scene follows. `auto` takes the city of the machine's time zone, so
 * nothing but a city's name ever leaves the machine.
 */
const placeText = async ($: EngineInterface, words: string): Promise<string> => {
  if (words === 'off') {
    await stored($, { place: null })
    await forecast($)

    return "Ambient weather follows Claude's work alone again."
  }

  const asked = words === 'auto' ? zoneCity() : words

  if (asked === '') {
    return "Ambient could not tell a city from this machine's time zone: /ambient weather <city>."
  }

  // The one host a place is looked up at, and all that is sent: its name.
  const answer = await $.http
    .fetch(
      `https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=${encodeURIComponent(asked)}`,
    )
    .catch(() => undefined)
  const found = fieldOf(fieldOf(jsonOf(answer), 'results'), '0')
  const place = toPlace(found)

  if (place === null) {
    return `Ambient found no place called "${asked}", or could not reach Open-Meteo.`
  }

  const country = fieldOf(found, 'country')
  await stored($, { place, scene: 'weather', isOn: true })
  await forecast($)

  return `Ambient weather follows the sky over ${place.name}${typeof country === 'string' ? `, ${country}` : ''}. Weather data by Open-Meteo.com.`
}

/**
 * `/ambient volume <0-100|up|down>`. A number up to 1 with a point in it is
 * taken as a share of the whole: `0.2` is 20.
 */
const volumeText = async ($: EngineInterface, word: string): Promise<string> => {
  const step = word === 'up' ? VOLUME_STEP : word === 'down' ? -VOLUME_STEP : 0
  const typed = Number(word)
  const asked = word.includes('.') && typed <= 1 ? typed * 100 : typed

  if (step === 0 && (word === '' || !Number.isFinite(asked) || asked < 0 || asked > 100)) {
    return 'Ambient takes a volume from 0 to 100, or up and down: /ambient volume 55.'
  }

  const { volume, isSoundOn } = await stored($, kept => ({
    volume: toVolume(step === 0 ? asked : kept.volume + step),
  }))

  return `Ambient volume is ${volume}%${isSoundOn ? '' : ', and the sound is off: /ambient sound on'}.`
}

/** The controls shown, with one of them shown or left out. */
const controlsWith = (
  controls: readonly AmbientControl[],
  id: AmbientControl,
  isShown: boolean,
): AmbientControl[] =>
  CONTROLS.map(control => control.id).filter(each =>
    each === id ? isShown : controls.includes(each),
  )

/**
 * Shows one control in the row under the hint line, or leaves it out. A
 * control shown brings the row back, if the person had taken it away.
 */
const shownControl = (
  $: EngineInterface,
  id: AmbientControl,
  isShown?: boolean,
): Promise<AmbientSettings> =>
  stored($, kept => {
    const isNowShown = isShown ?? !kept.controls.includes(id)

    return {
      controls: controlsWith(kept.controls, id, isNowShown),
      ...(isNowShown ? { hasHint: true } : {}),
    }
  })

/**
 * `/ambient hint [on|off]`: the band's part of the hint line, all of it.
 * `/ambient hint <control> [on|off]`: one control of the row under it. Each
 * goes the word's way, or the other way with no word.
 */
const hintText = async ($: EngineInterface, word: string, way: string): Promise<string> => {
  const control = CONTROLS.find(each => each.id === word)

  if (control !== undefined) {
    const isShown = way === '' ? undefined : SWITCH[way]

    if (way !== '' && isShown === undefined) {
      return USAGE
    }

    const { controls } = await shownControl($, control.id, isShown)

    return controls.includes(control.id)
      ? `Ambient shows ${control.label} under the prompt.`
      : `Ambient leaves ${control.label} out from under the prompt.`
  }

  const hasHint = word === '' ? !(await read($, settings)).hasHint : SWITCH[word]

  if (hasHint === undefined || way !== '') {
    return USAGE
  }

  await stored($, { hasHint })

  return hasHint
    ? 'Ambient shows its scene and sound on the hint line under the prompt.'
    : 'Ambient is off the hint line.'
}

/** What the hint line says of the band: its scene, and how it sounds. */
const hintOf = (now: AmbientSettings): string => {
  const sound = now.isSoundOn && now.volume > 0 ? `${now.volume}%` : 'muted'

  return `♪ ${now.scene} ${sound}`
}

/**
 * The label worked into the hint line's tail. A tail another mod already
 * padded out to the row's end gives up that much of its padding; with no
 * such room the label follows the line, or is left out when the row is full.
 */
const tailed = (hint: string, tail: string, label: string, columns: number): string => {
  const gap = ' '.repeat(HINT_GAP)
  const padding = ' '.repeat(label.length + HINT_GAP * 2)

  if (tail.includes(padding)) {
    return tail.replace(padding, `${gap}${label}${gap}`)
  }

  // After another mod's label a dot sets the two apart, as the line's own
  // parts are set apart.
  const joint = tail.trim() === '' ? gap : ' · '
  const room = columns - hint.length - tail.length - label.length

  return room >= joint.length + HINT_MARGIN ? `${tail}${joint}${label}` : tail
}

const rowsText = async ($: EngineInterface, word: string): Promise<string> => {
  const rows = Number(word)

  if (!Number.isInteger(rows) || rows < MIN_ROWS || rows > MAX_ROWS) {
    return `Ambient takes ${MIN_ROWS} to ${MAX_ROWS} rows: /ambient rows 5.`
  }

  await stored($, { rows })

  return `Ambient is ${rows} rows tall.`
}

/** `/ambient when [always|working]`: the word's way, or the other with none. */
const whenText = async ($: EngineInterface, word: string): Promise<string> => {
  const other = (await read($, settings)).when === 'working' ? 'always' : 'working'
  const when = word === '' ? other : WHEN[word]

  if (when === undefined) {
    return 'Ambient shows always or while Claude works: /ambient when always, /ambient when working.'
  }

  await stored($, { when })

  return when === 'working'
    ? 'Ambient shows while Claude works.'
    : 'Ambient shows always.'
}

/**
 * The settings the band and the hint line are drawn by. Until the session's
 * start has read the kept ones, the session holds only the defaults: drawn
 * by those, a band kept to show only while Claude works showed as the
 * session opened, and went once the start had read the kept settings.
 */
const shownSettings = async ($: EngineInterface): Promise<AmbientSettings> => {
  // Read either way: a change to the settings redraws what reads them.
  const held = await read($, settings)

  return (await read($, isLoaded)) ? held : toSettings(await $.store.get(SETTINGS))
}

/** Everything the band's scene draws from, as its props. */
const propsOf = async (
  $: EngineInterface,
  { scene, place, hasBackdrop }: AmbientSettings,
  isWorking: boolean,
): Promise<Feed> => {
  const counts = toFeed(await read($, feed))
  const { tree, city } = await read($, world)
  const date = new Date(await $.clock.now())

  return {
    ...counts,
    tree,
    city,
    scene,
    isWorking,
    hour: date.getHours(),
    month: date.getMonth() + 1,
    sky: await read($, sky),
    place: place?.name ?? '',
    hasBackdrop,
  }
}

/**
 * Folds what this session added into the kept world, grows the tree by the
 * turns given, and keeps the result.
 */
const folded = async (
  $: EngineInterface,
  added: Unsaved,
  grown: number,
): Promise<void> => {
  const before = toWorld(await $.store.get(WORLD), dayOf(await $.clock.now()))
  const after: AmbientWorld = {
    tree: {
      seed: before.tree.seed,
      turns: before.tree.turns + grown,
      shed: Math.max(0, before.tree.shed + added.shed - grown * REGROWN),
    },
    city: { day: before.city.day, edits: before.city.edits + added.edits },
  }
  await $.store.set(WORLD, after)
  await update($, world, () => after)
}

/** Opens the scene picker; the band shows for as long as it is open. */
const picking = async ($: EngineInterface): Promise<string> => {
  const opened = await $.ui.open({
    id: PANE,
    title: 'Ambient',
    focus: true,
    closeOnEscape: true,
    rows: PICKER_ROWS,
  })
  await update($, isPicking, () => opened.isPlaced)

  return opened.isPlaced
    ? 'Ambient: pick a scene, esc closes the picker.'
    : `Ambient's picker has no room to show: ${opened.reason}. /ambient list names the scenes.`
}

/** Opens the picker, or closes it when it is open: the hint line's button. */
const toggled = async ($: EngineInterface): Promise<void> => {
  if (await read($, isPicking)) {
    await $.ui.close({ id: PANE })
    await update($, isPicking, () => false)
  } else {
    await picking($)
  }
}

export const register: Register = on => {
  // The store is every session's: what this one adds goes in as a difference,
  // so two sessions at once grow one tree and build one skyline.
  let unsaved: Unsaved = { edits: 0, shed: 0 }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ambient',
      description: 'Pick the scene for the living band above the prompt',
      argumentHint: '[scene|list|next|off|sound|mute|volume|weather|shuffle|rows|when|hint|backdrop]',
    })
    const saved = toSettings(await $.store.get(SETTINGS))
    const before = await $.store.get(WORLD)
    const loaded = toWorld(before, dayOf(await $.clock.now()))
    await update($, settings, () => saved)
    await update($, world, () => loaded)
    await update($, isLoaded, () => true)

    if (fieldOf(before, 'tree') === undefined) {
      // A first session plants the tree: its seed is kept from here on.
      await $.store.set(WORLD, loaded)
    }

    await tuned($)
    // Not waited for: a slow network must not hold the session's start.
    void forecast($)

    return next(e)
  })

  // A session that ends gives the bed up at once, for another to take. After
  // a /clear the session goes on, and so does its sound.
  on('session.end', async ($, e, next) => {
    if (e.reason !== 'clear') {
      stage.ticker?.cancel()
      stage.ticker = undefined
      await released($)
    }

    return next(e)
  })

  // The scene on the band says which of its beds fits what it shows now: the
  // weather's rain, the train's run. Only the band's own posts are read.
  on('ui.message', async ($, e, next) => {
    const scene = fieldOf(e.data, 'scene')
    const bed = fieldOf(e.data, 'bed')

    if (e.element !== BAND || typeof scene !== 'string' || typeof bed !== 'string') {
      return next(e)
    }

    stage.wanted = { ...stage.wanted, [scene]: bed }
    await tuned($)

    return {}
  })

  on('command.run', { command: 'ambient' }, async ($, e) => {
    const [verb = '', word = '', ...rest] = e.args
      .trim()
      .toLowerCase()
      .split(/\s+/)
    const now = await read($, settings)

    // `/ambient weather` alone picks the scene; with words after it, they
    // name the place whose sky the scene follows.
    if (verb === 'weather' && word !== '') {
      return { text: await placeText($, [word, ...rest].join(' ')) }
    }

    // `/ambient hint volume off`: a control, then the way it goes.
    if (verb === 'hint' && rest.length <= 1) {
      return { text: await hintText($, word, rest[0] ?? '') }
    }

    if (rest.length > 0) {
      return { text: USAGE }
    }

    if (verb === 'shuffle') {
      return { text: await shuffleText($, word) }
    }

    if (verb === 'backdrop' || verb === 'background') {
      return { text: await backdropText($, word) }
    }

    if (verb === 'sound') {
      return { text: await soundText($, word) }
    }

    if (verb === 'volume') {
      return { text: await volumeText($, word) }
    }

    if (verb === 'rows') {
      return { text: await rowsText($, word) }
    }

    if (verb === 'when') {
      return { text: await whenText($, word) }
    }

    if (word !== '') {
      return { text: USAGE }
    }

    if (verb === '' || verb === 'pick') {
      return { text: await picking($) }
    }

    if (QUIET_WORDS.includes(verb) || LOUD_WORDS.includes(verb)) {
      return { text: await soundText($, LOUD_WORDS.includes(verb) ? 'on' : 'off') }
    }

    if (verb === 'list' || verb === 'status') {
      return { text: listText(now) }
    }

    if (verb === 'on' || verb === 'off') {
      return { text: summary(await stored($, { isOn: verb === 'on' })) }
    }

    if (verb === 'next' || verb === 'prev') {
      return {
        text: await picked($, sceneAfter(now.scene, verb === 'next' ? 1 : -1).id),
      }
    }

    if (verb === 'replant') {
      const seed = Math.floor(Math.random() * 2 ** 31) + 1
      const { city } = await read($, world)
      const replanted = { tree: { seed, turns: 0, shed: 0 }, city }
      unsaved = { ...unsaved, shed: 0 }
      await $.store.set(WORLD, replanted)
      await update($, world, () => replanted)

      return { text: 'Ambient: a new bonsai is planted.' }
    }

    const scene = sceneNamed(verb)

    return { text: scene === undefined ? USAGE : await picked($, scene.id) }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      await update($, isPicking, () => false)
    }

    return next(e)
  })

  // Claude's tool calls feed the scenes. The call itself is passed on and
  // answered untouched: only its name and whether it failed are read.
  on('tool.call', async ($, e, next) => {
    if (!(await read($, settings)).isOn) {
      return next(e)
    }

    const kind = KINDS.indexOf(kindOf(String(e.tool)))
    const time = await $.clock.now()
    await update($, feed, now => called(now, kind))

    if (time - stage.calledAt >= CALL_GAP_MS) {
      stage.calledAt = time
      await chimed($, `call-${kind}`)
    }

    const ran = await next(e)

    if (ran.deny === undefined && ran.isError === true) {
      await chimed($, 'fail')
      unsaved = { ...unsaved, shed: unsaved.shed + 1 }
      await update($, feed, now => ({ ...toFeed(now), fails: toFeed(now).fails + 1 }))
      await update($, world, now => ({
        ...now,
        tree: { ...now.tree, shed: now.tree.shed + 1 },
      }))
    } else if (ran.deny === undefined && kind === EDIT) {
      unsaved = { ...unsaved, edits: unsaved.edits + 1 }
      await update($, world, now => ({
        ...now,
        city: { ...now.city, edits: now.city.edits + 1 },
      }))
    }

    return ran
  })

  on('turn.start', async ($, e, next) => {
    if ((await read($, settings)).isOn) {
      const day = dayOf(await $.clock.now())
      await update($, feed, now => ({
        ...toFeed(now),
        turn: 0,
        turnKinds: noCounts(),
      }))

      if ((await read($, world)).city.day !== day) {
        // Midnight passed with the session open: the new day's lots are empty.
        unsaved = { ...unsaved, edits: 0 }
        await update($, world, now => ({ ...now, city: { day, edits: 0 } }))
      }

      // The person works in this session now: its bed is the one heard.
      await tuned($, true)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const now = await read($, settings)

    if (e.agentId !== undefined || !now.isOn) {
      return next(e)
    }

    const added = unsaved
    unsaved = { edits: 0, shed: 0 }
    await chimed($, 'turn')
    await update($, feed, finished)
    await folded($, added, e.isAborted ? 0 : 1)

    if (now.isShuffled) {
      const others = SCENES.filter(scene => scene.id !== now.scene)
      const scene = others[Math.floor(Math.random() * others.length)] ?? SCENES[0]
      await stored($, { scene: scene.id })
    }

    return next(e)
  })

  // The band's controls under the hint line: the scene's name, a switch for
  // the band and one for when it shows, its height, a switch for the sound
  // with its volume beside it, and a button that opens the picker and closes
  // it again, going on to another row where this one is too narrow for them.
  // The person picks which of them the row holds. The engine's own line is
  // drawn first, as it is, with what other mods added to it. A press needs a
  // pointer, which the terminal has only in its fullscreen layout: on the
  // main screen the scene and its sound are said at the end of the hint line.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const now = await shownSettings($)
    const hasPointer = e.surface !== 'terminal' || e.viewport?.isFullscreen === true

    if (!now.hasHint) {
      return next(e)
    }

    if (!hasPointer) {
      const tail = tailed(
        e.props.hint,
        e.props.tail ?? '',
        hintOf(now),
        e.viewport?.columns ?? 0,
      )

      return now.isOn ? next({ ...e, props: { ...e.props, tail } }) : next(e)
    }

    if (now.controls.length === 0) {
      return next(e)
    }

    const line = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const isHeard = now.isOn && now.isSoundOn && now.volume > 0
    const isOpen = await read($, isPicking)
    const has = (id: AmbientControl): boolean => now.controls.includes(id)

    // A switch that is on is drawn at full strength, the rest dim, so the
    // row says at a glance what plays.
    return (
      <Box flexDirection="column">
        {line}
        <Box columnGap={2} flexWrap="wrap">
          {has('name') &&
            (now.isOn ? (
              <Text color={sceneOf(now.scene)?.hue}>♪ {now.scene}</Text>
            ) : (
              <Text dimColor>♪ ambient</Text>
            ))}
          {has('band') && (
            <Button
              key="band"
              dimColor={!now.isOn}
              label={`${now.isOn ? '●' : '○'} band`}
              onPress={() => stored($, kept => ({ isOn: !kept.isOn }))}
            />
          )}
          {has('when') && (
            <Button
              key="when"
              dimColor
              label={now.when === 'working' ? '◐ working' : '◉ always'}
              onPress={() =>
                stored($, kept => ({
                  when: kept.when === 'working' ? 'always' : 'working',
                }))
              }
            />
          )}
          {has('rows') && (
            <Box gap={1}>
              <Button
                key="shorter"
                dimColor
                label="-"
                onPress={() =>
                  stored($, kept => ({ rows: Math.max(MIN_ROWS, kept.rows - 1) }))
                }
              />
              <Text dimColor>{now.rows} rows</Text>
              <Button
                key="taller"
                dimColor
                label="+"
                onPress={() =>
                  stored($, kept => ({ rows: Math.min(MAX_ROWS, kept.rows + 1) }))
                }
              />
            </Box>
          )}
          {has('sound') && (
            <Button
              key="sound"
              dimColor={!isHeard}
              label={`${isHeard ? '●' : '○'} sound`}
              onPress={() => stored($, kept => ({ isSoundOn: !kept.isSoundOn }))}
            />
          )}
          {has('volume') && (
            <Box gap={1}>
              <Button
                key="quieter"
                dimColor
                label="-"
                onPress={() =>
                  stored($, kept => ({ volume: Math.max(0, kept.volume - VOLUME_STEP) }))
                }
              />
              <Text dimColor>{now.volume}%</Text>
              <Button
                key="louder"
                dimColor
                label="+"
                onPress={() =>
                  stored($, kept => ({ volume: Math.min(100, kept.volume + VOLUME_STEP) }))
                }
              />
            </Box>
          )}
          {has('scenes') && (
            <Button
              key="scenes"
              dimColor={!isOpen}
              label={isOpen ? '× scenes' : 'scenes'}
              onPress={() => toggled($)}
            />
          )}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = await shownSettings($)
    const rows = Math.min(now.rows, e.props.maxRows)
    const isOffered =
      now.isOn &&
      !e.props.hasSurvey &&
      rows >= MIN_ROWS &&
      (e.surface === 'terminal' || e.surface === 'desktop')

    if (!isOffered) {
      return next(e)
    }

    if (now.when === 'working' && !e.props.isWorking && !(await read($, isPicking))) {
      return next(e)
    }

    const ui = $.ui.resolve(e)

    return (
      <ui.Client
        key={BAND}
        module="./band.tsx"
        props={await propsOf($, now, e.props.isWorking)}
        width="100%"
        height={rows}
      />
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const now = await read($, settings)

    return (
      <Box flexDirection="column">
        <Text dimColor>The band above the prompt · pick its scene</Text>
        {SCENES.map((scene, index) => (
          <Box gap={1}>
            <Text color={scene.hue}>{now.isOn && scene.id === now.scene ? '●' : ' '}</Text>
            <Button
              key={scene.id}
              plain
              hotkey={HOTKEYS[index]}
              label={scene.name.padEnd(9)}
              onPress={() => picked($, scene.id)}
            />
            <Text dimColor wrap="truncate-end">
              {scene.about}
            </Text>
          </Box>
        ))}
        <Box gap={1}>
          <Text>{now.isOn ? ' ' : '●'}</Text>
          <Button
            key="off"
            plain
            hotkey="o"
            label="Off"
            onPress={() => stored($, { isOn: false })}
          />
        </Box>
        <Box gap={2} marginTop={1}>
          <Button
            key="shorter"
            plain
            hotkey="j"
            label="shorter"
            onPress={() =>
              stored($, kept => ({ rows: Math.max(MIN_ROWS, kept.rows - 1) }))
            }
          />
          <Button
            key="taller"
            plain
            hotkey="k"
            label="taller"
            onPress={() =>
              stored($, kept => ({ rows: Math.min(MAX_ROWS, kept.rows + 1) }))
            }
          />
          <Text dimColor>{now.rows} rows</Text>
        </Box>
        <Box gap={2}>
          <Button
            key="sound"
            plain
            hotkey="v"
            label={`sound ${now.isSoundOn ? 'on' : 'off'}`}
            onPress={() => stored($, kept => ({ isSoundOn: !kept.isSoundOn }))}
          />
          <Button
            key="quieter"
            plain
            hotkey="z"
            label="quieter"
            onPress={() =>
              stored($, kept => ({ volume: Math.max(0, kept.volume - VOLUME_STEP) }))
            }
          />
          <Button
            key="louder"
            plain
            hotkey="x"
            label="louder"
            onPress={() =>
              stored($, kept => ({ volume: Math.min(100, kept.volume + VOLUME_STEP) }))
            }
          />
          <Text dimColor>{now.volume}%</Text>
        </Box>
        <Box gap={2}>
          <Button
            key="shuffle"
            plain
            hotkey="s"
            label={`shuffle ${now.isShuffled ? 'on' : 'off'}`}
            onPress={() => stored($, kept => ({ isShuffled: !kept.isShuffled }))}
          />
          <Button
            key="when"
            plain
            hotkey="w"
            label={now.when === 'working' ? 'shows while Claude works' : 'shows always'}
            onPress={() =>
              stored($, kept => ({
                when: kept.when === 'working' ? 'always' : 'working',
              }))
            }
          />
          <Button
            key="backdrop"
            plain
            hotkey="g"
            label={`backdrop ${now.hasBackdrop ? 'on' : 'off'}`}
            onPress={() => stored($, kept => ({ hasBackdrop: !kept.hasBackdrop }))}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Under the prompt · the controls its row holds</Text>
        </Box>
        <Box columnGap={2} flexWrap="wrap">
          {CONTROLS.map(control => (
            <Button
              key={`control-${control.id}`}
              plain
              hotkey={control.hotkey}
              dimColor={!(now.hasHint && now.controls.includes(control.id))}
              label={`${now.hasHint && now.controls.includes(control.id) ? '●' : '○'} ${control.id}`}
              onPress={() =>
                shownControl(
                  $,
                  control.id,
                  !(now.hasHint && now.controls.includes(control.id)),
                )
              }
            />
          ))}
        </Box>
      </Box>
    )
  })
}
