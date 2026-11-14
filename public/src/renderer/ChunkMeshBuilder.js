/**
 * Pure-JS neighbor-aware voxel chunk mesher with per-vertex Ambient Occlusion (AO),
 * directional face shading, and render-pass bucketing (opaque, cutout, translucent).
 * Zero Three.js dependencies so it runs identically inside Web Workers and Node tests.
 */

import {
    CHUNK_SIZE_X,
    CHUNK_SIZE_Z,
    CHUNK_HEIGHT,
    ATLAS_TILES_PER_ROW,
    ATLAS_PIXEL_SIZE,
} from '../core/Constants.js';
import { BLOCK_IDS, BLOCKS, isBlockOpaque, isBlockSolid } from '../core/BlockRegistry.js';

// Half-texel inset prevents atlas bleeding at grazing camera angles
const TILE_UV_SIZE = 1 / ATLAS_TILES_PER_ROW;
const UV_INSET = 0.5 / ATLAS_PIXEL_SIZE;

// AO curve levels (0 occluded corners -> 1.0, 3 occluded -> 0.50)
const AO_LEVELS = [0.50, 0.67, 0.84, 1.0];

/**
 * Face definitions in verified counter-clockwise (CCW) outward winding order.
 * Tangent vectors (uAxis, vAxis) point across the neighbor plane for AO corner lookup.
 */
const FACES = [
    {
        name: 'top', // +Y
        dir: [0, 1, 0],
        shade: 1.0,
        corners: [
            [0, 1, 1],
            [1, 1, 1],
            [1, 1, 0],
            [0, 1, 0],
        ],
        aoOffsets: [
            [-1, 1, 1],
            [1, 1, 1],
            [1, 1, -1],
            [-1, 1, -1],
        ],
        uAxis: [1, 0, 0],
        vAxis: [0, 0, 1],
    },
    {
        name: 'bottom', // -Y
        dir: [0, -1, 0],
        shade: 0.60,
        corners: [
            [0, 0, 0],
            [1, 0, 0],
            [1, 0, 1],
            [0, 0, 1],
        ],
        aoOffsets: [
            [-1, -1, -1],
            [1, -1, -1],
            [1, -1, 1],
            [-1, -1, 1],
        ],
        uAxis: [1, 0, 0],
        vAxis: [0, 0, 1],
    },
    {
        name: 'east', // +X
        dir: [1, 0, 0],
        shade: 0.80,
        corners: [
            [1, 0, 1],
            [1, 0, 0],
            [1, 1, 0],
            [1, 1, 1],
        ],
        aoOffsets: [
            [1, -1, 1],
            [1, -1, -1],
            [1, 1, -1],
            [1, 1, 1],
        ],
        uAxis: [0, 1, 0],
        vAxis: [0, 0, 1],
    },
    {
        name: 'west', // -X
        dir: [-1, 0, 0],
        shade: 0.80,
        corners: [
            [0, 0, 0],
            [0, 0, 1],
            [0, 1, 1],
            [0, 1, 0],
        ],
        aoOffsets: [
            [-1, -1, -1],
            [-1, -1, 1],
            [-1, 1, 1],
            [-1, 1, -1],
        ],
        uAxis: [0, 1, 0],
        vAxis: [0, 0, 1],
    },
    {
        name: 'south', // +Z
        dir: [0, 0, 1],
        shade: 0.88,
        corners: [
            [0, 0, 1],
            [1, 0, 1],
            [1, 1, 1],
            [0, 1, 1],
        ],
        aoOffsets: [
            [-1, -1, 1],
            [1, -1, 1],
            [1, 1, 1],
            [-1, 1, 1],
        ],
        uAxis: [1, 0, 0],
        vAxis: [0, 1, 0],
    },
    {
        name: 'north', // -Z
        dir: [0, 0, -1],
        shade: 0.88,
        corners: [
            [1, 0, 0],
            [0, 0, 0],
            [0, 1, 0],
            [1, 1, 0],
        ],
        aoOffsets: [
            [1, -1, -1],
            [-1, -1, -1],
            [-1, 1, -1],
            [1, 1, -1],
        ],
        uAxis: [1, 0, 0],
        vAxis: [0, 1, 0],
    },
];

function createBucket() {
    return {
        positions: [],
        normals: [],
        uvs: [],
        colors: [],
        indices: [],
        vertexCount: 0,
    };
}

function finalizeBucket(bucket) {
    if (bucket.vertexCount === 0) return null;
    return {
        positions: new Float32Array(bucket.positions),
        normals: new Float32Array(bucket.normals),
        uvs: new Float32Array(bucket.uvs),
        colors: new Float32Array(bucket.colors),
        indices: new Uint32Array(bucket.indices),
    };
}

/**
 * Extract compact border strips from adjacent chunks for fast worker transfer (~8.7 KB total).
 * @param {object} neighborChunks { px, nx, pz, nz, pxpz, pxnz, nxpz, nxnz } where each is Chunk|Uint8Array|null
 * @returns {object}
 */
export function packNeighborBorders(neighborChunks = {}) {
    const getBuf = (c) => (c && c.blocks ? c.blocks : c || null);

    const pxBuf = getBuf(neighborChunks.px);
    const nxBuf = getBuf(neighborChunks.nx);
    const pzBuf = getBuf(neighborChunks.pz);
    const nzBuf = getBuf(neighborChunks.nz);

    const pxpzBuf = getBuf(neighborChunks.pxpz);
    const pxnzBuf = getBuf(neighborChunks.pxnz);
    const nxpzBuf = getBuf(neighborChunks.nxpz);
    const nxnzBuf = getBuf(neighborChunks.nxnz);

    let px = null;
    if (pxBuf) {
        px = new Uint8Array(CHUNK_SIZE_Z * CHUNK_HEIGHT);
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
            for (let z = 0; z < CHUNK_SIZE_Z; z++) {
                px[(y << 4) | z] = pxBuf[(y << 8) | (z << 4) | 0];
            }
        }
    }

    let nx = null;
    if (nxBuf) {
        nx = new Uint8Array(CHUNK_SIZE_Z * CHUNK_HEIGHT);
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
            for (let z = 0; z < CHUNK_SIZE_Z; z++) {
                nx[(y << 4) | z] = nxBuf[(y << 8) | (z << 4) | (CHUNK_SIZE_X - 1)];
            }
        }
    }

    let pz = null;
    if (pzBuf) {
        pz = new Uint8Array(CHUNK_SIZE_X * CHUNK_HEIGHT);
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
            for (let x = 0; x < CHUNK_SIZE_X; x++) {
                pz[(y << 4) | x] = pzBuf[(y << 8) | (0 << 4) | x];
            }
        }
    }

    let nz = null;
    if (nzBuf) {
        nz = new Uint8Array(CHUNK_SIZE_X * CHUNK_HEIGHT);
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
            for (let x = 0; x < CHUNK_SIZE_X; x++) {
                nz[(y << 4) | x] = nzBuf[(y << 8) | ((CHUNK_SIZE_Z - 1) << 4) | x];
            }
        }
    }

    const extractCorner = (buf, lx, lz) => {
        if (!buf) return null;
        const col = new Uint8Array(CHUNK_HEIGHT);
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
            col[y] = buf[(y << 8) | (lz << 4) | lx];
        }
        return col;
    };

    return {
        px,
        nx,
        pz,
        nz,
        pxpz: extractCorner(pxpzBuf, 0, 0),
        pxnz: extractCorner(pxnzBuf, 0, CHUNK_SIZE_Z - 1),
        nxpz: extractCorner(nxpzBuf, CHUNK_SIZE_X - 1, 0),
        nxnz: extractCorner(nxnzBuf, CHUNK_SIZE_X - 1, CHUNK_SIZE_Z - 1),
    };
}

/**
 * Sample block ID in chunk-local space supporting 1-block neighbor borders (-1..16).
 */
function sampleBlock(blocks, borders, lx, ly, lz) {
    if (ly < 0) return BLOCK_IDS.BEDROCK;
    if (ly >= CHUNK_HEIGHT) return BLOCK_IDS.AIR;

    if (lx >= 0 && lx < CHUNK_SIZE_X && lz >= 0 && lz < CHUNK_SIZE_Z) {
        return blocks[(ly << 8) | (lz << 4) | lx];
    }

    if (!borders) return BLOCK_IDS.AIR;

    if (lx === CHUNK_SIZE_X) {
        if (lz === CHUNK_SIZE_Z) return borders.pxpz ? borders.pxpz[ly] : BLOCK_IDS.AIR;
        if (lz === -1) return borders.pxnz ? borders.pxnz[ly] : BLOCK_IDS.AIR;
        if (lz >= 0 && lz < CHUNK_SIZE_Z && borders.px) return borders.px[(ly << 4) | lz];
        return BLOCK_IDS.AIR;
    }

    if (lx === -1) {
        if (lz === CHUNK_SIZE_Z) return borders.nxpz ? borders.nxpz[ly] : BLOCK_IDS.AIR;
        if (lz === -1) return borders.nxnz ? borders.nxnz[ly] : BLOCK_IDS.AIR;
        if (lz >= 0 && lz < CHUNK_SIZE_Z && borders.nx) return borders.nx[(ly << 4) | lz];
        return BLOCK_IDS.AIR;
    }

    if (lz === CHUNK_SIZE_Z && lx >= 0 && lx < CHUNK_SIZE_X) {
        return borders.pz ? borders.pz[(ly << 4) | lx] : BLOCK_IDS.AIR;
    }

    if (lz === -1 && lx >= 0 && lx < CHUNK_SIZE_X) {
        return borders.nz ? borders.nz[(ly << 4) | lx] : BLOCK_IDS.AIR;
    }

    return BLOCK_IDS.AIR;
}

/**
 * Build face-culled, AO-shaded geometry buffers for a single chunk.
 * @param {Uint8Array} blocks
 * @param {object} [borders] Output of packNeighborBorders()
 * @returns {{ opaque: object|null, cutout: object|null, translucent: object|null }}
 */
export function buildChunkMeshData(blocks, borders = null) {
    const buckets = {
        opaque: createBucket(),
        cutout: createBucket(),
        translucent: createBucket(),
    };

    for (let y = 0; y < CHUNK_HEIGHT; y++) {
        const yBase = y << 8;
        for (let z = 0; z < CHUNK_SIZE_Z; z++) {
            const zBase = yBase | (z << 4);
            for (let x = 0; x < CHUNK_SIZE_X; x++) {
                const blockId = blocks[zBase | x];
                if (blockId === BLOCK_IDS.AIR) continue;

                const def = BLOCKS[blockId];
                if (!def || def.renderPass === 'none') continue;
                const bucket = buckets[def.renderPass];

                const isWater = blockId === BLOCK_IDS.WATER;
                const aboveWaterAir = isWater && sampleBlock(blocks, borders, x, y + 1, z) === BLOCK_IDS.AIR;
                const topOffset = aboveWaterAir ? -0.12 : 0;

                for (let f = 0; f < 6; f++) {
                    const face = FACES[f];
                    const nx = x + face.dir[0];
                    const ny = y + face.dir[1];
                    const nz = z + face.dir[2];

                    const neighborId = sampleBlock(blocks, borders, nx, ny, nz);

                    // Face culling rules:
                    // 1. Always cull against opaque neighbor blocks.
                    // 2. Cull shared faces between identical translucent blocks (glass-glass, water-water).
                    // 3. Do not render water side/bottom faces against non-air solid blocks (covered by #1) or glass? Keep crisp water-air/glass boundaries.
                    if (isBlockOpaque(neighborId)) continue;
                    if (def.cullSameType && neighborId === blockId) continue;

                    // Pick tile index for this face orientation
                    let tileIndex;
                    if (f === 0) tileIndex = def.faces.top;
                    else if (f === 1) tileIndex = def.faces.bottom;
                    else tileIndex = def.faces.side;

                    const tileX = tileIndex % ATLAS_TILES_PER_ROW;
                    const tileY = Math.floor(tileIndex / ATLAS_TILES_PER_ROW);
                    const u0 = tileX * TILE_UV_SIZE + UV_INSET;
                    const u1 = (tileX + 1) * TILE_UV_SIZE - UV_INSET;
                    // Canvas Y=0 is top; WebGL texture flipY=true maps v=1 to top row (tileY=0)
                    const v1 = 1.0 - tileY * TILE_UV_SIZE - UV_INSET;
                    const v0 = 1.0 - (tileY + 1) * TILE_UV_SIZE + UV_INSET;

                    // Compute per-vertex AO for each of the 4 face corners
                    const aoVals = [1.0, 1.0, 1.0, 1.0];
                    const applyAO = def.renderPass === 'opaque';
                    if (applyAO) {
                        for (let c = 0; c < 4; c++) {
                            const off = face.aoOffsets[c];
                            const sx = off[0];
                            const sy = off[1];
                            const sz = off[2];

                            const s1x = face.uAxis[0] ? x + sx : nx;
                            const s1y = face.uAxis[1] ? y + sy : ny;
                            const s1z = face.uAxis[2] ? z + sz : nz;

                            const s2x = face.vAxis[0] ? x + sx : nx;
                            const s2y = face.vAxis[1] ? y + sy : ny;
                            const s2z = face.vAxis[2] ? z + sz : nz;

                            const side1 = isBlockOpaque(sampleBlock(blocks, borders, s1x, s1y, s1z)) ? 1 : 0;
                            const side2 = isBlockOpaque(sampleBlock(blocks, borders, s2x, s2y, s2z)) ? 1 : 0;
                            const corner = (side1 && side2)
                                ? 1
                                : (isBlockOpaque(sampleBlock(blocks, borders, x + sx, y + sy, z + sz)) ? 1 : 0);

                            const level = (side1 && side2) ? 0 : (3 - (side1 + side2 + corner));
                            aoVals[c] = AO_LEVELS[level];
                        }
                    } else if (def.renderPass === 'cutout') {
                        // Subtle uniform depth darkening on inner leaves
                        const occ = isBlockSolid(neighborId) ? 0.78 : 0.96;
                        aoVals[0] = aoVals[1] = aoVals[2] = aoVals[3] = occ;
                    }

                    const baseVert = bucket.vertexCount;
                    const uvPairs = [
                        [u0, v0],
                        [u1, v0],
                        [u1, v1],
                        [u0, v1],
                    ];

                    for (let c = 0; c < 4; c++) {
                        const corner = face.corners[c];
                        const cy = corner[1] === 1 ? y + 1 + topOffset : y;
                        bucket.positions.push(x + corner[0], cy, z + corner[2]);
                        bucket.normals.push(face.dir[0], face.dir[1], face.dir[2]);
                        bucket.uvs.push(uvPairs[c][0], uvPairs[c][1]);

                        const shade = face.shade * aoVals[c];
                        // Subtle cool blue tint on water vertices, crisp white-grey AO otherwise
                        if (isWater) {
                            bucket.colors.push(shade * 0.85, shade * 0.94, shade * 1.0);
                        } else {
                            bucket.colors.push(shade, shade, shade);
                        }
                    }

                    // Flip diagonal when needed to avoid AO shading anisotropy artifacts
                    if (aoVals[0] + aoVals[2] > aoVals[1] + aoVals[3]) {
                        bucket.indices.push(
                            baseVert, baseVert + 1, baseVert + 2,
                            baseVert, baseVert + 2, baseVert + 3
                        );
                    } else {
                        bucket.indices.push(
                            baseVert + 1, baseVert + 2, baseVert + 3,
                            baseVert + 1, baseVert + 3, baseVert
                        );
                    }

                    bucket.vertexCount += 4;
                }
            }
        }
    }

    return {
        opaque: finalizeBucket(buckets.opaque),
        cutout: finalizeBucket(buckets.cutout),
        translucent: finalizeBucket(buckets.translucent),
    };
}
