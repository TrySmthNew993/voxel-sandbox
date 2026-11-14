/**
 * Infinite chunk streaming manager powered by a Web Worker pool.
 * Handles async chunk generation/meshing, GPU upload throttling, synchronous local edits,
 * persistent block deltas, and clean BufferGeometry disposal.
 */

import * as THREE from 'three';
import {
    CHUNK_SIZE_X,
    CHUNK_SIZE_Z,
    CHUNK_HEIGHT,
    DEFAULT_RENDER_DISTANCE,
    DEFAULT_SEED,
    MAX_MESH_UPLOADS_PER_FRAME,
} from '../core/Constants.js';
import { BLOCK_IDS, isBlockSolid } from '../core/BlockRegistry.js';
import { chunkKey, parseChunkKey, worldToChunkCoord } from '../core/MathUtils.js';
import { Chunk } from './Chunk.js';
import { TerrainGenerator } from './TerrainGenerator.js';
import { buildChunkMeshData, packNeighborBorders } from '../renderer/ChunkMeshBuilder.js';

export class WorldManager {
    /**
     * @param {import('../renderer/Renderer.js').Renderer} renderer
     * @param {import('../core/EventBus.js').EventBus} bus
     */
    constructor(renderer, bus) {
        this.renderer = renderer;
        this.bus = bus;

        this.seed = DEFAULT_SEED;
        this.terrain = new TerrainGenerator(this.seed);
        this.renderDistance = DEFAULT_RENDER_DISTANCE;

        /** @type {Map<string, { chunk: Chunk, group: THREE.Group|null, meshes: object, meshVersion: number, appliedVersion: number }>} */
        this.chunks = new Map();

        /** Persistent block deltas keyed by "cx,cz" -> Map<localIdx, blockId> */
        this.deltas = new Map();

        this.epoch = 0;
        this.nextJobId = 1;
        this.generatingKeys = new Set();
        this.meshingKeys = new Set();
        this.pendingMeshUpload = [];

        this.lastPlayerCx = Infinity;
        this.lastPlayerCz = Infinity;

        this._initWorkers();
    }

    _initWorkers() {
        const poolSize = Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 2)));
        this.workers = [];
        this.workerLoad = [];

        for (let i = 0; i < poolSize; i++) {
            const worker = new Worker(new URL('./ChunkWorker.js', import.meta.url), { type: 'module' });
            worker.onmessage = (e) => this._onWorkerMessage(i, e.data);
            worker.onerror = (err) => console.error('ChunkWorker error:', err);
            this.workers.push(worker);
            this.workerLoad.push(0);
        }
    }

    _pickWorker() {
        let bestIdx = 0;
        for (let i = 1; i < this.workers.length; i++) {
            if (this.workerLoad[i] < this.workerLoad[bestIdx]) {
                bestIdx = i;
            }
        }
        return bestIdx;
    }

    /**
     * Reset entire world for a new seed or multiplayer session join.
     * @param {number} seed
     * @param {Array<[number, number, number, number]>} [initialDeltas]
     */
    resetWorld(seed, initialDeltas = []) {
        this.epoch++;
        this.seed = seed | 0;
        this.terrain = new TerrainGenerator(this.seed);

        for (const entry of this.chunks.values()) {
            this._disposeEntryMesh(entry);
        }
        this.chunks.clear();
        this.deltas.clear();
        this.generatingKeys.clear();
        this.meshingKeys.clear();
        this.pendingMeshUpload.length = 0;
        this.lastPlayerCx = Infinity;
        this.lastPlayerCz = Infinity;

        for (const [wx, wy, wz, blockId] of initialDeltas) {
            this._recordDelta(wx, wy, wz, blockId);
        }
    }

    /**
     * Find safe spawn point using current deterministic terrain generator.
     */
    findSafeSpawn(wx = 0, wz = 0) {
        return this.terrain.findSafeSpawn(wx, wz);
    }

    setRenderDistance(radius) {
        this.renderDistance = radius;
        this.renderer.setRenderDistance(radius);
        this.lastPlayerCx = Infinity; // Force stream refresh
    }

    _recordDelta(wx, wy, wz, blockId) {
        if (wy < 0 || wy >= CHUNK_HEIGHT) return;
        const { cx, cz, lx, lz } = worldToChunkCoord(wx, wz);
        const key = chunkKey(cx, cz);
        let map = this.deltas.get(key);
        if (!map) {
            map = new Map();
            this.deltas.set(key, map);
        }
        map.set(Chunk.index(lx, wy, lz), blockId);
    }

    _getPackedDeltasForChunk(key) {
        const map = this.deltas.get(key);
        if (!map || map.size === 0) return null;
        const arr = new Int32Array(map.size * 2);
        let i = 0;
        for (const [idx, blockId] of map.entries()) {
            arr[i++] = idx;
            arr[i++] = blockId;
        }
        return arr;
    }

    /**
     * Export all modified voxels across the world as [wx, wy, wz, blockId] tuples.
     * Used by browser P2P Host to sync newly joining peers.
     * @returns {Array<[number, number, number, number]>}
     */
    getSerializedDeltas() {
        const out = [];
        for (const [key, map] of this.deltas.entries()) {
            const { cx, cz } = parseChunkKey(key);
            const baseWx = cx * CHUNK_SIZE_X;
            const baseWz = cz * CHUNK_SIZE_Z;
            for (const [idx, blockId] of map.entries()) {
                const ly = idx >> 8;
                const lz = (idx >> 4) & 15;
                const lx = idx & 15;
                out.push([baseWx + lx, ly, baseWz + lz, blockId]);
            }
        }
        return out;
    }

    hasChunkAt(wx, wz) {
        const { cx, cz } = worldToChunkCoord(wx, wz);
        return this.chunks.has(chunkKey(cx, cz));
    }

    getBlock(wx, wy, wz) {
        if (wy < 0) return BLOCK_IDS.BEDROCK;
        if (wy >= CHUNK_HEIGHT) return BLOCK_IDS.AIR;
        const { cx, cz, lx, lz } = worldToChunkCoord(wx, wz);
        const entry = this.chunks.get(chunkKey(cx, cz));
        if (!entry) return BLOCK_IDS.AIR;
        return entry.chunk.getBlock(lx, wy, lz);
    }

    isSolidAt(wx, wy, wz) {
        return isBlockSolid(this.getBlock(wx, wy, wz));
    }

    /**
     * Place or break a block at world coordinates.
     * Rebuilds touched chunk (and border neighbors) synchronously for instant 0ms response.
     * @param {number} wx
     * @param {number} wy
     * @param {number} wz
     * @param {number} blockId
     * @param {boolean} [fromNetwork=false]
     * @returns {boolean}
     */
    setBlockWorld(wx, wy, wz, blockId, fromNetwork = false) {
        if (wy < 1 || wy >= CHUNK_HEIGHT) return false;
        const { cx, cz, lx, lz } = worldToChunkCoord(wx, wz);
        const key = chunkKey(cx, cz);

        this._recordDelta(wx, wy, wz, blockId);

        const entry = this.chunks.get(key);
        if (entry) {
            const current = entry.chunk.getBlock(lx, wy, lz);
            if (current === blockId) return false;

            entry.chunk.setBlock(lx, wy, lz, blockId);
            entry.meshVersion++;
            this._rebuildEntryMeshSync(entry);

            // Remesh adjacent chunks when editing on chunk boundaries (handles faces + corner AO)
            const neighborOffsets = [];
            if (lx === 0) neighborOffsets.push([-1, 0]);
            if (lx === CHUNK_SIZE_X - 1) neighborOffsets.push([1, 0]);
            if (lz === 0) neighborOffsets.push([0, -1]);
            if (lz === CHUNK_SIZE_Z - 1) neighborOffsets.push([0, 1]);
            if (lx === 0 && lz === 0) neighborOffsets.push([-1, -1]);
            if (lx === 0 && lz === CHUNK_SIZE_Z - 1) neighborOffsets.push([-1, 1]);
            if (lx === CHUNK_SIZE_X - 1 && lz === 0) neighborOffsets.push([1, -1]);
            if (lx === CHUNK_SIZE_X - 1 && lz === CHUNK_SIZE_Z - 1) neighborOffsets.push([1, 1]);

            for (const [dx, dz] of neighborOffsets) {
                const nEntry = this.chunks.get(chunkKey(cx + dx, cz + dz));
                if (nEntry) {
                    nEntry.meshVersion++;
                    this._rebuildEntryMeshSync(nEntry);
                }
            }
        }

        if (!fromNetwork) {
            this.bus.emit('world:blockChanged', { x: wx, y: wy, z: wz, blockId });
        }
        return true;
    }

    /**
     * Synchronously generate and mesh a specific chunk if needed (used at initial spawn).
     */
    ensureChunkSync(cx, cz) {
        const key = chunkKey(cx, cz);
        if (this.chunks.has(key)) return this.chunks.get(key);

        const blocks = this.terrain.generateChunkBlocks(cx, cz);
        const deltaMap = this.deltas.get(key);
        if (deltaMap) {
            for (const [idx, blockId] of deltaMap.entries()) {
                blocks[idx] = blockId;
            }
        }

        const chunk = new Chunk(cx, cz, blocks);
        const entry = {
            chunk,
            group: null,
            meshes: { opaque: null, cutout: null, translucent: null },
            meshVersion: 1,
            appliedVersion: 0,
        };
        this.chunks.set(key, entry);
        this.generatingKeys.delete(key);
        return entry;
    }

    /**
     * Stream chunks around player position and throttle GPU uploads to sustain 60 FPS.
     */
    update(playerX, playerZ) {
        const { cx: pcx, cz: pcz } = worldToChunkCoord(Math.floor(playerX), Math.floor(playerZ));

        // 1. Flush throttled GPU mesh uploads (capped per frame)
        let uploaded = 0;
        while (this.pendingMeshUpload.length > 0 && uploaded < MAX_MESH_UPLOADS_PER_FRAME) {
            const job = this.pendingMeshUpload.shift();
            const entry = this.chunks.get(chunkKey(job.cx, job.cz));
            if (!entry || job.version !== entry.meshVersion || job.epoch !== this.epoch) continue;
            this._applyMeshData(entry, job.meshData);
            entry.appliedVersion = job.version;
            uploaded++;
        }

        // 2. Determine desired chunk rings whenever player crosses a chunk boundary
        if (pcx !== this.lastPlayerCx || pcz !== this.lastPlayerCz) {
            this.lastPlayerCx = pcx;
            this.lastPlayerCz = pcz;
            this._unloadDistantChunks(pcx, pcz);
            this._enqueueNeededGenerations(pcx, pcz);
        }

        // 3. Schedule meshing for chunks whose 4 cardinal neighbors are loaded
        this._scheduleDirtyMeshes(pcx, pcz);
    }

    _unloadDistantChunks(pcx, pcz) {
        const unloadRadius = this.renderDistance + 2;
        for (const [key, entry] of this.chunks.entries()) {
            const dx = entry.chunk.cx - pcx;
            const dz = entry.chunk.cz - pcz;
            if (Math.max(Math.abs(dx), Math.abs(dz)) > unloadRadius) {
                this._disposeEntryMesh(entry);
                this.chunks.delete(key);
                this.meshingKeys.delete(key);
            }
        }
    }

    _enqueueNeededGenerations(pcx, pcz) {
        const genRadius = this.renderDistance + 1;
        const needed = [];

        for (let dz = -genRadius; dz <= genRadius; dz++) {
            for (let dx = -genRadius; dx <= genRadius; dx++) {
                if (dx * dx + dz * dz > (genRadius + 0.5) * (genRadius + 0.5)) continue;
                const cx = pcx + dx;
                const cz = pcz + dz;
                const key = chunkKey(cx, cz);
                if (!this.chunks.has(key) && !this.generatingKeys.has(key)) {
                    needed.push({ cx, cz, key, distSq: dx * dx + dz * dz });
                }
            }
        }

        needed.sort((a, b) => a.distSq - b.distSq);

        for (const item of needed) {
            this.generatingKeys.add(item.key);
            const workerIdx = this._pickWorker();
            this.workerLoad[workerIdx]++;
            const deltas = this._getPackedDeltasForChunk(item.key);

            this.workers[workerIdx].postMessage({
                type: 'GENERATE',
                jobId: `${this.epoch}:${this.nextJobId++}`,
                cx: item.cx,
                cz: item.cz,
                seed: this.seed,
                deltas,
            });
        }
    }

    _scheduleDirtyMeshes(pcx, pcz) {
        // Limit concurrent mesh worker dispatches so queue remains responsive to player direction
        const totalInFlight = this.workerLoad.reduce((a, b) => a + b, 0);
        if (totalInFlight > this.workers.length * 4) return;

        const candidates = [];
        for (const [key, entry] of this.chunks.entries()) {
            if (!entry.chunk.dirty || this.meshingKeys.has(key)) continue;

            const { cx, cz } = entry.chunk;
            const dx = cx - pcx;
            const dz = cz - pcz;
            if (dx * dx + dz * dz > (this.renderDistance + 0.5) * (this.renderDistance + 0.5)) {
                continue;
            }

            // Wait for 4 cardinal neighbors so border faces are cleanly culled
            if (
                !this.chunks.has(chunkKey(cx + 1, cz)) ||
                !this.chunks.has(chunkKey(cx - 1, cz)) ||
                !this.chunks.has(chunkKey(cx, cz + 1)) ||
                !this.chunks.has(chunkKey(cx, cz - 1))
            ) {
                continue;
            }

            candidates.push({ key, entry, distSq: dx * dx + dz * dz });
        }

        if (candidates.length === 0) return;
        candidates.sort((a, b) => a.distSq - b.distSq);

        const maxDispatch = Math.min(candidates.length, 4);
        for (let i = 0; i < maxDispatch; i++) {
            const { key, entry } = candidates[i];
            entry.chunk.dirty = false;
            this.meshingKeys.add(key);
            this._dispatchMeshJob(entry);
        }
    }

    _getNeighborChunks(cx, cz) {
        return {
            px: this.chunks.get(chunkKey(cx + 1, cz))?.chunk || null,
            nx: this.chunks.get(chunkKey(cx - 1, cz))?.chunk || null,
            pz: this.chunks.get(chunkKey(cx, cz + 1))?.chunk || null,
            nz: this.chunks.get(chunkKey(cx, cz - 1))?.chunk || null,
            pxpz: this.chunks.get(chunkKey(cx + 1, cz + 1))?.chunk || null,
            pxnz: this.chunks.get(chunkKey(cx + 1, cz - 1))?.chunk || null,
            nxpz: this.chunks.get(chunkKey(cx - 1, cz + 1))?.chunk || null,
            nxnz: this.chunks.get(chunkKey(cx - 1, cz - 1))?.chunk || null,
        };
    }

    _dispatchMeshJob(entry) {
        const { cx, cz, blocks } = entry.chunk;
        const borders = packNeighborBorders(this._getNeighborChunks(cx, cz));
        const blocksCopy = new Uint8Array(blocks);

        const transfers = [blocksCopy.buffer];
        for (const buf of Object.values(borders)) {
            if (buf) transfers.push(buf.buffer);
        }

        const workerIdx = this._pickWorker();
        this.workerLoad[workerIdx]++;
        this.workers[workerIdx].postMessage(
            {
                type: 'MESH',
                jobId: `${this.epoch}:${this.nextJobId++}`,
                cx,
                cz,
                version: entry.meshVersion,
                blocks: blocksCopy,
                borders,
            },
            transfers
        );
    }

    _rebuildEntryMeshSync(entry) {
        const { cx, cz, blocks } = entry.chunk;
        entry.chunk.dirty = false;
        const borders = packNeighborBorders(this._getNeighborChunks(cx, cz));
        const meshData = buildChunkMeshData(blocks, borders);
        this._applyMeshData(entry, meshData);
        entry.appliedVersion = entry.meshVersion;
    }

    _onWorkerMessage(workerIdx, msg) {
        this.workerLoad[workerIdx] = Math.max(0, this.workerLoad[workerIdx] - 1);
        const msgEpoch = Number(String(msg.jobId).split(':')[0]);
        if (msgEpoch !== this.epoch) return;

        const key = chunkKey(msg.cx, msg.cz);

        if (msg.type === 'GENERATED') {
            this.generatingKeys.delete(key);
            if (msg.seed !== this.seed) return;

            const chunk = new Chunk(msg.cx, msg.cz, msg.blocks);
            // Re-apply any deltas added while worker was generating
            const deltaMap = this.deltas.get(key);
            if (deltaMap) {
                for (const [idx, blockId] of deltaMap.entries()) {
                    chunk.blocks[idx] = blockId;
                }
            }

            this.chunks.set(key, {
                chunk,
                group: null,
                meshes: { opaque: null, cutout: null, translucent: null },
                meshVersion: 1,
                appliedVersion: 0,
            });
            return;
        }

        if (msg.type === 'MESHED') {
            this.meshingKeys.delete(key);
            const entry = this.chunks.get(key);
            if (!entry || msg.version !== entry.meshVersion) return;

            this.pendingMeshUpload.push({
                cx: msg.cx,
                cz: msg.cz,
                version: msg.version,
                epoch: msgEpoch,
                meshData: msg.meshData,
            });
        }
    }

    _applyMeshData(entry, meshData) {
        if (!entry.group) {
            entry.group = new THREE.Group();
            entry.group.position.set(entry.chunk.cx * CHUNK_SIZE_X, 0, entry.chunk.cz * CHUNK_SIZE_Z);
            this.renderer.scene.add(entry.group);
        }

        for (const pass of ['opaque', 'cutout', 'translucent']) {
            const oldMesh = entry.meshes[pass];
            const bucket = meshData[pass];

            if (!bucket) {
                if (oldMesh) {
                    entry.group.remove(oldMesh);
                    oldMesh.geometry.dispose();
                    entry.meshes[pass] = null;
                }
                continue;
            }

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(bucket.positions, 3));
            geo.setAttribute('normal', new THREE.BufferAttribute(bucket.normals, 3));
            geo.setAttribute('uv', new THREE.BufferAttribute(bucket.uvs, 2));
            geo.setAttribute('color', new THREE.BufferAttribute(bucket.colors, 3));
            geo.setIndex(new THREE.BufferAttribute(bucket.indices, 1));
            geo.computeBoundingSphere();

            if (oldMesh) {
                oldMesh.geometry.dispose();
                oldMesh.geometry = geo;
            } else {
                const mesh = new THREE.Mesh(geo, this.renderer.materials[pass]);
                if (pass === 'translucent') {
                    mesh.renderOrder = 2;
                }
                entry.group.add(mesh);
                entry.meshes[pass] = mesh;
            }
        }
    }

    _disposeEntryMesh(entry) {
        if (!entry.group) return;
        for (const pass of ['opaque', 'cutout', 'translucent']) {
            const mesh = entry.meshes[pass];
            if (mesh) {
                mesh.geometry.dispose();
                entry.meshes[pass] = null;
            }
        }
        this.renderer.scene.remove(entry.group);
        entry.group = null;
    }

    getStats() {
        let meshedChunks = 0;
        for (const entry of this.chunks.values()) {
            if (entry.group) meshedChunks++;
        }
        return {
            loadedChunks: this.chunks.size,
            meshedChunks,
            pendingGen: this.generatingKeys.size,
            pendingMesh: this.meshingKeys.size + this.pendingMeshUpload.length,
        };
    }

    dispose() {
        for (const entry of this.chunks.values()) {
            this._disposeEntryMesh(entry);
        }
        this.chunks.clear();
        for (const w of this.workers) {
            w.terminate();
        }
    }
}
