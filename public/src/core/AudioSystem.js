/**
 * Pure Web Audio API procedural sound synthesizer (zero external audio files).
 * Generates crisp retro-voxel footsteps, mining taps, block breaks, pickups,
 * combat hits, eating crunches, and crafting chimes.
 */
export class AudioSystem {
    constructor() {
        this.ctx = null;
        this.muted = false;
        this.masterGain = null;
        this._noiseBuffer = null;
    }

    unlock() {
        if (typeof window === 'undefined') return;
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            this.ctx = new AudioCtx();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = this.muted ? 0 : 0.32;
            this.masterGain.connect(this.ctx.destination);
            this._noiseBuffer = this._createNoiseBuffer(this.ctx);
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }
    }

    toggleMute() {
        this.muted = !this.muted;
        if (this.masterGain && this.ctx) {
            this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.32, this.ctx.currentTime, 0.02);
        }
        return this.muted;
    }

    setMuted(muted) {
        this.muted = !!muted;
        if (this.masterGain && this.ctx) {
            this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.32, this.ctx.currentTime, 0.02);
        }
    }

    _canPlay() {
        if (this.muted || !this.ctx || this.ctx.state !== 'running') return false;
        return true;
    }

    _createNoiseBuffer(ctx) {
        const length = Math.floor(ctx.sampleRate * 0.4);
        const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        return buffer;
    }

    _playTone(freqStart, freqEnd, duration, type = 'triangle', gainPeak = 0.25, delay = 0) {
        if (!this._canPlay()) return;
        const now = this.ctx.currentTime + delay;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freqStart, now);
        if (freqEnd !== freqStart) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);
        }
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(gainPeak, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(now);
        osc.stop(now + duration + 0.02);
    }

    _playNoise(duration, filterFreq, filterType = 'bandpass', gainPeak = 0.2, delay = 0) {
        if (!this._canPlay() || !this._noiseBuffer) return;
        const now = this.ctx.currentTime + delay;
        const src = this.ctx.createBufferSource();
        src.buffer = this._noiseBuffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = filterType;
        filter.frequency.setValueAtTime(filterFreq, now);
        filter.Q.setValueAtTime(1.4, now);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(gainPeak, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        src.connect(filter);
        filter.connect(gain);
        gain.connect(this.masterGain);
        src.start(now);
        src.stop(now + duration + 0.02);
    }

    playStep(inWater = false) {
        if (inWater) {
            this._playNoise(0.09, 620 + Math.random() * 180, 'bandpass', 0.14);
            return;
        }
        this._playNoise(0.055, 340 + Math.random() * 140, 'lowpass', 0.12);
    }

    playDig() {
        this._playNoise(0.05, 780 + Math.random() * 240, 'bandpass', 0.14);
        this._playTone(150 + Math.random() * 35, 95, 0.045, 'triangle', 0.1);
    }

    playBreak() {
        this._playNoise(0.14, 520, 'lowpass', 0.28);
        this._playTone(185, 68, 0.12, 'square', 0.16);
    }

    playPlace() {
        this._playTone(210, 145, 0.065, 'triangle', 0.22);
        this._playNoise(0.05, 650, 'bandpass', 0.12);
    }

    playPickup() {
        this._playTone(580, 920, 0.075, 'sine', 0.18);
        this._playTone(860, 1180, 0.07, 'sine', 0.14, 0.045);
    }

    playHitMob() {
        this._playNoise(0.08, 920, 'bandpass', 0.26);
        this._playTone(240, 88, 0.09, 'sawtooth', 0.2);
    }

    playMobDeath() {
        this._playTone(280, 72, 0.22, 'sawtooth', 0.22);
        this._playNoise(0.16, 480, 'lowpass', 0.2);
    }

    playPlayerHurt() {
        this._playTone(190, 78, 0.16, 'sawtooth', 0.3);
        this._playNoise(0.1, 420, 'lowpass', 0.25);
    }

    playEat() {
        this._playNoise(0.06, 980, 'bandpass', 0.18, 0);
        this._playNoise(0.06, 1150, 'bandpass', 0.16, 0.07);
        this._playTone(320, 440, 0.07, 'sine', 0.12, 0.12);
    }

    playCraft() {
        this._playTone(440, 554, 0.09, 'triangle', 0.18, 0);
        this._playTone(554, 659, 0.1, 'triangle', 0.18, 0.06);
        this._playTone(659, 880, 0.14, 'triangle', 0.2, 0.12);
    }
}
