/**
 * Survival & Tool Crafting System.
 * Defines standard recipes (Wood -> Planks, Planks -> Sticks, Pickaxes, Axes, Swords, Shovels, Blocks)
 * and executes ingredient validation and crafting into InventoryManager.
 */

import { BLOCK_IDS } from '../core/BlockRegistry.js';
import { ITEM_IDS, getItemDef } from '../core/ItemRegistry.js';

/**
 * @typedef {Object} CraftingRecipe
 * @property {string} id
 * @property {string} name
 * @property {string} category - 'materials' | 'tools' | 'blocks'
 * @property {{ id: number, count: number }} output
 * @property {Array<{ id: number, count: number }>} ingredients
 * @property {string} summary
 */

/** @type {CraftingRecipe[]} */
export const CRAFTING_RECIPES = Object.freeze([
    {
        id: 'oak_planks',
        name: 'Oak Planks (x4)',
        category: 'materials',
        output: { id: BLOCK_IDS.PLANKS, count: 4 },
        ingredients: [{ id: BLOCK_IDS.WOOD, count: 1 }],
        summary: 'Mill 1 Oak Log into 4 sturdy Oak Planks.',
    },
    {
        id: 'sticks',
        name: 'Wooden Sticks (x4)',
        category: 'materials',
        output: { id: ITEM_IDS.STICK, count: 4 },
        ingredients: [{ id: BLOCK_IDS.PLANKS, count: 2 }],
        summary: 'Carve 2 Oak Planks into 4 wooden tool handles.',
    },
    {
        id: 'ember_torch',
        name: 'Ember Torch (x4)',
        category: 'blocks',
        output: { id: BLOCK_IDS.TORCH, count: 4 },
        ingredients: [
            { id: ITEM_IDS.COAL, count: 1 },
            { id: ITEM_IDS.STICK, count: 1 },
        ],
        summary: 'Craft 4 glowing Ember Torches to light up caves and night camps.',
    },
    {
        id: 'iron_ingot',
        name: 'Iron Ingot',
        category: 'materials',
        output: { id: ITEM_IDS.IRON_INGOT, count: 1 },
        ingredients: [
            { id: BLOCK_IDS.IRON_ORE, count: 1 },
            { id: ITEM_IDS.COAL, count: 1 },
        ],
        summary: 'Smelt 1 Iron Ore with 1 Coal into a forged Iron Ingot.',
    },
    {
        id: 'gold_ingot',
        name: 'Gold Ingot',
        category: 'materials',
        output: { id: ITEM_IDS.GOLD_INGOT, count: 1 },
        ingredients: [
            { id: BLOCK_IDS.GOLD_ORE, count: 1 },
            { id: ITEM_IDS.COAL, count: 1 },
        ],
        summary: 'Smelt 1 Gold Ore with 1 Coal into a pure Gold Ingot.',
    },
    {
        id: 'roasted_porkchop',
        name: 'Roasted Porkchop',
        category: 'materials',
        output: { id: ITEM_IDS.COOKED_PORKCHOP, count: 1 },
        ingredients: [
            { id: ITEM_IDS.PORKCHOP, count: 1 },
            { id: ITEM_IDS.COAL, count: 1 },
        ],
        summary: 'Cook Raw Porkchop over Coal. Restores 8 Hunger and 5 Health.',
    },
    {
        id: 'wooden_pickaxe',
        name: 'Wooden Pickaxe',
        category: 'tools',
        output: { id: ITEM_IDS.WOODEN_PICKAXE, count: 1 },
        ingredients: [
            { id: BLOCK_IDS.PLANKS, count: 3 },
            { id: ITEM_IDS.STICK, count: 2 },
        ],
        summary: '2.6x mining speed on Stone and Ores (3 ATK).',
    },
    {
        id: 'wooden_axe',
        name: 'Wooden Axe',
        category: 'tools',
        output: { id: ITEM_IDS.WOODEN_AXE, count: 1 },
        ingredients: [
            { id: BLOCK_IDS.PLANKS, count: 3 },
            { id: ITEM_IDS.STICK, count: 2 },
        ],
        summary: '2.6x chopping speed on Wood and Planks (4.5 ATK).',
    },
    {
        id: 'wooden_sword',
        name: 'Wooden Sword',
        category: 'tools',
        output: { id: ITEM_IDS.WOODEN_SWORD, count: 1 },
        ingredients: [
            { id: BLOCK_IDS.PLANKS, count: 2 },
            { id: ITEM_IDS.STICK, count: 1 },
        ],
        summary: 'Light melee blade for defending against mobs (6 ATK).',
    },
    {
        id: 'wooden_shovel',
        name: 'Wooden Shovel',
        category: 'tools',
        output: { id: ITEM_IDS.WOODEN_SHOVEL, count: 1 },
        ingredients: [
            { id: BLOCK_IDS.PLANKS, count: 1 },
            { id: ITEM_IDS.STICK, count: 2 },
        ],
        summary: '2.6x digging speed on Dirt, Grass, Sand, and Snow.',
    },
    {
        id: 'stone_pickaxe',
        name: 'Stone Pickaxe',
        category: 'tools',
        output: { id: ITEM_IDS.STONE_PICKAXE, count: 1 },
        ingredients: [
            { id: BLOCK_IDS.COBBLESTONE, count: 3 },
            { id: ITEM_IDS.STICK, count: 2 },
        ],
        summary: '4.2x mining speed on Stone and Ores (4 ATK).',
    },
    {
        id: 'stone_axe',
        name: 'Stone Axe',
        category: 'tools',
        output: { id: ITEM_IDS.STONE_AXE, count: 1 },
        ingredients: [
            { id: BLOCK_IDS.COBBLESTONE, count: 3 },
            { id: ITEM_IDS.STICK, count: 2 },
        ],
        summary: '4.2x chopping speed on Wood and Planks (6 ATK).',
    },
    {
        id: 'stone_sword',
        name: 'Stone Sword',
        category: 'tools',
        output: { id: ITEM_IDS.STONE_SWORD, count: 1 },
        ingredients: [
            { id: BLOCK_IDS.COBBLESTONE, count: 2 },
            { id: ITEM_IDS.STICK, count: 1 },
        ],
        summary: 'Heavy stone combat blade for slaying Zombies (8 ATK).',
    },
    {
        id: 'stone_shovel',
        name: 'Stone Shovel',
        category: 'tools',
        output: { id: ITEM_IDS.STONE_SHOVEL, count: 1 },
        ingredients: [
            { id: BLOCK_IDS.COBBLESTONE, count: 1 },
            { id: ITEM_IDS.STICK, count: 2 },
        ],
        summary: '4.2x digging speed on Dirt, Grass, Sand, and Snow.',
    },
    {
        id: 'iron_pickaxe',
        name: 'Iron Pickaxe',
        category: 'tools',
        output: { id: ITEM_IDS.IRON_PICKAXE, count: 1 },
        ingredients: [
            { id: ITEM_IDS.IRON_INGOT, count: 3 },
            { id: ITEM_IDS.STICK, count: 2 },
        ],
        summary: '6.5x rapid mining speed on Stone and Gold/Iron Ore (5 ATK).',
    },
    {
        id: 'iron_axe',
        name: 'Iron Axe',
        category: 'tools',
        output: { id: ITEM_IDS.IRON_AXE, count: 1 },
        ingredients: [
            { id: ITEM_IDS.IRON_INGOT, count: 3 },
            { id: ITEM_IDS.STICK, count: 2 },
        ],
        summary: '6.5x rapid chopping speed on Wood and Planks (7.5 ATK).',
    },
    {
        id: 'iron_sword',
        name: 'Iron Sword',
        category: 'tools',
        output: { id: ITEM_IDS.IRON_SWORD, count: 1 },
        ingredients: [
            { id: ITEM_IDS.IRON_INGOT, count: 2 },
            { id: ITEM_IDS.STICK, count: 1 },
        ],
        summary: 'Masterwork forged blade with lethal strike damage (10 ATK).',
    },
    {
        id: 'iron_shovel',
        name: 'Iron Shovel',
        category: 'tools',
        output: { id: ITEM_IDS.IRON_SHOVEL, count: 1 },
        ingredients: [
            { id: ITEM_IDS.IRON_INGOT, count: 1 },
            { id: ITEM_IDS.STICK, count: 2 },
        ],
        summary: '6.5x rapid digging speed on Dirt, Grass, Sand, and Snow.',
    },
    {
        id: 'smelt_stone',
        name: 'Smooth Stone (x2)',
        category: 'blocks',
        output: { id: BLOCK_IDS.STONE, count: 2 },
        ingredients: [{ id: BLOCK_IDS.COBBLESTONE, count: 2 }],
        summary: 'Refine 2 Cobblestone into 2 Smooth Stone blocks.',
    },
    {
        id: 'smelt_glass',
        name: 'Glass Block (x2)',
        category: 'blocks',
        output: { id: BLOCK_IDS.GLASS, count: 2 },
        ingredients: [{ id: BLOCK_IDS.SAND, count: 2 }],
        summary: 'Fuse 2 Sand blocks into 2 crystal Glass blocks.',
    },
]);

export class CraftingSystem {
    /**
     * @param {import('../inventory/InventoryManager.js').InventoryManager} inventory
     * @param {import('../core/EventBus.js').EventBus} [bus]
     */
    constructor(inventory, bus = null) {
        this.inventory = inventory;
        this.bus = bus;
    }

    getRecipes() {
        return CRAFTING_RECIPES;
    }

    /**
     * Check if the player has the required ingredients and inventory space for a recipe.
     * @param {string} recipeId
     * @returns {boolean}
     */
    canCraft(recipeId) {
        const recipe = CRAFTING_RECIPES.find((r) => r.id === recipeId);
        if (!recipe) return false;
        return this.inventory.hasIngredients(recipe.ingredients);
    }

    /**
     * Execute a crafting recipe, consuming ingredients and adding the output item.
     * @param {string} recipeId
     * @returns {{ ok: boolean, recipe?: CraftingRecipe, reason?: string }}
     */
    craft(recipeId) {
        const recipe = CRAFTING_RECIPES.find((r) => r.id === recipeId);
        if (!recipe) {
            return { ok: false, reason: 'Unknown recipe.' };
        }

        if (!this.inventory.hasIngredients(recipe.ingredients)) {
            return { ok: false, reason: 'Not enough materials in inventory.' };
        }

        if (!this.inventory.canAcceptItem(recipe.output.id)) {
            return { ok: false, reason: 'Inventory is full!' };
        }

        for (const req of recipe.ingredients) {
            this.inventory.removeItem(req.id, req.count);
        }

        this.inventory.addItem(recipe.output.id, recipe.output.count);
        const outDef = getItemDef(recipe.output.id);

        this.bus?.emit('crafting:crafted', {
            recipe,
            itemId: recipe.output.id,
            count: recipe.output.count,
            name: outDef.name,
        });

        return { ok: true, recipe };
    }
}
