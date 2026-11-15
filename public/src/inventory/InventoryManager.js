/**
 * Manages the player's 9-slot Hotbar (indices 0..8) and 27-slot Backpack Inventory (indices 9..35).
 * Supports item stacking, consumption on block placement / eating, crafting ingredient deduction,
 * and interactive slot swapping / quick-moving.
 */

import { BLOCK_IDS } from '../core/BlockRegistry.js';
import { ITEM_IDS, getItemDef } from '../core/ItemRegistry.js';

export const HOTBAR_SIZE = 9;
export const BACKPACK_SIZE = 27;
export const TOTAL_INVENTORY_SLOTS = HOTBAR_SIZE + BACKPACK_SIZE;

export class InventoryManager {
    /**
     * @param {import('../core/EventBus.js').EventBus} [bus]
     */
    constructor(bus = null) {
        this.bus = bus;
        /** @type {Array<{ id: number, count: number } | null>} */
        this.slots = new Array(TOTAL_INVENTORY_SLOTS).fill(null);
        this.activeIndex = 0;

        this.resetToStarterKit();
    }

    /**
     * Export full inventory state (slots and activeIndex) for world saving.
     */
    serialize() {
        return {
            activeIndex: this.activeIndex,
            slots: this.slots.map((s) => (s ? { id: s.id, count: s.count } : null)),
        };
    }

    /**
     * Restore inventory state from an exported world save.
     */
    deserialize(data) {
        if (!data || !Array.isArray(data.slots)) return;
        this.slots.fill(null);
        for (let i = 0; i < Math.min(TOTAL_INVENTORY_SLOTS, data.slots.length); i++) {
            const s = data.slots[i];
            if (s && typeof s.id === 'number' && typeof s.count === 'number' && s.count > 0) {
                this.slots[i] = { id: s.id, count: s.count };
            }
        }
        if (typeof data.activeIndex === 'number' && data.activeIndex >= 0 && data.activeIndex < HOTBAR_SIZE) {
            this.activeIndex = data.activeIndex;
        } else {
            this.activeIndex = 0;
        }
        this._emitChange();
    }

    /**
     * Reset inventory to empty hands so the player gathers and crafts everything.
     */
    resetToStarterKit() {
        this.slots.fill(null);
        this.selectedHotbarIndex = 0;

        this._emitChange();
    }

    _emitChange() {
        this.bus?.emit('inventory:changed', {
            slots: this.slots,
            activeIndex: this.activeIndex,
            activeSlot: this.getActiveSlot(),
        });
    }

    /**
     * Select active hotbar slot (0..8).
     * @param {number} idx
     */
    selectSlot(idx) {
        if (idx < 0 || idx >= HOTBAR_SIZE) return;
        this.activeIndex = idx;
        this._emitChange();
    }

    /**
     * Get the currently selected hotbar slot object `{ id, count } | null`.
     */
    getActiveSlot() {
        return this.slots[this.activeIndex] || null;
    }

    /**
     * Get the item/block ID in the active hotbar slot, or 0 (AIR/Empty) if empty.
     */
    getSelectedItemId() {
        const slot = this.slots[this.activeIndex];
        return slot ? slot.id : 0;
    }

    /**
     * Check if the inventory has space for at least 1 of `itemId`.
     * @param {number} itemId
     */
    canAcceptItem(itemId) {
        if (!itemId) return false;
        const def = getItemDef(itemId);
        const maxStack = def.maxStack || 64;

        for (let i = 0; i < TOTAL_INVENTORY_SLOTS; i++) {
            const s = this.slots[i];
            if (!s) return true;
            if (s.id === itemId && s.count < maxStack) return true;
        }
        return false;
    }

    /**
     * Add `count` of `itemId` into matching stacks first, then empty slots.
     * @param {number} itemId
     * @param {number} [count=1]
     * @returns {number} Number of items actually added
     */
    addItem(itemId, count = 1) {
        if (!itemId || count <= 0) return 0;
        const def = getItemDef(itemId);
        const maxStack = def.maxStack || 64;
        let remaining = count | 0;

        // 1. Stack into existing matching slots (hotbar first, then backpack)
        if (maxStack > 1) {
            for (let i = 0; i < TOTAL_INVENTORY_SLOTS && remaining > 0; i++) {
                const slot = this.slots[i];
                if (slot && slot.id === itemId && slot.count < maxStack) {
                    const space = maxStack - slot.count;
                    const toAdd = Math.min(space, remaining);
                    slot.count += toAdd;
                    remaining -= toAdd;
                }
            }
        }

        // 2. Place remaining into empty slots (hotbar first, then backpack)
        for (let i = 0; i < TOTAL_INVENTORY_SLOTS && remaining > 0; i++) {
            if (!this.slots[i]) {
                const toAdd = Math.min(maxStack, remaining);
                this.slots[i] = { id: itemId, count: toAdd };
                remaining -= toAdd;
            }
        }

        const added = count - remaining;
        if (added > 0) {
            this._emitChange();
            this.bus?.emit('inventory:itemAdded', { itemId, count: added, name: def.name });
        }
        return added;
    }

    /**
     * Consume `count` from the currently selected hotbar slot.
     * @param {number} [count=1]
     * @returns {boolean}
     */
    consumeActiveSlot(count = 1) {
        const slot = this.slots[this.activeIndex];
        if (!slot || slot.count < count) return false;
        slot.count -= count;
        if (slot.count <= 0) {
            this.slots[this.activeIndex] = null;
        }
        this._emitChange();
        return true;
    }

    /**
     * Count total quantity of `itemId` across all 36 slots.
     * @param {number} itemId
     * @returns {number}
     */
    getItemCount(itemId) {
        let total = 0;
        for (let i = 0; i < TOTAL_INVENTORY_SLOTS; i++) {
            const s = this.slots[i];
            if (s && s.id === itemId) {
                total += s.count;
            }
        }
        return total;
    }

    /**
     * Check if the player holds all required ingredients `[{ id, count }]`.
     * @param {Array<{ id: number, count: number }>} ingredients
     * @returns {boolean}
     */
    hasIngredients(ingredients) {
        for (const req of ingredients) {
            if (this.getItemCount(req.id) < req.count) {
                return false;
            }
        }
        return true;
    }

    /**
     * Remove `count` of `itemId` across inventory slots (draws from backpack first, then hotbar).
     * @param {number} itemId
     * @param {number} [count=1]
     * @returns {boolean}
     */
    removeItem(itemId, count = 1) {
        if (this.getItemCount(itemId) < count) return false;
        let remaining = count;

        // Deduct from backpack slots (9..35) first, then hotbar (8..0) so active hotbar stays intact when possible
        const order = [];
        for (let i = HOTBAR_SIZE; i < TOTAL_INVENTORY_SLOTS; i++) order.push(i);
        for (let i = HOTBAR_SIZE - 1; i >= 0; i--) order.push(i);

        for (const idx of order) {
            if (remaining <= 0) break;
            const slot = this.slots[idx];
            if (slot && slot.id === itemId) {
                const take = Math.min(slot.count, remaining);
                slot.count -= take;
                remaining -= take;
                if (slot.count <= 0) {
                    this.slots[idx] = null;
                }
            }
        }

        this._emitChange();
        return true;
    }

    /**
     * Swap or stack-merge two inventory slots `indexA` and `indexB`.
     * @param {number} indexA
     * @param {number} indexB
     */
    swapOrMergeSlots(indexA, indexB) {
        if (
            indexA === indexB ||
            indexA < 0 ||
            indexB < 0 ||
            indexA >= TOTAL_INVENTORY_SLOTS ||
            indexB >= TOTAL_INVENTORY_SLOTS
        ) {
            return;
        }

        const slotA = this.slots[indexA];
        const slotB = this.slots[indexB];

        if (slotA && slotB && slotA.id === slotB.id) {
            const maxStack = getItemDef(slotA.id).maxStack || 64;
            if (slotB.count < maxStack) {
                const transfer = Math.min(maxStack - slotB.count, slotA.count);
                slotB.count += transfer;
                slotA.count -= transfer;
                if (slotA.count <= 0) {
                    this.slots[indexA] = null;
                }
                this._emitChange();
                return;
            }
        }

        this.slots[indexA] = slotB;
        this.slots[indexB] = slotA;
        this._emitChange();
    }

    /**
     * Quick-move a slot between Hotbar (0..8) and Backpack (9..35).
     * @param {number} index
     */
    quickMoveSlot(index) {
        const slot = this.slots[index];
        if (!slot) return;

        const isHotbar = index < HOTBAR_SIZE;
        const start = isHotbar ? HOTBAR_SIZE : 0;
        const end = isHotbar ? TOTAL_INVENTORY_SLOTS : HOTBAR_SIZE;
        const maxStack = getItemDef(slot.id).maxStack || 64;

        // 1. Merge into matching stacks in target range
        if (maxStack > 1) {
            for (let i = start; i < end && slot.count > 0; i++) {
                const target = this.slots[i];
                if (target && target.id === slot.id && target.count < maxStack) {
                    const move = Math.min(maxStack - target.count, slot.count);
                    target.count += move;
                    slot.count -= move;
                }
            }
        }

        // 2. Move remainder to first empty slot in target range
        if (slot.count > 0) {
            for (let i = start; i < end; i++) {
                if (!this.slots[i]) {
                    this.slots[i] = { id: slot.id, count: slot.count };
                    slot.count = 0;
                    break;
                }
            }
        }

        if (slot.count <= 0) {
            this.slots[index] = null;
        }
        this._emitChange();
    }

    /**
     * Select an item in the hotbar if present, or move/assign it into the active hotbar slot.
     * @param {number} itemId
     * @param {number} [grantCount=1]
     */
    selectOrAssignItem(itemId, grantCount = 1) {
        // Check if already in hotbar
        for (let i = 0; i < HOTBAR_SIZE; i++) {
            if (this.slots[i] && this.slots[i].id === itemId) {
                this.selectSlot(i);
                return;
            }
        }
        // Check if in backpack -> swap into active hotbar slot
        for (let i = HOTBAR_SIZE; i < TOTAL_INVENTORY_SLOTS; i++) {
            if (this.slots[i] && this.slots[i].id === itemId) {
                this.swapOrMergeSlots(i, this.activeIndex);
                return;
            }
        }
        // Grant into active hotbar slot (creative/pick-block convenience)
        const def = getItemDef(itemId);
        const count = Math.min(def.maxStack || 64, Math.max(1, grantCount));
        this.slots[this.activeIndex] = { id: itemId, count };
        this._emitChange();
    }
}
