/**
 * Shared engine, world, physics, and networking constants.
 * Imported by both browser client modules (including Web Workers) and the Node.js server.
 */

export const CHUNK_SIZE_X = 16;
export const CHUNK_SIZE_Z = 16;
export const CHUNK_HEIGHT = 128;
export const CHUNK_AREA = CHUNK_SIZE_X * CHUNK_SIZE_Z; // 256
export const CHUNK_VOLUME = CHUNK_AREA * CHUNK_HEIGHT; // 32,768 bytes

export const SEA_LEVEL = 42;
export const DEFAULT_SEED = 133742;

export const DEFAULT_RENDER_DISTANCE = 6;
export const MIN_RENDER_DISTANCE = 2;
export const MAX_RENDER_DISTANCE = 10;
export const MAX_MESH_UPLOADS_PER_FRAME = 3;

export const REACH_DISTANCE = 6.0;

// Player AABB & Movement Physics Constants
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HALF_WIDTH = PLAYER_WIDTH / 2;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE_HEIGHT = 1.62;

export const PHYSICS_TIMESTEP = 1 / 60;
export const MAX_FRAME_DELTA = 0.1;

export const GRAVITY = 28.0;
export const JUMP_VELOCITY = 9.2;
export const WALK_SPEED = 5.4;
export const SPRINT_SPEED = 8.2;
export const FLY_SPEED = 14.5;
export const SWIM_GRAVITY = 8.0;
export const SWIM_UP_SPEED = 4.6;
export const TERMINAL_VELOCITY = 48.0;

// Networking Constants
export const DEFAULT_PORT = 3000;
export const NET_TICK_MS = 50; // 20 Hz state sync

export const MSG = Object.freeze({
    JOIN: 'JOIN',
    WELCOME: 'WELCOME',
    PLAYER_JOIN: 'PLAYER_JOIN',
    PLAYER_LEAVE: 'PLAYER_LEAVE',
    PLAYER_STATE: 'PLAYER_STATE',
    BLOCK_SET: 'BLOCK_SET',
    BLOCK_UPDATE: 'BLOCK_UPDATE',
    CHAT: 'CHAT',
    PING: 'PING',
    PONG: 'PONG',
    ERROR: 'ERROR',
});

// Atlas layout (16x16 tiles of 16x16px = 256x256 texture)
export const ATLAS_TILES_PER_ROW = 16;
export const ATLAS_TILE_SIZE = 16;
export const ATLAS_PIXEL_SIZE = ATLAS_TILES_PER_ROW * ATLAS_TILE_SIZE;
