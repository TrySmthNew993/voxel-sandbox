/**
 * Deterministic PRNG, spatial hashing, coordinate conversions, and fast 2D/3D Simplex Noise.
 * Zero external dependencies so Web Workers and Node tests can import directly.
 */

import { CHUNK_SIZE_X, CHUNK_SIZE_Z } from './Constants.js';

export function clamp(val, min, max) {
    return val < min ? min : val > max ? max : val;
}

export function lerp(a, b, t) {
    return a + (b - a) * t;
}

export function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

export function mod(n, m) {
    return ((n % m) + m) % m;
}

export function worldToChunkCoord(wx, wz) {
    return {
        cx: Math.floor(wx / CHUNK_SIZE_X),
        cz: Math.floor(wz / CHUNK_SIZE_Z),
        lx: mod(wx, CHUNK_SIZE_X),
        lz: mod(wz, CHUNK_SIZE_Z),
    };
}

export function chunkKey(cx, cz) {
    return `${cx},${cz}`;
}

export function parseChunkKey(key) {
    const sep = key.indexOf(',');
    return {
        cx: Number(key.slice(0, sep)),
        cz: Number(key.slice(sep + 1)),
    };
}

/**
 * Mulberry32 fast deterministic 32-bit PRNG.
 * @param {number} seed
 * @returns {() => number} Float in [0, 1)
 */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Deterministic 2D integer hash returning float in [0, 1).
 */
export function hash2D(x, z, seed = 0) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(seed | 0, 1442695041);
    h = (h ^ (h >>> 13)) | 0;
    h = Math.imul(h, 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
}

/**
 * Deterministic 3D integer hash returning float in [0, 1).
 */
export function hash3D(x, y, z, seed = 0) {
    let h =
        Math.imul(x | 0, 374761393) +
        Math.imul(y | 0, 668265263) +
        Math.imul(z | 0, 2147483647) +
        Math.imul(seed | 0, 1442695041);
    h = (h ^ (h >>> 13)) | 0;
    h = Math.imul(h, 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
}

// 3D gradient vectors for Simplex noise (12 edges of a cube)
const GRAD3 = new Int8Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
]);

const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
const F3 = 1.0 / 3.0;
const G3 = 1.0 / 6.0;

/**
 * High-speed deterministic 2D & 3D Simplex Noise generator.
 * Zero heap allocations during noise sampling calls.
 */
export class SimplexNoise {
    /**
     * @param {number} seed
     */
    constructor(seed = 1337) {
        const rand = mulberry32(seed);
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) p[i] = i;
        for (let i = 255; i > 0; i--) {
            const j = (rand() * (i + 1)) | 0;
            const tmp = p[i];
            p[i] = p[j];
            p[j] = tmp;
        }

        this.perm = new Uint8Array(512);
        this.permMod12 = new Uint8Array(512);
        for (let i = 0; i < 512; i++) {
            const v = p[i & 255];
            this.perm[i] = v;
            this.permMod12[i] = v % 12;
        }
    }

    /**
     * 2D Simplex noise in [-1, 1].
     * @param {number} xin
     * @param {number} yin
     * @returns {number}
     */
    noise2D(xin, yin) {
        const perm = this.perm;
        const permMod12 = this.permMod12;

        let n0 = 0;
        let n1 = 0;
        let n2 = 0;

        const s = (xin + yin) * F2;
        const i = Math.floor(xin + s);
        const j = Math.floor(yin + s);
        const t = (i + j) * G2;
        const X0 = i - t;
        const Y0 = j - t;
        const x0 = xin - X0;
        const y0 = yin - Y0;

        let i1, j1;
        if (x0 > y0) {
            i1 = 1;
            j1 = 0;
        } else {
            i1 = 0;
            j1 = 1;
        }

        const x1 = x0 - i1 + G2;
        const y1 = y0 - j1 + G2;
        const x2 = x0 - 1.0 + 2.0 * G2;
        const y2 = y0 - 1.0 + 2.0 * G2;

        const ii = i & 255;
        const jj = j & 255;

        let t0 = 0.5 - x0 * x0 - y0 * y0;
        if (t0 >= 0) {
            const gi0 = permMod12[ii + perm[jj]] * 3;
            t0 *= t0;
            n0 = t0 * t0 * (GRAD3[gi0] * x0 + GRAD3[gi0 + 1] * y0);
        }

        let t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 >= 0) {
            const gi1 = permMod12[ii + i1 + perm[jj + j1]] * 3;
            t1 *= t1;
            n1 = t1 * t1 * (GRAD3[gi1] * x1 + GRAD3[gi1 + 1] * y1);
        }

        let t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 >= 0) {
            const gi2 = permMod12[ii + 1 + perm[jj + 1]] * 3;
            t2 *= t2;
            n2 = t2 * t2 * (GRAD3[gi2] * x2 + GRAD3[gi2 + 1] * y2);
        }

        return 70.0 * (n0 + n1 + n2);
    }

    /**
     * 3D Simplex noise in [-1, 1].
     * @param {number} xin
     * @param {number} yin
     * @param {number} zin
     * @returns {number}
     */
    noise3D(xin, yin, zin) {
        const perm = this.perm;
        const permMod12 = this.permMod12;

        let n0 = 0;
        let n1 = 0;
        let n2 = 0;
        let n3 = 0;

        const s = (xin + yin + zin) * F3;
        const i = Math.floor(xin + s);
        const j = Math.floor(yin + s);
        const k = Math.floor(zin + s);
        const t = (i + j + k) * G3;

        const X0 = i - t;
        const Y0 = j - t;
        const Z0 = k - t;
        const x0 = xin - X0;
        const y0 = yin - Y0;
        const z0 = zin - Z0;

        let i1, j1, k1;
        let i2, j2, k2;

        if (x0 >= y0) {
            if (y0 >= z0) {
                i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
            } else if (x0 >= z0) {
                i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1;
            } else {
                i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1;
            }
        } else {
            if (y0 < z0) {
                i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1;
            } else if (x0 < z0) {
                i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1;
            } else {
                i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0;
            }
        }

        const x1 = x0 - i1 + G3;
        const y1 = y0 - j1 + G3;
        const z1 = z0 - k1 + G3;
        const x2 = x0 - i2 + 2.0 * G3;
        const y2 = y0 - j2 + 2.0 * G3;
        const z2 = z0 - k2 + 2.0 * G3;
        const x3 = x0 - 1.0 + 3.0 * G3;
        const y3 = y0 - 1.0 + 3.0 * G3;
        const z3 = z0 - 1.0 + 3.0 * G3;

        const ii = i & 255;
        const jj = j & 255;
        const kk = k & 255;

        let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
        if (t0 >= 0) {
            const gi0 = permMod12[ii + perm[jj + perm[kk]]] * 3;
            t0 *= t0;
            n0 = t0 * t0 * (GRAD3[gi0] * x0 + GRAD3[gi0 + 1] * y0 + GRAD3[gi0 + 2] * z0);
        }

        let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
        if (t1 >= 0) {
            const gi1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
            t1 *= t1;
            n1 = t1 * t1 * (GRAD3[gi1] * x1 + GRAD3[gi1 + 1] * y1 + GRAD3[gi1 + 2] * z1);
        }

        let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
        if (t2 >= 0) {
            const gi2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
            t2 *= t2;
            n2 = t2 * t2 * (GRAD3[gi2] * x2 + GRAD3[gi2 + 1] * y2 + GRAD3[gi2 + 2] * z2);
        }

        let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
        if (t3 >= 0) {
            const gi3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
            t3 *= t3;
            n3 = t3 * t3 * (GRAD3[gi3] * x3 + GRAD3[gi3 + 1] * y3 + GRAD3[gi3 + 2] * z3);
        }

        return 32.0 * (n0 + n1 + n2 + n3);
    }

    /**
     * Multi-octave 2D Fractal Brownian Motion in approx [-1, 1].
     */
    fbm2D(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
        let sum = 0;
        let amp = 1.0;
        let freq = 1.0;
        let maxAmp = 0;
        for (let i = 0; i < octaves; i++) {
            sum += this.noise2D(x * freq, y * freq) * amp;
            maxAmp += amp;
            amp *= gain;
            freq *= lacunarity;
        }
        return sum / maxAmp;
    }

    /**
     * Multi-octave 3D Fractal Brownian Motion in approx [-1, 1].
     */
    fbm3D(x, y, z, octaves = 3, lacunarity = 2.0, gain = 0.5) {
        let sum = 0;
        let amp = 1.0;
        let freq = 1.0;
        let maxAmp = 0;
        for (let i = 0; i < octaves; i++) {
            sum += this.noise3D(x * freq, y * freq, z * freq) * amp;
            maxAmp += amp;
            amp *= gain;
            freq *= lacunarity;
        }
        return sum / maxAmp;
    }
}
