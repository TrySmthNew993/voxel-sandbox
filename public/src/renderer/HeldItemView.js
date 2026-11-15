/**
 * First-person 3D held item / instrument / weapon viewmodel attached to the camera.
 * Renders a true 3D voxel-extruded Pickaxe, Axe, Sword, Shovel, Food, or Block
 * in the bottom-right view with smooth walking bob and mining/combat swing animation.
 */

import * as THREE from 'three';
import { ATLAS_TILE_SIZE, ATLAS_TILES_PER_ROW } from '../core/Constants.js';
import { BLOCKS } from '../core/BlockRegistry.js';
import { getItemDef } from '../core/ItemRegistry.js';

export class HeldItemView {
    /**
     * @param {THREE.Camera} camera
     * @param {import('./TextureAtlas.js').TextureAtlas} atlas
     * @param {THREE.Scene} scene
     */
    constructor(camera, atlas, scene) {
        this.camera = camera;
        this.atlas = atlas;
        this.scene = scene;

        if (this.scene && this.camera && !this.camera.parent) {
            this.scene.add(this.camera);
        }

        this.anchor = new THREE.Group();
        this.anchor.position.set(0.42, -0.34, -0.58);
        this.camera.add(this.anchor);

        this.swingPhase = 0;
        this.isSwinging = false;
        this.bobPhase = 0;
        this.currentItemId = -1;
        this.currentMesh = null;
        this._geoCache = new Map();

        this.atlasMat = new THREE.MeshLambertMaterial({
            map: this.atlas.texture,
            alphaTest: 0.35,
            transparent: true,
            side: THREE.FrontSide,
            depthTest: false,
        });
        this.voxelItemMat = new THREE.MeshLambertMaterial({
            vertexColors: true,
            side: THREE.FrontSide,
            depthTest: false,
        });
        this.handMat = new THREE.MeshLambertMaterial({
            color: 0xe8be9e,
            depthTest: false,
        });

        this.setHeldItem(0);
    }

    _getTileUVs(tileIndex) {
        const step = 1 / ATLAS_TILES_PER_ROW;
        const pad = 0.002;
        const col = tileIndex % ATLAS_TILES_PER_ROW;
        const row = Math.floor(tileIndex / ATLAS_TILES_PER_ROW);
        return {
            u0: col * step + pad,
            u1: (col + 1) * step - pad,
            v1: 1 - row * step - pad,
            v0: 1 - (row + 1) * step + pad,
        };
    }

    /**
     * Build a 3D extruded pixel-art voxel mesh from a 16x16 TextureAtlas tile.
     * Every non-transparent pixel becomes a 3D mini-voxel with exact vertex colors.
     */
    _buildExtrudedSpriteGeometry(tileIndex) {
        const cacheKey = `sprite:${tileIndex}`;
        if (this._geoCache.has(cacheKey)) {
            return this._geoCache.get(cacheKey);
        }

        const tx = (tileIndex % ATLAS_TILES_PER_ROW) * ATLAS_TILE_SIZE;
        const ty = Math.floor(tileIndex / ATLAS_TILES_PER_ROW) * ATLAS_TILE_SIZE;
        const imgData = this.atlas.ctx.getImageData(tx, ty, ATLAS_TILE_SIZE, ATLAS_TILE_SIZE).data;

        const positions = [];
        const normals = [];
        const colors = [];
        const indices = [];
        let vertCount = 0;

        const scale = 0.38 / 16;
        const halfDepth = 0.022;

        const isOpaque = (x, y) => {
            if (x < 0 || x >= 16 || y < 0 || y >= 16) return false;
            return imgData[(y * 16 + x) * 4 + 3] > 90;
        };

        const pushQuad = (p0, p1, p2, p3, nx, ny, nz, r, g, b, shade) => {
            positions.push(...p0, ...p1, ...p2, ...p3);
            for (let i = 0; i < 4; i++) {
                normals.push(nx, ny, nz);
                colors.push(r * shade, g * shade, b * shade);
            }
            indices.push(
                vertCount, vertCount + 1, vertCount + 2,
                vertCount, vertCount + 2, vertCount + 3
            );
            vertCount += 4;
        };

        for (let py = 0; py < 16; py++) {
            for (let px = 0; px < 16; px++) {
                const idx = (py * 16 + px) * 4;
                if (imgData[idx + 3] <= 90) continue;

                // Convert sRGB byte to linear-ish 0..1 vertex color
                const r = imgData[idx] / 255;
                const g = imgData[idx + 1] / 255;
                const b = imgData[idx + 2] / 255;

                const x0 = (px - 8) * scale;
                const x1 = (px - 7) * scale;
                const y0 = (7 - py) * scale;
                const y1 = (8 - py) * scale;
                const z0 = -halfDepth;
                const z1 = halfDepth;

                // Front (+Z) & Back (-Z)
                pushQuad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1, r, g, b, 1.0);
                pushQuad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0, 0, -1, r, g, b, 0.92);

                // Exposed perimeter edges
                if (!isOpaque(px + 1, py)) {
                    pushQuad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 1, 0, 0, r, g, b, 0.82);
                }
                if (!isOpaque(px - 1, py)) {
                    pushQuad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0, r, g, b, 0.82);
                }
                if (!isOpaque(px, py - 1)) {
                    pushQuad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 0, 1, 0, r, g, b, 0.95);
                }
                if (!isOpaque(px, py + 1)) {
                    pushQuad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0, -1, 0, r, g, b, 0.72);
                }
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geo.setIndex(indices);
        geo.computeBoundingSphere();

        this._geoCache.set(cacheKey, geo);
        return geo;
    }

    setHeldItem(itemId) {
        const id = itemId || 0;
        if (id === this.currentItemId) return;
        this.currentItemId = id;

        if (this.currentMesh) {
            this.anchor.remove(this.currentMesh);
            this.currentMesh = null;
        }

        if (!id) {
            const cacheKey = 'hand';
            let geo = this._geoCache.get(cacheKey);
            if (!geo) {
                geo = new THREE.BoxGeometry(0.16, 0.16, 0.42);
                this._geoCache.set(cacheKey, geo);
            }
            const mesh = new THREE.Mesh(geo, this.handMat);
            mesh.renderOrder = 25;
            mesh.rotation.set(0.22, -0.35, -0.1);
            this.anchor.add(mesh);
            this.currentMesh = mesh;
            return;
        }

        const itemDef = getItemDef(id);
        const blockDef = BLOCKS[id];

        if (blockDef && itemDef.category === 'block') {
            const cacheKey = `block:${id}`;
            let geo = this._geoCache.get(cacheKey);
            if (!geo) {
                geo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
                const uvAttr = geo.attributes.uv;
                const faces = blockDef.faces;
                const faceTiles = [
                    faces.side,
                    faces.side,
                    faces.top,
                    faces.bottom,
                    faces.side,
                    faces.side,
                ];
                for (let f = 0; f < 6; f++) {
                    const { u0, u1, v0, v1 } = this._getTileUVs(faceTiles[f]);
                    const base = f * 4;
                    uvAttr.setXY(base + 0, u0, v1);
                    uvAttr.setXY(base + 1, u1, v1);
                    uvAttr.setXY(base + 2, u0, v0);
                    uvAttr.setXY(base + 3, u1, v0);
                }
                uvAttr.needsUpdate = true;
                this._geoCache.set(cacheKey, geo);
            }

            const mesh = new THREE.Mesh(geo, this.atlasMat);
            mesh.renderOrder = 25;
            mesh.rotation.set(0.25, -0.65, 0.08);
            this.anchor.add(mesh);
            this.currentMesh = mesh;
        } else {
            // 3D voxel-extruded Tool / Weapon / Material / Food item
            const geo = this._buildExtrudedSpriteGeometry(itemDef.previewTile);
            const mesh = new THREE.Mesh(geo, this.voxelItemMat);
            mesh.renderOrder = 25;
            mesh.rotation.set(0.12, -1.18, 0.24);
            this.anchor.add(mesh);
            this.currentMesh = mesh;
        }
    }

    triggerSwing() {
        if (!this.isSwinging || this.swingPhase > 0.45) {
            this.isSwinging = true;
            this.swingPhase = 0;
        }
    }

    update(dt, isMoving = false, isMining = false) {
        if (isMining && !this.isSwinging) {
            this.isSwinging = true;
            this.swingPhase = 0;
        }

        if (isMoving) {
            this.bobPhase += dt * 9;
        } else {
            this.bobPhase *= 0.9;
        }

        let swingRotX = 0;
        let swingRotZ = 0;
        let swingOffsetY = 0;
        let swingOffsetZ = 0;

        if (this.isSwinging) {
            this.swingPhase += dt * 4.2;
            if (this.swingPhase >= 1.0) {
                if (isMining) {
                    this.swingPhase = 0;
                } else {
                    this.isSwinging = false;
                    this.swingPhase = 0;
                }
            }
            const s = Math.sin(this.swingPhase * Math.PI);
            swingRotX = -s * 0.85;
            swingRotZ = s * 0.42;
            swingOffsetY = -s * 0.08;
            swingOffsetZ = -s * 0.12;
        }

        const bobX = Math.cos(this.bobPhase) * 0.015;
        const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.018;

        this.anchor.position.set(
            0.42 + bobX,
            -0.34 - bobY + swingOffsetY,
            -0.58 + swingOffsetZ
        );
        this.anchor.rotation.set(swingRotX, 0, swingRotZ);
    }

    dispose() {
        for (const geo of this._geoCache.values()) {
            geo.dispose();
        }
        this._geoCache.clear();
        this.atlasMat.dispose();
        this.voxelItemMat.dispose();
        this.handMat.dispose();
    }
}
