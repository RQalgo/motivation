// Generative meditation soundscape built with the Web Audio API.
// Slow, soft chord swells (no constant tone), gentle ocean-like noise,
// and the occasional quiet bell, all through a long reverb.
(function () {
  // Warm, unresolved chords that flow into each other (Hz)
  const CHORDS = [
    [110.0, 164.81, 246.94, 261.63, 329.63],   // Am(add9)
    [87.31, 130.81, 220.0, 261.63, 329.63],    // Fmaj7
    [130.81, 196.0, 246.94, 329.63, 392.0],    // Cmaj7
    [98.0, 146.83, 246.94, 293.66, 329.63],    // G6
  ];
  const BELLS = [523.25, 587.33, 659.25, 783.99, 880.0]; // C D E G A, high and soft
  const CHORD_EVERY = 11;   // seconds between chord starts
  const CHORD_ATTACK = 6;   // slow fade in
  const CHORD_RELEASE = 9;  // long fade out, overlapping the next chord

  class Ambient {
    constructor() {
      this.ctx = null;
      this.playing = false;
      this.timers = [];
      this.chordIndex = 0;
    }

    _build() {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = (this.ctx = new AC());

      this.master = ctx.createGain();
      this.master.gain.value = 0;
      // gentle compression keeps swells from ever getting loud
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -24;
      comp.ratio.value = 3;
      this.master.connect(comp).connect(ctx.destination);

      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this._impulse(6, 2.2);
      const wet = ctx.createGain();
      wet.gain.value = 0.7;
      this.reverb.connect(wet).connect(this.master);

      // Pad bus: dark lowpass so nothing is piercing
      this.pad = ctx.createBiquadFilter();
      this.pad.type = "lowpass";
      this.pad.frequency.value = 900;
      this.pad.Q.value = 0.3;
      const padGain = ctx.createGain();
      padGain.gain.value = 1.0;
      this.pad.connect(padGain);
      padGain.connect(this.master);
      padGain.connect(this.reverb);

      // Soft brown noise that swells slowly, like distant waves
      const noise = ctx.createBufferSource();
      noise.buffer = this._brownNoise(10);
      noise.loop = true;
      const nFilter = ctx.createBiquadFilter();
      nFilter.type = "lowpass";
      nFilter.frequency.value = 500;
      const nGain = ctx.createGain();
      nGain.gain.value = 0.045;
      const swell = ctx.createOscillator();
      swell.frequency.value = 0.07; // one wave every ~14s
      const swellAmt = ctx.createGain();
      swellAmt.gain.value = 0.035;
      swell.connect(swellAmt).connect(nGain.gain);
      noise.connect(nFilter).connect(nGain).connect(this.master);
      noise.start();
      swell.start();
    }

    _impulse(seconds, decay) {
      const ctx = this.ctx;
      const len = ctx.sampleRate * seconds;
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
      return buf;
    }

    _brownNoise(seconds) {
      const ctx = this.ctx;
      const len = ctx.sampleRate * seconds;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
      const fade = Math.floor(ctx.sampleRate * 0.5); // crossfade the loop seam
      for (let i = 0; i < fade; i++) {
        const k = i / fade;
        d[len - fade + i] = d[len - fade + i] * (1 - k) + d[i] * k;
      }
      return buf;
    }

    _later(fn, ms) { this.timers.push(setTimeout(fn, ms)); }

    _chord() {
      if (!this.playing) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const notes = CHORDS[this.chordIndex % CHORDS.length];
      this.chordIndex++;
      const end = t + CHORD_ATTACK + (CHORD_EVERY - CHORD_ATTACK) + CHORD_RELEASE;
      notes.forEach((f, i) => {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = f;
        const g = ctx.createGain();
        // lower notes a little louder, upper notes quieter
        const level = (i === 0 ? 0.05 : 0.03) * (1 - i * 0.08);
        // stagger the entries slightly so the chord blooms rather than starts
        const start = t + i * 0.6;
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(level, start + CHORD_ATTACK);
        g.gain.setValueAtTime(level, t + CHORD_EVERY);
        g.gain.linearRampToValueAtTime(0, end);
        let node = g;
        if (ctx.createStereoPanner) {
          const p = ctx.createStereoPanner();
          p.pan.value = (i / (notes.length - 1)) * 0.8 - 0.4;
          g.connect(p);
          node = p;
        }
        o.connect(g);
        node.connect(this.pad);
        o.start(start);
        o.stop(end + 0.1);
      });
      this._later(() => this._chord(), CHORD_EVERY * 1000);
    }

    _bell() {
      if (!this.playing) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const f = BELLS[Math.floor(Math.random() * BELLS.length)];
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.018, t + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 8);
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      o.connect(g);
      g.connect(this.reverb); // mostly reverb: distant, not in your ear
      o.start(t);
      o.stop(t + 8.2);
      this._later(() => this._bell(), 9000 + Math.random() * 12000);
    }

    async play() {
      if (!this.ctx) this._build();
      await this.ctx.resume();
      if (this.playing) return;
      this.playing = true;
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(1.4, t + 4);
      this._chord();
      this._later(() => this._bell(), 6000);
    }

    pause() {
      if (!this.ctx) return;
      this.playing = false;
      this.timers.forEach(clearTimeout);
      this.timers = [];
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(0, t + 1.5);
      this._later(() => { if (!this.playing) this.ctx.suspend(); }, 1600);
    }
  }

  window.Ambient = Ambient;
})();
