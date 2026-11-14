import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_IDS, isBlockSolid } from '../public/src/core/BlockRegistry.js';
import { PHYSICS_TIMESTEP } from '../public/src/core/Constants.js';
import { raycastVoxel } from '../public/src/world/Raycaster.js';
import { PlayerController } from '../public/src/physics/PlayerController.js';

function createMockWorld(blocksMap) {
    const key = (x, y, z) => `${x},${y},${z}`;
    return {
        hasChunkAt() {
            return true;
        },
        getBlock(x, y, z) {
            return blocksMap.get(key(x, y, z)) ?? BLOCK_IDS.AIR;
        },
        isSolidAt(x, y, z) {
            return isBlockSolid(this.getBlock(x, y, z));
        },
    };
}

test('raycastVoxel hits solid block, skips water, and computes placement normal', () => {
    const map = new Map();
    map.set('2,5,0', BLOCK_IDS.WATER);
    map.set('4,5,0', BLOCK_IDS.STONE);

    const world = createMockWorld(map);
    const hit = raycastVoxel(
        { x: 0.5, y: 5.5, z: 0.5 },
        { x: 1, y: 0, z: 0 },
        (x, y, z) => world.getBlock(x, y, z),
        6.0
    );

    assert.equal(hit.hit, true);
    assert.deepEqual(hit.blockPos, { x: 4, y: 5, z: 0 });
    assert.deepEqual(hit.normal, { x: -1, y: 0, z: 0 });
    assert.deepEqual(hit.adjacentPos, { x: 3, y: 5, z: 0 });
    assert.equal(hit.blockId, BLOCK_IDS.STONE);

    // Out-of-reach miss
    const miss = raycastVoxel(
        { x: 0.5, y: 5.5, z: 0.5 },
        { x: 1, y: 0, z: 0 },
        (x, y, z) => world.getBlock(x, y, z),
        2.5
    );
    assert.equal(miss.hit, false);
});

test('PlayerController resolves gravity landing, jumping, and AABB wall collision', () => {
    const map = new Map();
    // 10x10 solid floor at y = 10
    for (let x = -5; x <= 5; x++) {
        for (let z = -5; z <= 5; z++) {
            map.set(`${x},10,${z}`, BLOCK_IDS.GRASS);
        }
    }
    // 2-high wall at x = 2
    for (let z = -5; z <= 5; z++) {
        map.set(`2,11,${z}`, BLOCK_IDS.STONE);
        map.set(`2,12,${z}`, BLOCK_IDS.STONE);
    }

    const world = createMockWorld(map);
    const player = new PlayerController({ world });
    player.setPosition(0.5, 13.0, 0.5);

    // Simulate 1.2s of gravity -> lands squarely on top of y=10 block (feet y = 11.0)
    for (let i = 0; i < 72; i++) {
        player.updatePhysics(PHYSICS_TIMESTEP);
    }
    assert.equal(player.onGround, true);
    assert.ok(Math.abs(player.position.y - 11.0) < 1e-4, `Expected y=11.0, got ${player.position.y}`);

    // Trigger jump and verify airborne rise
    player.keys.add('Space');
    player.updatePhysics(PHYSICS_TIMESTEP);
    player.keys.delete('Space');
    assert.equal(player.onGround, false);
    assert.ok(player.velocity.y > 5.0);

    // Let player settle back on ground
    for (let i = 0; i < 60; i++) {
        player.updatePhysics(PHYSICS_TIMESTEP);
    }
    assert.equal(player.onGround, true);

    // Face +X (yaw = -PI/2) and hold W toward wall at x = 2
    player.yaw = -Math.PI / 2;
    player.keys.add('KeyW');
    for (let i = 0; i < 90; i++) {
        player.updatePhysics(PHYSICS_TIMESTEP);
    }
    player.keys.delete('KeyW');

    // Player halfWidth=0.3 -> max center x before x=2 wall is 1.7
    assert.ok(
        Math.abs(player.position.x - 1.7) < 1e-3,
        `Expected player stopped at wall x=1.7, got ${player.position.x}`
    );

    // Verify block placement overlap guard prevents placing inside player AABB
    assert.equal(player.wouldBlockIntersectPlayer(1, 11, 0), true);
    assert.equal(player.wouldBlockIntersectPlayer(3, 11, 0), false);
});
