// Binaural-beat soundscape built with the Web Audio API.
// Modelled on a 40 Hz gamma study track: a steady pure tone in each ear whose
// frequencies differ by the target brainwave rate (heard as a beat on headphones),
// over a slow, dark pad cycling Eb -> Fm -> Bb -> Cm with nothing bright above ~1 kHz.
(function () {
  const MODES = {
    gamma: { left: 130.81, beat: 40, label: "Gamma", hz: "40 Hz", note: "focus" },
    alpha: { left: 130.81, beat: 10, label: "Alpha", hz: "10 Hz", note: "calm" },
  };

  // Chord voicings (Hz): low bass note first, then the upper voices.
  const CHORDS = [
    [77.78, 116.54, 155.56, 196.0, 233.08, 311.13],   // Eb
    [87.31, 130.81, 174.61, 207.65, 261.63, 349.23],  // Fm
    [58.27, 116.54, 174.61, 233.08, 293.66, 349.23],  // Bb
    [65.41, 98.0, 196.0, 261.63, 311.13, 392.0],      // Cm
  ];
  const CHORD_EVERY = 10;  // seconds per chord, as in the reference track
  const ATTACK = 4;
  const RELEASE = 7;       // overlaps the next chord so changes are seamless

  class Ambient {
    constructor() {
      this.ctx = null;
      this.playing = false;
      this.timers = [];
      this.chordIndex = 0;
      this.mode = "gamma";
    }

    static get MODES() { return MODES; }

    _build() {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = (this.ctx = new AC());

      this.master = ctx.createGain();
      this.master.gain.value = 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.ratio.value = 2.5;
      this.master.connect(comp).connect(ctx.destination);

      // Binaural carriers: one pure sine hard left, one hard right.
      const merger = ctx.createChannelMerger(2);
      const m = MODES[this.mode];
      this.oscL = ctx.createOscillator();
      this.oscR = ctx.createOscillator();
      this.oscL.type = this.oscR.type = "sine";
      this.oscL.frequency.value = m.left;
      this.oscR.frequency.value = m.left + m.beat;
      const gL = ctx.createGain(), gR = ctx.createGain();
      gL.gain.value = gR.gain.value = 0.12;
      this.oscL.connect(gL).connect(merger, 0, 0);
      this.oscR.connect(gR).connect(merger, 0, 1);
      merger.connect(this.master);
      this.oscL.start();
      this.oscR.start();

      // Short, soft reverb for the pad only (carriers stay dry so each ear hears one clean tone).
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this._impulse(3.5, 2.5);
      const wet = ctx.createGain();
      wet.gain.value = 0.35;
      this.reverb.connect(wet).connect(this.master);

      // Pad bus: warm lowpass, nothing piercing.
      this.pad = ctx.createBiquadFilter();
      this.pad.type = "lowpass";
      this.pad.frequency.value = 950;
      this.pad.Q.value = 0.4;
      const padGain = ctx.createGain();
      padGain.gain.value = 1;
      this.pad.connect(padGain);
      padGain.connect(this.master);
      padGain.connect(this.reverb);
    }

    _impulse(seconds, decay) {
      const ctx = this.ctx;
      const len = Math.floor(ctx.sampleRate * seconds);
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
      return buf;
    }

    _later(fn, ms) { this.timers.push(setTimeout(fn, ms)); }

    _chord() {
      if (!this.playing) return;
      const ctx = this.ctx;
      const t = ctx.currentTime + 0.05;
      const notes = CHORDS[this.chordIndex % CHORDS.length];
      this.chordIndex++;
      const hold = t + CHORD_EVERY;
      const end = hold + RELEASE;
      notes.forEach((f, i) => {
        // bass note on a soft triangle for warmth, upper voices pure sine
        const g = ctx.createGain();
        const level = i === 0 ? 0.1 : 0.05;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(level, t + ATTACK);
        g.gain.setValueAtTime(level, hold);
        g.gain.linearRampToValueAtTime(0, end);
        const o = ctx.createOscillator();
        o.type = i === 0 ? "triangle" : "sine";
        o.frequency.value = f;
        // a very slow, slight drift keeps sustained notes from sounding static
        o.detune.setValueAtTime((Math.random() - 0.5) * 6, t);
        o.connect(g);
        let out = g;
        if (ctx.createStereoPanner && i > 0) {
          const p = ctx.createStereoPanner();
          p.pan.value = (i % 2 ? -1 : 1) * 0.35;
          g.connect(p);
          out = p;
        }
        out.connect(this.pad);
        o.start(t);
        o.stop(end + 0.1);
      });
      this._later(() => this._chord(), CHORD_EVERY * 1000);
    }

    setMode(mode) {
      if (!MODES[mode]) return;
      this.mode = mode;
      if (!this.ctx) return;
      const m = MODES[mode];
      const t = this.ctx.currentTime;
      // glide smoothly to the new beat rate
      this.oscL.frequency.setTargetAtTime(m.left, t, 0.8);
      this.oscR.frequency.setTargetAtTime(m.left + m.beat, t, 0.8);
    }

    async play() {
      if (!this.ctx) this._build();
      await this.ctx.resume();
      if (this.playing) return;
      this.playing = true;
      this.setMode(this.mode);
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(1, t + 4);
      this._chord();
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
