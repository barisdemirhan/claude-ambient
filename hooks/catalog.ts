import type { AmbientFeed, AmbientSky, AmbientWorld } from '../types'

/** The kinds a tool call is sorted into: all a scene knows of a call. */
export const KINDS = [
  'read',
  'search',
  'edit',
  'shell',
  'web',
  'agent',
  'mcp',
  'other',
] as const

export type Kind = (typeof KINDS)[number]

const KIND_OF: Readonly<Record<string, Kind>> = {
  Read: 'read',
  NotebookRead: 'read',
  LS: 'read',
  Glob: 'search',
  Grep: 'search',
  ToolSearch: 'search',
  Edit: 'edit',
  MultiEdit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  Bash: 'shell',
  BashOutput: 'shell',
  KillShell: 'shell',
  Monitor: 'shell',
  WebFetch: 'web',
  WebSearch: 'web',
  Agent: 'agent',
  Task: 'agent',
  Workflow: 'agent',
  SendMessage: 'agent',
}

/** The kind of a tool, from its name alone. */
export const kindOf = (tool: string): Kind =>
  KIND_OF[tool] ?? (tool.startsWith('mcp__') ? 'mcp' : 'other')

export const KIND_COLORS: Readonly<Record<Kind, string>> = {
  read: '#42a5f5',
  search: '#26a69a',
  edit: '#ff8a65',
  shell: '#ab47bc',
  web: '#ec407a',
  agent: '#7986cb',
  mcp: '#9ccc65',
  other: '#90a4ae',
}

export const FAIL_COLOR = '#ef5350'

/** The kind at an index of the counts, `other` where the index names none. */
export const kindAt = (index: number): Kind => KINDS[index] ?? 'other'

export const SCENES = [
  {
    id: 'aquarium',
    name: 'Aquarium',
    about: 'every tool call is a fish of its kind, a failed one brings the shark',
  },
  {
    id: 'bonsai',
    name: 'Bonsai',
    about: 'grows a little every turn and lives on between sessions, failures shed leaves',
  },
  {
    id: 'city',
    name: 'Skyline',
    about: 'every edit adds a floor, by the end of the day there is a skyline',
  },
  {
    id: 'stars',
    name: 'Stars',
    about: 'every tool call is a star, every turn a constellation',
  },
  {
    id: 'weather',
    name: 'Weather',
    about: 'failures gather a storm, a clean run brings the sun back',
  },
  {
    id: 'train',
    name: 'Train',
    about: 'every tool call couples a wagon, the train pulls in when the turn ends',
  },
  {
    id: 'life',
    name: 'Life',
    about: "Conway's Game of Life, seeded by the tool calls",
  },
  {
    id: 'pulse',
    name: 'Pulse',
    about: 'the heartbeat of the session, every tool call a beat',
  },
  {
    id: 'fire',
    name: 'Fireplace',
    about: 'burns higher while Claude works',
  },
  {
    id: 'matrix',
    name: 'Matrix',
    about: 'digital rain',
  },
  {
    id: 'lofi',
    name: 'Lofi',
    about: 'a rainy window, a desk and a sleeping cat',
  },
] as const

export type SceneId = (typeof SCENES)[number]['id']

/**
 * Everything a scene draws from, as the band's props: the scene picked,
 * whether Claude works now, the session's counts, what lives on between
 * sessions, and the hour and month on the person's clock.
 */
export type Feed = AmbientFeed &
  AmbientWorld & {
    scene: string
    isWorking: boolean
    hour: number
    month: number
    // The sky over the place the person named, and the place's name; null
    // and empty when they named none.
    sky: AmbientSky | null
    place: string
  }
