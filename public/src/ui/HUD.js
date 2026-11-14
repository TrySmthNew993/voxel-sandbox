/**
 * Manages the in-game HUD: 9-slot hotbar with procedural block thumbnails,
 * block palette drawer (E), crosshair visibility, underwater vignette, and F3 telemetry.
 */

import { HOTBAR_DEFAULT, PALETTE_BLOCKS, getBlockDef } from '../core/BlockRegistry.js';
import { worldToChunkCoord } from '../core/MathUtils.js';

export class HUD {
    /**
     * @param {object} opts
     * @param {import('../renderer/TextureAtlas.js').TextureAtlas} opts.atlas
     * @param {import('../core/EventBus.js').EventBus} opts.bus
     */
    constructor({ atlas, bus }) {
        this.atlas = atlas;
        this.bus = bus;

        this.slots = [...HOTBAR_DEFAULT];
        this.activeIndex = 0;
        this.paletteOpen = false;
        this.debugVisible = false;

        this.crosshairEl = document.getElementById('crosshair');
        this.underwaterEl = document.getElementById('underwater-tint');
        this.hotbarEl = document.getElementById('hotbar');
        this.toastEl = document.getElementById('block-toast');
        this.modeEl = document.getElementById('mode-indicator');
        this.debugOverlayEl = document.getElementById('debug-overlay');
        this.debugTextEl = document.getElementById('debug-text');
        this.paletteModalEl = document.getElementById('palette-modal');
        this.paletteGridEl = document.getElementById('palette-grid');
        this.paletteCloseBtn = document.getElementById('palette-close-btn');

        this._toastTimer = null;
        this._fpsFrames = 0;
        this._fpsLastTime = performance.now();
        this._fpsDisplay = 60;
        this._frameMsDisplay = 16.7;

        this._renderHotbar();
        this._renderPalette();
        this._bindEvents();
        this.showToast(getBlockDef(this.getSelectedBlockId()).name);
    }

    _bindEvents() {
        this._onKeyDown = (e) => {
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

            if (e.code.startsWith('Digit')) {
                const num = Number(e.code.slice(5));
                if (num >= 1 && num <= 9) {
                    this.selectSlot(num - 1);
                }
            } else if (e.code === 'F3') {
                e.preventDefault();
                this.setDebugVisible(!this.debugVisible);
                this.bus.emit('hud:debugChanged', this.debugVisible);
            } else if (e.code === 'KeyE') {
                this.bus.emit('hud:togglePalette');
            } else if (e.code === 'Escape' && this.paletteOpen) {
                this.bus.emit('hud:closePalette', false);
            }
        };

        this._onWheel = (e) => {
            if (this.paletteOpen) return;
            const delta = Math.sign(e.deltaY);
            if (delta !== 0) {
                const next = (this.activeIndex + delta + 9) % 9;
                this.selectSlot(next);
            }
        };

        this.paletteCloseBtn.addEventListener('click', () => {
            this.bus.emit('hud:closePalette', true);
        });

        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('wheel', this._onWheel, { passive: true });
    }

    _renderHotbar() {
        this.hotbarEl.innerHTML = '';
        this.slotEls = this.slots.map((blockId, idx) => {
            const def = getBlockDef(blockId);
            const el = document.createElement('div');
            el.className = `hotbar-slot${idx === this.activeIndex ? ' active' : ''}`;
            el.title = `${idx + 1}: ${def.name}`;

            const keyEl = document.createElement('span');
            keyEl.className = 'hotbar-key';
            keyEl.textContent = String(idx + 1);

            const img = document.createElement('img');
            img.alt = def.name;
            img.src = this.atlas.getTileDataUrl(def.previewTile);

            el.append(keyEl, img);
            this.hotbarEl.appendChild(el);
            return el;
        });
    }

    _renderPalette() {
        this.paletteGridEl.innerHTML = '';
        for (const blockId of PALETTE_BLOCKS) {
            const def = getBlockDef(blockId);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'palette-item';

            const img = document.createElement('img');
            img.alt = def.name;
            img.src = this.atlas.getTileDataUrl(def.previewTile);

            const label = document.createElement('span');
            label.textContent = def.name;

            btn.append(img, label);
            btn.addEventListener('click', () => {
                this.assignBlockToActiveSlot(blockId);
                this.bus.emit('hud:closePalette', true);
            });
            this.paletteGridEl.appendChild(btn);
        }
    }

    selectSlot(idx) {
        if (idx < 0 || idx > 8) return;
        this.activeIndex = idx;
        for (let i = 0; i < this.slotEls.length; i++) {
            this.slotEls[i].classList.toggle('active', i === idx);
        }
        this.showToast(getBlockDef(this.getSelectedBlockId()).name);
    }

    assignBlockToActiveSlot(blockId) {
        this.slots[this.activeIndex] = blockId;
        this._renderHotbar();
        this.showToast(getBlockDef(blockId).name);
    }

    selectOrAssignBlock(blockId) {
        const existingIdx = this.slots.indexOf(blockId);
        if (existingIdx !== -1) {
            this.selectSlot(existingIdx);
        } else {
            this.assignBlockToActiveSlot(blockId);
        }
    }

    getSelectedBlockId() {
        return this.slots[this.activeIndex];
    }

    showToast(text) {
        this.toastEl.textContent = text;
        this.toastEl.classList.add('visible');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            this.toastEl.classList.remove('visible');
        }, 1800);
    }

    setCrosshairVisible(visible) {
        this.crosshairEl.classList.toggle('hidden', !visible);
    }

    setUnderwater(underwater) {
        this.underwaterEl.classList.toggle('hidden', !underwater);
    }

    setFlyMode(flying) {
        this.modeEl.classList.toggle('hidden', !flying);
    }

    setPaletteOpen(open) {
        this.paletteOpen = open;
        this.paletteModalEl.classList.toggle('hidden', !open);
    }

    setDebugVisible(visible) {
        this.debugVisible = visible;
        this.debugOverlayEl.classList.toggle('hidden', !visible);
    }

    /**
     * Update FPS counter and F3 debug telemetry block.
     */
    updateTelemetry(nowMs, frameDeltaSec, player, world, renderer, network) {
        this._fpsFrames++;
        const elapsed = nowMs - this._fpsLastTime;
        if (elapsed >= 250) {
            this._fpsDisplay = Math.round((this._fpsFrames * 1000) / elapsed);
            this._frameMsDisplay = (elapsed / this._fpsFrames).toFixed(1);
            this._fpsFrames = 0;
            this._fpsLastTime = nowMs;
        }

        if (!this.debugVisible) return;

        const p = player.position;
        const { cx, cz, lx, lz } = worldToChunkCoord(Math.floor(p.x), Math.floor(p.z));
        const stats = world.getStats();
        const gpu = renderer.getDrawCallsAndTriangles();
        const look = player.getLookDirection();
        const heading =
            Math.abs(look.x) > Math.abs(look.z)
                ? (look.x > 0 ? 'East (+X)' : 'West (-X)')
                : (look.z > 0 ? 'South (+Z)' : 'North (-Z)');

        const netLine = network.connected
            ? `LAN: Connected (${network.getRemotePlayerCount() + 1} players, ${network.pingMs ?? '--'} ms)`
            : 'LAN: Solo Mode';

        this.debugTextEl.textContent = [
            `FPS: ${this._fpsDisplay} (${this._frameMsDisplay} ms)`,
            `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
            `Chunk: ${cx}, ${cz} (local ${lx}, ${Math.floor(p.y)}, ${lz})`,
            `Facing: ${heading}${player.flying ? ' [FLY]' : ''}`,
            `Chunks: ${stats.meshedChunks} meshed / ${stats.loadedChunks} cached (Q: ${stats.pendingGen}g / ${stats.pendingMesh}m)`,
            `WebGL: ${gpu.calls} calls, ${gpu.triangles.toLocaleString()} tris`,
            netLine,
        ].join('\n');
    }

    dispose() {
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('wheel', this._onWheel);
        clearTimeout(this._toastTimer);
    }
}
