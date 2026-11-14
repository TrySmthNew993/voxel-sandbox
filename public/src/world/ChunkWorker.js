/**
 * Web Worker executing procedural terrain generation and chunk mesh building off the main thread.
 * Uses Transferable ArrayBuffers for zero-copy geometry and voxel data transfer.
 */

import { TerrainGenerator } from './TerrainGenerator.js';
import { buildChunkMeshData } from '../renderer/ChunkMeshBuilder.js';

let generator = null;
let currentSeed = null;

function ensureGenerator(seed) {
    if (!generator || currentSeed !== seed) {
        currentSeed = seed;
        generator = new TerrainGenerator(seed);
    }
    return generator;
}

function collectTransferables(meshData) {
    const transfers = [];
    for (const key of ['opaque', 'cutout', 'translucent']) {
        const bucket = meshData[key];
        if (!bucket) continue;
        transfers.push(
            bucket.positions.buffer,
            bucket.normals.buffer,
            bucket.uvs.buffer,
            bucket.colors.buffer,
            bucket.indices.buffer
        );
    }
    return transfers;
}

self.onmessage = (event) => {
    const msg = event.data;

    if (msg.type === 'GENERATE') {
        const gen = ensureGenerator(msg.seed);
        const blocks = gen.generateChunkBlocks(msg.cx, msg.cz);

        // Apply any known block deltas for this chunk before returning
        if (msg.deltas && msg.deltas.length > 0) {
            for (let i = 0; i < msg.deltas.length; i += 2) {
                const idx = msg.deltas[i];
                const blockId = msg.deltas[i + 1];
                blocks[idx] = blockId;
            }
        }

        self.postMessage(
            {
                type: 'GENERATED',
                jobId: msg.jobId,
                cx: msg.cx,
                cz: msg.cz,
                seed: msg.seed,
                blocks,
            },
            [blocks.buffer]
        );
        return;
    }

    if (msg.type === 'MESH') {
        const meshData = buildChunkMeshData(msg.blocks, msg.borders);
        const transfers = collectTransferables(meshData);

        self.postMessage(
            {
                type: 'MESHED',
                jobId: msg.jobId,
                cx: msg.cx,
                cz: msg.cz,
                version: msg.version,
                meshData,
            },
            transfers
        );
    }
};
