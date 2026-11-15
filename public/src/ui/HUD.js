/**
 * Manages the in-game Survival & Crafting HUD:
 * - 9-slot Hotbar with procedural pixel-art thumbnails, stack counts, and tool/weapon badges
 * - 10-heart Player Health Bar, damage flash vignette, and Death/Respawn modal
 * - Crosshair block mining progress bar & targeted Mob health bar
 * - Full Inventory (27 backpack + 9 hotbar slots) & Crafting Bench modal (E or C key)
 * - F3 performance & world telemetry overlay
 */

import { ALL_CREATIVE_ITEMS, getItemDef } from '../core/ItemRegistry.js';
import { HOTBAR_SIZE, TOTAL_INVENTORY_SLOTS } from '../inventory/InventoryManager.js';
import { worldToChunkCoord } from '../core/MathUtils.js';

export class HUD {
    /**
     * @param {object} opts
     * @param {import('../renderer/TextureAtlas.js').TextureAtlas} opts.atlas
     * @param {import('../core/EventBus.js').EventBus} opts.bus
     * @param {import('../inventory/InventoryManager.js').InventoryManager} opts.inventory
     * @param {import('../crafting/CraftingSystem.js').CraftingSystem} opts.crafting
     */
    constructor({ atlas, bus, inventory, crafting }) {
        this.atlas = atlas;
        this.bus = bus;
        this.inventory = inventory;
        this.crafting = crafting;

        this.paletteOpen = false;
        this.debugVisible = false;
        this.selectedSwapSlot = null;

        this.crosshairEl = document.getElementById('crosshair');
        this.underwaterEl = document.getElementById('underwater-tint');
        this.damageTintEl = document.getElementById('damage-tint');

        this.targetHudEl = document.getElementById('target-hud');
        this.targetLabelEl = document.getElementById('target-label');
        this.targetBarFillEl = document.getElementById('target-bar-fill');

        this.healthHeartsEl = document.getElementById('health-hearts');
        this.healthTextEl = document.getElementById('health-text');
        this.hungerDrumsEl = document.getElementById('hunger-drums');
        this.hungerTextEl = document.getElementById('hunger-text');
        this.oxygenBarEl = document.getElementById('oxygen-bar');
        this.oxygenBubblesEl = document.getElementById('oxygen-bubbles');
        this.oxygenTextEl = document.getElementById('oxygen-text');
        this.timeClockBadgeEl = document.getElementById('time-clock-badge');
        this.audioMuteBtn = document.getElementById('audio-mute-btn');
        this.openCraftingBtn = document.getElementById('open-crafting-btn');

        this.hotbarEl = document.getElementById('hotbar');
        this.toastEl = document.getElementById('block-toast');
        this.modeEl = document.getElementById('mode-indicator');
        this.debugOverlayEl = document.getElementById('debug-overlay');
        this.debugTextEl = document.getElementById('debug-text');

        // Inventory & Crafting modal elements
        this.paletteModalEl = document.getElementById('palette-modal');
        this.paletteCloseBtn = document.getElementById('palette-close-btn');
        this.craftingListEl = document.getElementById('crafting-recipes-list');
        this.backpackGridEl = document.getElementById('backpack-grid');
        this.modalHotbarGridEl = document.getElementById('modal-hotbar-grid');
        this.cursorHintEl = document.getElementById('inv-cursor-hint');
        this.paletteGridEl = document.getElementById('palette-grid');

        // Death / Respawn modal elements
        this.deathModalEl = document.getElementById('death-modal');
        this.deathReasonEl = document.getElementById('death-reason-text');
        this.respawnBtn = document.getElementById('respawn-btn');

        this._toastTimer = null;
        this._damageFlashTimer = null;
        this._fpsFrames = 0;
        this._fpsLastTime = performance.now();
        this._fpsDisplay = 60;
        this._frameMsDisplay = 16.7;

        this.renderHealth(20, 20);
        this._renderHotbar();
        this._renderCreativePalette();
        this._renderInventoryAndCraftingModal();
        this._bindEvents();

        const initialItem = getItemDef(this.getSelectedBlockId());
        this.showToast(initialItem ? initialItem.name : 'Gather Wood & Stone to Craft');
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
            } else if (e.code === 'KeyE' || (e.code === 'KeyC' && !this.paletteOpen)) {
                this.bus.emit('hud:togglePalette');
            } else if (e.code === 'KeyM') {
                this.bus.emit('hud:toggleMute');
            } else if (e.code === 'Escape' && this.paletteOpen) {
                this.bus.emit('hud:closePalette', false);
            } else if ((e.code === 'KeyR' || e.code === 'Enter') && !this.deathModalEl.classList.contains('hidden')) {
                this.bus.emit('player:requestRespawn');
            }
        };

        this._onWheel = (e) => {
            if (this.paletteOpen) return;
            const delta = Math.sign(e.deltaY);
            if (delta !== 0) {
                const next = (this.inventory.activeIndex + delta + HOTBAR_SIZE) % HOTBAR_SIZE;
                this.selectSlot(next);
            }
        };

        this.paletteCloseBtn?.addEventListener('click', () => {
            this.bus.emit('hud:closePalette', true);
        });

        this.openCraftingBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.bus.emit('hud:togglePalette');
        });

        this.audioMuteBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.bus.emit('hud:toggleMute');
        });

        this.respawnBtn?.addEventListener('click', () => {
            this.bus.emit('player:requestRespawn');
        });

        this.bus.on('inventory:changed', () => {
            this._renderHotbar();
            if (this.paletteOpen) {
                this._renderInventoryAndCraftingModal();
            }
        });

        this.bus.on('inventory:itemAdded', ({ name, count }) => {
            this.showToast(`+${count} ${name}`);
        });

        this.bus.on('crafting:crafted', ({ name, count }) => {
            this.showToast(`Crafted ${count}x ${name}!`);
            this._renderInventoryAndCraftingModal();
        });

        this.bus.on('player:healthChanged', ({ health, maxHealth }) => {
            this.renderHealth(health, maxHealth);
        });

        this.bus.on('player:damaged', ({ cause }) => {
            this.triggerDamageFlash();
            if (cause) {
                this.showToast(`-${cause}`);
            }
        });

        this.bus.on('player:died', ({ cause }) => {
            this.showDeathModal(cause || 'You perished in the wilderness');
        });

        this.bus.on('player:respawned', () => {
            this.hideDeathModal();
            this.showToast('Respawned with full health!');
        });

        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('wheel', this._onWheel, { passive: true });
    }

    /**
     * Render the 10-heart survival health bar.
     */
    renderHealth(health, maxHealth = 20) {
        if (!this.healthHeartsEl || !this.healthTextEl) return;
        this.healthHeartsEl.innerHTML = '';
        const totalHearts = Math.ceil(maxHealth / 2);

        for (let i = 0; i < totalHearts; i++) {
            const heartVal = health - i * 2;
            const span = document.createElement('span');
            if (heartVal >= 2) {
                span.className = 'heart-icon heart-full';
                span.textContent = '♥';
            } else if (heartVal === 1) {
                span.className = 'heart-icon heart-half';
                span.textContent = '♥';
            } else {
                span.className = 'heart-icon heart-empty';
                span.textContent = '♡';
            }
            this.healthHeartsEl.appendChild(span);
        }

        this.healthTextEl.textContent = `${Math.max(0, Math.round(health))} / ${maxHealth} HP`;
    }

    /**
     * Render the 10-drumstick hunger bar.
     */
    renderHunger(hunger, maxHunger = 20) {
        if (!this.hungerDrumsEl || !this.hungerTextEl) return;
        this.hungerDrumsEl.innerHTML = '';
        const total = Math.ceil(maxHunger / 2);
        for (let i = 0; i < total; i++) {
            const val = hunger - i * 2;
            const span = document.createElement('span');
            if (val >= 2) {
                span.className = 'drum-icon full';
            } else if (val === 1) {
                span.className = 'drum-icon half';
            } else {
                span.className = 'drum-icon';
            }
            this.hungerDrumsEl.appendChild(span);
        }
        this.hungerTextEl.textContent = `${Math.max(0, Math.round(hunger))} / ${maxHunger}`;
    }

    /**
     * Render underwater oxygen bubbles bar (visible only when submerged or recovering).
     */
    renderOxygen(oxygen, maxOxygen = 10, underwater = false) {
        if (!this.oxygenBarEl || !this.oxygenBubblesEl || !this.oxygenTextEl) return;
        if (!underwater && oxygen >= maxOxygen) {
            this.oxygenBarEl.classList.add('hidden');
            return;
        }
        this.oxygenBarEl.classList.remove('hidden');
        this.oxygenBubblesEl.innerHTML = '';
        for (let i = 0; i < maxOxygen; i++) {
            const span = document.createElement('span');
            span.className = i < oxygen ? 'bubble-icon full' : 'bubble-icon';
            this.oxygenBubblesEl.appendChild(span);
        }
        this.oxygenTextEl.textContent = `${Math.max(0, Math.round(oxygen))} / ${maxOxygen} O₂`;
    }

    updateTimeBadge(clockText, phaseLabel) {
        if (!this.timeClockBadgeEl) return;
        this.timeClockBadgeEl.textContent = `${clockText} (${phaseLabel})`;
    }

    setAudioMuted(muted) {
        if (!this.audioMuteBtn) return;
        this.audioMuteBtn.textContent = muted ? 'Sound: OFF' : 'Sound: ON';
        this.audioMuteBtn.classList.toggle('muted', Boolean(muted));
    }

    triggerDamageFlash() {
        if (!this.damageTintEl) return;
        this.damageTintEl.classList.remove('hidden');
        clearTimeout(this._damageFlashTimer);
        this._damageFlashTimer = setTimeout(() => {
            this.damageTintEl.classList.add('hidden');
        }, 280);
    }

    showDeathModal(reasonText) {
        if (!this.deathModalEl) return;
        if (this.deathReasonEl) {
            this.deathReasonEl.textContent = reasonText;
        }
        this.deathModalEl.classList.remove('hidden');
    }

    hideDeathModal() {
        if (!this.deathModalEl) return;
        this.deathModalEl.classList.add('hidden');
    }

    /**
     * Update the center target HUD bar (either block breaking progress or targeted mob HP).
     * @param {{ visible: boolean, label?: string, progress?: number, isMob?: boolean }} state
     */
    updateTargetHud(state) {
        if (!this.targetHudEl) return;
        if (!state || !state.visible) {
            this.targetHudEl.classList.add('hidden');
            return;
        }
        this.targetHudEl.classList.remove('hidden');
        this.targetLabelEl.textContent = state.label || '';
        const pct = Math.max(0, Math.min(100, (state.progress || 0) * 100));
        this.targetBarFillEl.style.width = `${pct.toFixed(1)}%`;
        this.targetBarFillEl.classList.toggle('mob-bar', Boolean(state.isMob));
    }

    _formatItemTag(def) {
        if (!def || def.id === 0) return '';
        if (def.category === 'weapon') return `${def.attackDamage}ATK`;
        if (def.category === 'tool') return `${def.miningMultiplier}x`;
        if (def.category === 'food') return `+${def.healAmount}HP`;
        return '';
    }

    _renderHotbar() {
        this.hotbarEl.innerHTML = '';
        this.slotEls = [];

        for (let idx = 0; idx < HOTBAR_SIZE; idx++) {
            const slot = this.inventory.slots[idx];
            const def = slot ? getItemDef(slot.id) : null;

            const el = document.createElement('div');
            el.className = `hotbar-slot${idx === this.inventory.activeIndex ? ' active' : ''}`;
            el.title = def ? `${idx + 1}: ${def.name} (x${slot.count})` : `${idx + 1}: Empty Slot`;

            const keyEl = document.createElement('span');
            keyEl.className = 'hotbar-key';
            keyEl.textContent = String(idx + 1);
            el.appendChild(keyEl);

            if (def && slot) {
                const img = document.createElement('img');
                img.alt = def.name;
                img.src = this.atlas.getTileDataUrl(def.previewTile);
                el.appendChild(img);

                const tagText = this._formatItemTag(def);
                if (tagText) {
                    const tagEl = document.createElement('span');
                    tagEl.className = 'hotbar-tag';
                    tagEl.textContent = tagText;
                    el.appendChild(tagEl);
                }

                if (slot.count > 1 || def.maxStack > 1) {
                    const countEl = document.createElement('span');
                    countEl.className = 'hotbar-count';
                    countEl.textContent = String(slot.count);
                    el.appendChild(countEl);
                }
            }

            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectSlot(idx);
            });

            this.hotbarEl.appendChild(el);
            this.slotEls.push(el);
        }
    }

    _renderInventoryAndCraftingModal() {
        this._renderCraftingRecipes();
        this._renderInventoryGrids();
    }

    _renderCraftingRecipes() {
        if (!this.craftingListEl) return;
        this.craftingListEl.innerHTML = '';

        const recipes = this.crafting.getRecipes();
        for (const recipe of recipes) {
            const outDef = getItemDef(recipe.output.id);
            const canCraft = this.crafting.canCraft(recipe.id);

            const card = document.createElement('div');
            card.className = `recipe-card${canCraft ? ' craftable' : ''}`;

            const left = document.createElement('div');
            left.className = 'recipe-left';

            const icon = document.createElement('img');
            icon.className = 'recipe-icon';
            icon.alt = outDef.name;
            icon.src = this.atlas.getTileDataUrl(outDef.previewTile);

            const info = document.createElement('div');
            info.className = 'recipe-info';

            const title = document.createElement('div');
            title.className = 'recipe-title';
            title.textContent = recipe.name;

            const desc = document.createElement('div');
            desc.className = 'recipe-desc';
            desc.textContent = recipe.summary;

            const reqs = document.createElement('div');
            reqs.className = 'recipe-reqs';

            for (const req of recipe.ingredients) {
                const reqDef = getItemDef(req.id);
                const have = this.inventory.getItemCount(req.id);
                const met = have >= req.count;

                const pill = document.createElement('span');
                pill.className = `req-pill ${met ? 'met' : 'missing'}`;
                pill.textContent = `${have}/${req.count} ${reqDef.name}`;
                reqs.appendChild(pill);
            }

            info.append(title, desc, reqs);
            left.append(icon, info);

            const craftBtn = document.createElement('button');
            craftBtn.type = 'button';
            craftBtn.className = `btn-primary craft-action-btn`;
            craftBtn.textContent = canCraft ? 'Craft' : 'Need Items';
            craftBtn.disabled = !canCraft;
            craftBtn.addEventListener('click', () => {
                const res = this.crafting.craft(recipe.id);
                if (!res.ok && res.reason) {
                    this.showToast(res.reason);
                }
            });

            card.append(left, craftBtn);
            this.craftingListEl.appendChild(card);
        }
    }

    _renderInventoryGrids() {
        if (!this.backpackGridEl || !this.modalHotbarGridEl) return;
        this.backpackGridEl.innerHTML = '';
        this.modalHotbarGridEl.innerHTML = '';

        if (this.cursorHintEl) {
            if (this.selectedSwapSlot !== null) {
                const s = this.inventory.slots[this.selectedSwapSlot];
                const name = s ? getItemDef(s.id).name : 'Empty Slot';
                this.cursorHintEl.textContent = `Moving [${name}] — click target slot to swap/merge`;
            } else {
                this.cursorHintEl.textContent = 'Click two slots to swap · Shift+Click to quick-move';
            }
        }

        // Backpack slots (indices 9..35)
        for (let i = HOTBAR_SIZE; i < TOTAL_INVENTORY_SLOTS; i++) {
            this.backpackGridEl.appendChild(this._createModalSlotEl(i, false));
        }

        // Hotbar slots (indices 0..8)
        for (let i = 0; i < HOTBAR_SIZE; i++) {
            this.modalHotbarGridEl.appendChild(this._createModalSlotEl(i, true));
        }
    }

    _createModalSlotEl(index, isHotbar) {
        const slot = this.inventory.slots[index];
        const def = slot ? getItemDef(slot.id) : null;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'inv-slot';
        if (this.selectedSwapSlot === index) {
            btn.classList.add('selected-swap');
        }
        if (isHotbar && index === this.inventory.activeIndex) {
            btn.classList.add('active-hotbar');
        }
        btn.title = def
            ? `${def.name} (x${slot.count}) — ${def.description}`
            : isHotbar
                ? `Hotbar Slot ${index + 1} (Empty)`
                : 'Backpack Slot (Empty)';

        if (isHotbar) {
            const keyEl = document.createElement('span');
            keyEl.className = 'hotbar-key';
            keyEl.textContent = String(index + 1);
            btn.appendChild(keyEl);
        }

        if (def && slot) {
            const img = document.createElement('img');
            img.alt = def.name;
            img.src = this.atlas.getTileDataUrl(def.previewTile);
            btn.appendChild(img);

            const tagText = this._formatItemTag(def);
            if (tagText) {
                const tagEl = document.createElement('span');
                tagEl.className = 'inv-slot-tag';
                tagEl.textContent = tagText;
                btn.appendChild(tagEl);
            }

            if (slot.count > 1 || def.maxStack > 1) {
                const countEl = document.createElement('span');
                countEl.className = 'inv-slot-count';
                countEl.textContent = String(slot.count);
                btn.appendChild(countEl);
            }
        }

        btn.addEventListener('click', (e) => {
            if (e.shiftKey) {
                this.selectedSwapSlot = null;
                this.inventory.quickMoveSlot(index);
                return;
            }

            if (this.selectedSwapSlot === null) {
                this.selectedSwapSlot = index;
                if (isHotbar) {
                    this.inventory.selectSlot(index);
                }
                this._renderInventoryGrids();
            } else if (this.selectedSwapSlot === index) {
                this.selectedSwapSlot = null;
                this._renderInventoryGrids();
            } else {
                const from = this.selectedSwapSlot;
                this.selectedSwapSlot = null;
                this.inventory.swapOrMergeSlots(from, index);
            }
        });

        return btn;
    }

    _renderCreativePalette() {
        if (!this.paletteGridEl) return;
        this.paletteGridEl.innerHTML = '';

        for (const itemId of ALL_CREATIVE_ITEMS) {
            const def = getItemDef(itemId);
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'palette-item';
            btn.title = def.description;

            const img = document.createElement('img');
            img.alt = def.name;
            img.src = this.atlas.getTileDataUrl(def.previewTile);

            const label = document.createElement('span');
            label.textContent = def.name;

            btn.append(img, label);
            btn.addEventListener('click', () => {
                const qty = def.maxStack > 1 ? 8 : 1;
                this.inventory.addItem(itemId, qty);
                this.showToast(`Added ${qty}x ${def.name}`);
            });
            this.paletteGridEl.appendChild(btn);
        }
    }

    selectSlot(idx) {
        if (idx < 0 || idx >= HOTBAR_SIZE) return;
        this.inventory.selectSlot(idx);
        const def = getItemDef(this.getSelectedBlockId());
        const extra = this._formatItemTag(def);
        this.showToast(extra ? `${def.name} (${extra})` : def.name);
    }

    assignBlockToActiveSlot(blockId) {
        const def = getItemDef(blockId);
        this.inventory.slots[this.inventory.activeIndex] = {
            id: blockId,
            count: def.maxStack > 1 ? 16 : 1,
        };
        this.inventory._emitChange();
        this.showToast(def.name);
    }

    selectOrAssignBlock(blockId) {
        this.inventory.selectOrAssignItem(blockId, 16);
        this.showToast(getItemDef(blockId).name);
    }

    getSelectedBlockId() {
        return this.inventory.getSelectedItemId();
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
        if (!visible) {
            this.updateTargetHud({ visible: false });
        }
    }

    setUnderwater(underwater) {
        this.underwaterEl.classList.toggle('hidden', !underwater);
    }

    setFlyMode(flying) {
        this.modeEl.classList.toggle('hidden', !flying);
    }

    setPaletteOpen(open) {
        this.paletteOpen = open;
        if (!open) {
            this.selectedSwapSlot = null;
        } else {
            this._renderInventoryAndCraftingModal();
        }
        this.paletteModalEl.classList.toggle('hidden', !open);
    }

    setDebugVisible(visible) {
        this.debugVisible = visible;
        this.debugOverlayEl.classList.toggle('hidden', !visible);
    }

    /**
     * Update FPS counter and F3 debug telemetry block.
     */
    updateTelemetry(nowMs, frameDeltaSec, player, world, renderer, network, mobManager = null, dropManager = null) {
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

        const entityLine = `Entities: ${mobManager ? mobManager.mobs.length : 0} mobs, ${dropManager ? dropManager.drops.length : 0} drops | HP: ${player.health}/${player.maxHealth}`;

        this.debugTextEl.textContent = [
            `FPS: ${this._fpsDisplay} (${this._frameMsDisplay} ms)`,
            `XYZ: ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
            `Chunk: ${cx}, ${cz} (local ${lx}, ${Math.floor(p.y)}, ${lz})`,
            `Facing: ${heading}${player.flying ? ' [FLY]' : ''}`,
            `Chunks: ${stats.meshedChunks} meshed / ${stats.loadedChunks} cached (Q: ${stats.pendingGen}g / ${stats.pendingMesh}m)`,
            entityLine,
            `WebGL: ${gpu.calls} calls, ${gpu.triangles.toLocaleString()} tris`,
            netLine,
        ].join('\n');
    }

    dispose() {
        window.removeEventListener('keydown', this._onKeyDown);
        window.removeEventListener('wheel', this._onWheel);
        clearTimeout(this._toastTimer);
        clearTimeout(this._damageFlashTimer);
    }
}
