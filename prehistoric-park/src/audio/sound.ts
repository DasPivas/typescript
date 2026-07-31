/**
 * Звук целиком синтезируется в WebAudio — ни одного файла в репозитории.
 * Первобытный набор: барабан, бас и дудка по пентатонике плюс короткие эффекты.
 */

export type Sfx =
  | 'click'
  | 'build'
  | 'coin'
  | 'break'
  | 'ride'
  | 'error'
  | 'win'
  | 'lose';

const SFX_KEY = 'pp.sound.v1';

/** Пентатоника — на ней трудно сыграть фальшиво. */
const SCALE = [0, 3, 5, 7, 10];
/** Восемь тактов мелодии: индекс ступени или -1 (пауза). */
const MELODY = [0, -1, 2, 1, 0, 4, -1, 2, 3, -1, 1, 0, 2, -1, 4, 3];

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer: number | null = null;
  private nextNote = 0;
  private step = 0;
  private lastCoin = 0;

  enabled = false;
  /** Пользователь уже ответил на вопрос про звук. */
  asked = false;

  constructor() {
    const saved = localStorage.getItem(SFX_KEY);
    if (saved !== null) {
      this.enabled = saved === '1';
      this.asked = true;
    }
  }

  /** Создаём контекст только по жесту пользователя — иначе iOS его не пустит. */
  unlock(): void {
    if (!this.enabled || this.ctx) return;
    type WithWebkit = typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (globalThis as WithWebkit).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.34;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.master);

    const len = Math.floor(this.ctx.sampleRate * 0.5);
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.startMusic();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.asked = true;
    localStorage.setItem(SFX_KEY, on ? '1' : '0');
    if (!on) {
      this.stopMusic();
      void this.ctx?.suspend();
    } else if (this.ctx) {
      void this.ctx.resume();
      this.startMusic();
    } else {
      this.unlock();
    }
  }

  // ───────────── эффекты ─────────────

  play(name: Sfx): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || !this.master) return;
    const t = ctx.currentTime;
    switch (name) {
      case 'click':
        this.blip(660, t, 0.05, 'square', 0.18);
        break;
      case 'build':
        this.blip(190, t, 0.13, 'triangle', 0.32, 90);
        this.burst(t, 0.09, 900, 0.2);
        break;
      case 'coin':
        // Касса звенит часто — не чаще пяти раз в секунду.
        if (t - this.lastCoin < 0.2) return;
        this.lastCoin = t;
        this.blip(988, t, 0.06, 'sine', 0.16);
        this.blip(1319, t + 0.05, 0.09, 'sine', 0.14);
        break;
      case 'break':
        this.burst(t, 0.45, 1600, 0.3, 200);
        this.blip(120, t, 0.3, 'sawtooth', 0.2, 55);
        break;
      case 'ride':
        this.burst(t, 0.34, 500, 0.18, 2200);
        break;
      case 'error':
        this.blip(220, t, 0.16, 'sawtooth', 0.2, 150);
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) =>
          this.blip(f, t + i * 0.11, 0.2, 'triangle', 0.22),
        );
        break;
      case 'lose':
        [392, 330, 262, 196].forEach((f, i) =>
          this.blip(f, t + i * 0.14, 0.26, 'triangle', 0.22),
        );
        break;
    }
  }

  private blip(
    freq: number,
    at: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    toFreq?: number,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (toFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, toFreq), at + dur);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(vol, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain).connect(this.master!);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  /** Шумовой всплеск через полосовой фильтр — удары, поломки, свист горок. */
  private burst(at: number, dur: number, freq: number, vol: number, toFreq?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(freq, at);
    if (toFreq) filter.frequency.exponentialRampToValueAtTime(Math.max(60, toFreq), at + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(at);
    src.stop(at + dur);
  }

  // ───────────── музыка ─────────────

  private startMusic(): void {
    if (!this.ctx || this.timer !== null || !this.enabled) return;
    this.nextNote = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 40);
  }

  private stopMusic(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Планировщик с запасом: докладываем ноты на 150 мс вперёд. */
  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain) return;
    const beat = 0.34;
    while (this.nextNote < ctx.currentTime + 0.15) {
      const s = this.step % 16;
      // Барабан на каждую долю, погромче на сильную.
      this.drum(this.nextNote, s % 4 === 0 ? 0.5 : 0.22);
      // Бас на первую и третью.
      if (s % 4 === 0) this.tone(98, this.nextNote, beat * 1.6, 'triangle', 0.5);
      const m = MELODY[s];
      if (m >= 0) {
        const semi = SCALE[m % SCALE.length] + 12 * Math.floor(m / SCALE.length);
        this.tone(392 * Math.pow(2, semi / 12), this.nextNote, beat * 0.85, 'square', 0.16);
      }
      this.nextNote += beat;
      this.step++;
    }
  }

  private tone(freq: number, at: number, dur: number, type: OscillatorType, vol: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(vol, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain).connect(this.musicGain!);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  private drum(at: number, vol: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, at);
    filter.frequency.exponentialRampToValueAtTime(90, at + 0.16);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
    src.connect(filter).connect(gain).connect(this.musicGain!);
    src.start(at);
    src.stop(at + 0.2);
  }
}

export const sound = new Sound();
