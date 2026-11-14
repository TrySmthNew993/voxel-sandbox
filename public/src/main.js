/**
 * Main game entry point wiring Core, Renderer, WorldManager, PlayerController,
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
import { EventBus } from './core/EventBus.js';
import { TextureAtlas } from './renderer/TextureAtlas.js';
import { Renderer } from './renderer/Renderer.js';
import { WorldManager } from './world/WorldManager.js';
import { raycastVoxel } from './world/Raycaster.js';
import { PlayerController } from './physics/PlayerController.js';
import { NetworkClient } from './networking/NetworkClient.js';
import { HUD } from './ui/HUD.js';
import { MenuModal } from './ui/MenuModal.js';

function bootstrap() {
    const viewport = document.getElementById('game-viewport');
    const bus = new EventBus();
    const atlas = new TextureAtlas();
    const renderer = new Renderer(viewport, atlas);
    const world = new WorldManager(renderer, bus);

    const player = new PlayerController({
        world,
        camera: renderer.camera,
        domElement: renderer.webgl.domElement,
        bus,
    });

    const network = new NetworkClient({ renderer, world, player, bus });
    const hud = new HUD({ atlas, bus });
    const menu = new MenuModal({ bus, world, player, network, hud });

    // Initialize Solo world and place player safely on solid surface
    function startSoloWorld(seed) {
        world.resetWorld(seed);
        const spawn = world.findSafeSpawn(0, 0);
        const scx = Math.floor(spawn.x / CHUNK_SIZE_X);
        const scz = Math.floor(spawn.z / CHUNK_SIZE_Z);
        world.ensureChunkSync(scx, scz);
        player.setPosition(spawn.x, spawn.y, spawn.z);
    }

    startSoloWorld(DEFAULT_SEED);

    // Expose read-only diagnostic hook for debugging & automated verification
    window.__VOXEL_GAME__ = { world, player, network, renderer, hud, menu };

    let currentTarget = null;
    let paletteOpen = false;

    // Voxel Breaking / Placing / Pick Block
    bus.on('player:primaryAction', () => {
        if (!currentTarget || !currentTarget.hit) return;
        const { x, y, z } = currentTarget.blockPos;
        const def = getBlockDef(currentTarget.blockId);
        if (!def.breakable) return;
        world.setBlockWorld(x, y, z, BLOCK_IDS.AIR, false);
    });

    bus.on('player:secondaryAction', () => {
        if (!currentTarget || !currentTarget.hit || !currentTarget.adjacentPos) return;
        const { x, y, z } = currentTarget.adjacentPos;
        const selectedBlockId = hud.getSelectedBlockId();
        if (!isValidPlaceableBlock(selectedBlockId)) return;

        // Prevent placing solid blocks inside the player's own AABB
        if (player.wouldBlockIntersectPlayer(x, y, z)) return;

        world.setBlockWorld(x, y, z, selectedBlockId, false);
    });

    bus.on('player:pickAction', () => {
        if (!currentTarget || !currentTarget.hit) return;
        if (isValidPlaceableBlock(currentTarget.blockId)) {
            hud.selectOrAssignBlock(currentTarget.blockId);
        }
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
            if (!paletteOpen) {
                menu.show();
            }
        }
    });

    bus.on('hud:togglePalette', () => {
        if (menu.visible) return;
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
        if (reLock) {
            player.requestPointerLock();
        }
    });

    bus.on('player:flyToggled', (flying) => {
        hud.setFlyMode(flying);
    });

    bus.on('world:newSoloSeed', (seed) => {
        startSoloWorld(seed);
    });

    // Clicking canvas directly when both modals are closed re-engages pointer lock
    renderer.webgl.domElement.addEventListener('click', () => {
        if (!menu.visible && !paletteOpen && !player.pointerLocked) {
            player.requestPointerLock();
        }
    });

    // Fixed-timestep physics + 60 FPS WebGL render loop
    let lastTime = performance.now();
    let accumulator = 0;

    function frame(nowMs) {
        requestAnimationFrame(frame);

        const rawDelta = Math.min((nowMs - lastTime) / 1000, MAX_FRAME_DELTA);
        lastTime = nowMs;

        // Stream chunks & flush throttled GPU uploads even while in menu so world loads immediately
        world.update(player.position.x, player.position.z);

        accumulator += rawDelta;
        while (accumulator >= PHYSICS_TIMESTEP) {
            player.updatePhysics(PHYSICS_TIMESTEP);
            accumulator -= PHYSICS_TIMESTEP;
        }

        // Update underwater atmosphere
        renderer.setUnderwater(player.eyeInWater);
        hud.setUnderwater(player.eyeInWater);

        // Update voxel selection raycast
        if (player.pointerLocked) {
            currentTarget = raycastVoxel(
                player.getEyePosition(),
                player.getLookDirection(),
                (wx, wy, wz) => world.getBlock(wx, wy, wz)
            );
            renderer.setHighlightBlock(currentTarget.hit ? currentTarget.blockPos : null);
        } else {
            currentTarget = null;
            renderer.setHighlightBlock(null);
        }

        // Update network sync & remote player interpolation
        network.update(rawDelta, nowMs, hud.getSelectedBlockId());

        // Render scene & update F3 telemetry
        renderer.render();
        hud.updateTelemetry(nowMs, rawDelta, player, world, renderer, network);
    }

    requestAnimationFrame(frame);
}

bootstrap();
