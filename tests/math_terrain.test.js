import test from 'node:test';
import assert from 'node:assert/strict';
import { SimplexNoise, worldToChunkCoord } from '../public/src/core/MathUtils.js';
import { BLOCK_IDS } from '../public/src/core/BlockRegistry.js';
import { CHUNK_SIZE_X, CHUNK_SIZE_Z, CHUNK_HEIGHT } from '../public/src/core/Constants.js';
import { TerrainGenerator } from '../public/src/world/TerrainGenerator.js';

test('worldToChunkCoord handles positive and negative coordinates cleanly', () => {
    assert.deepEqual(worldToChunkCoord(0, 0), { cx: 0, cz: 0, lx: 0, lz: 0 });
    assert.deepEqual(worldToChunkCoord(15, 16), { cx: 0, cz: 1, lx: 15, lz: 0 });
    assert.deepEqual(worldToChunkCoord(-1, -16), { cx: -1, cz: -1, lx: 15, lz: 0 });
    assert.deepEqual(worldToChunkCoord(-17, -1), { cx: -2, cz: -1, lx: 15, lz: 15 });
});

test('SimplexNoise 2D and 3D are deterministic and bounded', () => {
    const a = new SimplexNoise(4242);
    const b = new SimplexNoise(4242);
    const c = new SimplexNoise(9999);

    for (let i = 0; i < 50; i++) {
        const x = i * 0.37 - 5;
        const y = i * 0.23 + 2;
        const z = i * 0.41 - 3;

        const v2a = a.noise2D(x, y);
        const v2b = b.noise2D(x, y);
        const v3a = a.noise3D(x, y, z);
        const v3b = b.noise3D(x, y, z);

        assert.equal(v2a, v2b);
        assert.equal(v3a, v3b);
        assert.ok(v2a >= -1.05 && v2a <= 1.05, `2D value out of range: ${v2a}`);
        assert.ok(v3a >= -1.05 && v3a <= 1.05, `3D value out of range: ${v3a}`);
    }

    assert.notEqual(a.noise3D(1.37, 2.19, 3.83), c.noise3D(1.37, 2.19, 3.83));
});

test('TerrainGenerator creates bedrock, varied biomes, caves, and deterministic chunks', () => {
    const genA = new TerrainGenerator(133742);
    const genB = new TerrainGenerator(133742);

    const blocksA = genA.generateChunkBlocks(0, 0);
    const blocksB = genB.generateChunkBlocks(0, 0);
    assert.equal(blocksA.length, CHUNK_SIZE_X * CHUNK_SIZE_Z * CHUNK_HEIGHT);
    assert.deepEqual(blocksA, blocksB);

    // Every column has bedrock at y = 0
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
        for (let x = 0; x < CHUNK_SIZE_X; x++) {
            assert.equal(blocksA[(0 << 8) | (z << 4) | x], BLOCK_IDS.BEDROCK);
        }
    }

    // Multiple biomes observed across world span
    const biomes = new Set();
    for (let wx = -800; wx <= 800; wx += 40) {
        for (let wz = -800; wz <= 800; wz += 40) {
            biomes.add(genA.sampleColumn(wx, wz).biome);
        }
    }
    assert.ok(biomes.size >= 3, `Expected >= 3 biomes, got ${[...biomes]}`);

    // 3D caves carve underground air pockets in stone below surface
    let undergroundAirCount = 0;
    for (let cx = -2; cx <= 2; cx++) {
        for (let cz = -2; cz <= 2; cz++) {
            const buf = genA.generateChunkBlocks(cx, cz);
            for (let z = 0; z < 16; z++) {
                for (let x = 0; x < 16; x++) {
                    const { surfaceY } = genA.sampleColumn(cx * 16 + x, cz * 16 + z);
                    for (let y = 4; y < surfaceY - 4; y++) {
                        if (buf[(y << 8) | (z << 4) | x] === BLOCK_IDS.AIR) {
                            undergroundAirCount++;
                        }
                    }
                }
            }
        }
    }
    assert.ok(undergroundAirCount > 100, `Expected 3D caves underground, found ${undergroundAirCount} air cells`);
});
