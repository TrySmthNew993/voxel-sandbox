/**
 * Procedural 16x16 pixel-art Texture Atlas generator (256x256 total canvas).
 * Produces crisp nearest-neighbor Three.js textures and data-URL icons for HUD slots.
 */

import * as THREE from 'three';
import { ATLAS_PIXEL_SIZE, ATLAS_TILE_SIZE, ATLAS_TILES_PER_ROW } from '../core/Constants.js';
import { TILE_INDEX } from '../core/BlockRegistry.js';
import { hash2D } from '../core/MathUtils.js';

export class TextureAtlas {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = ATLAS_PIXEL_SIZE;
        this.canvas.height = ATLAS_PIXEL_SIZE;
        this.ctx = this.canvas.getContext('2d');
        this.iconCache = new Map();

        this._drawAllTiles();

        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.magFilter = THREE.NearestFilter;
        this.texture.minFilter = THREE.NearestFilter;
        this.texture.generateMipmaps = false;
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.needsUpdate = true;
    }

    /**
     * Fill a single pixel inside tile (tileIndex) at local (px, py).
     */
    _setPixel(tileIndex, px, py, r, g, b, a = 255) {
        const tx = (tileIndex % ATLAS_TILES_PER_ROW) * ATLAS_TILE_SIZE;
        const ty = Math.floor(tileIndex / ATLAS_TILES_PER_ROW) * ATLAS_TILE_SIZE;
        this.ctx.fillStyle = `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${a / 255})`;
        this.ctx.fillRect(tx + px, ty + py, 1, 1);
    }

    _drawAllTiles() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, ATLAS_PIXEL_SIZE, ATLAS_PIXEL_SIZE);

        this._drawDirt(TILE_INDEX.DIRT);
        this._drawGrassTop(TILE_INDEX.GRASS_TOP);
        this._drawGrassSide(TILE_INDEX.GRASS_SIDE);
        this._drawStone(TILE_INDEX.STONE);
        this._drawWoodSide(TILE_INDEX.WOOD_SIDE);
        this._drawWoodTop(TILE_INDEX.WOOD_TOP);
        this._drawGlass(TILE_INDEX.GLASS);
        this._drawLeaves(TILE_INDEX.LEAVES);
        this._drawSand(TILE_INDEX.SAND);
        this._drawCobblestone(TILE_INDEX.COBBLESTONE);
        this._drawPlanks(TILE_INDEX.PLANKS);
        this._drawWater(TILE_INDEX.WATER);
        this._drawSnow(TILE_INDEX.SNOW);
        this._drawSnowSide(TILE_INDEX.SNOW_SIDE);
        this._drawBedrock(TILE_INDEX.BEDROCK);
    }

    _drawDirt(tile) {
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                const n = hash2D(x, y, 101);
                const pebble = hash2D(x, y, 202) > 0.88 ? -16 : 0;
                const delta = (n - 0.5) * 26 + pebble;
                this._setPixel(tile, x, y, 124 + delta, 86 + delta * 0.75, 56 + delta * 0.55);
            }
        }
    }

    _drawGrassTop(tile) {
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                const n = hash2D(x, y, 303);
                const blade = hash2D(x, y, 309) > 0.8 ? 14 : 0;
                const delta = (n - 0.5) * 24 + blade;
                this._setPixel(tile, x, y, 86 + delta * 0.7, 152 + delta, 62 + delta * 0.6);
            }
        }
    }

    _drawGrassSide(tile) {
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                const overhang = 3 + Math.floor(hash2D(x, 0, 404) * 3);
                if (y < overhang) {
                    const n = hash2D(x, y, 408);
                    const delta = (n - 0.5) * 22;
                    const shade = y === overhang - 1 ? -14 : 0;
                    this._setPixel(tile, x, y, 86 + delta * 0.7 + shade, 152 + delta + shade, 62 + delta * 0.6 + shade);
                } else {
                    const n = hash2D(x, y, 101);
                    const delta = (n - 0.5) * 24;
                    this._setPixel(tile, x, y, 124 + delta, 86 + delta * 0.75, 56 + delta * 0.55);
                }
            }
        }
    }

    _drawStone(tile) {
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                const streak = hash2D(Math.floor(x / 2), y, 505);
                const fine = hash2D(x, y, 509);
                const crack = hash2D(x, y, 515) > 0.9 ? -20 : 0;
                const val = 124 + (streak - 0.5) * 22 + (fine - 0.5) * 14 + crack;
                this._setPixel(tile, x, y, val, val + 2, val + 5);
            }
        }
    }

    _drawWoodSide(tile) {
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                const stripe = hash2D(x, Math.floor(y / 3), 606);
                const ridge = (x % 3 === 0) ? -14 : 4;
                const fine = (hash2D(x, y, 612) - 0.5) * 14;
                const delta = (stripe - 0.5) * 24 + ridge + fine;
                this._setPixel(tile, x, y, 104 + delta, 73 + delta * 0.72, 43 + delta * 0.45);
            }
        }
    }

    _drawWoodTop(tile) {
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                const border = x === 0 || y === 0 || x === 15 || y === 15;
                if (border) {
                    const d = (hash2D(x, y, 620) - 0.5) * 14;
                    this._setPixel(tile, x, y, 92 + d, 64 + d * 0.7, 38 + d * 0.5);
                } else {
                    const dx = x - 7.5;
                    const dy = y - 7.5;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const ring = Math.sin(dist * 2.3) > 0.25 ? -16 : 6;
                    const d = (hash2D(x, y, 625) - 0.5) * 12 + ring;
                    this._setPixel(tile, x, y, 166 + d, 130 + d * 0.8, 82 + d * 0.55);
                }
            }
        }
    }

    _drawGlass(tile) {
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                const border = x === 0 || y === 0 || x === 15 || y === 15;
                const innerBevel = x === 1 || y === 1 || x === 14 || y === 14;
                const glint = (x + y === 6 || x + y === 7) && x >= 2 && x <= 5;
                const glint2 = (x + y === 22) && x >= 10 && x <= 13;

                if (border) {
                    this._setPixel(tile, x, y, 210, 234, 245, 235);
                } else if (glint || glint2) {
                    this._setPixel(tile, x, y, 245, 252, 255, 195);
                } else if (innerBevel) {
                    this._setPixel(tile, x, y, 185, 222, 240, 120);
                } else {
                    this._setPixel(tile, x, y, 175, 224, 245, 72);
                }
            }
        }
    }

    _drawLeaves(tile) {
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                const n = hash2D(x, y, 707);
                const hole = hash2D(x, y, 713);
                // Crisp alpha cutout gaps while keeping rich dense leaf clusters
                if (hole < 0.22) {
                    this._setPixel(tile, x, y, 0, 0, 0, 0);
                } else {
                    const shade = n > 0.65 ? 18 : n < 0.3 ? -22 : 0;
                    this._setPixel(tile, x, y, 52 + shade * 0.6, 124 + shade, 42 + shade * 0.5, 255);
                }
            }
        }
    }

    _drawSand(tile) {
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                const n = hash2D(x, y, 808);
                const ripple = Math.sin((x + y * 0.5) * 0.7) * 5;
                const delta = (n - 0.5) * 18 + ripple;
                this._setPixel(tile, x, y, 218 + delta, 204 + delta * 0.9, 148 + delta * 0.7);
            }
        }
    }

    _drawCobblestone(tile) {
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                const cellX = Math.floor((x + ((y >> 2) & 1) * 2) / 4);
                const cellY = Math.floor(y / 4);
                const edgeX = (x + ((y >> 2) & 1) * 2) % 4 === 0;
                const edgeY = y % 4 === 0;
                if (edgeX || edgeY) {
                    this._setPixel(tile, x, y, 76, 78, 82);
                } else {
                    const tone = (hash2D(cellX, cellY, 901) - 0.5) * 34;
                    const fine = (hash2D(x, y, 909) - 0.5) * 14;
                    const v = 128 + tone + fine;
                    this._setPixel(tile, x, y, v, v + 1, v + 3);
                }
            }
        }
    }

    _drawPlanks(tile) {
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                const row = Math.floor(y / 4);
                const seamY = y % 4 === 0;
                const jointX = (x + row * 6) % 16 === 0;
                if (seamY || jointX) {
                    this._setPixel(tile, x, y, 108, 76, 44);
                } else {
                    const plankTone = (hash2D(row, Math.floor((x + row * 6) / 16), 1001) - 0.5) * 18;
                    const grain = (hash2D(x >> 1, y, 1009) - 0.5) * 12;
                    const d = plankTone + grain;
                    this._setPixel(tile, x, y, 178 + d, 134 + d * 0.75, 82 + d * 0.5);
                }
            }
        }
    }

    _drawWater(tile) {
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                const wave = Math.sin((x * 0.55) + (y * 0.35)) * 7;
                const n = (hash2D(x, y, 1101) - 0.5) * 6;
                this._setPixel(tile, x, y, 42 + wave + n, 118 + wave + n, 208 + wave * 0.5, 198);
            }
        }
    }

    _drawSnow(tile) {
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                const n = (hash2D(x, y, 1201) - 0.5) * 12;
                this._setPixel(tile, x, y, 238 + n, 244 + n, 250 + n * 0.5);
            }
        }
    }

    _drawSnowSide(tile) {
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                const overhang = 3 + Math.floor(hash2D(x, 0, 1301) * 3);
                if (y < overhang) {
                    const n = (hash2D(x, y, 1201) - 0.5) * 10;
                    this._setPixel(tile, x, y, 236 + n, 242 + n, 248 + n * 0.5);
                } else {
                    const n = (hash2D(x, y, 101) - 0.5) * 24;
                    this._setPixel(tile, x, y, 124 + n, 86 + n * 0.75, 56 + n * 0.55);
                }
            }
        }
    }

    _drawBedrock(tile) {
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                const n = hash2D(x, y, 1401);
                const val = n > 0.75 ? 92 : n > 0.4 ? 54 : 26;
                this._setPixel(tile, x, y, val, val, val + 2);
            }
        }
    }

    /**
     * Extract a crisp 32x32 data URL thumbnail for a given tile index for HUD/inventory rendering.
     * @param {number} tileIndex
     * @returns {string}
     */
    getTileDataUrl(tileIndex) {
        if (this.iconCache.has(tileIndex)) {
            return this.iconCache.get(tileIndex);
        }

        const iconCanvas = document.createElement('canvas');
        iconCanvas.width = 32;
        iconCanvas.height = 32;
        const ictx = iconCanvas.getContext('2d');
        ictx.imageSmoothingEnabled = false;

        const tx = (tileIndex % ATLAS_TILES_PER_ROW) * ATLAS_TILE_SIZE;
        const ty = Math.floor(tileIndex / ATLAS_TILES_PER_ROW) * ATLAS_TILE_SIZE;

        // Subtle dark checkerboard/backdrop behind transparent tiles like Glass or Leaves
        ictx.fillStyle = 'rgba(20, 26, 36, 0.35)';
        ictx.fillRect(0, 0, 32, 32);
        ictx.drawImage(this.canvas, tx, ty, ATLAS_TILE_SIZE, ATLAS_TILE_SIZE, 0, 0, 32, 32);

        const url = iconCanvas.toDataURL();
        this.iconCache.set(tileIndex, url);
        return url;
    }

    dispose() {
        this.texture.dispose();
    }
}
