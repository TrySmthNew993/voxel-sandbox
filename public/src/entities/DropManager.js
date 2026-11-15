/**
 * Manages 3D collectible item drops spawned when breaking blocks or defeating mobs.
 * Features gravity, voxel ground collision, bobbing & spinning animation,
 * and smooth magnetic attraction flying toward the player when within range.
 */

import * as THREE from 'three';
import { ATLAS_TILES_PER_ROW } from '../core/Constants.js';
import { BLOCKS } from '../core/BlockRegistry.js';
import { getItemDef } from '../core/ItemRegistry.js';

const MAGNET_RADIUS = 3.5;
const COLLECT_RADIUS = 0.88;
const PICKUP_DELAY = 0.18;
const DROP_GRAVITY = 18.0;
const MAX_DROPS = 96;

export class DropManager {
    /**
     * @param {object} opts
     * @param {THREE.Scene} [opts.scene]
     * @param {import('../renderer/TextureAtlas.js').TextureAtlas} [opts.atlas]
     * @param {{ isSolidAt: (x:number,y:number,z:number)=>boolean }} opts.world
     * @param {import('../inventory/InventoryManager.js').InventoryManager} opts.inventory
     * @param {import('../core/EventBus.js').EventBus} [opts.bus]
     */
    constructor({ scene = null, atlas = null, world, inventory, bus = null }) {
        this.scene = scene;
        this.atlas = atlas;
        this.world = world;
        this.inventory = inventory;
        this.bus = bus;

        /** @type {Array<{
         *   id: number,
         *   itemId: number,
         *   count: number,
         *   x: number,
         *   y: number,
         *   z: number,
         *   vx: number,
         *   vy: number,
         *   vz: number,
         *   age: number,
         *   onGround: boolean,
         *   magnetized: boolean,
         *   group: THREE.Group | null,
         *   innerMesh: THREE.Mesh | null
         * }>} */
        this.drops = [];
        this.nextId = 1;

        this._geoCache = new Map();
        this._shadowGeo = null;
        this._shadowMat = null;
        this._dropMaterial = null;

        if (this.scene && this.atlas) {
            this._initSharedRenderResources();
        }
    }

    _initSharedRenderResources() {
        this._dropMaterial = new THREE.MeshLambertMaterial({
            map: this.atlas.texture,
            alphaTest: 0.35,
            transparent: true,
            side: THREE.DoubleSide,
        });

        this._shadowGeo = new THREE.CircleGeometry(0.18, 12);
        this._shadowGeo.rotateX(-Math.PI / 2);
        this._shadowMat = new THREE.MeshBasicMaterial({
            color: 0x05080c,
            transparent: true,
            opacity: 0.36,
            depthWrite: false,
        });
    }

    _getTileUVs(tileIndex) {
        const uStep = 1 / ATLAS_TILES_PER_ROW;
        const vStep = 1 / ATLAS_TILES_PER_ROW;
        const pad = 0.0015;
        const col = tileIndex % ATLAS_TILES_PER_ROW;
        const row = Math.floor(tileIndex / ATLAS_TILES_PER_ROW);
        const u0 = col * uStep + pad;
        const u1 = (col + 1) * uStep - pad;
        const v1 = 1 - row * vStep - pad;
        const v0 = 1 - (row + 1) * vStep + pad;
        return { u0, u1, v0, v1 };
    }

    _getOrCreateGeometry(itemId) {
        if (this._geoCache.has(itemId)) {
            return this._geoCache.get(itemId);
        }

        const blockDef = BLOCKS[itemId];
        const itemDef = getItemDef(itemId);
        const isBlock = Boolean(blockDef && itemDef.category === 'block');

        const size = isBlock ? 0.30 : 0.36;
        const depth = isBlock ? 0.30 : 0.08;
        const geo = new THREE.BoxGeometry(size, size, depth);

        const uvAttr = geo.attributes.uv;
        const faces = blockDef?.faces || {
            top: itemDef.previewTile,
            bottom: itemDef.previewTile,
            side: itemDef.previewTile,
        };

        // BoxGeometry face order: +X (0), -X (1), +Y top (2), -Y bottom (3), +Z (4), -Z (5)
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

        this._geoCache.set(itemId, geo);
        return geo;
    }

    /**
     * Spawn a collectible 3D drop in the world.
     * @param {number} x World X
     * @param {number} y World Y
     * @param {number} z World Z
     * @param {number} itemId Block or Item ID
     * @param {number} [count=1]
     * @param {{vx?: number, vy?: number, vz?: number}} [customVel]
     */
    spawnDrop(x, y, z, itemId, count = 1, customVel = null) {
        if (!itemId || count <= 0) return null;

        // Enforce cap by removing oldest drop if exceeded
        if (this.drops.length >= MAX_DROPS) {
            const oldest = this.drops.shift();
            if (oldest && oldest.group && this.scene) {
                this.scene.remove(oldest.group);
            }
        }

        const angle = Math.random() * Math.PI * 2;
        const speed = 1.2 + Math.random() * 1.4;
        const vx = customVel?.vx ?? Math.cos(angle) * speed;
        const vy = customVel?.vy ?? (3.4 + Math.random() * 1.4);
        const vz = customVel?.vz ?? Math.sin(angle) * speed;

        let group = null;
        let innerMesh = null;

        if (this.scene && this.atlas && this._dropMaterial) {
            group = new THREE.Group();
            group.position.set(x, y, z);

            const geo = this._getOrCreateGeometry(itemId);
            innerMesh = new THREE.Mesh(geo, this._dropMaterial);
            innerMesh.position.y = 0.22;
            group.add(innerMesh);

            if (this._shadowGeo && this._shadowMat) {
                const shadow = new THREE.Mesh(this._shadowGeo, this._shadowMat);
                shadow.position.y = 0.02;
                group.add(shadow);
            }

            this.scene.add(group);
        }

        const drop = {
            id: this.nextId++,
            itemId,
            count,
            x,
            y,
            z,
            vx,
            vy,
            vz,
            age: 0,
            onGround: false,
            magnetized: false,
            group,
            innerMesh,
        };

        this.drops.push(drop);
        return drop;
    }

    /**
     * Step physics, spinning/bobbing animation, magnetic pull toward player, and collection.
     * @param {number} dt
     * @param {{x: number, y: number, z: number}} playerPos Player feet position
     * @param {boolean} [playerDead=false]
     */
    update(dt, playerPos, playerDead = false) {
        if (this.drops.length === 0) return;

        const targetX = playerPos.x;
        const targetY = playerPos.y + 0.9;
        const targetZ = playerPos.z;

        for (let i = this.drops.length - 1; i >= 0; i--) {
            const d = this.drops[i];
            d.age += dt;

            // Despawn after 3 minutes
            if (d.age > 180) {
                this._removeDropAt(i);
                continue;
            }

            const dx = targetX - d.x;
            const dy = targetY - d.y;
            const dz = targetZ - d.z;
            const distSq = dx * dx + dy * dy + dz * dz;
            const dist = Math.sqrt(distSq);

            const canCollect =
                !playerDead &&
                d.age >= PICKUP_DELAY &&
                this.inventory.canAcceptItem(d.itemId);

            if (canCollect && dist <= COLLECT_RADIUS) {
                const added = this.inventory.addItem(d.itemId, d.count);
                if (added >= d.count) {
                    this.bus?.emit('drop:collected', { itemId: d.itemId, count: added });
                    this._removeDropAt(i);
                    continue;
                } else if (added > 0) {
                    d.count -= added;
                }
            }

            if (canCollect && dist <= MAGNET_RADIUS) {
                // Fly smoothly toward the player with increasing attraction speed
                d.magnetized = true;
                const invDist = 1 / Math.max(0.05, dist);
                const pullStrength = 8.5 + (1 - dist / MAGNET_RADIUS) * 9.5;
                d.vx = dx * invDist * pullStrength;
                d.vy = dy * invDist * pullStrength;
                d.vz = dz * invDist * pullStrength;

                d.x += d.vx * dt;
                d.y += d.vy * dt;
                d.z += d.vz * dt;
            } else {
                d.magnetized = false;
                // Standard gravity & ground collision
                d.vy = Math.max(d.vy - DROP_GRAVITY * dt, -22);
                d.vx *= Math.pow(0.12, dt);
                d.vz *= Math.pow(0.12, dt);

                const nextX = d.x + d.vx * dt;
                const nextZ = d.z + d.vz * dt;
                const checkY = Math.floor(d.y + 0.15);

                if (!this.world.isSolidAt(Math.floor(nextX), checkY, Math.floor(d.z))) {
                    d.x = nextX;
                } else {
                    d.vx = -d.vx * 0.3;
                }

                if (!this.world.isSolidAt(Math.floor(d.x), checkY, Math.floor(nextZ))) {
                    d.z = nextZ;
                } else {
                    d.vz = -d.vz * 0.3;
                }

                const nextY = d.y + d.vy * dt;
                const blockBelow = Math.floor(nextY);
                if (d.vy <= 0 && this.world.isSolidAt(Math.floor(d.x), blockBelow, Math.floor(d.z))) {
                    d.y = blockBelow + 1.0;
                    d.vy = 0;
                    d.onGround = true;
                } else {
                    d.y = nextY;
                    d.onGround = false;
                }
            }

            if (d.group && d.innerMesh) {
                d.group.position.set(d.x, d.y, d.z);
                d.innerMesh.rotation.y += dt * 2.5;
                d.innerMesh.position.y = 0.22 + Math.sin(d.age * 3.8 + d.id) * 0.065;
            }
        }
    }

    _removeDropAt(index) {
        const d = this.drops[index];
        if (d && d.group && this.scene) {
            this.scene.remove(d.group);
        }
        this.drops.splice(index, 1);
    }

    clearAll() {
        if (this.scene) {
            for (const d of this.drops) {
                if (d.group) this.scene.remove(d.group);
            }
        }
        this.drops.length = 0;
    }

    dispose() {
        this.clearAll();
        for (const geo of this._geoCache.values()) {
            geo.dispose();
        }
        this._geoCache.clear();
        this._shadowGeo?.dispose();
        this._shadowMat?.dispose();
        this._dropMaterial?.dispose();
    }
}
