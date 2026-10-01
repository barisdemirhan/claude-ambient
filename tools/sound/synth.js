// The sounds of claude-ambient, made from nothing but arithmetic: every bed
// and every chime is drawn here, sample by sample, from a seeded generator.
// The same file runs in the browser, where the audition page plays what it
// renders, and under bun, where build.js writes the files the mod ships.
;(function (root) {
  'use strict'

  const SR = 44100
  const TAU = Math.PI * 2
  // The length of every looping bed but lofi's, whose bars set its own.
  const BED = 24
  // A note for each kind of tool call, up a pentatonic scale: read, search,
  // edit, shell, web, agent, mcp, other. A turn's calls are a small tune.
  const DEGREES = [0, 2, 4, 7, 9, 12, 14, 16]

  const midi = note => 440 * Math.pow(2, (note - 69) / 12)
  const noteOf = (kind, base) => midi(base + (DEGREES[kind] ?? 0))

  /** A seeded generator: the same seed renders the same sound. */
  const rng = seed => {
    let state = seed >>> 0

    return () => {
      state = (state + 0x6d2b79f5) >>> 0
      let mixed = Math.imul(state ^ (state >>> 15), state | 1)
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)

      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
    }
  }

  const between = (rand, low, high) => low + rand() * (high - low)

  /** A stereo buffer; a looping one wraps what is placed past its end. */
  const stereo = (seconds, isLoop = false) => {
    const n = Math.round(seconds * SR)

    return { n, isLoop, l: new Float32Array(n), r: new Float32Array(n) }
  }

  // What two plays of a bed's file share: the next starts this long before
  // the last ends, and the one crosses over into the other.
  const OVERLAP = 2

  /**
   * The buffer a bed is drawn into. As a ring it loops on itself: what a
   * player that loops without a gap wants, the audition page's. As a file it
   * runs on past the loop by the overlap: the mod's player cannot loop
   * without a gap, so it starts the next play that much early, and what is
   * struck near the end rings out under it.
   */
  const bedOf = (seconds, asFile) => {
    const loopN = Math.round(seconds * SR)
    const n = asFile ? loopN + Math.round(OVERLAP * SR) : loopN

    return { n, loopN, isLoop: !asFile, l: new Float32Array(n), r: new Float32Array(n) }
  }

  /** Mixes a mono voice into a buffer at a time, at a gain and a pan (-1 to 1). */
  const place = (buffer, at, voice, gain = 1, pan = 0) => {
    const start = Math.round(at * SR)
    const angle = ((pan + 1) * Math.PI) / 4
    const left = gain * Math.cos(angle)
    const right = gain * Math.sin(angle)

    for (let i = 0; i < voice.length; i += 1) {
      let to = start + i

      if (buffer.isLoop) {
        to = ((to % buffer.n) + buffer.n) % buffer.n
      } else if (to < 0 || to >= buffer.n) {
        continue
      }

      buffer.l[to] += voice[i] * left
      buffer.r[to] += voice[i] * right
    }
  }

  /**
   * Adds a layer that never stops (noise, a drone) to one channel of a bed:
   * `samples` is one loop of it. In a file it fades in over the overlap and
   * out over the run past the loop, so two plays cross at an even loudness.
   */
  const layer = (buffer, channel, samples, gain = 1) => {
    const to = channel === 0 ? buffer.l : buffer.r
    const lap = buffer.n - buffer.loopN

    for (let i = 0; i < buffer.n; i += 1) {
      let weight = gain

      if (lap > 0 && i < lap) {
        weight *= Math.sin(((Math.PI / 2) * i) / lap)
      } else if (lap > 0 && i >= buffer.loopN) {
        weight *= Math.cos(((Math.PI / 2) * (i - buffer.loopN)) / lap)
      }

      to[i] += samples[i % samples.length] * weight
    }
  }

  // ── Filters ────────────────────────────────────────────────────────────

  /** A biquad over samples in place: `low`, `high` or `band` at a frequency. */
  const biquad = (samples, kind, frequency, q = 0.707) => {
    const w = (TAU * frequency) / SR
    const cos = Math.cos(w)
    const alpha = Math.sin(w) / (2 * q)
    let b0 = alpha
    let b1 = 0
    let b2 = -alpha

    if (kind === 'low') {
      b0 = (1 - cos) / 2
      b1 = 1 - cos
      b2 = (1 - cos) / 2
    } else if (kind === 'high') {
      b0 = (1 + cos) / 2
      b1 = -(1 + cos)
      b2 = (1 + cos) / 2
    }

    const a0 = 1 + alpha
    const a1 = -2 * cos
    const a2 = 1 - alpha
    let x1 = 0
    let x2 = 0
    let y1 = 0
    let y2 = 0

    for (let i = 0; i < samples.length; i += 1) {
      const x = samples[i]
      const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
      x2 = x1
      x1 = x
      y2 = y1
      y1 = y
      samples[i] = y
    }

    return samples
  }

  /**
   * A band-pass whose centre moves with time: `centreAt(i)` is the frequency
   * at a sample. What wind is made of.
   */
  const sweptBand = (samples, centreAt, q) => {
    let low = 0
    let band = 0

    for (let i = 0; i < samples.length; i += 1) {
      const f = 2 * Math.sin((Math.PI * centreAt(i)) / SR)
      low += f * band
      const high = samples[i] - low - band / q
      band += f * high
      samples[i] = band
    }

    return samples
  }

  // ── Noise ──────────────────────────────────────────────────────────────

  const white = (n, rand) => {
    const out = new Float32Array(n)

    for (let i = 0; i < n; i += 1) {
      out[i] = rand() * 2 - 1
    }

    return out
  }

  const pink = (n, rand) => {
    const out = new Float32Array(n)
    let b0 = 0
    let b1 = 0
    let b2 = 0

    for (let i = 0; i < n; i += 1) {
      const w = rand() * 2 - 1
      b0 = 0.99765 * b0 + w * 0.099046
      b1 = 0.963 * b1 + w * 0.2965164
      b2 = 0.57 * b2 + w * 1.0526913
      out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25
    }

    return out
  }

  const brown = (n, rand) => {
    const out = new Float32Array(n)
    let last = 0

    for (let i = 0; i < n; i += 1) {
      last = (last + 0.02 * (rand() * 2 - 1)) / 1.02
      out[i] = last * 3.5
    }

    return out
  }

  /** Scales samples to a loudness (root mean square) in place. */
  const level = (samples, rms) => {
    let sum = 0

    for (let i = 0; i < samples.length; i += 1) {
      sum += samples[i] * samples[i]
    }

    const now = Math.sqrt(sum / samples.length) || 1

    for (let i = 0; i < samples.length; i += 1) {
      samples[i] *= rms / now
    }

    return samples
  }

  /**
   * A stretch of shaped noise that loops without a seam: it is made a little
   * long, shaped, and its tail is faded into its head. `shape` gets the
   * samples and the index the loop starts at, so what it does in time can
   * line up with the loop.
   */
  const loopNoise = (n, make, shape) => {
    const warm = Math.round(SR * 0.25)
    const fade = Math.round(SR * 0.5)
    const raw = make(warm + n + fade)
    const shaped = shape ? shape(raw, warm) : raw
    const out = new Float32Array(n)

    for (let i = 0; i < n; i += 1) {
      const mix = i < fade ? i / fade : 1
      const tail = i < fade ? shaped[warm + n + i] : 0
      out[i] = shaped[warm + i] * mix + tail * (1 - mix)
    }

    return out
  }

  // ── Voices ─────────────────────────────────────────────────────────────

  const KALIMBA = [
    [1, 1, 1],
    [2, 0.28, 1.8],
    [3, 0.1, 2.6],
    [5.4, 0.06, 5],
  ]
  const BELL = [
    [1, 1, 1],
    [2.76, 0.32, 1.9],
    [5.4, 0.14, 3.2],
    [8.9, 0.05, 5],
  ]
  const KEYS = [
    [1, 1, 1],
    [2, 0.38, 1.7],
    [3, 0.1, 2.8],
    [4, 0.04, 4],
  ]
  const WOOD = [
    [1, 1, 1],
    [3.9, 0.3, 3],
    [9.2, 0.1, 6],
  ]

  /**
   * A struck or plucked note: partials `[multiple, loudness, how much faster
   * it dies]` over a fundamental, each ringing out on its own.
   */
  const pluck = (frequency, options = {}) => {
    const { dur = 1.2, decay = 0.3, attack = 0.004, partials = KALIMBA } = options
    const n = Math.round(dur * SR)
    const out = new Float32Array(n)

    for (const [multiple, loudness, haste] of partials) {
      if (frequency * multiple < 15000) {
        const w = (TAU * frequency * multiple) / SR
        const tau = (decay / haste) * SR

        for (let i = 0; i < n; i += 1) {
          out[i] += loudness * Math.sin(w * i) * Math.exp(-i / tau)
        }
      }
    }

    const rise = Math.max(1, Math.round(attack * SR))
    const fall = Math.min(n, Math.round(0.03 * SR))

    for (let i = 0; i < rise; i += 1) {
      out[i] *= i / rise
    }

    for (let i = 0; i < fall; i += 1) {
      out[n - 1 - i] *= i / fall
    }

    return out
  }

  /**
   * A tone that slides from one pitch to another. It rings out (`decay`) or
   * holds and lets go (`hold`), may waver (`vibrato`), and may carry
   * overtones (`harmonics`: `[multiple, loudness]`).
   */
  const glide = (from, to, dur, options = {}) => {
    const {
      attack = 0.006,
      decay,
      hold = false,
      release = 0.04,
      bend = 1,
      vibrato = 0,
      vibratoRate = 5.5,
      harmonics = [],
    } = options
    const n = Math.round(dur * SR)
    const out = new Float32Array(n)
    const rise = Math.max(1, Math.round(attack * SR))
    const fall = Math.max(1, Math.round(release * SR))
    const tau = (decay ?? dur * 0.4) * SR
    let phase = 0

    for (let i = 0; i < n; i += 1) {
      const along = Math.pow(i / n, bend)
      const waver = 1 + vibrato * Math.sin((TAU * vibratoRate * i) / SR)
      phase += (TAU * from * Math.pow(to / from, along) * waver) / SR
      let sample = Math.sin(phase)

      for (const [multiple, loudness] of harmonics) {
        sample += loudness * Math.sin(phase * multiple)
      }

      const body = hold ? Math.min(1, (n - i) / fall) : Math.exp(-i / tau)
      out[i] = sample * Math.min(1, i / rise) * body
    }

    if (!hold) {
      const end = Math.min(n, Math.round(0.01 * SR))

      for (let i = 0; i < end; i += 1) {
        out[n - 1 - i] *= i / end
      }
    }

    return out
  }

  /** A puff of noise that dies away, through a filter when one is named. */
  const burst = (rand, dur, decay, filter) => {
    const n = Math.round(dur * SR)
    const out = white(n, rand)
    const tau = decay * SR
    const rise = Math.max(1, Math.round(0.001 * SR))

    for (let i = 0; i < n; i += 1) {
      out[i] *= Math.exp(-i / tau) * Math.min(1, i / rise)
    }

    return filter ? biquad(out, filter[0], filter[1], filter[2]) : out
  }

  /** A noise that swells and ebbs once over its length: a breath, a gust. */
  const swell = (rand, dur, filter, peakAt = 0.4) => {
    const n = Math.round(dur * SR)
    const out = pink(n, rand)
    biquad(out, filter[0], filter[1], filter[2])

    for (let i = 0; i < n; i += 1) {
      const t = i / n
      const up = Math.min(1, t / peakAt)
      const down = Math.min(1, (1 - t) / (1 - peakAt))
      out[i] *= Math.pow(Math.sin((Math.PI / 2) * Math.min(up, down)), 2)
    }

    return out
  }

  const bubble = (from, to, dur) => glide(from, to, dur, { attack: 0.005, decay: dur * 0.45, bend: 0.6 })

  // A low knock. It carries overtones, so a laptop's speakers can say it.
  const thump = (from, to, dur, decay) =>
    glide(from, to, dur, { attack: 0.004, decay, bend: 0.5, harmonics: [[2, 0.4], [3, 0.15]] })

  /** A pitch moved to the nearest that fits a whole number of cycles in a bed. */
  const fitted = (frequency, seconds = BED) => Math.round(frequency * seconds) / seconds

  // ── Space ──────────────────────────────────────────────────────────────

  const COMBS = [1116, 1188, 1277, 1356, 1422, 1491]
  const ALLPASSES = [556, 441, 341]

  /**
   * A small room around a buffer. A looping buffer is played into it twice
   * and the second time is kept, so the tail of the loop rings into its head.
   */
  const reverb = (buffer, options = {}) => {
    const { mix = 0.25, size = 0.8, damp = 0.35 } = options
    const passes = buffer.isLoop ? 2 : 1
    const n = buffer.n
    const send = new Float32Array(n)

    for (let i = 0; i < n; i += 1) {
      send[i] = (buffer.l[i] + buffer.r[i]) * 0.02
    }

    for (const [channel, spread] of [[buffer.l, 0], [buffer.r, 23]]) {
      const combs = COMBS.map(length => ({ line: new Float32Array(length + spread), at: 0, kept: 0 }))
      const allpasses = ALLPASSES.map(length => ({ line: new Float32Array(length + spread), at: 0 }))
      const wet = new Float32Array(n)

      for (let pass = 0; pass < passes; pass += 1) {
        for (let i = 0; i < n; i += 1) {
          const input = send[i]
          let out = 0

          for (const comb of combs) {
            const back = comb.line[comb.at]
            comb.kept = back * (1 - damp) + comb.kept * damp
            comb.line[comb.at] = input + comb.kept * size
            comb.at = (comb.at + 1) % comb.line.length
            out += back
          }

          for (const allpass of allpasses) {
            const back = allpass.line[allpass.at]
            allpass.line[allpass.at] = out + back * 0.5
            allpass.at = (allpass.at + 1) % allpass.line.length
            out = back - out
          }

          wet[i] = out
        }
      }

      for (let i = 0; i < n; i += 1) {
        channel[i] = channel[i] * (1 - mix * 0.4) + wet[i] * mix * 3
      }
    }

    return buffer
  }

  /** Scales a buffer so its loudest sample is at a peak. */
  const normalize = (buffer, peak) => {
    let top = 0

    for (let i = 0; i < buffer.n; i += 1) {
      top = Math.max(top, Math.abs(buffer.l[i]), Math.abs(buffer.r[i]))
    }

    const gain = top > 0 ? peak / top : 1

    for (let i = 0; i < buffer.n; i += 1) {
      buffer.l[i] *= gain
      buffer.r[i] *= gain
    }

    return buffer
  }

  /** A one-shot finished: a room around it, levelled, its silent end cut. */
  const finished = (buffer, room = 0.22, peak = 0.5) => {
    reverb(buffer, { mix: room })
    normalize(buffer, peak)
    let end = buffer.n

    while (end > 1 && Math.abs(buffer.l[end - 1]) < 0.0015 && Math.abs(buffer.r[end - 1]) < 0.0015) {
      end -= 1
    }

    const n = Math.min(buffer.n, end + Math.round(0.02 * SR))

    return { n, isLoop: false, l: buffer.l.slice(0, n), r: buffer.r.slice(0, n) }
  }

  /** A bed finished: a room around it, levelled, and a file's end eased out. */
  const settled = (buffer, room, peak = 0.6) => {
    if (room !== undefined) {
      reverb(buffer, room)
    }

    normalize(buffer, peak)

    if (!buffer.isLoop) {
      const fall = Math.round(0.3 * SR)

      for (let i = 0; i < fall; i += 1) {
        buffer.l[buffer.n - 1 - i] *= i / fall
        buffer.r[buffer.n - 1 - i] *= i / fall
      }
    }

    return buffer
  }

  /** A filter over both channels of a bed; a ring is warmed on its tail. */
  const loopFilter = (buffer, kind, frequency, q) => {
    for (const channel of [buffer.l, buffer.r]) {
      const warm = buffer.isLoop ? Math.min(buffer.n, 8192) : 0
      const twice = new Float32Array(warm + buffer.n)
      twice.set(channel.subarray(buffer.n - warm), 0)
      twice.set(channel, warm)
      biquad(twice, kind, frequency, q)
      channel.set(twice.subarray(warm))
    }

    return buffer
  }

  // ── Layers shared by scenes ────────────────────────────────────────────

  /** A slow rise and fall whose period divides the bed, so it loops. */
  const tide = (i, seconds, phase = 0) => Math.sin((TAU * i) / (seconds * SR) + phase)

  /** Rain on the bed: a soft wash, a patter under it, and single drops. */
  const rain = (buffer, rand, wash, drops) => {
    for (const channel of [0, 1]) {
      const high = loopNoise(buffer.loopN, n => pink(n, rand), raw => biquad(raw, 'band', 2400, 0.45))
      const low = loopNoise(buffer.loopN, n => brown(n, rand), raw => biquad(raw, 'low', 700, 0.7))
      layer(buffer, channel, level(high, wash))
      layer(buffer, channel, level(low, wash * 0.5))
    }

    const seconds = buffer.loopN / SR

    for (let drop = 0; drop < drops * seconds; drop += 1) {
      const pitch = between(rand, 1700, 4200)
      const plip = glide(pitch, pitch * 0.72, between(rand, 0.012, 0.028), { attack: 0.001 })
      place(buffer, rand() * seconds, plip, between(rand, 0.01, 0.045), between(rand, -0.9, 0.9))
    }
  }

  /** Wind on the bed: noise through a band that wanders with the loop. */
  const wind = (buffer, rand, loudness, centre) => {
    for (const channel of [0, 1]) {
      const gust = loopNoise(
        buffer.loopN,
        n => pink(n, rand),
        (raw, start) =>
          sweptBand(raw, i => centre + centre * 0.4 * tide(i - start, 12, channel) + centre * 0.2 * tide(i - start, 8, 1), 1.1),
      )
      level(gust, loudness)

      for (let i = 0; i < gust.length; i += 1) {
        gust[i] *= 0.7 + 0.3 * tide(i, 12, 2 + channel)
      }

      layer(buffer, channel, gust)
    }
  }

  /** A bird's phrase: a few short slides of a high, quiet tone. */
  const birdsong = (buffer, rand, at, loudness) => {
    const pan = between(rand, -0.8, 0.8)
    const pitch = between(rand, 2600, 3800)
    const isFalling = rand() < 0.4
    const notes = 2 + Math.floor(rand() * 3)

    for (let note = 0; note < notes; note += 1) {
      const from = pitch * between(rand, 0.94, 1.06)
      const to = from * (isFalling ? 0.74 : 1.22)
      const chirp = glide(from, to, between(rand, 0.05, 0.11), { hold: true, attack: 0.012, release: 0.03 })
      place(buffer, at + note * between(rand, 0.13, 0.2), chirp, loudness, pan)
    }
  }

  /** A cricket: a high tone in quick pulses, in bursts, for a while. */
  const cricket = (buffer, pitch, startAt, bursts, every, loudness, pan) => {
    const chirp = new Float32Array(Math.round(0.32 * SR))

    for (let i = 0; i < chirp.length; i += 1) {
      const pulse = Math.max(0, Math.sin((TAU * 27 * i) / SR))
      const body = Math.sin((Math.PI * i) / chirp.length)
      chirp[i] = Math.sin((TAU * pitch * i) / SR) * pulse * pulse * body
    }

    for (let at = 0; at < bursts; at += 1) {
      place(buffer, startAt + at * every, chirp, loudness, pan)
    }
  }

  // ── The scenes ─────────────────────────────────────────────────────────

  const aquarium = {
    beds: {
      water(asFile) {
        const bed = bedOf(BED, asFile)
        const rand = rng(11)

        for (const channel of [0, 1]) {
          const water = loopNoise(bed.loopN, n => brown(n, rand), raw => biquad(raw, 'low', 360, 0.7))
          level(water, 0.05)

          for (let i = 0; i < water.length; i += 1) {
            water[i] *= 0.75 + 0.25 * tide(i, 8, channel * 1.3)
          }

          layer(bed, channel, water)
        }

        // Bubbles come up in little runs, never two the same.
        for (let run = 0; run < 15; run += 1) {
          const at = rand() * BED
          const pan = between(rand, -0.7, 0.7)

          for (let pop = 0; pop < 1 + Math.floor(rand() * 4); pop += 1) {
            const pitch = between(rand, 340, 880)
            place(bed, at + pop * between(rand, 0.07, 0.15), bubble(pitch, pitch * between(rand, 1.5, 2.1), between(rand, 0.05, 0.11)), between(rand, 0.07, 0.17), pan)
          }
        }

        return settled(bed, { mix: 0.3 })
      },
    },
    events: {
      call(kind) {
        const out = stereo(1.6)
        const pitch = noteOf(kind, 60)
        place(out, 0, bubble(pitch, pitch * 1.5, 0.1), 0.5)
        place(out, 0.075, bubble(pitch * 2, pitch * 3, 0.07), 0.22, 0.3)

        return finished(out, 0.28)
      },
      fail() {
        const out = stereo(2)
        place(out, 0, bubble(210, 140, 0.24), 0.5, -0.2)
        place(out, 0.3, bubble(170, 105, 0.3), 0.45, 0.2)

        return finished(out, 0.3)
      },
      turn() {
        const out = stereo(2.4)
        const rand = rng(12)

        // Feeding time: a sprinkle going up the scale.
        for (const [at, degree] of [0, 2, 4, 7, 9, 12].entries()) {
          const pitch = midi(72 + degree)
          place(out, at * 0.09, bubble(pitch, pitch * 1.4, 0.07), 0.3, between(rand, -0.5, 0.5))
        }

        return finished(out, 0.32)
      },
    },
  }

  const bonsai = {
    beds: {
      garden(asFile) {
        const bed = bedOf(BED, asFile)
        const rand = rng(21)
        wind(bed, rand, 0.015, 480)

        for (let phrase = 0; phrase < 6; phrase += 1) {
          birdsong(bed, rand, rand() * BED, between(rand, 0.03, 0.06))
        }

        // A wind chime, when the breeze finds it.
        for (let chime = 0; chime < 7; chime += 1) {
          const note = 84 + DEGREES[Math.floor(rand() * 5)]
          place(bed, rand() * BED, pluck(midi(note), { dur: 3, decay: 1.1, partials: BELL }), between(rand, 0.03, 0.06), between(rand, -0.6, 0.6))
        }

        return settled(bed, { mix: 0.32 })
      },
    },
    events: {
      call(kind) {
        const out = stereo(2)
        place(out, 0, pluck(noteOf(kind, 72), { dur: 1, decay: 0.28 }), 0.5)

        return finished(out, 0.26)
      },
      fail() {
        const out = stereo(2.4)
        // A leaf lets go: two notes down, the second drooping.
        place(out, 0, pluck(midi(79), { dur: 0.9, decay: 0.25 }), 0.4, -0.2)
        place(out, 0.22, glide(midi(76), midi(75), 0.9, { decay: 0.28, harmonics: [[2, 0.2]] }), 0.4, 0.2)

        return finished(out, 0.3)
      },
      turn() {
        const out = stereo(3)

        // New growth: three notes up, and a glint over them.
        for (const [at, note] of [72, 76, 79].entries()) {
          place(out, at * 0.11, pluck(midi(note), { dur: 1.2, decay: 0.32 }), 0.36, (at - 1) * 0.3)
        }

        place(out, 0.36, pluck(midi(96), { dur: 2, decay: 0.7, partials: BELL }), 0.14)

        return finished(out, 0.34)
      },
    },
  }

  const city = {
    beds: {
      street(asFile) {
        const bed = bedOf(BED, asFile)
        const rand = rng(31)

        for (const channel of [0, 1]) {
          const hum = loopNoise(bed.loopN, n => brown(n, rand), raw => biquad(raw, 'low', 170, 0.7))
          layer(bed, channel, level(hum, 0.05))
        }

        // Cars far off, each a swell that crosses from one side to the other.
        for (let car = 0; car < 5; car += 1) {
          const dur = between(rand, 4, 6.5)
          const pass = swell(rand, dur, ['band', between(rand, 260, 420), 0.8], 0.5)
          const from = rand() < 0.5 ? -0.8 : 0.8
          const at = rand() * BED
          const pieces = 12

          for (let piece = 0; piece < pieces; piece += 1) {
            const cut = pass.subarray(Math.floor((piece * pass.length) / pieces), Math.floor(((piece + 1) * pass.length) / pieces))
            place(bed, at + (piece * dur) / pieces, cut, 0.5, from * (1 - (2 * piece) / (pieces - 1)))
          }
        }

        place(bed, 7, pluck(midi(88), { dur: 2.4, decay: 0.8, partials: BELL }), 0.035, 0.5)
        place(bed, 19.5, pluck(midi(84), { dur: 2.4, decay: 0.8, partials: BELL }), 0.03, -0.5)

        return settled(bed, { mix: 0.25 })
      },
    },
    events: {
      call(kind) {
        const out = stereo(1.4)
        const rand = rng(32 + kind)
        // A block set in place: wood, then the note it rings.
        place(out, 0, burst(rand, 0.03, 0.006, ['band', 1800, 1.5]), 0.25)
        place(out, 0, pluck(noteOf(kind, 67), { dur: 0.5, decay: 0.09, partials: WOOD }), 0.5)

        return finished(out, 0.2)
      },
      fail() {
        const out = stereo(1.8)
        // The lights go: a tone that winds down.
        place(out, 0, glide(392, 130, 0.7, { hold: true, attack: 0.02, release: 0.4, bend: 1.6, vibrato: 0.012, vibratoRate: 9, harmonics: [[2, 0.15]] }), 0.4)

        return finished(out, 0.25)
      },
      turn() {
        const out = stereo(3.6)
        const rand = rng(33)

        // Fireworks, heard from a few streets away.
        for (const [at, pan] of [[0, -0.5], [0.55, 0.4], [1.0, 0]]) {
          place(out, at, thump(110, 55, 0.3, 0.09), 0.5, pan)
          place(out, at, burst(rand, 0.25, 0.07, ['low', 900, 0.7]), 0.3, pan)

          for (let glint = 0; glint < 7; glint += 1) {
            const note = 88 + DEGREES[Math.floor(rand() * 8)]
            place(out, at + 0.12 + glint * between(rand, 0.04, 0.09), pluck(midi(note), { dur: 0.7, decay: 0.16, partials: BELL }), between(rand, 0.04, 0.09), pan + between(rand, -0.4, 0.4))
          }
        }

        return finished(out, 0.35)
      },
    },
  }

  const stars = {
    beds: {
      night(asFile) {
        const bed = bedOf(BED, asFile)
        const rand = rng(41)

        // A drone on an open fifth, each voice breathing on its own.
        for (const [channel, cents] of [[0, -3], [1, 3]]) {
          const drone = new Float32Array(bed.loopN)

          for (const [note, period, phase] of [[45, 8, 0], [52, 12, 1.2], [57, 6, 2.5], [64, 12, 4]]) {
            const w = (TAU * fitted(midi(note) * Math.pow(2, cents / 1200))) / SR

            for (let i = 0; i < drone.length; i += 1) {
              drone[i] += Math.sin(w * i) * 0.018 * (0.6 + 0.4 * tide(i, period, phase))
            }
          }

          layer(bed, channel, drone)
        }

        cricket(bed, 4100, 1, 9, 0.9, 0.008, 0.6)
        cricket(bed, 3650, 11.5, 7, 1.1, 0.007, -0.6)
        cricket(bed, 4100, 19, 5, 0.9, 0.006, 0.5)

        for (let twinkle = 0; twinkle < 6; twinkle += 1) {
          const note = 81 + DEGREES[Math.floor(rand() * 6)]
          place(bed, rand() * BED, pluck(midi(note), { dur: 3, decay: 1, partials: BELL }), between(rand, 0.025, 0.05), between(rand, -0.7, 0.7))
        }

        return settled(bed, { mix: 0.4, size: 0.86 })
      },
    },
    events: {
      call(kind) {
        const out = stereo(2.6)
        place(out, 0, pluck(noteOf(kind, 81), { dur: 1.8, decay: 0.55, partials: BELL }), 0.5, (kind - 3.5) * 0.12)

        return finished(out, 0.4)
      },
      fail() {
        const out = stereo(2.2)
        // A star falls: a tone sliding down as it fades.
        place(out, 0, glide(1568, 520, 0.7, { attack: 0.01, decay: 0.3, bend: 0.8, vibrato: 0.01, vibratoRate: 11 }), 0.4, -0.3)
        place(out, 0.02, glide(2349, 780, 0.6, { attack: 0.01, decay: 0.22, bend: 0.8 }), 0.1, 0.3)

        return finished(out, 0.4)
      },
      turn() {
        const out = stereo(4)

        for (const [at, note] of [69, 73, 76, 81, 85].entries()) {
          place(out, at * 0.1, pluck(midi(note), { dur: 2.4, decay: 0.8, partials: BELL }), 0.3, (at - 2) * 0.25)
        }

        return finished(out, 0.45)
      },
    },
  }

  const weather = {
    beds: {
      fair(asFile) {
        const bed = bedOf(BED, asFile)
        const rand = rng(51)
        wind(bed, rand, 0.018, 520)

        for (let phrase = 0; phrase < 11; phrase += 1) {
          birdsong(bed, rand, rand() * BED, between(rand, 0.03, 0.07))
        }

        return settled(bed, { mix: 0.3 })
      },
      rain(asFile) {
        const bed = bedOf(BED, asFile)
        const rand = rng(52)
        rain(bed, rand, 0.035, 14)

        return settled(bed, { mix: 0.18 })
      },
      storm(asFile) {
        const bed = bedOf(BED, asFile)
        const rand = rng(53)
        rain(bed, rand, 0.06, 26)
        wind(bed, rand, 0.03, 380)

        // Thunder a long way off, rolling.
        for (const [at, pan] of [[5, -0.4], [17, 0.4]]) {
          const roll = level(biquad(brown(Math.round(4 * SR), rand), 'low', 110, 0.7), 0.12)

          for (let i = 0; i < roll.length; i += 1) {
            const t = i / roll.length
            roll[i] *= Math.min(1, t * 12) * Math.pow(1 - t, 1.6) * (0.6 + 0.4 * Math.sin(TAU * 3.1 * t + pan))
          }

          place(bed, at, roll, 1, pan)
        }

        return settled(bed, { mix: 0.22 })
      },
      snow(asFile) {
        // Snow makes no sound of its own: the wind, and ice on a branch.
        const bed = bedOf(BED, asFile)
        const rand = rng(55)
        wind(bed, rand, 0.024, 400)

        for (let chime = 0; chime < 4; chime += 1) {
          const note = 88 + DEGREES[Math.floor(rand() * 5)]
          place(bed, rand() * BED, pluck(midi(note), { dur: 3, decay: 1.1, partials: BELL }), between(rand, 0.02, 0.035), between(rand, -0.6, 0.6))
        }

        return settled(bed, { mix: 0.34 })
      },
    },
    events: {
      call(kind) {
        const out = stereo(1.4)
        const pitch = noteOf(kind, 79)
        // A drop off a leaf.
        place(out, 0, glide(pitch * 1.25, pitch, 0.16, { attack: 0.002, decay: 0.05, bend: 0.3 }), 0.5)
        place(out, 0.05, glide(pitch * 2, pitch * 2.4, 0.06, { attack: 0.002, decay: 0.02 }), 0.12, 0.3)

        return finished(out, 0.3)
      },
      fail() {
        const out = stereo(5)
        const rand = rng(54)
        const roll = level(biquad(brown(Math.round(3.6 * SR), rand), 'low', 130, 0.7), 0.2)

        for (let i = 0; i < roll.length; i += 1) {
          const t = i / roll.length
          roll[i] *= Math.min(1, t * 25) * Math.pow(1 - t, 1.8) * (0.65 + 0.35 * Math.sin(TAU * 4.3 * t))
        }

        place(out, 0, roll, 1)
        place(out, 0, burst(rand, 0.5, 0.12, ['low', 500, 0.7]), 0.25)

        return finished(out, 0.3, 0.55)
      },
      turn() {
        const out = stereo(4)

        // The rainbow: a harp run up the scale.
        for (const [at, degree] of [0, 2, 4, 7, 9, 12, 14, 16, 19].entries()) {
          place(out, at * 0.07, pluck(midi(72 + degree), { dur: 2, decay: 0.6, partials: KEYS }), 0.26, (at - 4) * 0.18)
        }

        return finished(out, 0.4)
      },
    },
  }

  /** One chuff of the engine. */
  const chuff = (rand, strength) =>
    burst(rand, 0.2, 0.05 + strength * 0.02, ['band', 720 + strength * 180, 0.9])

  const train = {
    beds: {
      station(asFile) {
        const bed = bedOf(BED, asFile)
        const rand = rng(62)

        // The engine at rest breathes steam, slowly.
        for (let breath = 0; breath < BED / 3; breath += 1) {
          place(bed, breath * 3, swell(rand, 2.2, ['band', 2600, 0.5], 0.35), 0.5, 0.2)
        }

        for (let tick = 0; tick < 9; tick += 1) {
          place(bed, rand() * BED, pluck(between(rand, 1900, 2600), { dur: 0.1, decay: 0.015, partials: WOOD }), between(rand, 0.02, 0.04), between(rand, -0.4, 0.6))
        }

        place(bed, 11, pluck(midi(81), { dur: 2.5, decay: 0.9, partials: BELL }), 0.03, -0.6)

        return settled(bed, { mix: 0.2 }, 0.45)
      },
      run(asFile) {
        // Twenty bars of four chuffs: CH-ch-ch-ch.
        const bar = 1.2
        const bed = bedOf(BED, asFile)
        const rand = rng(61)

        for (const channel of [0, 1]) {
          const rails = loopNoise(bed.loopN, n => pink(n, rand), raw => biquad(raw, 'low', 1300, 0.7))
          layer(bed, channel, level(rails, 0.012))
        }

        for (let beat = 0; beat < BED / (bar / 4); beat += 1) {
          const strength = [1, 0.5, 0.68, 0.5][beat % 4]
          const at = beat * (bar / 4)
          place(bed, at, chuff(rand, strength), 0.3 * strength, 0.15)

          if (beat % 4 === 0) {
            place(bed, at, thump(78, 48, 0.14, 0.05), 0.2)
          }
        }

        // The wheels over a joint in the rail, every other bar.
        for (let joint = 0; joint < BED / (bar * 2); joint += 1) {
          for (const [gap, pan] of [[0, -0.4], [0.13, 0.4]]) {
            place(bed, joint * bar * 2 + 0.6 + gap, pluck(1650, { dur: 0.08, decay: 0.012, partials: WOOD }), 0.045, pan)
          }
        }

        return settled(bed, { mix: 0.16 })
      },
    },
    events: {
      call(kind) {
        const out = stereo(1.4)
        const pitch = noteOf(kind, 74)
        // A wagon coupled: clink, clack.
        place(out, 0, pluck(pitch, { dur: 0.35, decay: 0.06, partials: WOOD }), 0.5, -0.2)
        place(out, 0.08, pluck(pitch * 0.75, { dur: 0.4, decay: 0.08, partials: WOOD }), 0.42, 0.2)

        return finished(out, 0.18)
      },
      fail() {
        const out = stereo(2)
        const rand = rng(63)
        place(out, 0, pluck(196, { dur: 0.5, decay: 0.1, partials: WOOD }), 0.4)
        place(out, 0.06, swell(rand, 0.9, ['band', 2400, 0.6], 0.15), 0.5)

        return finished(out, 0.2)
      },
      turn() {
        const out = stereo(3)
        const rand = rng(64)

        // The whistle: toot, tooot.
        for (const [at, dur] of [[0, 0.2], [0.32, 0.62]]) {
          for (const [pitch, pan] of [[587.33, -0.2], [739.99, 0.2]]) {
            place(out, at, glide(pitch * 0.985, pitch, dur, { hold: true, attack: 0.03, release: 0.07, bend: 0.2, vibrato: 0.006, harmonics: [[2, 0.18], [3, 0.07]] }), 0.3, pan)
          }

          place(out, at, swell(rand, dur, ['band', 2100, 0.8], 0.2), 0.12)
        }

        return finished(out, 0.34)
      },
    },
  }

  const life = {
    beds: {
      dish(asFile) {
        const bed = bedOf(BED, asFile)
        const rand = rng(71)
        const drone = new Float32Array(bed.loopN)

        for (const [note, period, phase] of [[48, 12, 0], [55, 8, 2]]) {
          const w = (TAU * fitted(midi(note))) / SR

          for (let i = 0; i < drone.length; i += 1) {
            drone[i] += Math.sin(w * i) * 0.016 * (0.6 + 0.4 * tide(i, period, phase))
          }
        }

        layer(bed, 0, drone)
        layer(bed, 1, drone)

        // Cells flickering on and off, one note each.
        for (let cell = 0; cell < 20; cell += 1) {
          const note = 72 + DEGREES[Math.floor(rand() * 8)]
          place(bed, rand() * BED, pluck(midi(note), { dur: 0.6, decay: 0.12 }), between(rand, 0.03, 0.07), between(rand, -0.8, 0.8))
        }

        return settled(bed, { mix: 0.35 })
      },
    },
    events: {
      call(kind) {
        const out = stereo(1.4)
        const pitch = noteOf(kind, 67)
        place(out, 0, pluck(pitch, { dur: 0.5, decay: 0.1 }), 0.5, -0.15)
        place(out, 0.09, pluck(pitch * 1.5, { dur: 0.45, decay: 0.09 }), 0.3, 0.15)

        return finished(out, 0.3)
      },
      fail() {
        const out = stereo(2)
        // A blight: two low notes that do not agree.
        place(out, 0, pluck(midi(50), { dur: 1, decay: 0.3 }), 0.4, -0.2)
        place(out, 0.05, pluck(midi(51), { dur: 1, decay: 0.3 }), 0.3, 0.2)

        return finished(out, 0.3)
      },
      turn() {
        const out = stereo(2.4)
        place(out, 0, pluck(midi(67), { dur: 1.2, decay: 0.3 }), 0.4, -0.2)
        place(out, 0.14, pluck(midi(72), { dur: 1.4, decay: 0.4 }), 0.4, 0.2)

        return finished(out, 0.32)
      },
    },
  }

  /** One heartbeat: lub, dub. */
  const heartbeat = (buffer, at, loudness) => {
    place(buffer, at, thump(62, 44, 0.16, 0.05), loudness)
    place(buffer, at + 0.27, thump(52, 38, 0.13, 0.04), loudness * 0.7)
  }

  const pulse = {
    beds: {
      rest(asFile) {
        // Fifty beats a minute: twenty in the bed.
        const bed = bedOf(BED, asFile)

        for (let beat = 0; beat < 20; beat += 1) {
          heartbeat(bed, beat * 1.2, 0.5)
        }

        return settled(bed, { mix: 0.12 }, 0.4)
      },
    },
    events: {
      call(kind) {
        const out = stereo(1.4)
        const pitch = noteOf(kind, 76)
        // The monitor's pip, over the beat it marks.
        place(out, 0, glide(pitch, pitch, 0.09, { hold: true, attack: 0.012, release: 0.05 }), 0.3)
        heartbeat(out, 0, 0.5)

        return finished(out, 0.16)
      },
      fail() {
        const out = stereo(1.6)

        // A beat out of step: two low pips, close together.
        for (const at of [0, 0.16]) {
          place(out, at, glide(330, 311, 0.1, { hold: true, attack: 0.012, release: 0.05 }), 0.3)
        }

        heartbeat(out, 0, 0.4)
        heartbeat(out, 0.2, 0.4)

        return finished(out, 0.16)
      },
      turn() {
        const out = stereo(2)
        place(out, 0, glide(659.25, 659.25, 0.14, { hold: true, attack: 0.015, release: 0.08 }), 0.3)
        place(out, 0.2, glide(880, 880, 0.3, { hold: true, attack: 0.015, release: 0.2 }), 0.3)

        return finished(out, 0.25)
      },
    },
  }

  /** One crackle of the fire: a splinter of noise at a pitch of its own. */
  const crackle = (rand, size) =>
    burst(rand, 0.004 + size * 0.03, 0.001 + size * 0.008, ['band', between(rand, 1200, 4800) / (1 + size * 2), 1.2])

  const fire = {
    beds: {
      hearth(asFile) {
        const bed = bedOf(BED, asFile)
        const rand = rng(81)

        for (const channel of [0, 1]) {
          const rumble = loopNoise(bed.loopN, n => brown(n, rand), raw => biquad(raw, 'low', 230, 0.7))
          const hiss = loopNoise(bed.loopN, n => pink(n, rand), raw => biquad(raw, 'high', 2600, 0.7))
          level(rumble, 0.03)

          for (let i = 0; i < rumble.length; i += 1) {
            rumble[i] *= 0.75 + 0.25 * tide(i, 6, channel)
          }

          layer(bed, channel, rumble)
          layer(bed, channel, level(hiss, 0.006))
        }

        // Crackles come thick and thin as the fire shifts.
        for (let made = 0; made < BED * 11; made += 1) {
          const at = rand() * BED

          if (rand() < 0.55 + 0.45 * Math.sin((TAU * at) / 12)) {
            place(bed, at, crackle(rand, rand() * 0.3), between(rand, 0.07, 0.26), between(rand, -0.5, 0.5))
          }
        }

        for (let pop = 0; pop < 14; pop += 1) {
          const at = rand() * BED
          place(bed, at, crackle(rand, between(rand, 0.6, 1)), between(rand, 0.26, 0.4), between(rand, -0.4, 0.4))
          place(bed, at, thump(140, 80, 0.06, 0.02), 0.08)
        }

        return settled(bed, { mix: 0.12 })
      },
    },
    events: {
      call(kind) {
        const out = stereo(1.6)
        const rand = rng(82 + kind)
        // A log on the fire, and the sparks it throws.
        place(out, 0, thump(noteOf(kind, 43), noteOf(kind, 43) * 0.7, 0.14, 0.045), 0.5)
        place(out, 0, burst(rand, 0.05, 0.012, ['band', 420, 1]), 0.35)

        for (let spark = 0; spark < 8; spark += 1) {
          place(out, 0.04 + rand() * 0.4, crackle(rand, rand() * 0.4), between(rand, 0.1, 0.25), between(rand, -0.5, 0.5))
        }

        return finished(out, 0.14)
      },
      fail() {
        const out = stereo(2)
        const rand = rng(83)
        const whoosh = level(sweptBand(pink(Math.round(0.9 * SR), rand), i => 300 + 1300 * Math.sin((Math.PI * i) / (0.9 * SR)), 1.4), 0.2)

        for (let i = 0; i < whoosh.length; i += 1) {
          whoosh[i] *= Math.pow(Math.sin((Math.PI * i) / whoosh.length), 2)
        }

        place(out, 0, whoosh, 1)

        return finished(out, 0.2)
      },
      turn() {
        const out = stereo(2.6)
        const rand = rng(84)

        // The fire settles: an ember shifts, a last few pops.
        place(out, 0, swell(rand, 1.2, ['low', 500, 0.7], 0.2), 0.5)

        for (const at of [0.15, 0.5, 0.95]) {
          place(out, at, crackle(rand, 0.8), 0.3, between(rand, -0.4, 0.4))
        }

        return finished(out, 0.16)
      },
    },
  }

  /** A soft digital blip: a tone with a little of a square's edge. */
  const blip = (pitch, dur) =>
    glide(pitch, pitch, dur, { hold: true, attack: 0.004, release: dur * 0.5, harmonics: [[3, 0.22], [5, 0.08]] })

  const matrix = {
    beds: {
      rain(asFile) {
        const bed = bedOf(BED, asFile)
        const rand = rng(91)

        // Two low tones a hair apart, beating once every four seconds.
        for (const [channel, pitches] of [[0, [110, 165]], [1, [110.25, 164.75]]]) {
          const drone = new Float32Array(bed.loopN)

          for (const pitch of pitches) {
            const w = (TAU * pitch) / SR

            for (let i = 0; i < drone.length; i += 1) {
              drone[i] += Math.sin(w * i) * 0.02
            }
          }

          layer(bed, channel, drone)
        }

        // Code falling: runs of blips going down the scale, with an echo.
        for (let run = 0; run < 12; run += 1) {
          const at = rand() * BED
          const pan = between(rand, -0.8, 0.8)
          const top = 5 + Math.floor(rand() * 3)

          for (let step = 0; step < 3 + Math.floor(rand() * 3); step += 1) {
            const voice = blip(midi(84 + DEGREES[Math.max(0, top - step)]), 0.045)
            place(bed, at + step * 0.085, voice, 0.05, pan)
            place(bed, at + step * 0.085 + 0.3, voice, 0.02, -pan)
          }
        }

        loopFilter(bed, 'low', 5200, 0.7)

        return settled(bed, { mix: 0.28 })
      },
    },
    events: {
      call(kind) {
        const out = stereo(1.4)

        for (let step = 0; step < 3; step += 1) {
          place(out, step * 0.07, blip(noteOf(Math.max(0, kind - step), 84), 0.05), 0.4 - step * 0.1, (step - 1) * 0.4)
        }

        return finished(out, 0.28)
      },
      fail() {
        const out = stereo(1.6)
        // A glitch: a low buzz that sags.
        const buzz = glide(116, 98, 0.32, { hold: true, attack: 0.01, release: 0.15, harmonics: [[2, 0.5], [3, 0.33], [4, 0.2], [5, 0.12]] })
        place(out, 0, biquad(buzz, 'low', 900, 0.7), 0.5)

        return finished(out, 0.22)
      },
      turn() {
        const out = stereo(3)
        const rand = rng(92)

        // Decoded: a scramble of blips that settles into a chord.
        for (let step = 0; step < 9; step += 1) {
          place(out, step * 0.045, blip(midi(79 + DEGREES[Math.floor(rand() * 8)]), 0.035), 0.16, between(rand, -0.6, 0.6))
        }

        for (const [at, note] of [72, 76, 79].entries()) {
          place(out, 0.44 + at * 0.02, pluck(midi(note), { dur: 1.6, decay: 0.5, partials: BELL }), 0.24, (at - 1) * 0.3)
        }

        return finished(out, 0.34)
      },
    },
  }

  // The lofi bed: eight bars at 72 beats a minute, ii-V-I-vi under a tune
  // of a few notes, a soft kit and a worn record.
  const BEAT = 60 / 72
  const CHORDS = [
    { bass: 38, keys: [53, 57, 60, 64] },
    { bass: 43, keys: [53, 57, 59, 64] },
    { bass: 36, keys: [52, 55, 59, 62] },
    { bass: 45, keys: [55, 59, 60, 64] },
    { bass: 38, keys: [53, 57, 60, 64] },
    { bass: 43, keys: [53, 57, 59, 64] },
    { bass: 36, keys: [52, 55, 59, 62] },
    { bass: 36, keys: [52, 55, 57, 62] },
  ]
  // The tune: the beat a note falls on, and the note.
  const TUNE = [
    [0.5, 76], [1.5, 74], [2.5, 72], [5, 69], [6.5, 71],
    [8.5, 71], [9.5, 74], [11, 67], [13.5, 69], [14.5, 72],
    [16.5, 76], [17.5, 79], [18.5, 76], [21, 71], [22.5, 74],
    [24.5, 71], [25.5, 67], [27, 64], [29, 67], [30.5, 72],
  ]

  const lofi = {
    beds: {
      tape(asFile) {
        // The page loops the eight bars; a file holds them twice, so the one
        // place two plays meet comes round half as often.
        const bars = asFile ? 16 : 8
        const bed = bedOf(BEAT * 4 * bars, asFile)
        const keys = bedOf(BEAT * 4 * bars, asFile)
        const rand = rng(101)

        for (let bar = 0; bar < bars; bar += 1) {
          const chord = CHORDS[bar % CHORDS.length]
          const at = bar * 4 * BEAT

          // The chord, strummed a little; and again, softer, late in the bar.
          for (const [hit, loudness, dur] of [[0, 0.085, 3], [2.5 * BEAT, 0.045, 1.6]]) {
            chord.keys.forEach((note, finger) => {
              for (const [cents, pan] of [[-4, -0.35], [4, 0.35]]) {
                const pitch = midi(note) * Math.pow(2, cents / 1200)
                place(keys, at + hit + finger * 0.018, pluck(pitch, { dur, decay: dur * 0.36, attack: 0.012, partials: KEYS }), loudness, pan)
              }
            })
          }

          for (const [hit, loudness] of [[0, 0.24], [1.5 * BEAT, 0.14], [2.5 * BEAT, 0.18]]) {
            place(bed, at + hit, glide(midi(chord.bass), midi(chord.bass), 0.9, { attack: 0.012, decay: 0.32, harmonics: [[2, 0.3], [3, 0.08]] }), loudness)
          }

          // The kit: kick, a rim for a snare, and hats that lean late.
          for (const hit of [0, 2.5]) {
            place(bed, at + hit * BEAT, thump(118, 46, 0.24, 0.075), 0.3)
          }

          for (const hit of [1, 3]) {
            place(bed, at + hit * BEAT, burst(rand, 0.14, 0.032, ['band', 1850, 0.8]), 0.13, 0.1)
            place(bed, at + hit * BEAT, thump(210, 170, 0.07, 0.025), 0.07, 0.1)
          }

          for (let eighth = 0; eighth < 8; eighth += 1) {
            if (rand() > 0.14) {
              const late = eighth % 2 === 1 ? 0.085 * BEAT : 0
              const loudness = (eighth % 2 === 1 ? 0.022 : 0.034) * between(rand, 0.7, 1.1)
              place(bed, at + eighth * 0.5 * BEAT + late, burst(rand, 0.03, 0.007, ['high', 6500, 0.7]), loudness, -0.25)
            }
          }
        }

        // The keys waver, as an old electric piano does: 128 times a loop.
        for (let i = 0; i < keys.n; i += 1) {
          const sway = 0.5 + 0.5 * Math.sin((TAU * 4.8 * i) / SR)
          bed.l[i] += keys.l[i] * (1 - 0.16 * sway)
          bed.r[i] += keys.r[i] * (1 - 0.16 * (1 - sway))
        }

        for (let pass = 0; pass < bars / 8; pass += 1) {
          for (const [beat, note] of TUNE) {
            const at = (pass * 32 + beat) * BEAT
            place(bed, at, pluck(midi(note), { dur: 1.6, decay: 0.42, partials: KALIMBA }), 0.075, 0.2)
            place(bed, at + 0.375 * BEAT, pluck(midi(note), { dur: 1, decay: 0.3, partials: KALIMBA }), 0.018, -0.4)
          }
        }

        // Played through something old: the top rolled off.
        loopFilter(bed, 'low', 3600, 0.7)
        reverb(bed, { mix: 0.16 })

        // And over it the record's own noise, and rain on the window.
        for (const channel of [0, 1]) {
          const hiss = loopNoise(bed.loopN, n => pink(n, rand), raw => biquad(raw, 'high', 1500, 0.7))
          layer(bed, channel, level(hiss, 0.0035))
        }

        const seconds = bed.loopN / SR

        for (let tick = 0; tick < seconds * 3; tick += 1) {
          place(bed, rand() * seconds, burst(rand, 0.003, 0.0006, ['low', 5000, 0.7]), between(rand, 0.01, 0.05), between(rand, -0.6, 0.6))
        }

        rain(bed, rand, 0.007, 3)

        return settled(bed)
      },
    },
    events: {
      call(kind) {
        const out = stereo(1)
        const rand = rng(102 + kind)
        // A key pressed: tick, and the thock under it.
        place(out, 0, burst(rand, 0.02, 0.004, ['band', 2400 + kind * 90, 1.4]), 0.3, 0.15)
        place(out, 0.004, thump(190 + kind * 8, 120, 0.05, 0.016), 0.5)

        return finished(out, 0.1)
      },
      fail() {
        const out = stereo(1.6)
        // The cat, woken: prrp?
        const prrp = glide(410, 700, 0.26, { hold: true, attack: 0.03, release: 0.09, bend: 1.4, harmonics: [[2, 0.5], [3, 0.3], [4, 0.12]] })

        for (let i = 0; i < prrp.length; i += 1) {
          prrp[i] *= 0.72 + 0.28 * Math.sin((TAU * 24 * i) / SR)
        }

        biquad(prrp, 'band', 1100, 0.8)
        place(out, 0, prrp, 1)

        return finished(out, 0.14)
      },
      turn() {
        const out = stereo(3)

        for (const [at, note] of [[0, 79], [0.16, 84]]) {
          place(out, at, pluck(midi(note), { dur: 1.8, decay: 0.55, attack: 0.01, partials: KEYS }), 0.4, at === 0 ? -0.2 : 0.2)
        }

        return finished(out, 0.3)
      },
    },
  }

  const SCENES = { aquarium, bonsai, city, stars, weather, train, life, pulse, fire, matrix, lofi }

  const api = { SR, SCENES, KINDS: DEGREES.length, OVERLAP }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }

  root.AmbientSynth = api
})(typeof globalThis !== 'undefined' ? globalThis : this)
