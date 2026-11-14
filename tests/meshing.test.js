import test from 'node:test';
import assert from 'node:assert/strict';
import { CHUNK_VOLUME } from '../public/src/core/Constants.js';
import { BLOCK_IDS } from '../public/src/core/BlockRegistry.js';
import { Chunk } from '../public/src/world/Chunk.js';
import { buildChunkMeshData, packNeighborBorders } from '../public/src/renderer/ChunkMeshBuilder.js';

test('Single solid voxel emits 6 faces (24 vertices, 36 indices) in opaque bucket', () => {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    blocks[Chunk.index(4, 10, 4)] = BLOCK_IDS.DIRT;

    const mesh = buildChunkMeshData(blocks);
    assert.ok(mesh.opaque);
    assert.equal(mesh.cutout, null);
    assert.equal(mesh.translucent, null);
    assert.equal(mesh.opaque.positions.length, 24 * 3);
    assert.equal(mesh.opaque.indices.length, 36);
});

test('Adjacent solid voxels cull shared hidden face (10 faces = 40 vertices)', () => {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    blocks[Chunk.index(4, 10, 4)] = BLOCK_IDS.STONE;
    blocks[Chunk.index(5, 10, 4)] = BLOCK_IDS.STONE;

    const mesh = buildChunkMeshData(blocks);
    assert.equal(mesh.opaque.positions.length, 40 * 3);
    assert.equal(mesh.opaque.indices.length, 60);
});

test('Neighbor border culling removes chunk boundary face when adjacent chunk has solid block', () => {
    const chunkA = new Chunk(0, 0);
    const chunkB = new Chunk(1, 0);
    chunkA.setBlock(15, 10, 4, BLOCK_IDS.DIRT);
    chunkB.setBlock(0, 10, 4, BLOCK_IDS.DIRT);

    const meshWithoutNeighbor = buildChunkMeshData(chunkA.blocks, null);
    assert.equal(meshWithoutNeighbor.opaque.indices.length, 36);

    const borders = packNeighborBorders({ px: chunkB });
    const meshWithNeighbor = buildChunkMeshData(chunkA.blocks, borders);
    assert.equal(meshWithNeighbor.opaque.indices.length, 30); // 5 visible faces instead of 6
});

test('Transparent glass culls internal shared faces while leaves use cutout pass', () => {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    blocks[Chunk.index(2, 10, 2)] = BLOCK_IDS.GLASS;
    blocks[Chunk.index(3, 10, 2)] = BLOCK_IDS.GLASS;
    blocks[Chunk.index(6, 10, 6)] = BLOCK_IDS.LEAVES;

    const mesh = buildChunkMeshData(blocks);
    assert.equal(mesh.opaque, null);
    assert.ok(mesh.translucent);
    assert.ok(mesh.cutout);
    // 2 adjacent glass blocks share 1 interior face -> 10 faces -> 60 indices
    assert.equal(mesh.translucent.indices.length, 60);
    // 1 isolated leaf block -> 6 faces -> 36 indices
    assert.equal(mesh.cutout.indices.length, 36);
});

test('Per-vertex AO darkens vertices next to corner occluders', () => {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    // Floor block at (5, 10, 5) and raised occluding wall block at (6, 11, 5)
    blocks[Chunk.index(5, 10, 5)] = BLOCK_IDS.STONE;
    blocks[Chunk.index(6, 11, 5)] = BLOCK_IDS.STONE;

    const mesh = buildChunkMeshData(blocks);
    // Check that top face of (5,10,5) has some vertices darker than 1.0 due to AO
    const colors = mesh.opaque.colors;
    let hasDarkenedVertex = false;
    for (let i = 0; i < colors.length; i += 3) {
        if (colors[i] < 0.99 && mesh.opaque.normals[i + 1] === 1) {
            hasDarkenedVertex = true;
            break;
        }
    }
    assert.ok(hasDarkenedVertex, 'Expected top face near raised wall block to receive AO darkening');
});
