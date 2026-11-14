/**
 * Fast 3D Amanatides-Woo DDA voxel traversal raycaster.
 * Determines exact block intersection and outward face normal for breaking & placing.
 */

import { REACH_DISTANCE } from '../core/Constants.js';
import { isBlockSelectable } from '../core/BlockRegistry.js';

/**
 * Cast a ray through the voxel grid.
 * @param {{x: number, y: number, z: number}} origin Ray origin (eye position)
 * @param {{x: number, y: number, z: number}} direction Normalized ray direction vector
 * @param {(wx: number, wy: number, wz: number) => number} getBlockFn World voxel lookup function
 * @param {number} [maxDistance=REACH_DISTANCE]
 * @returns {{
 *   hit: boolean,
 *   blockPos: {x: number, y: number, z: number}|null,
 *   normal: {x: number, y: number, z: number}|null,
 *   adjacentPos: {x: number, y: number, z: number}|null,
 *   blockId: number,
 *   distance: number
 * }}
 */
export function raycastVoxel(origin, direction, getBlockFn, maxDistance = REACH_DISTANCE) {
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);

    const dx = direction.x;
    const dy = direction.y;
    const dz = direction.z;

    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

    const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;

    let tMaxX = stepX > 0
        ? (x + 1 - origin.x) * tDeltaX
        : stepX < 0
            ? (origin.x - x) * tDeltaX
            : Infinity;

    let tMaxY = stepY > 0
        ? (y + 1 - origin.y) * tDeltaY
        : stepY < 0
            ? (origin.y - y) * tDeltaY
            : Infinity;

    let tMaxZ = stepZ > 0
        ? (z + 1 - origin.z) * tDeltaZ
        : stepZ < 0
            ? (origin.z - z) * tDeltaZ
            : Infinity;

    let nx = 0;
    let ny = 0;
    let nz = 0;
    let dist = 0;

    // Check starting cell only if player is somehow standing inside a selectable solid block
    const startBlock = getBlockFn(x, y, z);
    if (isBlockSelectable(startBlock)) {
        return {
            hit: true,
            blockPos: { x, y, z },
            normal: { x: 0, y: 1, z: 0 },
            adjacentPos: { x, y: y + 1, z },
            blockId: startBlock,
            distance: 0,
        };
    }

    while (dist <= maxDistance) {
        if (tMaxX < tMaxY) {
            if (tMaxX < tMaxZ) {
                dist = tMaxX;
                x += stepX;
                tMaxX += tDeltaX;
                nx = -stepX;
                ny = 0;
                nz = 0;
            } else {
                dist = tMaxZ;
                z += stepZ;
                tMaxZ += tDeltaZ;
                nx = 0;
                ny = 0;
                nz = -stepZ;
            }
        } else {
            if (tMaxY < tMaxZ) {
                dist = tMaxY;
                y += stepY;
                tMaxY += tDeltaY;
                nx = 0;
                ny = -stepY;
                nz = 0;
            } else {
                dist = tMaxZ;
                z += stepZ;
                tMaxZ += tDeltaZ;
                nx = 0;
                ny = 0;
                nz = -stepZ;
            }
        }

        if (dist > maxDistance) break;

        const blockId = getBlockFn(x, y, z);
        if (isBlockSelectable(blockId)) {
            return {
                hit: true,
                blockPos: { x, y, z },
                normal: { x: nx, y: ny, z: nz },
                adjacentPos: { x: x + nx, y: y + ny, z: z + nz },
                blockId,
                distance: dist,
            };
        }
    }

    return {
        hit: false,
        blockPos: null,
        normal: null,
        adjacentPos: null,
        blockId: 0,
        distance: Infinity,
    };
}
