/**
 * Block IDs, Texture Atlas tile assignments, physical properties, and hotbar inventory definitions.
 */

export const BLOCK_IDS = Object.freeze({
    AIR: 0,
    DIRT: 1,
    STONE: 2,
    WOOD: 3,
    GLASS: 4,
    LEAVES: 5,
    GRASS: 6,
    SAND: 7,
    COBBLESTONE: 8,
    PLANKS: 9,
    WATER: 10,
    SNOW: 11,
    BEDROCK: 12,
});

export const TILE_INDEX = Object.freeze({
    DIRT: 0,
    GRASS_TOP: 1,
    GRASS_SIDE: 2,
    STONE: 3,
    WOOD_SIDE: 4,
    WOOD_TOP: 5,
    GLASS: 6,
    LEAVES: 7,
    SAND: 8,
    COBBLESTONE: 9,
    PLANKS: 10,
    WATER: 11,
    SNOW: 12,
    SNOW_SIDE: 13,
    BEDROCK: 14,
    // Non-block items, food, and instruments/tools (tiles 16..30)
    STICK: 16,
    WOODEN_PICKAXE: 17,
    WOODEN_AXE: 18,
    WOODEN_SWORD: 19,
    WOODEN_SHOVEL: 20,
    STONE_PICKAXE: 21,
    STONE_AXE: 22,
    STONE_SWORD: 23,
    STONE_SHOVEL: 24,
    RAW_PORKCHOP: 25,
    ROTTEN_FLESH: 26,
    APPLE: 27,
    IRON_PICKAXE: 28,
    IRON_AXE: 29,
    IRON_SWORD: 30,
});

/**
 * @typedef {Object} BlockDefinition
 * @property {number} id
 * @property {string} name
 * @property {boolean} solid - Blocks player movement and supports AABB collision
 * @property {boolean} selectable - Targeted by raycaster for breaking/placing against
 * @property {boolean} breakable - Can be broken by players
 * @property {boolean} opaque - Completely hides adjacent faces during meshing
 * @property {'none'|'opaque'|'cutout'|'translucent'} renderPass
 * @property {boolean} cullSameType - Culls faces shared between identical adjacent blocks
 * @property {{top: number, bottom: number, side: number}} faces - Tile indices in TextureAtlas
 * @property {number} previewTile - Tile index rendered in hotbar/inventory icons
 * @property {number} hardness - Base time in seconds to break by hand
 * @property {'pickaxe'|'axe'|'shovel'|'sword'|null} preferredTool - Tool category that speeds up breaking
 * @property {number} dropId - Item/Block ID spawned when broken
 */

/** @type {Record<number, BlockDefinition>} */
export const BLOCKS = Object.freeze({
    [BLOCK_IDS.AIR]: {
        id: BLOCK_IDS.AIR,
        name: 'Air',
        solid: false,
        selectable: false,
        breakable: false,
        opaque: false,
        renderPass: 'none',
        cullSameType: true,
        faces: { top: 0, bottom: 0, side: 0 },
        previewTile: 0,
        hardness: 0,
        preferredTool: null,
        dropId: 0,
    },
    [BLOCK_IDS.DIRT]: {
        id: BLOCK_IDS.DIRT,
        name: 'Dirt',
        solid: true,
        selectable: true,
        breakable: true,
        opaque: true,
        renderPass: 'opaque',
        cullSameType: true,
        faces: { top: TILE_INDEX.DIRT, bottom: TILE_INDEX.DIRT, side: TILE_INDEX.DIRT },
        previewTile: TILE_INDEX.DIRT,
        hardness: 0.45,
        preferredTool: 'shovel',
        dropId: BLOCK_IDS.DIRT,
    },
    [BLOCK_IDS.STONE]: {
        id: BLOCK_IDS.STONE,
        name: 'Stone',
        solid: true,
        selectable: true,
        breakable: true,
        opaque: true,
        renderPass: 'opaque',
        cullSameType: true,
        faces: { top: TILE_INDEX.STONE, bottom: TILE_INDEX.STONE, side: TILE_INDEX.STONE },
        previewTile: TILE_INDEX.STONE,
        hardness: 1.15,
        preferredTool: 'pickaxe',
        dropId: BLOCK_IDS.COBBLESTONE,
    },
    [BLOCK_IDS.WOOD]: {
        id: BLOCK_IDS.WOOD,
        name: 'Oak Wood',
        solid: true,
        selectable: true,
        breakable: true,
        opaque: true,
        renderPass: 'opaque',
        cullSameType: true,
        faces: { top: TILE_INDEX.WOOD_TOP, bottom: TILE_INDEX.WOOD_TOP, side: TILE_INDEX.WOOD_SIDE },
        previewTile: TILE_INDEX.WOOD_SIDE,
        hardness: 0.85,
        preferredTool: 'axe',
        dropId: BLOCK_IDS.WOOD,
    },
    [BLOCK_IDS.GLASS]: {
        id: BLOCK_IDS.GLASS,
        name: 'Glass',
        solid: true,
        selectable: true,
        breakable: true,
        opaque: false,
        renderPass: 'translucent',
        cullSameType: true,
        faces: { top: TILE_INDEX.GLASS, bottom: TILE_INDEX.GLASS, side: TILE_INDEX.GLASS },
        previewTile: TILE_INDEX.GLASS,
        hardness: 0.3,
        preferredTool: 'pickaxe',
        dropId: BLOCK_IDS.GLASS,
    },
    [BLOCK_IDS.LEAVES]: {
        id: BLOCK_IDS.LEAVES,
        name: 'Oak Leaves',
        solid: true,
        selectable: true,
        breakable: true,
        opaque: false,
        renderPass: 'cutout',
        cullSameType: false,
        faces: { top: TILE_INDEX.LEAVES, bottom: TILE_INDEX.LEAVES, side: TILE_INDEX.LEAVES },
        previewTile: TILE_INDEX.LEAVES,
        hardness: 0.25,
        preferredTool: 'axe',
        dropId: BLOCK_IDS.LEAVES,
    },
    [BLOCK_IDS.GRASS]: {
        id: BLOCK_IDS.GRASS,
        name: 'Grass Block',
        solid: true,
        selectable: true,
        breakable: true,
        opaque: true,
        renderPass: 'opaque',
        cullSameType: true,
        faces: { top: TILE_INDEX.GRASS_TOP, bottom: TILE_INDEX.DIRT, side: TILE_INDEX.GRASS_SIDE },
        previewTile: TILE_INDEX.GRASS_SIDE,
        hardness: 0.5,
        preferredTool: 'shovel',
        dropId: BLOCK_IDS.DIRT,
    },
    [BLOCK_IDS.SAND]: {
        id: BLOCK_IDS.SAND,
        name: 'Sand',
        solid: true,
        selectable: true,
        breakable: true,
        opaque: true,
        renderPass: 'opaque',
        cullSameType: true,
        faces: { top: TILE_INDEX.SAND, bottom: TILE_INDEX.SAND, side: TILE_INDEX.SAND },
        previewTile: TILE_INDEX.SAND,
        hardness: 0.45,
        preferredTool: 'shovel',
        dropId: BLOCK_IDS.SAND,
    },
    [BLOCK_IDS.COBBLESTONE]: {
        id: BLOCK_IDS.COBBLESTONE,
        name: 'Cobblestone',
        solid: true,
        selectable: true,
        breakable: true,
        opaque: true,
        renderPass: 'opaque',
        cullSameType: true,
        faces: { top: TILE_INDEX.COBBLESTONE, bottom: TILE_INDEX.COBBLESTONE, side: TILE_INDEX.COBBLESTONE },
        previewTile: TILE_INDEX.COBBLESTONE,
        hardness: 1.15,
        preferredTool: 'pickaxe',
        dropId: BLOCK_IDS.COBBLESTONE,
    },
    [BLOCK_IDS.PLANKS]: {
        id: BLOCK_IDS.PLANKS,
        name: 'Oak Planks',
        solid: true,
        selectable: true,
        breakable: true,
        opaque: true,
        renderPass: 'opaque',
        cullSameType: true,
        faces: { top: TILE_INDEX.PLANKS, bottom: TILE_INDEX.PLANKS, side: TILE_INDEX.PLANKS },
        previewTile: TILE_INDEX.PLANKS,
        hardness: 0.75,
        preferredTool: 'axe',
        dropId: BLOCK_IDS.PLANKS,
    },
    [BLOCK_IDS.WATER]: {
        id: BLOCK_IDS.WATER,
        name: 'Water',
        solid: false,
        selectable: false,
        breakable: false,
        opaque: false,
        renderPass: 'translucent',
        cullSameType: true,
        faces: { top: TILE_INDEX.WATER, bottom: TILE_INDEX.WATER, side: TILE_INDEX.WATER },
        previewTile: TILE_INDEX.WATER,
        hardness: 0,
        preferredTool: null,
        dropId: 0,
    },
    [BLOCK_IDS.SNOW]: {
        id: BLOCK_IDS.SNOW,
        name: 'Snow Block',
        solid: true,
        selectable: true,
        breakable: true,
        opaque: true,
        renderPass: 'opaque',
        cullSameType: true,
        faces: { top: TILE_INDEX.SNOW, bottom: TILE_INDEX.DIRT, side: TILE_INDEX.SNOW_SIDE },
        previewTile: TILE_INDEX.SNOW,
        hardness: 0.4,
        preferredTool: 'shovel',
        dropId: BLOCK_IDS.SNOW,
    },
    [BLOCK_IDS.BEDROCK]: {
        id: BLOCK_IDS.BEDROCK,
        name: 'Bedrock',
        solid: true,
        selectable: true,
        breakable: false,
        opaque: true,
        renderPass: 'opaque',
        cullSameType: true,
        faces: { top: TILE_INDEX.BEDROCK, bottom: TILE_INDEX.BEDROCK, side: TILE_INDEX.BEDROCK },
        previewTile: TILE_INDEX.BEDROCK,
        hardness: Infinity,
        preferredTool: null,
        dropId: 0,
    },
});

export const HOTBAR_DEFAULT = [
    BLOCK_IDS.DIRT,
    BLOCK_IDS.STONE,
    BLOCK_IDS.WOOD,
    BLOCK_IDS.GLASS,
    BLOCK_IDS.LEAVES,
    BLOCK_IDS.GRASS,
    BLOCK_IDS.SAND,
    BLOCK_IDS.COBBLESTONE,
    BLOCK_IDS.PLANKS,
];

export const PALETTE_BLOCKS = [
    BLOCK_IDS.DIRT,
    BLOCK_IDS.STONE,
    BLOCK_IDS.WOOD,
    BLOCK_IDS.GLASS,
    BLOCK_IDS.LEAVES,
    BLOCK_IDS.GRASS,
    BLOCK_IDS.SAND,
    BLOCK_IDS.COBBLESTONE,
    BLOCK_IDS.PLANKS,
    BLOCK_IDS.SNOW,
];

export function getBlockDef(id) {
    return BLOCKS[id] || BLOCKS[BLOCK_IDS.AIR];
}

export function isBlockSolid(id) {
    const def = BLOCKS[id];
    return def ? def.solid : false;
}

export function isBlockOpaque(id) {
    const def = BLOCKS[id];
    return def ? def.opaque : false;
}

export function isBlockSelectable(id) {
    const def = BLOCKS[id];
    return def ? def.selectable : false;
}

export function isValidPlaceableBlock(id) {
    const def = BLOCKS[id];
    return Boolean(def && def.id !== BLOCK_IDS.AIR && def.id !== BLOCK_IDS.WATER && def.id !== BLOCK_IDS.BEDROCK);
}
