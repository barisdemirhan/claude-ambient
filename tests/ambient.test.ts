import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const COLUMNS = 80
const ROWS = 5
const BAND = {
  plugin: 'ambient',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 20,
    bodyColumns: COLUMNS,
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
  viewport: { columns: COLUMNS, rows: 40 },
} as const
const PICKER = {
  plugin: 'ambient',
  component: 'Pane',
  requestId: 'ambient',
  props: {
    title: 'Ambient',
    isFocused: true,
    bodyColumns: COLUMNS,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 16 },
    view: {},
  },
  viewport: { columns: COLUMNS, rows: 40 },
} as const
// `/ambient` as the person types it at the prompt.
const TYPED = {
  command: 'ambient',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: COLUMNS },
} as const
const SESSION = { cwd: '/', surface: 'terminal', isInteractive: true } as const
const SCENES = [
  'aquarium',
  'bonsai',
  'city',
  'stars',
  'weather',
  'train',
  'life',
  'pulse',
  'fire',
  'matrix',
  'lofi',
]
// One call of each tool the tests make, as the model would make it.
const CALLS = {
  read: { tool: 'Read', file_path: '/notes.md' },
  edit: { tool: 'Edit', file_path: '/notes.md', old_string: 'a', new_string: 'b' },
  write: { tool: 'Write', file_path: '/notes.md', content: 'a' },
  bash: { tool: 'Bash', command: 'false' },
  fetch: { tool: 'WebFetch', url: 'https://example.com', prompt: 'title' },
} as const
// Noon on the second of October, on the clock of whoever runs the test.
const NOON = new Date(2026, 9, 2, 12).getTime()
const TODAY = '2026-10-02'

/** One sound the mod asked the engine to play. */
type Play = { asset: string; gain: number | undefined }

/**
 * The engine beneath the mod: a clock, a store, tools where Bash fails, and
 * a player that plays nothing and notes what it was asked to. The store and
 * the notes are handed back: a test stands in for another session through
 * the first, and reads what was played from the second.
 */
const world = (on: On, kept: Readonly<Record<string, unknown>> = {}) => {
  const clock = mock.clock(on, { now: NOON })
  const store = new Map(Object.entries(kept))
  const plays: Play[] = []
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)

    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    store.delete(e.key)

    return { value: undefined }
  })
  // Open-Meteo, as far as the mod asks it: where Istanbul is, and its sky.
  const sky = { code: 2 }
  const asked: string[] = []
  on('http.fetch', (_$, e) => {
    asked.push(e.url)
    const isKnown = e.url.includes('name=istanbul') || e.url.includes('name=Istanbul')
    const found = [{ name: 'Istanbul', latitude: 41.01, longitude: 28.95, country: 'Türkiye' }]
    const body = e.url.includes('geocoding-api')
      ? { results: isKnown ? found : undefined }
      : { current: { temperature_2m: 16.2, weather_code: sky.code, is_day: 1 } }

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  on('audio.play', (_$, e) => {
    plays.push({ asset: 'asset' in e.clip ? (e.clip.asset ?? '') : '', gain: e.gain })

    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('tool.call', (_$, e) =>
    e.tool === 'Bash' ? { isError: true, result: undefined } : { result: 'ok' },
  )

  return { clock, store, plays, sky, asked }
}

/** The beds among what was played: the long sounds, not a call's or a turn's. */
const bedsOf = (plays: readonly Play[]): string[] =>
  plays
    .map(play => play.asset.replace('sounds/', '').replace('.m4a', ''))
    .filter(name => !/-(call-\d|fail|turn)$/.test(name))

const typed = async ($: Engine, args: string): Promise<string> =>
  (await $.command.run({ ...TYPED, args })).text ?? ''

const turnDone = ($: Engine, isAborted = false) =>
  $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted,
    turnId: 'turn',
    reason: isAborted ? 'aborted' : 'answer',
  })

test('every scene fills the band on both surfaces, through a turn of work and after it', async ($, on) => {
  world(on)

  for (const scene of SCENES) {
    for (const surface of ['terminal', 'desktop'] as const) {
      expect(await typed($, scene)).toContain('Ambient: ')
      const ui = await $.ui.mount({ ...BAND, surface })
      await ui.resize({ columns: COLUMNS, rows: ROWS })
      // What the band shows as text, a line per row.
      const lines = async () => {
        const drawn = await ui.findAll({ type: 'Text', in: 'band' })

        return drawn.map(run => run.text ?? '').join('')
      }
      const isFilled = async () => {
        const text = await lines()

        return [...text].length === COLUMNS * ROWS && text.trim() !== ''
      }

      await $.turn.start({ text: 'go', turnId: 'turn' })
      await ui.advance(1500)
      expect(await isFilled()).toBe(true)

      for (const call of Object.values(CALLS)) {
        await $.tool.call(call)
        await ui.advance(400)
      }

      expect(await isFilled()).toBe(true)
      await turnDone($)
      await ui.redraw({ ...BAND.props, isWorking: false })
      await ui.advance(6000)
      expect(await isFilled()).toBe(true)

      // A band three rows tall and a narrow one still draw whole.
      await ui.resize({ columns: 44, rows: 3 })
      await ui.advance(500)
      const narrow = await lines()
      expect([...narrow].length).toBe(44 * 3)
      await ui.unmount()
    }
  }
})

test('the calls of a turn reach the scene: three calls are three wagons', async ($, on) => {
  world(on)
  await typed($, 'train')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    await ui.resize({ columns: COLUMNS, rows: ROWS })
    await $.turn.start({ text: 'go', turnId: 'turn' })

    for (const call of [CALLS.read, CALLS.edit, CALLS.fetch]) {
      await $.tool.call(call)
    }

    await ui.advance(300)
    expect(await ui.find({ type: 'Text', in: 'band', text: '3 wagons' })).toBeDefined()
    await turnDone($)
    await ui.unmount()
  }
})

test('an edit builds a floor of the skyline, a failed one does not', async ($, on) => {
  world(on)
  await typed($, 'city')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.resize({ columns: COLUMNS, rows: ROWS })
  expect(await ui.find({ type: 'Text', in: 'band', text: 'empty lots' })).toBeDefined()

  await $.tool.call(CALLS.edit)
  await $.tool.call(CALLS.write)
  await $.tool.call(CALLS.bash)
  await $.tool.call(CALLS.read)
  await ui.advance(300)
  expect(await ui.find({ type: 'Text', in: 'band', text: '2 floors today' })).toBeDefined()
  await ui.unmount()
})

test('the bonsai and the skyline are kept between sessions, the skyline for its day', async ($, on) => {
  world(on, {
    settings: { scene: 'bonsai', isOn: true, rows: 5, when: 'always', isShuffled: false },
    world: {
      tree: { seed: 7, turns: 41, shed: 0 },
      city: { day: TODAY, edits: 12 },
    },
  })
  await $.session.start(SESSION)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.resize({ columns: COLUMNS, rows: ROWS })
  expect(await ui.find({ type: 'Text', in: 'band', text: '41 turns old' })).toBeDefined()

  // A finished turn grows the tree, an interrupted one does not.
  await $.turn.start({ text: 'go', turnId: 'turn' })
  await turnDone($)
  await ui.advance(200)
  expect(await ui.find({ type: 'Text', in: 'band', text: '42 turns old' })).toBeDefined()
  await turnDone($, true)
  await ui.advance(200)
  expect(await ui.find({ type: 'Text', in: 'band', text: '42 turns old' })).toBeDefined()

  await typed($, 'city')
  await ui.advance(200)
  expect(await ui.find({ type: 'Text', in: 'band', text: '12 floors today' })).toBeDefined()
  await ui.unmount()

  // The next session opens on what the last one kept.
  await $.session.start(SESSION)
  expect(await typed($, 'list')).toContain('Ambient is on · Skyline')
  await typed($, 'bonsai')
  const next = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await next.resize({ columns: COLUMNS, rows: ROWS })
  expect(await next.find({ type: 'Text', in: 'band', text: '42 turns old' })).toBeDefined()
  await next.unmount()
})

test("yesterday's skyline is gone in the morning", async ($, on) => {
  world(on, {
    settings: { scene: 'city' },
    world: {
      tree: { seed: 7, turns: 3, shed: 0 },
      city: { day: '2026-10-01', edits: 30 },
    },
  })
  await $.session.start(SESSION)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.resize({ columns: COLUMNS, rows: ROWS })
  expect(await ui.find({ type: 'Text', in: 'band', text: 'empty lots' })).toBeDefined()
  await ui.unmount()
})

test('/ambient picks a scene by name, start or alias, steps through them and takes settings', async ($, on) => {
  world(on)

  expect(await typed($, 'fire')).toContain('Ambient: Fireplace')
  expect(await typed($, 'skyline')).toContain('Ambient: Skyline')
  expect(await typed($, 'aqua')).toContain('Ambient: Aquarium')
  expect(await typed($, 'ekg')).toContain('Ambient: Pulse')
  expect(await typed($, 'next')).toContain('Ambient: Fireplace')
  expect(await typed($, 'prev')).toContain('Ambient: Pulse')
  expect(await typed($, 'l')).toContain('Usage: /ambient')
  expect(await typed($, 'nonsense')).toContain('Usage: /ambient')
  expect(await typed($, 'fire now')).toContain('Usage: /ambient')

  expect(await typed($, 'rows 7')).toBe('Ambient is 7 rows tall.')
  expect(await typed($, 'rows 40')).toContain('3 to 10 rows')
  expect(await typed($, 'when working')).toBe('Ambient shows while Claude works.')
  expect(await typed($, 'when sometimes')).toContain('/ambient when always')
  expect(await typed($, 'shuffle')).toContain('shuffle is on')
  expect(await typed($, 'shuffle off')).toBe('Ambient shuffle is off.')
  expect(await typed($, 'off')).toContain('Ambient is off')

  const list = await typed($, 'list')
  expect(list).toContain('Ambient is off · Pulse · 7 rows · shows while Claude works · shuffle off')
  expect(list.split('\n')).toHaveLength(SCENES.length + 1)
  expect(await typed($, 'pulse')).toContain('Ambient: Pulse')
  expect(await typed($, 'list')).toContain('● pulse')
})

test('the band stays away while it is off, behind a survey, and at rest when it shows only for work', async ($, on) => {
  world(on)
  // What the engine draws in the band when no mod does: nothing of the mod's.
  on('ui.render', ($$, e) => $$.ui.resolve(e).Text({ children: 'nothing here' }))
  const isShown = async (
    props: Partial<{ isWorking: boolean; hasSurvey: boolean; maxRows: number }>,
  ) => {
    const ui = await $.ui.mount({
      ...BAND,
      props: { ...BAND.props, ...props },
      surface: 'terminal',
    })
    const isAway = (await ui.find({ type: 'Text', text: 'nothing here' })) !== undefined
    await ui.unmount()

    return !isAway
  }

  expect(await isShown({})).toBe(true)
  expect(await isShown({ isWorking: false })).toBe(true)
  expect(await isShown({ hasSurvey: true })).toBe(false)
  expect(await isShown({ maxRows: 2 })).toBe(false)

  await typed($, 'when working')
  expect(await isShown({})).toBe(true)
  expect(await isShown({ isWorking: false })).toBe(false)

  await typed($, 'off')
  expect(await isShown({})).toBe(false)
})

test('nothing is counted while the band is off', async ($, on) => {
  world(on)
  await typed($, 'train')
  await typed($, 'off')
  await $.tool.call(CALLS.read)
  await typed($, 'on')

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.resize({ columns: COLUMNS, rows: ROWS })
  await $.tool.call(CALLS.read)
  await ui.advance(300)
  expect(await ui.find({ type: 'Text', in: 'band', text: '1 wagon' })).toBeDefined()
  expect(await ui.find({ type: 'Text', in: 'band', text: 'wagons' })).toBeUndefined()
  await ui.unmount()
})

test('/ambient opens the picker, and a press in it picks the scene on every surface', async ($, on) => {
  world(on)
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })

  expect(await typed($, '')).toContain('pick a scene')
  expect(opened).toEqual(['ambient'])

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PICKER, surface })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(SCENES.length + 16)

    await ui.press({ key: 'fire' })
    expect(await typed($, 'list')).toContain('● fire')
    await ui.press({ key: 'taller' })
    await ui.press({ key: 'taller' })
    await ui.press({ key: 'shorter' })
    await ui.press({ key: 'shuffle' })
    await ui.press({ key: 'when' })
    expect(await typed($, 'list')).toContain(
      'Fireplace · 6 rows · shows while Claude works · shuffle on',
    )
    await ui.press({ key: 'off' })
    expect(await typed($, 'list')).toContain('Ambient is off')

    await typed($, 'rows 5')
    await typed($, 'when always')
    await typed($, 'shuffle off')
    await ui.unmount()
  }
})

test('sound is off until asked for; on, the bed plays and plays on, one loop after another', async ($, on) => {
  const { clock, plays, store } = world(on)

  await typed($, 'fire')
  await $.tool.call(CALLS.read)
  await clock.advance(30_000)
  expect(plays).toEqual([])

  expect(await typed($, 'sound on')).toContain('Ambient sound is on at 55%')
  expect(plays).toEqual([])
  await clock.advance(400)
  expect(plays).toEqual([{ asset: 'sounds/fire-hearth.m4a', gain: 0.303 }])

  // The next play starts one loop on, while the last one's end still rings.
  await clock.advance(23_000)
  expect(bedsOf(plays)).toEqual(['fire-hearth'])
  await clock.advance(1000)
  expect(bedsOf(plays)).toEqual(['fire-hearth', 'fire-hearth'])
  await clock.advance(24_000)
  expect(bedsOf(plays)).toEqual(['fire-hearth', 'fire-hearth', 'fire-hearth'])

  // Another scene is another bed, at once; the fire's is not played again.
  await typed($, 'lofi')
  expect(bedsOf(plays).at(-1)).toBe('lofi-tape')
  await clock.advance(53_400)
  expect(bedsOf(plays).slice(3)).toEqual(['lofi-tape', 'lofi-tape'])

  // Louder is the same bed again, at the new loudness.
  expect(await typed($, 'volume 100')).toBe('Ambient volume is 100%.')
  expect(plays.at(-1)).toEqual({ asset: 'sounds/lofi-tape.m4a', gain: 0.55 })
  expect(await typed($, 'volume 300')).toContain('0 to 100')

  expect(await typed($, 'sound off')).toBe('Ambient sound is off.')
  const played = plays.length
  await $.tool.call(CALLS.read)
  await clock.advance(120_000)
  expect(plays).toHaveLength(played)
  expect(store.has('player')).toBe(false)
})

test("a call, a failure and a turn's end sound in the scene's voice; a burst of calls sounds once", async ($, on) => {
  const { clock, plays } = world(on)
  await typed($, 'train')
  await typed($, 'sound on')
  await clock.advance(400)
  plays.length = 0

  await $.tool.call(CALLS.read)
  await $.tool.call(CALLS.edit)
  await $.tool.call(CALLS.fetch)
  expect(plays).toEqual([{ asset: 'sounds/train-call-0.m4a', gain: 0.33 }])

  await clock.advance(300)
  await $.tool.call(CALLS.edit)
  await clock.advance(300)
  await $.tool.call(CALLS.bash)
  await turnDone($)
  expect(plays.map(play => play.asset).slice(1)).toEqual([
    'sounds/train-call-2.m4a',
    'sounds/train-call-3.m4a',
    'sounds/train-fail.m4a',
    'sounds/train-turn.m4a',
  ])
})

test('however many sessions are open, one plays the bed: the one last used, or one still there', async ($, on) => {
  // Another session holds the bed when this one starts.
  const { clock, plays, store } = world(on, {
    settings: { scene: 'stars', isSoundOn: true },
    player: { id: 'another', at: NOON, ready: 0 },
  })
  const beat = () => store.set('player', { id: 'another', at: clock.now(), ready: 0 })
  const whileItBeats = async (seconds: number) => {
    for (let second = 0; second < seconds; second += 1) {
      beat()
      await clock.advance(1000)
    }
  }
  await $.session.start(SESSION)

  await whileItBeats(40)
  expect(bedsOf(plays)).toEqual([])

  // This session's calls are still heard: only the bed is one session's.
  await $.tool.call(CALLS.read)
  expect(plays.map(play => play.asset)).toEqual(['sounds/stars-call-0.m4a'])

  // The other session is gone without a word: after a while this one plays.
  await clock.advance(19_000)
  expect(bedsOf(plays)).toEqual([])
  await clock.advance(4000)
  expect(bedsOf(plays)).toEqual(['stars-night'])

  // The person goes to work in the other session: this one falls silent.
  beat()
  await whileItBeats(60)
  expect(bedsOf(plays)).toEqual(['stars-night'])

  // And comes back to this one: it waits for the other to stop, then plays.
  await $.turn.start({ text: 'go', turnId: 'turn' })
  await clock.advance(2000)
  expect(bedsOf(plays)).toEqual(['stars-night'])
  await clock.advance(600)
  expect(bedsOf(plays)).toEqual(['stars-night', 'stars-night'])

  // The sound switched off in another session is off in this one too: its
  // bed stops, its calls fall silent, and a turn started here does not bring
  // the bed back. Switched on there again, it is on here at the next turn.
  const elsewhere = (isSoundOn: boolean) =>
    store.set('settings', { ...(store.get('settings') as object), isSoundOn })
  elsewhere(false)
  await clock.advance(2000)
  const quiet = plays.length
  await $.tool.call(CALLS.read)
  await $.turn.start({ text: 'go', turnId: 'turn' })
  await clock.advance(60_000)
  expect(plays).toHaveLength(quiet)
  expect(await typed($, 'list')).toContain('sound off')
  elsewhere(true)
  await $.turn.start({ text: 'go', turnId: 'turn' })
  await clock.advance(3000)
  expect(bedsOf(plays).at(-1)).toBe('stars-night')
  expect(plays.length).toBeGreaterThan(quiet)

  // A session that ends leaves the bed free at once.
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'here', resume: { id: 'here' } })
  expect(store.has('player')).toBe(false)
  const played = plays.length
  await clock.advance(60_000)
  expect(plays).toHaveLength(played)
})

test("the bed follows what the scene shows: the train's run, the weather's rain and storm", async ($, on) => {
  const { clock, plays } = world(on, { settings: { scene: 'train', isSoundOn: true } })
  await $.session.start(SESSION)
  await clock.advance(400)
  expect(bedsOf(plays)).toEqual(['train-station'])

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.resize({ columns: COLUMNS, rows: ROWS })
  await $.turn.start({ text: 'go', turnId: 'turn' })
  await ui.advance(500)
  expect(bedsOf(plays)).toEqual(['train-station', 'train-run'])

  await turnDone($)
  await ui.redraw({ ...BAND.props, isWorking: false })
  await ui.advance(15_000)
  expect(bedsOf(plays)).toEqual(['train-station', 'train-run', 'train-station'])

  await typed($, 'weather')
  await ui.advance(500)
  expect(bedsOf(plays).at(-1)).toBe('weather-fair')

  for (let failed = 0; failed < 3; failed += 1) {
    await clock.advance(300)
    await $.tool.call(CALLS.bash)
  }

  // The storm gathers: first the rain is heard, then the thunder with it.
  await ui.advance(2000)
  expect(bedsOf(plays).at(-1)).toBe('weather-rain')
  await ui.advance(6000)
  expect(bedsOf(plays).slice(-3)).toEqual(['weather-fair', 'weather-rain', 'weather-storm'])
  await ui.unmount()
})

test('the weather follows the real sky over a place the person names, and asks the network only then', async ($, on) => {
  const { clock, plays, sky, asked } = world(on)
  await typed($, 'sound on')
  expect(await typed($, 'weather')).toContain('Ambient: Weather')
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.resize({ columns: COLUMNS, rows: ROWS })
  await clock.advance(60 * 60_000)
  expect(asked).toEqual([])
  expect(await ui.find({ type: 'Text', in: 'band', text: '°' })).toBeUndefined()

  // It rains over Istanbul: the scene rains, and sounds like it, with no
  // call of Claude's having failed.
  sky.code = 63
  expect(await typed($, 'weather istanbul')).toContain('the sky over Istanbul, Türkiye')
  expect(asked).toHaveLength(2)
  expect(asked[0]).toContain('geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=istanbul')
  expect(asked[1]).toContain('api.open-meteo.com/v1/forecast?latitude=41.01&longitude=28.95')
  await ui.advance(4000)
  expect(await ui.find({ type: 'Text', in: 'band', text: 'Istanbul 16° rain' })).toBeDefined()
  expect(bedsOf(plays).at(-1)).toBe('weather-rain')
  expect(await typed($, 'list')).toContain('sky over Istanbul')

  // The sky is asked again every quarter of an hour, and it has cleared.
  sky.code = 0
  await clock.advance(15 * 60_000)
  expect(asked).toHaveLength(3)
  await ui.advance(200)
  expect(await ui.find({ type: 'Text', in: 'band', text: 'Istanbul 16° clear' })).toBeDefined()

  expect(await typed($, 'weather atlantis')).toContain('found no place called "atlantis"')
  expect(await typed($, 'weather off')).toContain("Claude's work alone")
  const before = asked.length
  await clock.advance(60 * 60_000)
  await ui.advance(200)
  expect(asked).toHaveLength(before)
  expect(await ui.find({ type: 'Text', in: 'band', text: '°' })).toBeUndefined()
  await ui.unmount()
})

test('the hint line under the prompt says what plays, beside what other mods put there', async ($, on) => {
  world(on)
  const opened: string[] = []
  const closed: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    closed.push(e.id)

    return { value: undefined }
  })
  // The engine's own drawing of the two sites, as text a test can read.
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    const props: object = e.props

    return Text({
      children:
        'hint' in props
          ? `${String(props.hint)}|${'tail' in props ? String(props.tail) : ''}|`
          : `modes: ${'modes' in props && Array.isArray(props.modes) ? props.modes.join(', ') : ''}`,
    })
  })
  const hintWith = async (tail?: string) => {
    const ui = await $.ui.mount({
      plugin: 'ambient',
      surface: 'terminal',
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: 'auto mode on', ...(tail === undefined ? {} : { tail }) },
      viewport: { columns: 100, rows: 40 },
    })
    const text = (await ui.find({ type: 'Text' }))?.text ?? ''
    await ui.unmount()

    return text
  }

  expect(await hintWith()).toBe('auto mode on|  ♪ aquarium muted|')
  await typed($, 'sound on')
  await typed($, 'lofi')
  expect(await hintWith()).toBe('auto mode on|  ♪ lofi 55%|')

  // Another mod's label at the row's end keeps its place: this one takes
  // some of the padding before it.
  const padded = `${' '.repeat(40)}HI 00255`
  const shared = await hintWith(padded)
  expect(shared).toContain('  ♪ lofi 55%  ')
  expect(shared.endsWith('HI 00255|')).toBe(true)
  expect(shared).toHaveLength(`auto mode on|${padded}|`.length)

  // After a label with no padding to give, a dot sets the two apart; on a
  // row with no room left the label stays out.
  expect(await hintWith('  25:00')).toBe('auto mode on|  25:00 · ♪ lofi 55%|')
  expect(await hintWith(' '.repeat(80))).toContain('♪ lofi 55%')
  expect(await hintWith('x'.repeat(80))).toBe(`auto mode on|${'x'.repeat(80)}|`)

  // Where there is a pointer (the terminal's fullscreen layout, the desktop
  // app) the line under the hint holds the controls instead: a switch for
  // the band and one for when it shows, one for the sound, a button for the
  // picker.
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'ambient',
      surface,
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: 'auto mode on' },
      viewport: { columns: 100, rows: 40, isFullscreen: true },
    })
    const labels = async () => (await ui.findAll({ type: 'Button' })).map(button => button.text)
    // The engine's own line is still drawn, untouched, over the controls.
    expect(await ui.find({ type: 'Text', text: 'auto mode on||' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '♪ lofi' })).toBeDefined()
    expect(await labels()).toEqual(['● band', '◉ always', '-', '+', '● sound', '-', '+', 'scenes'])
    expect(await ui.find({ type: 'Text', text: '55%' })).toBeDefined()

    await ui.press({ key: 'sound' })
    expect(await labels()).toEqual(['● band', '◉ always', '-', '+', '○ sound', '-', '+', 'scenes'])
    expect(await typed($, 'list')).toContain('sound off')
    await ui.press({ key: 'band' })
    const [band, when, , , sound] = await labels()
    expect([band, when, sound]).toEqual(['○ band', '◉ always', '○ sound'])
    expect(await ui.find({ type: 'Text', text: '♪ ambient' })).toBeDefined()
    expect(await typed($, 'list')).toContain('Ambient is off')
    await ui.press({ key: 'band' })
    await ui.press({ key: 'sound' })

    // The switch beside the band's says when it shows, and turns it.
    await ui.press({ key: 'when' })
    expect((await labels())[1]).toBe('◐ working')
    expect(await typed($, 'list')).toContain('shows while Claude works')
    await ui.press({ key: 'when' })
    expect((await labels())[1]).toBe('◉ always')

    // The band's height beside it goes down and up by a row.
    expect(await ui.find({ type: 'Text', text: '5 rows' })).toBeDefined()
    await ui.press({ key: 'taller' })
    expect(await ui.find({ type: 'Text', text: '6 rows' })).toBeDefined()
    expect(await typed($, 'list')).toContain('6 rows')
    await ui.press({ key: 'shorter' })
    expect(await typed($, 'list')).toContain('5 rows')

    // The volume beside the sound goes down and up by a step.
    await ui.press({ key: 'quieter' })
    await ui.press({ key: 'quieter' })
    expect(await ui.find({ type: 'Text', text: '35%' })).toBeDefined()
    await ui.press({ key: 'louder' })
    await ui.press({ key: 'louder' })
    expect(await typed($, 'list')).toContain('sound 55%')

    // The button opens the picker, and pressed again closes it.
    const before = { opened: opened.length, closed: closed.length }
    await ui.press({ key: 'scenes' })
    expect(opened).toHaveLength(before.opened + 1)
    expect((await labels()).at(-1)).toBe('× scenes')
    await ui.press({ key: 'scenes' })
    expect(closed).toHaveLength(before.closed + 1)
    expect(opened).toHaveLength(before.opened + 1)
    expect((await labels()).at(-1)).toBe('scenes')
    await ui.unmount()
  }

  expect(await typed($, 'hint off')).toBe('Ambient is off the hint line.')
  expect(await hintWith()).toBe('auto mode on||')
  await typed($, 'hint')
  await typed($, 'off')
  expect(await hintWith()).toBe('auto mode on||')
})

test('as a session opens, the band and its row follow the kept settings, never the defaults', async ($, on) => {
  world(on, { settings: { scene: 'lofi', when: 'working', isSoundOn: true, volume: 40 } })
  // What the engine draws when no mod does.
  on('ui.render', ($$, e) => $$.ui.resolve(e).Text({ children: 'nothing here' }))
  const bandAt = async (isWorking: boolean) => {
    const ui = await $.ui.mount({
      ...BAND,
      props: { ...BAND.props, isWorking },
      surface: 'terminal',
    })
    const isAway = (await ui.find({ type: 'Text', text: 'nothing here' })) !== undefined
    await ui.unmount()

    return !isAway
  }
  const row = async () => {
    const ui = await $.ui.mount({
      plugin: 'ambient',
      surface: 'desktop',
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: 'auto mode on' },
      viewport: { columns: 100, rows: 40 },
    })
    const labels = (await ui.findAll({ type: 'Button' })).map(button => button.text)
    const name = (await ui.find({ type: 'Text', text: '♪ lofi' })) !== undefined
    await ui.unmount()

    return { labels, name }
  }

  // Drawn before the session's start has read the store: a band kept to show
  // only while Claude works stays away at rest, and the row says what is kept.
  expect(await bandAt(false)).toBe(false)
  expect(await bandAt(true)).toBe(true)
  expect(await row()).toEqual({
    labels: ['● band', '◐ working', '-', '+', '● sound', '-', '+', 'scenes'],
    name: true,
  })

  await $.session.start(SESSION)
  expect(await bandAt(false)).toBe(false)
  expect(await bandAt(true)).toBe(true)
  expect((await row()).labels[1]).toBe('◐ working')
})

test('the row under the hint line holds the controls the person picks, and keeps them', async ($, on) => {
  const { store } = world(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', ($$, e) => $$.ui.resolve(e).Text({ children: 'the engine\'s line' }))
  const row = async () => {
    const ui = await $.ui.mount({
      plugin: 'ambient',
      surface: 'terminal',
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: 'auto mode on' },
      viewport: { columns: 100, rows: 40, isFullscreen: true },
    })
    const labels = (await ui.findAll({ type: 'Button' })).map(button => button.text)
    const texts = (await ui.findAll({ type: 'Text' })).map(text => text.text)
    await ui.unmount()

    return { labels, texts }
  }

  expect((await row()).labels).toEqual(['● band', '◉ always', '-', '+', '○ sound', '-', '+', 'scenes'])

  expect(await typed($, 'hint volume off')).toBe(
    'Ambient leaves the volume out from under the prompt.',
  )
  expect(await row()).toEqual({
    labels: ['● band', '◉ always', '-', '+', '○ sound', 'scenes'],
    texts: ["the engine's line", '♪ aquarium', '5 rows'],
  })
  expect(await typed($, 'hint name off')).toContain('leaves the scene\'s name out')
  expect(await typed($, 'hint when')).toContain('leaves when the band shows out')
  expect(await row()).toEqual({
    labels: ['● band', '-', '+', '○ sound', 'scenes'],
    texts: ["the engine's line", '5 rows'],
  })

  // The picker shows and hides them too.
  await typed($, '')
  const picker = await $.ui.mount({ ...PICKER, surface: 'terminal' })
  await picker.press({ key: 'control-band' })
  await picker.press({ key: 'control-sound' })
  await picker.press({ key: 'control-scenes' })
  await picker.press({ key: 'control-rows' })
  await picker.unmount()
  // With none of them, the row is gone and the engine's line is drawn alone.
  expect(await row()).toEqual({ labels: [], texts: ["the engine's line"] })

  expect(await typed($, 'hint volume on')).toBe('Ambient shows the volume under the prompt.')
  expect((await row()).labels).toEqual(['-', '+'])
  expect(await typed($, 'hint volume maybe')).toContain('Usage: /ambient')
  expect(await typed($, 'hint on off')).toContain('Usage: /ambient')

  // A control shown brings back the row the person had taken away.
  await typed($, 'hint off')
  expect((await row()).labels).toEqual([])
  await typed($, 'hint band on')
  expect((await row()).labels).toEqual(['● band', '-', '+'])

  // The next session opens on the same row.
  expect(store.get('settings')).toMatchObject({ controls: ['band', 'volume'], hasHint: true })
  await $.session.start(SESSION)
  expect((await row()).labels).toEqual(['● band', '-', '+'])
})

test('the fireplace, the heart monitor and the digital rain show the terminal behind them, or paint a backdrop', async ($, on) => {
  world(on)
  // True where every run of the band has a background: nothing of the
  // terminal shows through.
  const isPainted = async (scene: string) => {
    await typed($, scene)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    await ui.resize({ columns: COLUMNS, rows: ROWS })
    await $.tool.call(CALLS.read)
    await ui.advance(1500)
    const runs = await ui.findAll({ type: 'Text', in: 'band' })
    await ui.unmount()

    return runs.every(run => typeof run.props.backgroundColor === 'string')
  }

  for (const scene of ['fire', 'pulse', 'matrix']) {
    expect(await isPainted(scene)).toBe(false)
  }

  expect(await isPainted('aquarium')).toBe(true)

  expect(await typed($, 'backdrop on')).toBe(
    'Ambient paints a backdrop behind the fireplace, the heart monitor and the digital rain.',
  )

  for (const scene of ['fire', 'pulse', 'matrix', 'aquarium']) {
    expect(await isPainted(scene)).toBe(true)
  }

  expect(await typed($, 'backdrop')).toContain('shows the terminal behind')
  expect(await typed($, 'backdrop maybe')).toContain('Usage: /ambient')
})

test('the commands take the words a person tries first', async ($, on) => {
  const { clock, plays } = world(on)
  await typed($, 'fire')

  expect(await typed($, 'play')).toContain('Ambient sound is on at 55%')
  await clock.advance(400)
  expect(bedsOf(plays)).toEqual(['fire-hearth'])
  expect(await typed($, 'stop')).toBe('Ambient sound is off.')
  expect(await typed($, 'mute')).toBe('Ambient sound is off.')

  expect(await typed($, 'volume 0.2')).toContain('Ambient volume is 20%, and the sound is off')
  expect(await typed($, 'volume up')).toContain('Ambient volume is 30%')
  expect(await typed($, 'volume down')).toContain('Ambient volume is 20%')
  expect(await typed($, 'volume 1')).toContain('Ambient volume is 1%')
  expect(await typed($, 'volume loud')).toContain('0 to 100')

  expect(await typed($, 'when')).toBe('Ambient shows while Claude works.')
  expect(await typed($, 'when')).toBe('Ambient shows always.')
})
