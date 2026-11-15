import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_IDS, isBlockSolid } from '../public/src/core/BlockRegistry.js';
import {
    ITEM_IDS,
    getAttackDamage,
    getBlockBreakTime,
    getMiningSpeedMultiplier,
} from '../public/src/core/ItemRegistry.js';
import { PHYSICS_TIMESTEP } from '../public/src/core/Constants.js';
import { DayNightCycle } from '../public/src/core/DayNightCycle.js';
import { InventoryManager } from '../public/src/inventory/InventoryManager.js';
import { CraftingSystem } from '../public/src/crafting/CraftingSystem.js';
import { DropManager } from '../public/src/entities/DropManager.js';
import { MobManager } from '../public/src/entities/MobManager.js';
import { PlayerController } from '../public/src/physics/PlayerController.js';

function createFlatMockWorld(floorY = 10) {
    return {
        hasChunkAt() {
            return true;
        },
        getBlock(x, y, z) {
            return y <= floorY ? BLOCK_IDS.GRASS : BLOCK_IDS.AIR;
        },
        isSolidAt(x, y, z) {
            return isBlockSolid(this.getBlock(x, y, z));
        },
        findSafeSpawn() {
            return { x: 0.5, y: floorY + 1, z: 0.5 };
        },
    };
}

test('CraftingSystem crafts Planks, Sticks, Pickaxe, Axe, and Sword, and tools speed up mining', () => {
    const inv = new InventoryManager();
    inv.slots.fill(null);
    const crafting = new CraftingSystem(inv);

    // Give 2 Wood logs
    inv.addItem(BLOCK_IDS.WOOD, 2);
    assert.equal(inv.getItemCount(BLOCK_IDS.WOOD), 2);

    // Craft 2x Oak Planks recipes -> 8 Planks
    assert.equal(crafting.canCraft('oak_planks'), true);
    assert.equal(crafting.craft('oak_planks').ok, true);
    assert.equal(crafting.craft('oak_planks').ok, true);
    assert.equal(inv.getItemCount(BLOCK_IDS.WOOD), 0);
    assert.equal(inv.getItemCount(BLOCK_IDS.PLANKS), 8);

    // Craft Sticks (2 Planks -> 4 Sticks)
    assert.equal(crafting.craft('sticks').ok, true);
    assert.equal(inv.getItemCount(BLOCK_IDS.PLANKS), 6);
    assert.equal(inv.getItemCount(ITEM_IDS.STICK), 4);

    // Craft Wooden Pickaxe (3 Planks + 2 Sticks)
    assert.equal(crafting.craft('wooden_pickaxe').ok, true);
    assert.equal(inv.getItemCount(ITEM_IDS.WOODEN_PICKAXE), 1);

    // Craft Wooden Sword (2 Planks + 1 Stick)
    assert.equal(crafting.craft('wooden_sword').ok, true);
    assert.equal(inv.getItemCount(ITEM_IDS.WOODEN_SWORD), 1);

    // Verify tool mining speed multipliers and break times
    const handStoneTime = getBlockBreakTime(BLOCK_IDS.STONE, 0);
    const woodPickStoneTime = getBlockBreakTime(BLOCK_IDS.STONE, ITEM_IDS.WOODEN_PICKAXE);
    const stonePickStoneTime = getBlockBreakTime(BLOCK_IDS.STONE, ITEM_IDS.STONE_PICKAXE);

    assert.ok(woodPickStoneTime < handStoneTime * 0.5, 'Wooden Pickaxe should mine Stone >2x faster than hand');
    assert.ok(stonePickStoneTime < woodPickStoneTime, 'Stone Pickaxe should mine Stone faster than Wooden Pickaxe');
    assert.ok(getMiningSpeedMultiplier(ITEM_IDS.WOODEN_AXE, BLOCK_IDS.WOOD) > 2.0, 'Axe speeds up Wood breaking');
    assert.ok(getAttackDamage(ITEM_IDS.STONE_SWORD) > getAttackDamage(ITEM_IDS.WOODEN_SWORD));
    assert.ok(getAttackDamage(ITEM_IDS.WOODEN_SWORD) > getAttackDamage(0));
});

test('DropManager spawns 3D collectible drop, flies toward close player, and adds to inventory', () => {
    const world = createFlatMockWorld(10);
    const inv = new InventoryManager();
    inv.slots.fill(null);

    const dropMgr = new DropManager({ world, inventory: inv });
    dropMgr.spawnDrop(2.0, 11.2, 0.5, BLOCK_IDS.COBBLESTONE, 1, { vx: 0, vy: 0, vz: 0 });
    assert.equal(dropMgr.drops.length, 1);

    // Player stands within magnet radius (1.8m away)
    const playerPos = { x: 0.5, y: 11.0, z: 0.5 };
    for (let i = 0; i < 60; i++) {
        dropMgr.update(PHYSICS_TIMESTEP, playerPos, false);
        if (dropMgr.drops.length === 0) break;
    }

    assert.equal(dropMgr.drops.length, 0, 'Drop should be collected after flying to player');
    assert.equal(inv.getItemCount(BLOCK_IDS.COBBLESTONE), 1);
});

test('PlayerController applies fall damage on high drop, triggers death state, and respawns cleanly', () => {
    const world = createFlatMockWorld(10);
    const player = new PlayerController({ world });

    // Drop player from y = 21 onto floor top y = 11 (10-block fall -> ~7 fall damage)
    player.setPosition(0.5, 21.0, 0.5);
    for (let i = 0; i < 120; i++) {
        player.updatePhysics(PHYSICS_TIMESTEP);
        if (player.onGround) break;
    }

    assert.equal(player.onGround, true);
    assert.ok(player.health < player.maxHealth, `Expected fall damage, health is ${player.health}`);

    // Inflict lethal damage and verify death & respawn
    player.invulnerableTimer = 0;
    player.takeDamage(50, 'Slain by a Zombie');
    assert.equal(player.health, 0);
    assert.equal(player.isDead, true);

    player.respawn({ x: 0.5, y: 11.0, z: 0.5 });
    assert.equal(player.isDead, false);
    assert.equal(player.health, player.maxHealth);
});

test('MobManager Zombie pursues player, deals touch damage, flashes on weapon hit, and drops items on death', () => {
    const world = createFlatMockWorld(10);
    const inv = new InventoryManager();
    inv.slots.fill(null);
    const dropMgr = new DropManager({ world, inventory: inv });
    const mobMgr = new MobManager({ world, dropManager: dropMgr });
    const player = new PlayerController({ world });
    player.setPosition(0.5, 11.0, 0.5);

    const zombie = mobMgr.spawnMob('zombie', 4.5, 11.0, 0.5);
    const startDist = Math.abs(zombie.x - player.position.x);

    // Step 1.5 seconds at night -> Zombie detects player and walks closer, eventually dealing touch damage
    for (let i = 0; i < 90; i++) {
        player.updatePhysics(PHYSICS_TIMESTEP);
        mobMgr.update(PHYSICS_TIMESTEP, player, true);
    }

    const endDist = Math.abs(zombie.x - player.position.x);
    assert.ok(endDist < startDist, 'Zombie should walk toward player');
    assert.ok(player.health < player.maxHealth, 'Zombie should deal touch damage when reaching player');

    // Hit zombie with Stone Sword (8 damage)
    const killed1 = mobMgr.damageMob(zombie, 8, { x: 1, z: 0 });
    assert.equal(killed1, false);
    assert.equal(zombie.health, 12);
    assert.ok(zombie.hurtFlashTimer > 0, 'Zombie should trigger hurt flash timer on hit');

    // Finish zombie off and verify drops spawn
    const killed2 = mobMgr.damageMob(zombie, 15, { x: 1, z: 0 });
    assert.equal(killed2, true);
    assert.ok(dropMgr.drops.length > 0, 'Killed zombie should drop items on the ground');
});

test('InventoryManager starts completely empty and CraftingSystem crafts Torches, Ingots & Iron tools', () => {
    const inv = new InventoryManager();
    const totalCount = inv.slots.reduce((acc, s) => acc + (s ? s.count : 0), 0);
    assert.equal(totalCount, 0, 'Player must start with zero items in inventory');

    const crafting = new CraftingSystem(inv);
    inv.addItem(ITEM_IDS.COAL, 4);
    inv.addItem(ITEM_IDS.STICK, 4);
    inv.addItem(BLOCK_IDS.IRON_ORE, 3);

    assert.equal(crafting.craft('ember_torch').ok, true);
    assert.equal(inv.getItemCount(BLOCK_IDS.TORCH), 4);

    assert.equal(crafting.craft('iron_ingot').ok, true);
    assert.equal(crafting.craft('iron_ingot').ok, true);
    assert.equal(crafting.craft('iron_ingot').ok, true);
    assert.equal(inv.getItemCount(ITEM_IDS.IRON_INGOT), 3);

    assert.equal(crafting.craft('iron_pickaxe').ok, true);
    assert.equal(inv.getItemCount(ITEM_IDS.IRON_PICKAXE), 1);
});

test('DayNightCycle tracks day/night transitions and MobManager spawns zombies only at night', () => {
    const cycle = new DayNightCycle(600, 0.5);
    assert.equal(cycle.isNight(), false, 'Noon should be daytime');
    assert.ok(cycle.getDaylight() > 0.9);

    cycle.timeOfDay = 0.02;
    assert.equal(cycle.isNight(), true, 'Midnight should be nighttime');
    assert.equal(cycle.getDaylight(), 0);

    const world = createFlatMockWorld(10);
    const mobMgr = new MobManager({ world });
    mobMgr.spawnInitialMobs({ x: 0.5, y: 11, z: 0.5 }, false);
    const dayHostiles = mobMgr.mobs.filter((m) => m.hostile).length;
    assert.equal(dayHostiles, 0, 'Daytime spawnInitialMobs must spawn 0 zombies');

    mobMgr.spawnInitialMobs({ x: 0.5, y: 11, z: 0.5 }, true);
    const nightHostiles = mobMgr.mobs.filter((m) => m.hostile).length;
    assert.ok(nightHostiles > 0, 'Nighttime spawnInitialMobs should spawn zombies');
});

test('PlayerController tracks hunger exhaustion and food restoration', () => {
    const world = createFlatMockWorld(10);
    const player = new PlayerController({ world });
    assert.equal(player.hunger, 20);

    player.addExhaustion(4.5);
    assert.equal(player.hunger, 19);

    assert.equal(player.feed(5), true);
    assert.equal(player.hunger, 20);
});
