/**
 * Unified Item, Tool, Weapon, and Block registry for Survival, Crafting, Inventory, and Combat.
 */

import { BLOCK_IDS, BLOCKS, TILE_INDEX, isValidPlaceableBlock } from './BlockRegistry.js';

export const ITEM_IDS = Object.freeze({
    ...BLOCK_IDS,
    // Crafting Materials & Mob / Block Drops
    STICK: 101,
    RAW_PORKCHOP: 102,
    ROTTEN_FLESH: 103,
    APPLE: 104,
    COAL: 105,
    IRON_INGOT: 106,
    GOLD_INGOT: 107,
    COOKED_PORKCHOP: 108,
    // Instruments / Tools & Weapons
    WOODEN_PICKAXE: 201,
    WOODEN_AXE: 202,
    WOODEN_SWORD: 203,
    WOODEN_SHOVEL: 204,
    STONE_PICKAXE: 205,
    STONE_AXE: 206,
    STONE_SWORD: 207,
    STONE_SHOVEL: 208,
    IRON_PICKAXE: 209,
    IRON_AXE: 210,
    IRON_SWORD: 211,
    IRON_SHOVEL: 212,
});

export const NON_BLOCK_ITEMS = Object.freeze({
    [ITEM_IDS.STICK]: {
        id: ITEM_IDS.STICK,
        name: 'Stick',
        category: 'material',
        maxStack: 64,
        previewTile: TILE_INDEX.STICK,
        isPlaceable: false,
        toolType: null,
        miningMultiplier: 1.0,
        attackDamage: 2,
        healAmount: 0,
        description: 'Essential wooden handle for crafting tools and weapons.',
    },
    [ITEM_IDS.RAW_PORKCHOP]: {
        id: ITEM_IDS.RAW_PORKCHOP,
        name: 'Raw Porkchop',
        category: 'food',
        maxStack: 64,
        previewTile: TILE_INDEX.RAW_PORKCHOP,
        isPlaceable: false,
        toolType: null,
        miningMultiplier: 1.0,
        attackDamage: 2,
        healAmount: 2,
        hungerRestore: 4,
        description: 'Dropped by Wild Pigs. Right-click to eat (+4 Hunger, +2 HP).',
    },
    [ITEM_IDS.COOKED_PORKCHOP]: {
        id: ITEM_IDS.COOKED_PORKCHOP,
        name: 'Roasted Porkchop',
        category: 'food',
        maxStack: 64,
        previewTile: TILE_INDEX.COOKED_PORKCHOP,
        isPlaceable: false,
        toolType: null,
        miningMultiplier: 1.0,
        attackDamage: 2,
        healAmount: 6,
        hungerRestore: 8,
        description: 'Hearty meal cooked with Coal. Right-click to eat (+8 Hunger, +6 HP).',
    },
    [ITEM_IDS.ROTTEN_FLESH]: {
        id: ITEM_IDS.ROTTEN_FLESH,
        name: 'Rotten Flesh',
        category: 'food',
        maxStack: 64,
        previewTile: TILE_INDEX.ROTTEN_FLESH,
        isPlaceable: false,
        toolType: null,
        miningMultiplier: 1.0,
        attackDamage: 2,
        healAmount: 1,
        hungerRestore: 3,
        description: 'Dropped by Zombies. Right-click to consume (+3 Hunger, +1 HP).',
    },
    [ITEM_IDS.APPLE]: {
        id: ITEM_IDS.APPLE,
        name: 'Wild Apple',
        category: 'food',
        maxStack: 64,
        previewTile: TILE_INDEX.APPLE,
        isPlaceable: false,
        toolType: null,
        miningMultiplier: 1.0,
        attackDamage: 2,
        healAmount: 2,
        hungerRestore: 4,
        description: 'Crisp forest fruit from Oak Leaves. Right-click to eat (+4 Hunger, +2 HP).',
    },
    [ITEM_IDS.COAL]: {
        id: ITEM_IDS.COAL,
        name: 'Coal',
        category: 'material',
        maxStack: 64,
        previewTile: TILE_INDEX.COAL,
        isPlaceable: false,
        toolType: null,
        miningMultiplier: 1.0,
        attackDamage: 2,
        healAmount: 0,
        description: 'Fuel mined from Coal Ore. Used for Ember Torches & smelting.',
    },
    [ITEM_IDS.IRON_INGOT]: {
        id: ITEM_IDS.IRON_INGOT,
        name: 'Iron Ingot',
        category: 'material',
        maxStack: 64,
        previewTile: TILE_INDEX.IRON_INGOT,
        isPlaceable: false,
        toolType: null,
        miningMultiplier: 1.0,
        attackDamage: 2,
        healAmount: 0,
        description: 'Refined metal bar forged from Iron Ore & Coal.',
    },
    [ITEM_IDS.GOLD_INGOT]: {
        id: ITEM_IDS.GOLD_INGOT,
        name: 'Gold Ingot',
        category: 'material',
        maxStack: 64,
        previewTile: TILE_INDEX.GOLD_INGOT,
        isPlaceable: false,
        toolType: null,
        miningMultiplier: 1.0,
        attackDamage: 2,
        healAmount: 0,
        description: 'Precious refined metal bar forged from Gold Ore & Coal.',
    },
    [ITEM_IDS.WOODEN_PICKAXE]: {
        id: ITEM_IDS.WOODEN_PICKAXE,
        name: 'Wooden Pickaxe',
        category: 'tool',
        maxStack: 1,
        previewTile: TILE_INDEX.WOODEN_PICKAXE,
        isPlaceable: false,
        toolType: 'pickaxe',
        tier: 'wood',
        miningMultiplier: 2.6,
        attackDamage: 3,
        healAmount: 0,
        description: '2.6x mining speed on Stone, Cobblestone & Glass. 3 ATK.',
    },
    [ITEM_IDS.WOODEN_AXE]: {
        id: ITEM_IDS.WOODEN_AXE,
        name: 'Wooden Axe',
        category: 'tool',
        maxStack: 1,
        previewTile: TILE_INDEX.WOODEN_AXE,
        isPlaceable: false,
        toolType: 'axe',
        tier: 'wood',
        miningMultiplier: 2.6,
        attackDamage: 4.5,
        healAmount: 0,
        description: '2.6x chopping speed on Wood, Planks & Leaves. 4.5 ATK.',
    },
    [ITEM_IDS.WOODEN_SWORD]: {
        id: ITEM_IDS.WOODEN_SWORD,
        name: 'Wooden Sword',
        category: 'weapon',
        maxStack: 1,
        previewTile: TILE_INDEX.WOODEN_SWORD,
        isPlaceable: false,
        toolType: 'sword',
        tier: 'wood',
        miningMultiplier: 1.6,
        attackDamage: 6,
        healAmount: 0,
        description: 'Balanced melee blade for fighting mobs. 6 ATK.',
    },
    [ITEM_IDS.WOODEN_SHOVEL]: {
        id: ITEM_IDS.WOODEN_SHOVEL,
        name: 'Wooden Shovel',
        category: 'tool',
        maxStack: 1,
        previewTile: TILE_INDEX.WOODEN_SHOVEL,
        isPlaceable: false,
        toolType: 'shovel',
        tier: 'wood',
        miningMultiplier: 2.6,
        attackDamage: 2.5,
        healAmount: 0,
        description: '2.6x digging speed on Dirt, Grass, Sand & Snow. 2.5 ATK.',
    },
    [ITEM_IDS.STONE_PICKAXE]: {
        id: ITEM_IDS.STONE_PICKAXE,
        name: 'Stone Pickaxe',
        category: 'tool',
        maxStack: 1,
        previewTile: TILE_INDEX.STONE_PICKAXE,
        isPlaceable: false,
        toolType: 'pickaxe',
        tier: 'stone',
        miningMultiplier: 4.2,
        attackDamage: 4,
        healAmount: 0,
        description: '4.2x mining speed on Stone, Cobblestone & Glass. 4 ATK.',
    },
    [ITEM_IDS.STONE_AXE]: {
        id: ITEM_IDS.STONE_AXE,
        name: 'Stone Axe',
        category: 'tool',
        maxStack: 1,
        previewTile: TILE_INDEX.STONE_AXE,
        isPlaceable: false,
        toolType: 'axe',
        tier: 'stone',
        miningMultiplier: 4.2,
        attackDamage: 6,
        healAmount: 0,
        description: '4.2x chopping speed on Wood, Planks & Leaves. 6 ATK.',
    },
    [ITEM_IDS.STONE_SWORD]: {
        id: ITEM_IDS.STONE_SWORD,
        name: 'Stone Sword',
        category: 'weapon',
        maxStack: 1,
        previewTile: TILE_INDEX.STONE_SWORD,
        isPlaceable: false,
        toolType: 'sword',
        tier: 'stone',
        miningMultiplier: 1.8,
        attackDamage: 8,
        healAmount: 0,
        description: 'Heavy stone combat blade for slaying Zombies. 8 ATK.',
    },
    [ITEM_IDS.STONE_SHOVEL]: {
        id: ITEM_IDS.STONE_SHOVEL,
        name: 'Stone Shovel',
        category: 'tool',
        maxStack: 1,
        previewTile: TILE_INDEX.STONE_SHOVEL,
        isPlaceable: false,
        toolType: 'shovel',
        tier: 'stone',
        miningMultiplier: 4.2,
        attackDamage: 3.5,
        healAmount: 0,
        description: '4.2x digging speed on Dirt, Grass, Sand & Snow. 3.5 ATK.',
    },
    [ITEM_IDS.IRON_PICKAXE]: {
        id: ITEM_IDS.IRON_PICKAXE,
        name: 'Iron Pickaxe',
        category: 'tool',
        maxStack: 1,
        previewTile: TILE_INDEX.IRON_PICKAXE,
        isPlaceable: false,
        toolType: 'pickaxe',
        tier: 'iron',
        miningMultiplier: 6.5,
        attackDamage: 5,
        healAmount: 0,
        description: '6.5x rapid mining speed on Stone & Cobblestone. 5 ATK.',
    },
    [ITEM_IDS.IRON_AXE]: {
        id: ITEM_IDS.IRON_AXE,
        name: 'Iron Axe',
        category: 'tool',
        maxStack: 1,
        previewTile: TILE_INDEX.IRON_AXE,
        isPlaceable: false,
        toolType: 'axe',
        tier: 'iron',
        miningMultiplier: 6.5,
        attackDamage: 7.5,
        healAmount: 0,
        description: '6.5x rapid chopping speed on Wood & Planks. 7.5 ATK.',
    },
    [ITEM_IDS.IRON_SWORD]: {
        id: ITEM_IDS.IRON_SWORD,
        name: 'Iron Sword',
        category: 'weapon',
        maxStack: 1,
        previewTile: TILE_INDEX.IRON_SWORD,
        isPlaceable: false,
        toolType: 'sword',
        tier: 'iron',
        miningMultiplier: 2.0,
        attackDamage: 10,
        healAmount: 0,
        description: 'Masterwork steel blade with lethal strike power. 10 ATK.',
    },
    [ITEM_IDS.IRON_SHOVEL]: {
        id: ITEM_IDS.IRON_SHOVEL,
        name: 'Iron Shovel',
        category: 'tool',
        maxStack: 1,
        previewTile: TILE_INDEX.IRON_SHOVEL,
        isPlaceable: false,
        toolType: 'shovel',
        tier: 'iron',
        miningMultiplier: 6.5,
        attackDamage: 4.5,
        healAmount: 0,
        description: '6.5x rapid digging speed on Dirt, Grass, Sand & Snow. 4.5 ATK.',
    },
});

/**
 * Retrieve unified item or block definition by ID.
 * @param {number} id
 */
export function getItemDef(id) {
    if (!id) {
        return {
            id: 0,
            name: 'Empty Hand',
            category: 'none',
            maxStack: 0,
            previewTile: 0,
            isPlaceable: false,
            toolType: null,
            miningMultiplier: 1.0,
            attackDamage: 2,
            healAmount: 0,
            description: 'Bare hands',
        };
    }

    if (NON_BLOCK_ITEMS[id]) {
        return NON_BLOCK_ITEMS[id];
    }

    const block = BLOCKS[id];
    if (block) {
        return {
            id: block.id,
            name: block.name,
            category: 'block',
            maxStack: 64,
            previewTile: block.previewTile,
            isPlaceable: isValidPlaceableBlock(block.id),
            toolType: null,
            miningMultiplier: 1.0,
            attackDamage: 2,
            healAmount: 0,
            description: `Placeable ${block.name} voxel block.`,
        };
    }

    return NON_BLOCK_ITEMS[ITEM_IDS.STICK];
}

/**
 * Compute mining speed multiplier when breaking `blockId` while holding `heldItemId`.
 * Matching tools (e.g., Pickaxe on Stone, Axe on Wood, Shovel on Dirt) apply their full multiplier.
 * Non-matching tools still provide a minor 1.25x leverage boost.
 * @param {number} heldItemId
 * @param {number} blockId
 * @returns {number}
 */
export function getMiningSpeedMultiplier(heldItemId, blockId) {
    const item = getItemDef(heldItemId);
    const block = BLOCKS[blockId];
    if (!block || !item || !item.toolType) return 1.0;

    if (block.preferredTool && item.toolType === block.preferredTool) {
        return item.miningMultiplier;
    }
    if (item.toolType === 'sword' && blockId === BLOCK_IDS.LEAVES) {
        return 2.4;
    }
    return 1.25;
}

/**
 * Compute time in seconds required to break `blockId` with `heldItemId`.
 * @param {number} blockId
 * @param {number} heldItemId
 * @returns {number}
 */
export function getBlockBreakTime(blockId, heldItemId) {
    const block = BLOCKS[blockId];
    if (!block || !block.breakable) return Infinity;
    const baseHardness = block.hardness || 0.5;
    const mult = getMiningSpeedMultiplier(heldItemId, blockId);
    return Math.max(0.08, baseHardness / mult);
}

/**
 * Compute melee hit damage dealt to mobs when holding `heldItemId`.
 * @param {number} heldItemId
 * @returns {number}
 */
export function getAttackDamage(heldItemId) {
    const item = getItemDef(heldItemId);
    return item ? item.attackDamage : 2;
}

export const ALL_CREATIVE_ITEMS = [
    BLOCK_IDS.WOOD,
    BLOCK_IDS.PLANKS,
    BLOCK_IDS.COBBLESTONE,
    BLOCK_IDS.STONE,
    BLOCK_IDS.DIRT,
    BLOCK_IDS.GRASS,
    BLOCK_IDS.SAND,
    BLOCK_IDS.GLASS,
    BLOCK_IDS.LEAVES,
    BLOCK_IDS.SNOW,
    BLOCK_IDS.COAL_ORE,
    BLOCK_IDS.IRON_ORE,
    BLOCK_IDS.GOLD_ORE,
    BLOCK_IDS.TORCH,
    ITEM_IDS.STICK,
    ITEM_IDS.COAL,
    ITEM_IDS.IRON_INGOT,
    ITEM_IDS.GOLD_INGOT,
    ITEM_IDS.WOODEN_PICKAXE,
    ITEM_IDS.WOODEN_AXE,
    ITEM_IDS.WOODEN_SWORD,
    ITEM_IDS.WOODEN_SHOVEL,
    ITEM_IDS.STONE_PICKAXE,
    ITEM_IDS.STONE_AXE,
    ITEM_IDS.STONE_SWORD,
    ITEM_IDS.STONE_SHOVEL,
    ITEM_IDS.IRON_PICKAXE,
    ITEM_IDS.IRON_AXE,
    ITEM_IDS.IRON_SWORD,
    ITEM_IDS.IRON_SHOVEL,
    ITEM_IDS.RAW_PORKCHOP,
    ITEM_IDS.COOKED_PORKCHOP,
    ITEM_IDS.APPLE,
    ITEM_IDS.ROTTEN_FLESH,
];
