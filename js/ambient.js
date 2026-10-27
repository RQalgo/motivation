// Binaural-beat soundscape built with the Web Audio API.
// Modelled on a 40 Hz gamma study track: a steady pure tone in each ear whose
// frequencies differ by the target brainwave rate (heard as a beat on headphones),
// over a slow, dark pad cycling Eb -> Fm -> Bb -> Cm.
//
// Smoothness choices:
// - The pad is three sustained sine voices that never re-attack; at each chord
//   change they glide a step or two to the next note (voice-led, so most moves
//   are 1-2 semitones and some notes don't move at all).
// - Chords last 20 s; glides take ~5 s.
// - The bass note breathes out before the next one breathes in, so two bass
//   tones never sound together.
// - No random detune, no noise, a very soft dark reverb.
(function () {
  const MODES = {
    gamma: { left: 130.81, beat: 40, label: "Gamma", hz: "40 Hz", note: "focus" },
    alpha: { left: 130.81, beat: 10, label: "Alpha", hz: "10 Hz", note: "calm" },
  };

  // Voice-led progression: [bass, voice1, voice2, voice3] in Hz
  const CHORDS = [
    [77.78, 196.0, 233.08, 311.13],   // Eb:  Eb2 | G3  Bb3 Eb4
    [87.31, 207.65, 261.63, 349.23],  // Fm:  F2  | Ab3 C4  F4
    [58.27, 233.08, 293.66, 349.23],  // Bb:  Bb1 | Bb3 D4  F4
    [65.41, 196.0, 261.63, 311.13],   // Cm:  C2  | G3  C4  Eb4
  ];
  const CHORD_SECONDS = 20;
  const GLIDE = 1.6;          // time constant: ~5 s to settle on the new note
  const BASS_IN = 6, BASS_OUT = 6;
  const VOICE_LEVEL = 0.042;
  const BASS_LEVEL = 0.09;
  const CARRIER_LEVEL = 0.09;

  class Ambient {
    constructor() {
      this.ctx = null;
      this.playing = false;
      this.timers = [];
      this.chordIndex = 0;
      this.mode = "gamma";
      this.bass = null;
    }

    static get MODES() { return MODES; }

    _build() {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = (this.ctx = new AC());

      this.master = ctx.createGain();
      this.master.gain.value = 0;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.ratio.value = 2;
      comp.attack.value = 0.1;
      comp.release.value = 1;
      this.master.connect(comp).connect(ctx.destination);

      // Binaural carriers: one pure sine hard left, one hard right, kept dry.
      const merger = ctx.createChannelMerger(2);
      const m = MODES[this.mode];
      this.oscL = ctx.createOscillator();
      this.oscR = ctx.createOscillator();
      this.oscL.type = this.oscR.type = "sine";
      this.oscL.frequency.value = m.left;
      this.oscR.frequency.value = m.left + m.beat;
      const gL = ctx.createGain(), gR = ctx.createGain();
      gL.gain.value = gR.gain.value = CARRIER_LEVEL;
      this.oscL.connect(gL).connect(merger, 0, 0);
      this.oscR.connect(gR).connect(merger, 0, 1);
      merger.connect(this.master);
      this.oscL.start();
      this.oscR.start();

      // Pad bus: warm lowpass, centred, with a very soft dark reverb.
      this.pad = ctx.createBiquadFilter();
      this.pad.type = "lowpass";
      this.pad.frequency.value = 800;
      this.pad.Q.value = 0.3;
      this.pad.connect(this.master);

      const reverb = ctx.createConvolver();
      reverb.buffer = this._impulse(4, 3);
      const verbTone = ctx.createBiquadFilter();
      verbTone.type = "lowpass";
      verbTone.frequency.value = 600;
      const wet = ctx.createGain();
      wet.gain.value = 0.18;
      this.pad.connect(reverb);
      reverb.connect(verbTone).connect(wet).connect(this.master);

      // Three sustained upper voices that glide between chord tones.
      const first = CHORDS[0];
      this.voices = [1, 2, 3].map((k) => {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = first[k];
        const g = ctx.createGain();
        g.gain.value = VOICE_LEVEL * (k === 3 ? 0.75 : 1); // top voice a little softer
        o.connect(g).connect(this.pad);
        o.start();
        return o;
      });
    }

    _impulse(seconds, decay) {
      const ctx = this.ctx;
      const len = Math.floor(ctx.sampleRate * seconds);
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        let last = 0;
        for (let i = 0; i < len; i++) {
          // smoothed noise gives a darker, less hissy tail
          last = last * 0.6 + (Math.random() * 2 - 1) * 0.4;
          d[i] = last * Math.pow(1 - i / len, decay);
        }
      }
      return buf;
    }

    _later(fn, ms) { this.timers.push(setTimeout(fn, ms)); }

    _startBass(freq, t) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(BASS_LEVEL, t + BASS_IN);
      o.connect(g).connect(this.pad);
      o.start(t);
      return { o, g };
    }

    _stopBass(b, t) {
      if (!b) return;
      b.g.gain.cancelScheduledValues(t);
      b.g.gain.setValueAtTime(b.g.gain.value, t);
      b.g.gain.linearRampToValueAtTime(0, t + BASS_OUT);
      b.o.stop(t + BASS_OUT + 0.1);
    }

    _chord(first) {
      if (!this.playing) return;
      const ctx = this.ctx;
      const t = ctx.currentTime + 0.05;
      const notes = CHORDS[this.chordIndex % CHORDS.length];
      this.chordIndex++;

      // upper voices glide (or jump silently on the very first chord)
      this.voices.forEach((o, i) => {
        const f = notes[i + 1];
        o.frequency.cancelScheduledValues(t);
        if (first) o.frequency.setValueAtTime(f, t);
        else o.frequency.setTargetAtTime(f, t, GLIDE);
      });

      // bass: old note breathes out, new one breathes in a little later
      const old = this.bass;
      this._stopBass(old, t);
      this.bass = this._startBass(notes[0], t + (old ? BASS_OUT * 0.6 : 0));

      this._later(() => this._chord(false), CHORD_SECONDS * 1000);
    }

    setMode(mode) {
      if (!MODES[mode]) return;
      this.mode = mode;
      if (!this.ctx) return;
      const m = MODES[mode];
      const t = this.ctx.currentTime;
      this.oscL.frequency.setTargetAtTime(m.left, t, 1.2);
      this.oscR.frequency.setTargetAtTime(m.left + m.beat, t, 1.2);
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
      this.master.gain.linearRampToValueAtTime(1, t + 5);
      this._chord(this.chordIndex === 0);
    }

    pause() {
      if (!this.ctx) return;
      this.playing = false;
      this.timers.forEach(clearTimeout);
      this.timers = [];
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(0, t + 2);
      this._later(() => { if (!this.playing) this.ctx.suspend(); }, 2100);
    }
  }

  window.Ambient = Ambient;
})();
