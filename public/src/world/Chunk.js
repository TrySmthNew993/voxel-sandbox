/**
 * 16 x 128 x 16 voxel chunk container backed by a flat 32 KB Uint8Array.
 */

import { CHUNK_SIZE_X, CHUNK_SIZE_Z, CHUNK_HEIGHT, CHUNK_VOLUME } from '../core/Constants.js';
import { BLOCK_IDS, isBlockSolid } from '../core/BlockRegistry.js';

export class Chunk {
    /**
     * @param {number} cx Chunk X coordinate
     * @param {number} cz Chunk Z coordinate
     * @param {Uint8Array} [blocks] Optional pre-populated voxel buffer
     */
    constructor(cx, cz, blocks = null) {
        this.cx = cx;
        this.cz = cz;
        this.blocks = blocks || new Uint8Array(CHUNK_VOLUME);
        this.dirty = true;
        this.meshing = false;
    }

    /**
     * Compute flat array index for local coordinates (0..15, 0..127, 0..15).
     * @param {number} lx
     * @param {number} ly
     * @param {number} lz
     * @returns {number}
     */
    static index(lx, ly, lz) {
        return (ly << 8) | (lz << 4) | lx;
    }

    /**
     * @param {number} lx
     * @param {number} ly
     * @param {number} lz
     * @returns {boolean}
     */
    static isInBounds(lx, ly, lz) {
        return (
            lx >= 0 && lx < CHUNK_SIZE_X &&
            lz >= 0 && lz < CHUNK_SIZE_Z &&
            ly >= 0 && ly < CHUNK_HEIGHT
        );
    }

    /**
     * @param {number} lx
     * @param {number} ly
     * @param {number} lz
     * @returns {number} Block ID
     */
    getBlock(lx, ly, lz) {
        if (!Chunk.isInBounds(lx, ly, lz)) {
            return BLOCK_IDS.AIR;
        }
        return this.blocks[(ly << 8) | (lz << 4) | lx];
    }

    /**
     * @param {number} lx
     * @param {number} ly
     * @param {number} lz
     * @param {number} blockId
     */
    setBlock(lx, ly, lz, blockId) {
        if (!Chunk.isInBounds(lx, ly, lz)) return;
        const idx = (ly << 8) | (lz << 4) | lx;
        if (this.blocks[idx] !== blockId) {
            this.blocks[idx] = blockId;
            this.dirty = true;
        }
    }

    /**
     * Returns highest solid block Y at local (lx, lz), or -1 if empty.
     * @param {number} lx
     * @param {number} lz
     * @returns {number}
     */
    getHighestSolidY(lx, lz) {
        for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
            if (isBlockSolid(this.blocks[(y << 8) | (lz << 4) | lx])) {
                return y;
            }
        }
        return -1;
    }
}
