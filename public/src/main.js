/**
 * Main game entry point wiring Core, Renderer, WorldManager, PlayerController,
 * InventoryManager, CraftingSystem, DropManager, MobManager, HeldItemView,
 * Raycaster, NetworkClient, HUD, and MenuModal into a fixed-timestep 60 FPS loop.
 */

import {
    CHUNK_SIZE_X,
    CHUNK_SIZE_Z,
    DEFAULT_SEED,
    MAX_FRAME_DELTA,
    PHYSICS_TIMESTEP,
} from './core/Constants.js';
import {
    BLOCK_IDS,
    getBlockDef,
    isValidPlaceableBlock,
} from './core/BlockRegistry.js';
import {
    ITEM_IDS,
    getAttackDamage,
    getBlockBreakTime,
    getItemDef,
    getMiningSpeedMultiplier,
} from './core/ItemRegistry.js';
import { EventBus } from './core/EventBus.js';
import { DayNightCycle } from './core/DayNightCycle.js';
import { AudioSystem } from './core/AudioSystem.js';
import { TextureAtlas } from './renderer/TextureAtlas.js';
import { Renderer } from './renderer/Renderer.js';
import { HeldItemView } from './renderer/HeldItemView.js';
import { WorldManager } from './world/WorldManager.js';
import { raycastVoxel } from './world/Raycaster.js';
import { PlayerController } from './physics/PlayerController.js';
import { InventoryManager } from './inventory/InventoryManager.js';
import { CraftingSystem } from './crafting/CraftingSystem.js';
import { DropManager } from './entities/DropManager.js';
import { MobManager } from './entities/MobManager.js';
import { NetworkClient } from './networking/NetworkClient.js';
import { HUD } from './ui/HUD.js';
import { MenuModal } from './ui/MenuModal.js';

function bootstrap() {
    const viewport = document.getElementById('game-viewport');
    const bus = new EventBus();
    const dayNight = new DayNightCycle(600, 0.30);
    const audio = new AudioSystem();
    const atlas = new TextureAtlas();
    const renderer = new Renderer(viewport, atlas);
    const world = new WorldManager(renderer, bus);

    // Track placed torches for pooled dynamic PointLights
    const activeTorches = new Map();
    let torchListCache = [];
    function syncTorchList() {
        torchListCache = Array.from(activeTorches.values());
    }

    const player = new PlayerController({
        world,
        camera: renderer.camera,
        domElement: renderer.webgl.domElement,
        bus,
    });

    const inventory = new InventoryManager(bus);
    const crafting = new CraftingSystem(inventory, bus);
    const dropManager = new DropManager({
        scene: renderer.scene,
        atlas,
        world,
        inventory,
        bus,
    });
    const mobManager = new MobManager({
        scene: renderer.scene,
        world,
        dropManager,
        bus,
    });
    const heldView = new HeldItemView(renderer.camera, atlas, renderer.scene);

    const network = new NetworkClient({ renderer, world, player, bus });
    const hud = new HUD({ atlas, bus, inventory, crafting });
    const menu = new MenuModal({ bus, world, player, network, hud });

    // Initialize Solo world, ensure chunks around spawn, and spawn nearby passive animals
    function startSoloWorld(seed) {
        world.resetWorld(seed);
        dropManager.clearAll();
        mobManager.clearAll();
        activeTorches.clear();
        syncTorchList();

        const spawn = world.findSafeSpawn(0, 0);
        const scx = Math.floor(spawn.x / CHUNK_SIZE_X);
        const scz = Math.floor(spawn.z / CHUNK_SIZE_Z);
        for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
                world.ensureChunkSync(scx + dx, scz + dz);
            }
        }
        player.respawn(spawn);
        mobManager.spawnInitialMobs(spawn, dayNight.isNight());
    }

    startSoloWorld(DEFAULT_SEED);

    // Wire audio and survival HUD bars
    bus.on('player:step', ({ inWater }) => audio.playStep(inWater));
    bus.on('player:damaged', () => audio.playPlayerHurt());
    bus.on('inventory:itemAdded', () => audio.playPickup());
    bus.on('crafting:crafted', () => audio.playCraft());
    bus.on('mob:damaged', () => audio.playHitMob());
    bus.on('mob:killed', () => audio.playMobDeath());
    bus.on('hud:toggleMute', () => {
        const muted = audio.toggleMute();
        hud.setAudioMuted(muted);
        hud.showToast(muted ? 'Audio Muted' : 'Audio Enabled');
    });
    bus.on('player:hungerChanged', ({ hunger, maxHunger }) => {
        hud.renderHunger(hunger, maxHunger);
    });
    bus.on('player:oxygenChanged', ({ oxygen, maxOxygen }) => {
        hud.renderOxygen(oxygen, maxOxygen, player.eyeInWater);
    });
    hud.renderHunger(player.hunger, player.maxHunger);
    hud.renderOxygen(player.oxygen, player.maxOxygen, player.eyeInWater);

    // Sync held 3D item viewmodel with active hotbar selection
    heldView.setHeldItem(inventory.getSelectedItemId());
    bus.on('inventory:changed', () => {
        heldView.setHeldItem(inventory.getSelectedItemId());
    });

    // Helper to break a block and spawn its 3D collectible item drop(s)
    function breakBlockAndSpawnDrops(x, y, z, blockId) {
        const def = getBlockDef(blockId);
        if (!def || !def.breakable) return false;
        const changed = world.setBlockWorld(x, y, z, BLOCK_IDS.AIR, false);
        if (!changed) return false;

        if (blockId === BLOCK_IDS.TORCH) {
            activeTorches.delete(`${x},${y},${z}`);
            syncTorchList();
        }
        audio.playBreak();
        player.addExhaustion(0.025);

        const dropId = def.dropId || blockId;
        if (dropId) {
            dropManager.spawnDrop(x + 0.5, y + 0.35, z + 0.5, dropId, 1);
        }
        // Breaking Oak Leaves can also drop a bonus Stick or Wild Apple
        if (blockId === BLOCK_IDS.LEAVES && Math.random() < 0.35) {
            const bonusId = Math.random() < 0.5 ? ITEM_IDS.APPLE : ITEM_IDS.STICK;
            dropManager.spawnDrop(x + 0.5, y + 0.4, z + 0.5, bonusId, 1);
        }
        return true;
    }

    let currentTarget = null;
    let currentMobTarget = null;
    let paletteOpen = false;

    // Progressive block mining state
    let miningKey = '';
    let miningProgress = 0;
    let digSoundTimer = 0;

    function resetMining() {
        miningKey = '';
        miningProgress = 0;
        digSoundTimer = 0;
        renderer.setCrackProgress(null, 0);
    }

    // Primary Action (LMB): Attack targeted Mob OR start/boost mining targeted Block
    bus.on('player:primaryAction', () => {
        audio.unlock();
        if (player.isDead) return;
        heldView.triggerSwing();

        const heldId = inventory.getSelectedItemId();

        // 1. Check if player is aiming at a Mob closer than any block
        const eyePos = player.getEyePosition();
        const lookDir = player.getLookDirection();
        const mobHit = mobManager.raycastMob(eyePos, lookDir, 4.6);
        const blockDist = currentTarget && currentTarget.hit ? currentTarget.distance : Infinity;

        if (mobHit.hit && mobHit.mob && mobHit.distance <= blockDist) {
            const attackDmg = getAttackDamage(heldId);
            mobManager.damageMob(mobHit.mob, attackDmg, lookDir);
            resetMining();
            return;
        }

        // 2. Otherwise mine targeted block
        if (!currentTarget || !currentTarget.hit) return;
        const { x, y, z } = currentTarget.blockPos;
        const def = getBlockDef(currentTarget.blockId);
        if (!def.breakable) return;

        // Instant break when in Fly Mode; progressive tool-accelerated mining in Survival Mode
        if (player.flying) {
            breakBlockAndSpawnDrops(x, y, z, currentTarget.blockId);
            resetMining();
            return;
        }

        const key = `${x},${y},${z}`;
        if (miningKey !== key) {
            miningKey = key;
            miningProgress = 0;
        }
        // Grant an initial tap impulse so rapid clicking or holding both work smoothly
        const breakTime = getBlockBreakTime(currentTarget.blockId, heldId);
        miningProgress += Math.min(0.38, 0.14 / breakTime);
        if (miningProgress >= 1.0) {
            breakBlockAndSpawnDrops(x, y, z, currentTarget.blockId);
            resetMining();
        }
    });

    bus.on('player:primaryRelease', () => {
        resetMining();
    });

    // Secondary Action (RMB): Eat held Food OR Place held Block from inventory
    bus.on('player:secondaryAction', () => {
        audio.unlock();
        if (player.isDead) return;
        const activeSlot = inventory.getActiveSlot();
        if (!activeSlot || activeSlot.count <= 0) return;

        const itemDef = getItemDef(activeSlot.id);

        // 1. Consumable food (restores hunger and/or health)
        if (itemDef.healAmount > 0 || itemDef.hungerRestore > 0) {
            const needHealth = itemDef.healAmount > 0 && player.health < player.maxHealth;
            const needHunger = itemDef.hungerRestore > 0 && player.hunger < player.maxHunger;
            if (needHealth || needHunger) {
                if (itemDef.healAmount > 0) player.heal(itemDef.healAmount);
                if (itemDef.hungerRestore > 0) player.feed(itemDef.hungerRestore);
                inventory.consumeActiveSlot(1);
                heldView.triggerSwing();
                audio.playEat();
                hud.showToast(`Ate ${itemDef.name}`);
            } else {
                hud.showToast('Health & Hunger are full!');
            }
            return;
        }

        // 2. Block placement
        if (!currentTarget || !currentTarget.hit || !currentTarget.adjacentPos) return;
        const { x, y, z } = currentTarget.adjacentPos;
        if (!isValidPlaceableBlock(activeSlot.id)) return;

        // Prevent placing solid blocks inside the player's own AABB
        if (player.wouldBlockIntersectPlayer(x, y, z)) return;

        if (world.setBlockWorld(x, y, z, activeSlot.id, false)) {
            if (activeSlot.id === BLOCK_IDS.TORCH) {
                activeTorches.set(`${x},${y},${z}`, { x, y, z });
                syncTorchList();
            }
            audio.playPlace();
            inventory.consumeActiveSlot(1);
            heldView.triggerSwing();
        }
    });

    bus.on('player:pickAction', () => {
        if (!currentTarget || !currentTarget.hit) return;
        if (isValidPlaceableBlock(currentTarget.blockId)) {
            hud.selectOrAssignBlock(currentTarget.blockId);
        }
    });

    // Respawn handling
    bus.on('player:requestRespawn', () => {
        const spawn = world.findSafeSpawn(0, 0);
        const scx = Math.floor(spawn.x / CHUNK_SIZE_X);
        const scz = Math.floor(spawn.z / CHUNK_SIZE_Z);
        world.ensureChunkSync(scx, scz);
        player.respawn(spawn);
        menu.hide();
        player.requestPointerLock();
    });

    // PointerLock & Modal Transitions
    bus.on('player:pointerLock', (locked) => {
        if (locked) {
            paletteOpen = false;
            hud.setPaletteOpen(false);
            menu.hide();
            hud.setCrosshairVisible(true);
        } else {
            hud.setCrosshairVisible(false);
            resetMining();
            if (!paletteOpen && !player.isDead) {
                menu.show();
            }
        }
    });

    bus.on('hud:togglePalette', () => {
        if (menu.visible || player.isDead) return;
        paletteOpen = !paletteOpen;
        hud.setPaletteOpen(paletteOpen);
        if (paletteOpen) {
            player.exitPointerLock();
        } else {
            player.requestPointerLock();
        }
    });

    bus.on('hud:closePalette', (reLock) => {
        paletteOpen = false;
        hud.setPaletteOpen(false);
        if (reLock && !player.isDead) {
            player.requestPointerLock();
        }
    });

    bus.on('player:flyToggled', (flying) => {
        hud.setFlyMode(flying);
    });

    bus.on('world:newSoloSeed', (seed) => {
        startSoloWorld(seed);
    });

    // World Export / Import
    function exportWorldData() {
        const data = {
            version: 1,
            format: 'voxel-sandbox-world',
            timestamp: Date.now(),
            seed: world.seed,
            deltas: world.getSerializedDeltas(),
            player: {
                position: { x: player.position.x, y: player.position.y, z: player.position.z },
                yaw: player.yaw,
                pitch: player.pitch,
                health: player.health,
                maxHealth: player.maxHealth,
                hunger: player.hunger,
                maxHunger: player.maxHunger,
                inventory: inventory.serialize(),
            },
            dayNight: {
                timeOfDay: dayNight.timeOfDay,
                dayCount: dayNight.dayCount,
            },
            torches: Array.from(activeTorches.values()),
        };
        return data;
    }

    function downloadWorldFile() {
        const data = exportWorldData();
        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const filename = `voxel-world-${world.seed}-${Date.now()}.json`;
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2500);
        hud.showToast(`Exported world to ${filename}`);
    }

    function importWorldData(data) {
        if (!data || typeof data !== 'object') {
            alert('Invalid world data file.');
            return false;
        }
        if (data.format !== 'voxel-sandbox-world' && !Array.isArray(data.deltas)) {
            alert('Unrecognized world save format.');
            return false;
        }

        const seed = typeof data.seed === 'number' ? data.seed : DEFAULT_SEED;
        const initialDeltas = Array.isArray(data.deltas) ? data.deltas : [];

        // Reset world and apply imported deltas
        world.resetWorld(seed, initialDeltas);
        dropManager.clearAll();
        mobManager.clearAll();
        activeTorches.clear();

        if (Array.isArray(data.torches)) {
            for (const t of data.torches) {
                if (t && typeof t.x === 'number' && typeof t.y === 'number' && typeof t.z === 'number') {
                    activeTorches.set(`${t.x},${t.y},${t.z}`, { x: t.x, y: t.y, z: t.z });
                }
            }
        }
        syncTorchList();

        // Restore day/night cycle
        if (data.dayNight && typeof data.dayNight.timeOfDay === 'number') {
            dayNight.timeOfDay = data.dayNight.timeOfDay;
            if (typeof data.dayNight.dayCount === 'number') {
                dayNight.dayCount = data.dayNight.dayCount;
            }
        }

        // Restore player position & stats
        const p = data.player;
        if (p && p.position && typeof p.position.x === 'number') {
            const scx = Math.floor(p.position.x / CHUNK_SIZE_X);
            const scz = Math.floor(p.position.z / CHUNK_SIZE_Z);
            for (let dz = -1; dz <= 1; dz++) {
                for (let dx = -1; dx <= 1; dx++) {
                    world.ensureChunkSync(scx + dx, scz + dz);
                }
            }
            player.setPosition(p.position.x, p.position.y, p.position.z);
            if (typeof p.yaw === 'number') player.yaw = p.yaw;
            if (typeof p.pitch === 'number') player.pitch = p.pitch;
            if (typeof p.health === 'number') player.health = p.health;
            if (typeof p.hunger === 'number') player.hunger = p.hunger;
            if (p.inventory) inventory.deserialize(p.inventory);
        } else {
            const spawn = world.findSafeSpawn(0, 0);
            player.respawn(spawn);
        }

        mobManager.spawnInitialMobs(player.position, dayNight.isNight());
        hud.renderHealth(player.health, player.maxHealth);
        hud.renderHunger(player.hunger, player.maxHunger);
        hud.showToast('World imported successfully!');
        return true;
    }

    bus.on('world:exportRequested', () => {
        downloadWorldFile();
    });

    bus.on('world:importRequested', (data) => {
        importWorldData(data);
    });

    // Expose read-only diagnostic hook for debugging & automated verification
    window.__VOXEL_GAME__ = {
        world,
        player,
        inventory,
        crafting,
        dropManager,
        mobManager,
        heldView,
        network,
        renderer,
        hud,
        menu,
        dayNight,
        audio,
        breakBlockAndSpawnDrops,
        exportWorldData,
        importWorldData,
    };

    // Clicking canvas directly when modals are closed re-engages pointer lock
    renderer.webgl.domElement.addEventListener('click', () => {
        audio.unlock();
        if (!menu.visible && !paletteOpen && !player.isDead && !player.pointerLocked) {
            player.requestPointerLock();
        }
    });

    // Fixed-timestep physics + 60 FPS WebGL render loop
    let lastTime = performance.now();
    let accumulator = 0;
    let lastClockText = '';

    function frame(nowMs) {
        requestAnimationFrame(frame);

        const rawDelta = Math.min((nowMs - lastTime) / 1000, MAX_FRAME_DELTA);
        lastTime = nowMs;

        // Advance day/night cycle and update sky/sun/moon/stars
        dayNight.update(rawDelta);
        renderer.updateDayNight(dayNight, player.position);
        renderer.updateTorchLights(torchListCache, player.position, nowMs * 0.001);

        const clockText = dayNight.getFormattedClock();
        if (clockText !== lastClockText) {
            lastClockText = clockText;
            hud.updateTimeBadge(clockText, dayNight.getPhaseLabel());
        }

        // Stream chunks & flush throttled GPU uploads even while in menu so world loads immediately
        world.update(player.position.x, player.position.z);

        accumulator += rawDelta;
        while (accumulator >= PHYSICS_TIMESTEP) {
            player.updatePhysics(PHYSICS_TIMESTEP);
            dropManager.update(PHYSICS_TIMESTEP, player.position, player.isDead);
            mobManager.update(PHYSICS_TIMESTEP, player, dayNight.isNight());
            accumulator -= PHYSICS_TIMESTEP;
        }

        // Update underwater atmosphere
        renderer.setUnderwater(player.eyeInWater);
        hud.setUnderwater(player.eyeInWater);
        hud.renderOxygen(player.oxygen, player.maxOxygen, player.eyeInWater);

        // Update voxel & mob targeting + continuous block breaking
        let activelyMining = false;
        if (player.pointerLocked && !player.isDead) {
            const eyePos = player.getEyePosition();
            const lookDir = player.getLookDirection();

            currentTarget = raycastVoxel(
                eyePos,
                lookDir,
                (wx, wy, wz) => world.getBlock(wx, wy, wz)
            );
            currentMobTarget = mobManager.raycastMob(eyePos, lookDir, 4.6);

            const blockDist = currentTarget.hit ? currentTarget.distance : Infinity;
            const mobCloser = currentMobTarget.hit && currentMobTarget.distance <= blockDist;

            if (mobCloser && currentMobTarget.mob) {
                renderer.setHighlightBlock(null);
                resetMining();
                const m = currentMobTarget.mob;
                hud.updateTargetHud({
                    visible: true,
                    label: `${m.name} (${Math.ceil(m.health)} / ${m.maxHealth} HP)`,
                    progress: m.health / m.maxHealth,
                    isMob: true,
                });
            } else if (currentTarget.hit) {
                renderer.setHighlightBlock(currentTarget.blockPos);
                const { x, y, z } = currentTarget.blockPos;
                const key = `${x},${y},${z}`;
                const blockDef = getBlockDef(currentTarget.blockId);
                const heldId = inventory.getSelectedItemId();
                const mult = getMiningSpeedMultiplier(heldId, currentTarget.blockId);

                if (player.primaryHeld && blockDef.breakable) {
                    activelyMining = true;
                    if (miningKey !== key) {
                        miningKey = key;
                        miningProgress = 0;
                    }
                    digSoundTimer += rawDelta;
                    if (digSoundTimer >= 0.22) {
                        digSoundTimer = 0;
                        audio.playDig();
                    }
                    const breakTime = getBlockBreakTime(currentTarget.blockId, heldId);
                    miningProgress += rawDelta / breakTime;
                    if (miningProgress >= 1.0) {
                        breakBlockAndSpawnDrops(x, y, z, currentTarget.blockId);
                        resetMining();
                    }
                } else if (miningKey !== key) {
                    resetMining();
                }

                renderer.setCrackProgress(currentTarget.blockPos, miningProgress);

                if (miningProgress > 0) {
                    const multTag = mult > 1.0 ? ` · ${mult}x Speed` : '';
                    hud.updateTargetHud({
                        visible: true,
                        label: `Mining ${blockDef.name}${multTag} (${Math.min(100, Math.round(miningProgress * 100))}%)`,
                        progress: miningProgress,
                        isMob: false,
                    });
                } else {
                    hud.updateTargetHud({ visible: false });
                }
            } else {
                renderer.setHighlightBlock(null);
                resetMining();
                hud.updateTargetHud({ visible: false });
            }
        } else {
            currentTarget = null;
            currentMobTarget = null;
            renderer.setHighlightBlock(null);
            resetMining();
            hud.updateTargetHud({ visible: false });
        }

        heldView.update(rawDelta, player.isMovingHorizontally() && player.onGround, activelyMining);

        // Update network sync & remote player interpolation
        network.update(rawDelta, nowMs, hud.getSelectedBlockId());

        // Render scene & update F3 telemetry
        renderer.render();
        hud.updateTelemetry(nowMs, rawDelta, player, world, renderer, network, mobManager, dropManager);
    }

    requestAnimationFrame(frame);
}

bootstrap();
