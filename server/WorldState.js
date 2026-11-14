/**
 * Authoritative LAN server world state: manages deterministic world seed,
 * accumulated block modification deltas, player registry, and spawn lookup.
 */

import { CHUNK_HEIGHT, DEFAULT_SEED } from '../public/src/core/Constants.js';
import { BLOCKS, BLOCK_IDS } from '../public/src/core/BlockRegistry.js';
import { TerrainGenerator } from '../public/src/world/TerrainGenerator.js';

const AVATAR_COLORS = [
    '#3b82f6',
    '#ef4444',
    '#10b981',
    '#f59e0b',
    '#06b6d4',
    '#ec4899',
    '#84cc16',
    '#f97316',
];

export class WorldState {
    /**
     * @param {number} [seed]
     */
    constructor(seed = DEFAULT_SEED) {
        this.seed = seed | 0;
        this.terrain = new TerrainGenerator(this.seed);
        this.spawn = this.terrain.findSafeSpawn(0, 0);

        /** @type {Map<string, number>} "x,y,z" -> blockId */
        this.blockDeltas = new Map();

        /** @type {Map<string, object>} playerId -> player metadata & latest transform */
        this.players = new Map();
        this._nextId = 1;
    }

    addPlayer(name = 'Builder') {
        const idx = this._nextId++;
        const id = `p_${idx}`;
        const sanitizedName = String(name || `Player ${idx}`)
            .replace(/[\r\n\t]/g, ' ')
            .trim()
            .slice(0, 18) || `Player ${idx}`;

        const player = {
            id,
            name: sanitizedName,
            color: AVATAR_COLORS[(idx - 1) % AVATAR_COLORS.length],
            x: this.spawn.x,
            y: this.spawn.y,
            z: this.spawn.z,
            yaw: 0,
            pitch: 0,
            walking: false,
            heldBlock: BLOCK_IDS.DIRT,
        };
        this.players.set(id, player);
        return player;
    }

    removePlayer(id) {
        return this.players.delete(id);
    }

    updatePlayerState(id, state) {
        const player = this.players.get(id);
        if (!player) return null;

        if (Number.isFinite(state.x)) player.x = state.x;
        if (Number.isFinite(state.y)) player.y = state.y;
        if (Number.isFinite(state.z)) player.z = state.z;
        if (Number.isFinite(state.yaw)) player.yaw = state.yaw;
        if (Number.isFinite(state.pitch)) player.pitch = state.pitch;
        if (typeof state.walking === 'boolean') player.walking = state.walking;
        if (Number.isInteger(state.heldBlock) && BLOCKS[state.heldBlock]) {
            player.heldBlock = state.heldBlock;
        }
        return player;
    }

    /**
     * Validate and record a voxel change.
     * @returns {{ x: number, y: number, z: number, blockId: number }|null}
     */
    setBlock(x, y, z, blockId) {
        if (
            !Number.isInteger(x) ||
            !Number.isInteger(y) ||
            !Number.isInteger(z) ||
            !Number.isInteger(blockId)
        ) {
            return null;
        }
        if (y < 1 || y >= CHUNK_HEIGHT) return null;
        if (!BLOCKS[blockId] || blockId === BLOCK_IDS.BEDROCK) return null;

        this.blockDeltas.set(`${x},${y},${z}`, blockId);
        return { x, y, z, blockId };
    }

    getSerializedDeltas() {
        const out = [];
        for (const [key, blockId] of this.blockDeltas.entries()) {
            const [x, y, z] = key.split(',').map(Number);
            out.push([x, y, z, blockId]);
        }
        return out;
    }

    getPlayerList() {
        return Array.from(this.players.values());
    }
}
