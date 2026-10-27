// Generative meditation soundscape built with the Web Audio API.
// A warm drone, soft "wind/ocean" noise and slow random chimes through a reverb.
(function () {
  const PENTATONIC = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33]; // A minor pentatonic

  class Ambient {
    constructor() {
      this.ctx = null;
      this.playing = false;
      this.chimeTimer = null;
    }

    _build() {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = (this.ctx = new AC());

      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(ctx.destination);

      // Reverb from a generated impulse response
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this._impulse(5, 2.6);
      const wet = ctx.createGain();
      wet.gain.value = 0.55;
      this.reverb.connect(wet).connect(this.master);

      // Drone: two detuned voice pairs through a lowpass with slow movement
      const droneFilter = ctx.createBiquadFilter();
      droneFilter.type = "lowpass";
      droneFilter.frequency.value = 520;
      droneFilter.Q.value = 0.4;
      const droneGain = ctx.createGain();
      droneGain.gain.value = 0.11;
      droneFilter.connect(droneGain);
      droneGain.connect(this.master);
      droneGain.connect(this.reverb);
      [110, 110.4, 164.81, 165.2].forEach((f, i) => {
        const o = ctx.createOscillator();
        o.type = i % 2 ? "triangle" : "sine";
        o.frequency.value = f;
        o.connect(droneFilter);
        o.start();
      });
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05;
      const lfoAmt = ctx.createGain();
      lfoAmt.gain.value = 180;
      lfo.connect(lfoAmt).connect(droneFilter.frequency);
      lfo.start();

      // Soft brown noise that swells like distant waves
      const noise = ctx.createBufferSource();
      noise.buffer = this._brownNoise(8);
      noise.loop = true;
      const nFilter = ctx.createBiquadFilter();
      nFilter.type = "lowpass";
      nFilter.frequency.value = 420;
      const nGain = ctx.createGain();
      nGain.gain.value = 0.05;
      const swell = ctx.createOscillator();
      swell.frequency.value = 0.09;
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
      // crossfade the loop seam
      const fade = Math.floor(ctx.sampleRate * 0.5);
      for (let i = 0; i < fade; i++) {
        const k = i / fade;
        d[len - fade + i] = d[len - fade + i] * (1 - k) + d[i] * k;
      }
      return buf;
    }

    _chime() {
      if (!this.playing) return;
      const ctx = this.ctx;
      const t = ctx.currentTime;
      const f = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)];
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.03, t + 0.9);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 7);
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      [1, 2.0].forEach((mult, i) => {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = f * mult;
        const og = ctx.createGain();
        og.gain.value = i ? 0.18 : 1;
        o.connect(og).connect(g);
        o.start(t);
        o.stop(t + 7.2);
      });
      if (pan) {
        pan.pan.value = Math.random() * 1.2 - 0.6;
        g.connect(pan);
        pan.connect(this.reverb);
        pan.connect(this.master);
      } else {
        g.connect(this.reverb);
        g.connect(this.master);
      }
      this.chimeTimer = setTimeout(() => this._chime(), 2500 + Math.random() * 4500);
    }

    async play() {
      if (!this.ctx) this._build();
      await this.ctx.resume();
      this.playing = true;
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(0.8, t + 3);
      clearTimeout(this.chimeTimer);
      this.chimeTimer = setTimeout(() => this._chime(), 1200);
    }

    pause() {
      if (!this.ctx) return;
      this.playing = false;
      clearTimeout(this.chimeTimer);
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(0, t + 1.2);
      setTimeout(() => { if (!this.playing) this.ctx.suspend(); }, 1300);
    }
  }

  window.Ambient = Ambient;
})();
