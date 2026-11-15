/**
 * Deterministic procedural terrain generator using 2D & 3D Simplex noise.
 * Produces multi-biome heightmaps, 3D cave systems, water basins, and seamless cross-chunk trees.
 */

import {
    CHUNK_SIZE_X,
    CHUNK_SIZE_Z,
    CHUNK_HEIGHT,
    CHUNK_VOLUME,
    SEA_LEVEL,
} from '../core/Constants.js';
import { BLOCK_IDS } from '../core/BlockRegistry.js';
import { SimplexNoise, hash2D, clamp, lerp, smoothstep } from '../core/MathUtils.js';

export class TerrainGenerator {
    /**
     * @param {number} seed
     */
    constructor(seed = 133742) {
        this.seed = seed | 0;
        this.heightNoise = new SimplexNoise(this.seed);
        this.biomeNoise = new SimplexNoise(this.seed ^ 0x9E3779B9);
        this.caveNoise = new SimplexNoise(this.seed ^ 0x85EBCA6B);
    }

    /**
     * Compute biome classification and target terrain surface height at world (wx, wz).
     * @param {number} wx
     * @param {number} wz
     * @returns {{ biome: 'plains'|'forest'|'desert'|'alpine', surfaceY: number }}
     */
    sampleColumn(wx, wz) {
        const continental = this.heightNoise.fbm2D(wx * 0.0042, wz * 0.0042, 4, 2.0, 0.5);
        const detail = this.heightNoise.fbm2D(wx * 0.017 + 31.7, wz * 0.017 - 17.3, 3, 2.0, 0.5);
        const ridgeRaw = 1.0 - Math.abs(this.heightNoise.noise2D(wx * 0.0085 - 50.2, wz * 0.0085 + 24.1));
        const ridge = ridgeRaw * ridgeRaw;

        const temp = this.biomeNoise.fbm2D(wx * 0.0031, wz * 0.0031, 2, 2.0, 0.5);
        const moisture = this.biomeNoise.fbm2D(wx * 0.0031 + 114.5, wz * 0.0031 - 83.2, 2, 2.0, 0.5);

        // Smooth elevation shaping: ocean basins -> rolling plains -> dramatic peaks
        let baseHeight;
        if (continental < -0.18) {
            const t = smoothstep(-0.65, -0.18, continental);
            baseHeight = lerp(31, SEA_LEVEL + 1, t) + detail * 3.0;
        } else if (continental < 0.22) {
            const t = smoothstep(-0.18, 0.22, continental);
            baseHeight = lerp(SEA_LEVEL + 1, 56, t) + detail * 4.5;
        } else {
            const t = smoothstep(0.22, 0.78, continental);
            baseHeight = 56 + t * 28 + ridge * t * 18 + detail * 5.0;
        }

        let biome = 'plains';
        if (baseHeight > 74 || (temp < -0.28 && continental > 0.12)) {
            biome = 'alpine';
        } else if (temp > 0.2 && moisture < -0.04) {
            biome = 'desert';
            // Flatten desert basins into soft dunes
            baseHeight = lerp(baseHeight, SEA_LEVEL + 6 + detail * 4.5 + ridge * 3.0, 0.55);
        } else if (moisture > 0.06) {
            biome = 'forest';
        }

        const surfaceY = clamp(Math.round(baseHeight), 12, CHUNK_HEIGHT - 18);
        return { biome, surfaceY };
    }

    /**
     * Evaluate 3D Simplex cave carving at world (wx, y, wz).
     * Combines winding spaghetti tunnels and deeper underground caverns.
     * @param {number} wx
     * @param {number} y
     * @param {number} wz
     * @param {number} surfaceY
     * @returns {boolean} True if voxel should be carved into air
     */
    isCave(wx, y, wz, surfaceY) {
        if (y <= 2 || y >= CHUNK_HEIGHT - 4) return false;
        // Keep a thin crust beneath sea basins so water lakes do not drain arbitrarily
        if (surfaceY <= SEA_LEVEL + 1 && y >= surfaceY - 4) return false;
        if (y >= surfaceY - 1) return false;

        // Dual-field spaghetti tunnels
        const n1 = this.caveNoise.noise3D(wx * 0.046, y * 0.056, wz * 0.046);
        const n2 = this.caveNoise.noise3D(wx * 0.046 + 123.4, y * 0.056 + 47.1, wz * 0.046 - 88.2);
        if (n1 * n1 + n2 * n2 < 0.021) {
            return true;
        }

        // Deeper cavern chambers
        if (y < 40) {
            const cavern = this.caveNoise.noise3D(wx * 0.028 - 40.0, y * 0.038, wz * 0.028 + 65.0);
            if (cavern > 0.54) {
                return true;
            }
        }

        return false;
    }

    /**
     * Generate complete voxel buffer for chunk (cx, cz).
     * @param {number} cx
     * @param {number} cz
     * @returns {Uint8Array}
     */
    generateChunkBlocks(cx, cz) {
        const blocks = new Uint8Array(CHUNK_VOLUME);
        const baseWx = cx * CHUNK_SIZE_X;
        const baseWz = cz * CHUNK_SIZE_Z;

        // 1. Base terrain columns + 3D caves + water fill
        for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
            const wz = baseWz + lz;
            for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
                const wx = baseWx + lx;
                const { biome, surfaceY } = this.sampleColumn(wx, wz);

                // Bedrock floor
                blocks[(0 << 8) | (lz << 4) | lx] = BLOCK_IDS.BEDROCK;

                for (let y = 1; y <= surfaceY; y++) {
                    if (this.isCave(wx, y, wz, surfaceY)) {
                        continue;
                    }

                    let blockId;
                    if (y === surfaceY) {
                        if (surfaceY <= SEA_LEVEL + 1 && biome !== 'alpine') {
                            blockId = BLOCK_IDS.SAND;
                        } else if (biome === 'desert') {
                            blockId = BLOCK_IDS.SAND;
                        } else if (biome === 'alpine') {
                            blockId = surfaceY >= 74 ? BLOCK_IDS.SNOW : BLOCK_IDS.STONE;
                        } else {
                            blockId = BLOCK_IDS.GRASS;
                        }
                    } else if (y >= surfaceY - 3) {
                        if (biome === 'desert' || surfaceY <= SEA_LEVEL + 1) {
                            blockId = BLOCK_IDS.SAND;
                        } else if (biome === 'alpine') {
                            blockId = surfaceY >= 76 && y >= surfaceY - 1 ? BLOCK_IDS.SNOW : BLOCK_IDS.STONE;
                        } else {
                            blockId = BLOCK_IDS.DIRT;
                        }
                    } else {
                        blockId = this._pickUndergroundBlock(wx, y, wz);
                    }

                    blocks[(y << 8) | (lz << 4) | lx] = blockId;
                }

                // Fill ocean/lake basins up to SEA_LEVEL
                if (surfaceY < SEA_LEVEL) {
                    for (let y = surfaceY + 1; y <= SEA_LEVEL; y++) {
                        blocks[(y << 8) | (lz << 4) | lx] = BLOCK_IDS.WATER;
                    }
                }
            }
        }

        // 2. Deterministic cross-chunk-safe trees (apron of 2 blocks around chunk bounds)
        this._populateTrees(blocks, baseWx, baseWz);

        return blocks;
    }

    /**
     * Evaluates deterministic tree anchors across chunk + 2-block border apron and writes
     * only the blocks falling inside the target chunk so trees never clip at chunk borders.
     * @param {Uint8Array} blocks
     * @param {number} baseWx
     * @param {number} baseWz
     */
    _populateTrees(blocks, baseWx, baseWz) {
        const apron = 2;
        for (let wz = baseWz - apron; wz < baseWz + CHUNK_SIZE_Z + apron; wz++) {
            for (let wx = baseWx - apron; wx < baseWx + CHUNK_SIZE_X + apron; wx++) {
                // Keep trees spaced on a 2x2 parity grid to prevent merged trunks
                if ((wx & 1) !== 0 || (wz & 1) !== 0) continue;

                const { biome, surfaceY } = this.sampleColumn(wx, wz);
                if (surfaceY <= SEA_LEVEL + 2 || surfaceY >= CHUNK_HEIGHT - 10) continue;
                if (biome !== 'forest' && biome !== 'plains') continue;

                const density = biome === 'forest' ? 0.085 : 0.014;
                const chance = hash2D(wx, wz, this.seed + 777);
                if (chance >= density) continue;

                // Do not sprout trees over open cave mouths
                if (this.isCave(wx, surfaceY - 1, wz, surfaceY)) continue;

                const trunkHeight = 4 + Math.floor(hash2D(wx, wz, this.seed + 999) * 3); // 4..6
                const topY = surfaceY + trunkHeight;

                // Place leaves canopy first (never overwrites trunk)
                for (let dy = trunkHeight - 2; dy <= trunkHeight + 1; dy++) {
                    const radius = dy >= trunkHeight + 1 ? 1 : 2;
                    const ly = surfaceY + dy;
                    if (ly < 1 || ly >= CHUNK_HEIGHT) continue;

                    for (let dz = -radius; dz <= radius; dz++) {
                        const tz = wz + dz;
                        const lz = tz - baseWz;
                        if (lz < 0 || lz >= CHUNK_SIZE_Z) continue;

                        for (let dx = -radius; dx <= radius; dx++) {
                            const tx = wx + dx;
                            const lx = tx - baseWx;
                            if (lx < 0 || lx >= CHUNK_SIZE_X) continue;

                            // Round off corners of canopy layers
                            if (Math.abs(dx) === radius && Math.abs(dz) === radius) {
                                if (dy === trunkHeight + 1 || hash2D(tx, tz + ly, this.seed + 55) < 0.55) {
                                    continue;
                                }
                            }

                            const idx = (ly << 8) | (lz << 4) | lx;
                            if (blocks[idx] === BLOCK_IDS.AIR) {
                                blocks[idx] = BLOCK_IDS.LEAVES;
                            }
                        }
                    }
                }

                // Place trunk wood if inside this chunk
                const trunkLx = wx - baseWx;
                const trunkLz = wz - baseWz;
                if (
                    trunkLx >= 0 && trunkLx < CHUNK_SIZE_X &&
                    trunkLz >= 0 && trunkLz < CHUNK_SIZE_Z
                ) {
                    for (let y = surfaceY + 1; y <= topY; y++) {
                        if (y < CHUNK_HEIGHT) {
                            blocks[(y << 8) | (trunkLz << 4) | trunkLx] = BLOCK_IDS.WOOD;
                        }
                    }
                    // Replace grass directly under trunk with dirt
                    blocks[(surfaceY << 8) | (trunkLz << 4) | trunkLx] = BLOCK_IDS.DIRT;
                }
            }
        }
    }

    /**
     * Find safe ground spawn height near world (wx, wz).
     * @param {number} wx
     * @param {number} wz
     * @returns {{ x: number, y: number, z: number }}
     */
    findSafeSpawn(wx = 0, wz = 0) {
        for (let r = 0; r <= 48; r += 2) {
            for (let angleIdx = 0; angleIdx < 8; angleIdx++) {
                const angle = (angleIdx / 8) * Math.PI * 2;
                const sx = Math.round(wx + Math.cos(angle) * r);
                const sz = Math.round(wz + Math.sin(angle) * r);
                const { surfaceY } = this.sampleColumn(sx, sz);
                if (surfaceY > SEA_LEVEL + 1 && surfaceY < 80) {
                    return { x: sx + 0.5, y: surfaceY + 2.2, z: sz + 0.5 };
                }
            }
        }
        const { surfaceY } = this.sampleColumn(wx, wz);
        return { x: wx + 0.5, y: Math.max(surfaceY, SEA_LEVEL) + 2.5, z: wz + 0.5 };
    }

    _pickUndergroundBlock(wx, y, wz) {
        // Coarse 2x2x2 vein cells + fine filter for realistic ore clusters
        const cx = Math.floor(wx * 0.5);
        const cy = Math.floor(y * 0.5);
        const cz = Math.floor(wz * 0.5);

        if (y >= 4 && y <= 30) {
            const vein = this._hash3(cx, cy, cz, 101);
            if (vein < 0.012 && this._hash3(wx, y, wz, 211) < 0.65) {
                return BLOCK_IDS.GOLD_ORE;
            }
        }
        if (y >= 4 && y <= 54) {
            const vein = this._hash3(cx, cy, cz, 307);
            if (vein < 0.028 && this._hash3(wx, y, wz, 409) < 0.68) {
                return BLOCK_IDS.IRON_ORE;
            }
        }
        if (y >= 6 && y <= 84) {
            const vein = this._hash3(cx, cy, cz, 503);
            if (vein < 0.048 && this._hash3(wx, y, wz, 607) < 0.72) {
                return BLOCK_IDS.COAL_ORE;
            }
        }
        return BLOCK_IDS.STONE;
    }

    _hash3(x, y, z, salt) {
        let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + Math.imul(salt, 1274126177)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }
}
