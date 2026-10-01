// Renders every sound of tools/sound/synth.js into sounds/, as the mod plays
// them, writes hooks/beds.ts from what it rendered, and checks its own work:
//   bun tools/sound/build.js
// Needs macOS: afconvert makes the files afplay will play.
const { execFileSync } = require('node:child_process')
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { SR, SCENES, KINDS, OVERLAP } = require('./synth.js')

const ROOT = join(__dirname, '..', '..')
const SOUNDS = join(ROOT, 'sounds')
const BED_BITS = 112000
const EVENT_BITS = 96000
// How far off its mark the next play of a bed may start, in seconds: what
// the mod's clock and the player's start were measured to wander by.
const JITTERS = [-0.08, 0, 0.08]

const wav = ({ n, l, r }) => {
  const out = Buffer.alloc(44 + n * 4)
  out.write('RIFF', 0)
  out.writeUInt32LE(36 + n * 4, 4)
  out.write('WAVEfmt ', 8)
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)
  out.writeUInt16LE(2, 22)
  out.writeUInt32LE(SR, 24)
  out.writeUInt32LE(SR * 4, 28)
  out.writeUInt16LE(4, 32)
  out.writeUInt16LE(16, 34)
  out.write('data', 36)
  out.writeUInt32LE(n * 4, 40)

  for (let i = 0; i < n; i += 1) {
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[i])) * 32767), 44 + i * 4)
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[i])) * 32767), 46 + i * 4)
  }

  return out
}

/** The left channel of a WAV file, as afconvert wrote it back. */
const leftOf = path => {
  const file = readFileSync(path)
  let at = 12

  while (file.toString('ascii', at, at + 4) !== 'data') {
    at += 8 + file.readUInt32LE(at + 4)
  }

  const n = Math.floor(file.readUInt32LE(at + 4) / 4)
  const out = new Float32Array(n)

  for (let i = 0; i < n; i += 1) {
    out[i] = file.readInt16LE(at + 8 + i * 4) / 32768
  }

  return out
}

const work = mkdtempSync(join(tmpdir(), 'ambient-sounds-'))

/** Writes a sound as an AAC file, and answers it as the player will hear it. */
const encoded = (sound, name, bits) => {
  const source = join(work, `${name}.wav`)
  const target = join(SOUNDS, `${name}.m4a`)
  const back = join(work, `${name}.back.wav`)
  writeFileSync(source, wav(sound))
  execFileSync('afconvert', [source, target, '-f', 'm4af', '-d', 'aac', '-s', '2', '-b', String(bits), '-q', '127'])
  execFileSync('afconvert', [target, back, '-f', 'WAVE', '-d', 'LEI16'])

  return { heard: leftOf(back), bytes: readFileSync(target).length }
}

const rmsOf = (samples, from, to) => {
  let sum = 0

  for (let i = from; i < to; i += 1) {
    const sample = samples[i] ?? 0
    sum += sample * sample
  }

  return Math.sqrt(sum / Math.max(1, to - from))
}

/**
 * How well two plays of a bed's file meet: the file is laid over itself one
 * loop on and its loudness around the meeting is set beside the ring's,
 * which loops with no meeting at all. In decibels, the quietest and the
 * loudest second: near zero is a join not heard. A bed of single strokes
 * (a heartbeat, a chuff) reads wide when the second play is early or late,
 * since a stroke then falls in another second; on its mark it must not.
 */
const rangeOf = (heard, ring, loopN, jitter) => {
  const span = SR
  const shift = loopN + Math.round(jitter * SR)
  let low = 0
  let high = 0

  for (let from = loopN - 3 * span; from < loopN + 3 * span; from += span / 4) {
    let mixed = 0
    let whole = 0

    for (let i = from; i < from + span; i += 1) {
      const first = i < heard.length ? heard[i] : 0
      const second = i >= shift ? heard[i - shift] : 0
      mixed += (first + second) ** 2
      whole += ring.l[i % ring.n] ** 2
    }

    const db = 10 * Math.log10((mixed + 1e-9) / (whole + 1e-9))
    low = Math.min(low, db)
    high = Math.max(high, db)
  }

  return `${low.toFixed(1)}..+${high.toFixed(1)}`
}

const joined = (heard, ring, loopN) => {
  const off = JITTERS.filter(jitter => jitter !== 0).map(jitter => rangeOf(heard, ring, loopN, jitter))

  return `join on its mark ${rangeOf(heard, ring, loopN, 0)} dB, off it ${off.join(' and ')} dB`
}

const db = value => (20 * Math.log10(value || 1e-9)).toFixed(1).padStart(6)

rmSync(SOUNDS, { recursive: true, force: true })
mkdirSync(SOUNDS, { recursive: true })
const beds = {}
let total = 0
let files = 0

for (const [scene, sounds] of Object.entries(SCENES)) {
  beds[scene] = {}

  for (const [name, make] of Object.entries(sounds.beds)) {
    const ring = make(false)
    const file = make(true)
    const seconds = file.loopN / SR
    const { heard, bytes } = encoded(file, `${scene}-${name}`, BED_BITS)
    const drift = Math.abs(heard.length - file.n)
    beds[scene][name] = Number(seconds.toFixed(4))
    total += bytes
    files += 1
    console.log(
      `${`${scene}-${name}`.padEnd(16)} loop ${seconds.toFixed(2).padStart(5)}s + ${OVERLAP}s  rms ${db(rmsOf(heard, 0, heard.length))} dB  ${joined(heard, ring, file.loopN)}  ${Math.round(bytes / 1024)} KB${drift > 64 ? `  LENGTH OFF BY ${drift}` : ''}`,
    )
  }

  for (const [name, make] of Object.entries(sounds.events)) {
    for (let kind = 0; kind < (name === 'call' ? KINDS : 1); kind += 1) {
      const sound = make(kind)
      const file = name === 'call' ? `${scene}-call-${kind}` : `${scene}-${name}`
      const { heard, bytes } = encoded(sound, file, EVENT_BITS)
      total += bytes
      files += 1

      if (!heard.every(Number.isFinite) || rmsOf(heard, 0, heard.length) < 0.005) {
        console.log(`${file}: SILENT OR BROKEN`)
      }
    }
  }
}

const table = Object.entries(beds)
  .map(([scene, named]) => `  ${scene}: { ${Object.entries(named).map(([name, seconds]) => `${name}: ${seconds}`).join(', ')} },`)
  .join('\n')
writeFileSync(
  join(ROOT, 'hooks', 'beds.ts'),
  `// Written by tools/sound/build.js from what it rendered; not by hand.
// The beds each scene has, the first the one it plays when it says no other,
// and the seconds from one play of a bed's file to the next: the file runs
// ${OVERLAP} seconds longer, and the two plays cross over.
export const BEDS = {
${table}
} as const

export const BED_OVERLAP = ${OVERLAP}
`,
)
rmSync(work, { recursive: true, force: true })
console.log(`${files} files, ${(total / 1024 / 1024).toFixed(1)} MB in sounds/`)
