/**
 * 3D Mob Entity & AI System.
 * Implements passive animals (Wild Pig) and hostile mobs (Zombie) with:
 * - Articulated 3D Three.js models & limb walking animations
 * - Terrain-following physics with automatic 1-block step jumping
 * - Zombie player detection, pursuit AI, and melee touch damage
 * - Ray-AABB hit detection, red damage flash, knockback, and item drops on death
 */

import * as THREE from 'three';
import { CHUNK_HEIGHT, GRAVITY } from '../core/Constants.js';
import { BLOCK_IDS } from '../core/BlockRegistry.js';
import { ITEM_IDS } from '../core/ItemRegistry.js';

const MAX_PASSIVE_MOBS = 6;
const MAX_HOSTILE_MOBS = 4;
const DESPAWN_DISTANCE = 58;
const ZOMBIE_DETECT_RANGE = 18.0;
const ZOMBIE_TOUCH_RANGE = 1.28;
const ZOMBIE_ATTACK_DAMAGE = 3;
const ZOMBIE_ATTACK_COOLDOWN = 1.05;

function lerpAngle(current, target, t) {
    let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return current + diff * t;
}

export class MobManager {
    /**
     * @param {object} opts
     * @param {THREE.Scene} [opts.scene]
     * @param {{ isSolidAt: Function, getBlock: Function, hasChunkAt?: Function }} opts.world
     * @param {import('./DropManager.js').DropManager} [opts.dropManager]
     * @param {import('../core/EventBus.js').EventBus} [opts.bus]
     */
    constructor({ scene = null, world, dropManager = null, bus = null }) {
        this.scene = scene;
        this.world = world;
        this.dropManager = dropManager;
        this.bus = bus;

        /** @type {Array<object>} */
        this.mobs = [];
        this.nextId = 1;
        this.spawnTimer = 0;
    }

    /**
     * Spawn an initial cluster of passive animals (and zombies only if it is night) near spawn.
     * @param {{x: number, y: number, z: number}} centerPos
     * @param {boolean} [isNight=false]
     */
    spawnInitialMobs(centerPos, isNight = false) {
        this.clearAll();

        // Spawn 3 passive pigs within 7..13 blocks
        const pigOffsets = [
            [7, -6],
            [-8, -5],
            [5, 8],
        ];
        for (const [dx, dz] of pigOffsets) {
            const pos = this._findSurfaceAt(Math.round(centerPos.x + dx), Math.round(centerPos.z + dz), centerPos.y);
            if (pos) {
                this.spawnMob('pig', pos.x, pos.y, pos.z);
            }
        }

        if (isNight) {
            const zombieOffsets = [
                [-13, -10],
                [14, -9],
            ];
            for (const [dx, dz] of zombieOffsets) {
                const pos = this._findSurfaceAt(Math.round(centerPos.x + dx), Math.round(centerPos.z + dz), centerPos.y);
                if (pos) {
                    this.spawnMob('zombie', pos.x, pos.y, pos.z);
                }
            }
        }
    }

    _findSurfaceAt(wx, wz, fallbackY = 66) {
        if (typeof this.world.hasChunkAt === 'function' && !this.world.hasChunkAt(wx, wz)) {
            return null;
        }
        for (let y = CHUNK_HEIGHT - 2; y >= 4; y--) {
            const b = this.world.getBlock(wx, y, wz);
            if (b === BLOCK_IDS.WATER) return null; // Avoid spawning in deep water
            if (this.world.isSolidAt(wx, y, wz)) {
                if (!this.world.isSolidAt(wx, y + 1, wz) && !this.world.isSolidAt(wx, y + 2, wz)) {
                    return { x: wx + 0.5, y: y + 1, z: wz + 0.5 };
                }
                return null;
            }
        }
        return { x: wx + 0.5, y: fallbackY, z: wz + 0.5 };
    }

    /**
     * Spawn a specific mob ('pig' or 'zombie') at world coordinates.
     * @param {'pig'|'zombie'} type
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    spawnMob(type, x, y, z) {
        const isZombie = type === 'zombie';
        const maxHealth = isZombie ? 20 : 10;
        const halfWidth = isZombie ? 0.35 : 0.42;
        const height = isZombie ? 1.8 : 0.95;

        const model = this.scene
            ? (isZombie ? this._buildZombieModel() : this._buildPigModel())
            : null;

        if (model && this.scene) {
            model.group.position.set(x, y, z);
            this.scene.add(model.group);
        }

        const mob = {
            id: this.nextId++,
            type,
            name: isZombie ? 'Zombie' : 'Wild Pig',
            hostile: isZombie,
            x,
            y,
            z,
            vx: 0,
            vy: 0,
            vz: 0,
            yaw: Math.random() * Math.PI * 2,
            halfWidth,
            height,
            health: maxHealth,
            maxHealth,
            onGround: false,
            walkPhase: Math.random() * 10,
            aiTimer: 1.0 + Math.random() * 2.0,
            aiMoving: true,
            panicTimer: 0,
            hurtFlashTimer: 0,
            isFlashing: false,
            attackCooldown: 0,
            dead: false,
            model,
        };

        this.mobs.push(mob);
        return mob;
    }

    _buildPigModel() {
        const group = new THREE.Group();
        const bodyPivot = new THREE.Group();
        group.add(bodyPivot);

        const bodyMat = new THREE.MeshLambertMaterial({ color: 0xf4a4b4 });
        const snoutMat = new THREE.MeshLambertMaterial({ color: 0xe08296 });
        const hoofMat = new THREE.MeshLambertMaterial({ color: 0xd98094 });
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x181c24 });

        // Body (width 0.62, height 0.52, length 0.88)
        const bodyGeo = new THREE.BoxGeometry(0.62, 0.52, 0.88);
        const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
        bodyMesh.position.set(0, 0.54, 0);
        bodyPivot.add(bodyMesh);

        // Head pivot at front (-Z is forward)
        const headPivot = new THREE.Group();
        headPivot.position.set(0, 0.66, -0.44);
        bodyPivot.add(headPivot);

        const headGeo = new THREE.BoxGeometry(0.46, 0.44, 0.46);
        const headMesh = new THREE.Mesh(headGeo, bodyMat);
        headMesh.position.set(0, 0, -0.14);
        headPivot.add(headMesh);

        // Snout
        const snoutGeo = new THREE.BoxGeometry(0.24, 0.16, 0.12);
        const snoutMesh = new THREE.Mesh(snoutGeo, snoutMat);
        snoutMesh.position.set(0, -0.06, -0.40);
        headPivot.add(snoutMesh);

        // Eyes
        const eyeGeo = new THREE.BoxGeometry(0.06, 0.06, 0.02);
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-0.14, 0.06, -0.375);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0.14, 0.06, -0.375);
        headPivot.add(leftEye, rightEye);

        // 4 Legs
        const legGeo = new THREE.BoxGeometry(0.18, 0.34, 0.18);
        legGeo.translate(0, -0.17, 0);

        const legFL = new THREE.Mesh(legGeo, hoofMat);
        legFL.position.set(-0.18, 0.34, -0.28);
        const legFR = new THREE.Mesh(legGeo, hoofMat);
        legFR.position.set(0.18, 0.34, -0.28);
        const legBL = new THREE.Mesh(legGeo, hoofMat);
        legBL.position.set(-0.18, 0.34, 0.28);
        const legBR = new THREE.Mesh(legGeo, hoofMat);
        legBR.position.set(0.18, 0.34, 0.28);

        bodyPivot.add(legFL, legFR, legBL, legBR);

        const tintableMaterials = [
            { mat: bodyMat, baseHex: 0xf4a4b4 },
            { mat: snoutMat, baseHex: 0xe08296 },
            { mat: hoofMat, baseHex: 0xd98094 },
        ];

        return {
            group,
            bodyPivot,
            headPivot,
            legs: [legFL, legFR, legBL, legBR],
            arms: [],
            tintableMaterials,
            disposables: [bodyMat, snoutMat, hoofMat, eyeMat, bodyGeo, headGeo, snoutGeo, eyeGeo, legGeo],
        };
    }

    _buildZombieModel() {
        const group = new THREE.Group();
        const bodyPivot = new THREE.Group();
        group.add(bodyPivot);

        const skinMat = new THREE.MeshLambertMaterial({ color: 0x568849 });
        const shirtMat = new THREE.MeshLambertMaterial({ color: 0x266e82 });
        const pantsMat = new THREE.MeshLambertMaterial({ color: 0x2f345e });
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111518 });

        // Legs
        const legGeo = new THREE.BoxGeometry(0.22, 0.72, 0.24);
        legGeo.translate(0, -0.36, 0);

        const leftLeg = new THREE.Mesh(legGeo, pantsMat);
        leftLeg.position.set(-0.12, 0.72, 0);
        const rightLeg = new THREE.Mesh(legGeo, pantsMat);
        rightLeg.position.set(0.12, 0.72, 0);
        bodyPivot.add(leftLeg, rightLeg);

        // Torso
        const torsoGeo = new THREE.BoxGeometry(0.48, 0.68, 0.26);
        const torso = new THREE.Mesh(torsoGeo, shirtMat);
        torso.position.set(0, 1.06, 0);
        bodyPivot.add(torso);

        // Outstretched Zombie Arms (pivoted at shoulder y=1.34, raised forward along -Z)
        const armGeo = new THREE.BoxGeometry(0.18, 0.64, 0.20);
        armGeo.translate(0, -0.28, 0);

        const leftArm = new THREE.Mesh(armGeo, skinMat);
        leftArm.position.set(-0.34, 1.34, 0);
        leftArm.rotation.x = Math.PI / 2 - 0.15;

        const rightArm = new THREE.Mesh(armGeo, skinMat);
        rightArm.position.set(0.34, 1.34, 0);
        rightArm.rotation.x = Math.PI / 2 - 0.15;
        bodyPivot.add(leftArm, rightArm);

        // Head
        const headPivot = new THREE.Group();
        headPivot.position.set(0, 1.40, 0);
        bodyPivot.add(headPivot);

        const headGeo = new THREE.BoxGeometry(0.44, 0.44, 0.44);
        const headMesh = new THREE.Mesh(headGeo, skinMat);
        headMesh.position.set(0, 0.22, 0);
        headPivot.add(headMesh);

        // Zombie eyes
        const eyeGeo = new THREE.BoxGeometry(0.08, 0.06, 0.02);
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-0.1, 0.22, -0.225);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0.1, 0.22, -0.225);
        headPivot.add(leftEye, rightEye);

        const tintableMaterials = [
            { mat: skinMat, baseHex: 0x568849 },
            { mat: shirtMat, baseHex: 0x266e82 },
            { mat: pantsMat, baseHex: 0x2f345e },
        ];

        return {
            group,
            bodyPivot,
            headPivot,
            legs: [leftLeg, rightLeg],
            arms: [leftArm, rightArm],
            tintableMaterials,
            disposables: [skinMat, shirtMat, pantsMat, eyeMat, legGeo, torsoGeo, armGeo, headGeo, eyeGeo],
        };
    }

    _setMobFlash(mob, flashing) {
        if (!mob.model || mob.isFlashing === flashing) return;
        mob.isFlashing = flashing;
        for (const item of mob.model.tintableMaterials) {
            item.mat.color.setHex(flashing ? 0xff3b3b : item.baseHex);
        }
    }

    /**
     * Raycast against all living mobs' AABBs to detect player melee attacks or crosshair targeting.
     * @param {{x: number, y: number, z: number}} origin
     * @param {{x: number, y: number, z: number}} direction Normalized ray vector
     * @param {number} [maxDistance=4.6]
     * @returns {{ hit: boolean, mob: object|null, distance: number }}
     */
    raycastMob(origin, direction, maxDistance = 4.6) {
        let closestMob = null;
        let closestDist = maxDistance;

        for (const mob of this.mobs) {
            if (mob.dead) continue;
            const hw = mob.halfWidth + 0.08; // Slight hitbox forgiveness for smooth combat feel
            const minX = mob.x - hw;
            const maxX = mob.x + hw;
            const minY = mob.y;
            const maxY = mob.y + mob.height + 0.08;
            const minZ = mob.z - hw;
            const maxZ = mob.z + hw;

            const t = this._intersectRayAABB(origin, direction, minX, minY, minZ, maxX, maxY, maxZ);
            if (t !== null && t >= 0 && t <= closestDist) {
                closestDist = t;
                closestMob = mob;
            }
        }

        return {
            hit: Boolean(closestMob),
            mob: closestMob,
            distance: closestMob ? closestDist : Infinity,
        };
    }

    _intersectRayAABB(origin, dir, minX, minY, minZ, maxX, maxY, maxZ) {
        let tmin = -Infinity;
        let tmax = Infinity;

        const axes = [
            [origin.x, dir.x, minX, maxX],
            [origin.y, dir.y, minY, maxY],
            [origin.z, dir.z, minZ, maxZ],
        ];

        for (const [o, d, mn, mx] of axes) {
            if (Math.abs(d) < 1e-8) {
                if (o < mn || o > mx) return null;
            } else {
                let t1 = (mn - o) / d;
                let t2 = (mx - o) / d;
                if (t1 > t2) {
                    const tmp = t1;
                    t1 = t2;
                    t2 = tmp;
                }
                if (t1 > tmin) tmin = t1;
                if (t2 < tmax) tmax = t2;
                if (tmin > tmax) return null;
            }
        }

        if (tmax < 0) return null;
        return tmin >= 0 ? tmin : 0;
    }

    /**
     * Apply weapon/hit damage to a mob, trigger red damage flash, knockback, and drop items on death.
     * @param {object} mob
     * @param {number} damage
     * @param {{x: number, y?: number, z: number}} [hitDir]
     * @returns {boolean} True if mob was killed by this hit
     */
    damageMob(mob, damage, hitDir = { x: 0, z: 0 }) {
        if (!mob || mob.dead) return false;

        mob.health = Math.max(0, mob.health - damage);
        mob.hurtFlashTimer = 0.28;
        this._setMobFlash(mob, true);

        // Apply knockback impulse away from attacker
        const horizLen = Math.hypot(hitDir.x, hitDir.z) || 1;
        mob.vx = (hitDir.x / horizLen) * 6.2;
        mob.vz = (hitDir.z / horizLen) * 6.2;
        mob.vy = 4.5;
        mob.onGround = false;

        // Passive mobs panic and flee after taking damage
        if (!mob.hostile) {
            mob.panicTimer = 3.2;
            mob.yaw = Math.atan2(-hitDir.x, -hitDir.z);
            mob.aiMoving = true;
        }

        this.bus?.emit('mob:damaged', { mob, damage });

        if (mob.health <= 0) {
            this._killMob(mob);
            return true;
        }
        return false;
    }

    _killMob(mob) {
        mob.dead = true;

        // Spawn collectible 3D item drops at mob's location
        if (this.dropManager) {
            const dropY = mob.y + 0.35;
            if (mob.type === 'pig') {
                const meatCount = 1 + (Math.random() > 0.45 ? 1 : 0);
                this.dropManager.spawnDrop(mob.x, dropY, mob.z, ITEM_IDS.RAW_PORKCHOP, meatCount);
            } else if (mob.type === 'zombie') {
                this.dropManager.spawnDrop(mob.x, dropY, mob.z, ITEM_IDS.ROTTEN_FLESH, 1);
                this.dropManager.spawnDrop(mob.x + 0.2, dropY, mob.z - 0.2, ITEM_IDS.STICK, 2);
                this.dropManager.spawnDrop(mob.x - 0.2, dropY, mob.z + 0.2, BLOCK_IDS.COBBLESTONE, 1);
            }
        }

        this.bus?.emit('mob:killed', { mob });

        const idx = this.mobs.indexOf(mob);
        if (idx !== -1) {
            this._removeMobAt(idx);
        }
    }

    /**
     * Step AI, movement physics, collision, damage flash, and touch attacks for all active mobs.
     * @param {number} dt
     * @param {import('../physics/PlayerController.js').PlayerController} player
     * @param {boolean} [isNight=false]
     */
    update(dt, player, isNight = false) {
        const playerPos = player.position;
        const playerDead = Boolean(player.isDead);

        // Periodically top up ambient mob population around player
        this.spawnTimer += dt;
        if (this.spawnTimer >= 4.0) {
            this.spawnTimer = 0;
            this._maintainPopulation(playerPos, isNight);
        }

        for (let i = this.mobs.length - 1; i >= 0; i--) {
            const mob = this.mobs[i];
            if (mob.dead) {
                this._removeMobAt(i);
                continue;
            }

            const dxToPlayer = playerPos.x - mob.x;
            const dyToPlayer = playerPos.y - mob.y;
            const dzToPlayer = playerPos.z - mob.z;
            const distSq = dxToPlayer * dxToPlayer + dzToPlayer * dzToPlayer;

            if (distSq > DESPAWN_DISTANCE * DESPAWN_DISTANCE || mob.y < -20) {
                this._removeMobAt(i);
                continue;
            }

            // Pause physics if chunk under mob is not loaded
            if (typeof this.world.hasChunkAt === 'function' && !this.world.hasChunkAt(mob.x, mob.z)) {
                continue;
            }

            // Update hurt flash timer
            if (mob.hurtFlashTimer > 0) {
                mob.hurtFlashTimer -= dt;
                if (mob.hurtFlashTimer <= 0) {
                    this._setMobFlash(mob, false);
                }
            }

            if (mob.attackCooldown > 0) {
                mob.attackCooldown = Math.max(0, mob.attackCooldown - dt);
            }

            // Zombies burn in daytime sunlight
            if (mob.hostile && !isNight) {
                mob.sunBurnTimer = (mob.sunBurnTimer || 0) + dt;
                if (mob.sunBurnTimer >= 1.2) {
                    mob.sunBurnTimer = 0;
                    mob.health -= 3;
                    mob.hurtFlashTimer = 0.22;
                    this._setMobFlash(mob, true);
                    if (mob.health <= 0) {
                        this._killMob(mob);
                        this._removeMobAt(i);
                        continue;
                    }
                }
            } else {
                mob.sunBurnTimer = 0;
            }

            const distToPlayer = Math.sqrt(distSq);

            // AI Decision Logic
            let targetSpeed = 0;
            if (mob.hostile) {
                if (!playerDead && distToPlayer <= ZOMBIE_DETECT_RANGE) {
                    // Hostile Zombie locks onto player and walks toward them
                    const desiredYaw = Math.atan2(-dxToPlayer, -dzToPlayer);
                    mob.yaw = lerpAngle(mob.yaw, desiredYaw, Math.min(1, dt * 8));
                    targetSpeed = distToPlayer > 0.75 ? 3.1 : 0;

                    // Deal touch damage when close to player
                    if (
                        distToPlayer <= ZOMBIE_TOUCH_RANGE &&
                        Math.abs(dyToPlayer) <= 1.8 &&
                        mob.attackCooldown <= 0
                    ) {
                        mob.attackCooldown = ZOMBIE_ATTACK_COOLDOWN;
                        const invDist = 1 / Math.max(0.1, distToPlayer);
                        if (typeof player.takeDamage === 'function') {
                            player.takeDamage(ZOMBIE_ATTACK_DAMAGE, 'Slain by a Zombie', {
                                x: dxToPlayer * invDist * 5.2,
                                y: 3.6,
                                z: dzToPlayer * invDist * 5.2,
                            });
                        }
                    }
                } else {
                    // Idle wander when player is out of range
                    this._updateWanderAI(mob, dt);
                    targetSpeed = mob.aiMoving ? 1.2 : 0;
                }
            } else {
                // Passive animal (Pig)
                if (mob.panicTimer > 0) {
                    mob.panicTimer -= dt;
                    targetSpeed = 3.3;
                } else {
                    this._updateWanderAI(mob, dt);
                    targetSpeed = mob.aiMoving ? 1.55 : 0;
                }
            }

            // Forward direction from yaw (matching Three.js -Z forward convention)
            const fwdX = -Math.sin(mob.yaw);
            const fwdZ = -Math.cos(mob.yaw);

            const wishVx = fwdX * targetSpeed;
            const wishVz = fwdZ * targetSpeed;
            const blend = Math.min(1, dt * (mob.hurtFlashTimer > 0 ? 4 : 10));
            mob.vx += (wishVx - mob.vx) * blend;
            mob.vz += (wishVz - mob.vz) * blend;

            mob.vy = Math.max(mob.vy - GRAVITY * dt, -36);

            // Move & resolve terrain collisions with auto-step jump
            const blockedHoriz = this._moveMobWithCollision(mob, dt);
            if (blockedHoriz && mob.onGround) {
                mob.vy = 7.8; // Jump up 1-block terrain steps
                mob.onGround = false;
            }

            // Update 3D model transform & limb animation
            if (mob.model) {
                mob.model.group.position.set(mob.x, mob.y, mob.z);
                mob.model.bodyPivot.rotation.y = mob.yaw;

                const speedHoriz = Math.hypot(mob.vx, mob.vz);
                if (speedHoriz > 0.25) {
                    mob.walkPhase += dt * (speedHoriz * 3.6);
                    const swing = Math.sin(mob.walkPhase) * 0.65;
                    if (mob.model.legs.length === 4) {
                        mob.model.legs[0].rotation.x = swing;
                        mob.model.legs[1].rotation.x = -swing;
                        mob.model.legs[2].rotation.x = -swing;
                        mob.model.legs[3].rotation.x = swing;
                    } else if (mob.model.legs.length === 2) {
                        mob.model.legs[0].rotation.x = swing;
                        mob.model.legs[1].rotation.x = -swing;
                    }
                } else {
                    for (const leg of mob.model.legs) {
                        leg.rotation.x *= 0.85;
                    }
                }

                // Subtle zombie arm bob
                if (mob.model.arms.length === 2) {
                    const bob = Math.sin(mob.walkPhase * 0.5) * 0.08;
                    mob.model.arms[0].rotation.x = Math.PI / 2 - 0.15 + bob;
                    mob.model.arms[1].rotation.x = Math.PI / 2 - 0.15 - bob;
                }
            }
        }
    }

    _updateWanderAI(mob, dt) {
        mob.aiTimer -= dt;
        if (mob.aiTimer <= 0) {
            mob.aiMoving = Math.random() < 0.65;
            if (mob.aiMoving) {
                mob.yaw += (Math.random() - 0.5) * Math.PI * 1.2;
                mob.aiTimer = 2.0 + Math.random() * 3.0;
            } else {
                mob.aiTimer = 1.2 + Math.random() * 2.2;
            }
        }
    }

    _moveMobWithCollision(mob, dt) {
        let blockedHoriz = false;
        const hw = mob.halfWidth;
        const h = mob.height;

        // X axis
        const dx = mob.vx * dt;
        if (dx !== 0) {
            const nextX = mob.x + dx;
            if (!this._collidesAt(nextX, mob.y, mob.z, hw, h)) {
                mob.x = nextX;
            } else {
                mob.vx = 0;
                blockedHoriz = true;
            }
        }

        // Z axis
        const dz = mob.vz * dt;
        if (dz !== 0) {
            const nextZ = mob.z + dz;
            if (!this._collidesAt(mob.x, mob.y, nextZ, hw, h)) {
                mob.z = nextZ;
            } else {
                mob.vz = 0;
                blockedHoriz = true;
            }
        }

        // Y axis
        const dy = mob.vy * dt;
        const nextY = mob.y + dy;
        if (!this._collidesAt(mob.x, nextY, mob.z, hw, h)) {
            mob.y = nextY;
            mob.onGround = false;
        } else {
            if (dy < 0) {
                mob.y = Math.floor(nextY) + 1;
                mob.onGround = true;
            }
            mob.vy = 0;
        }

        return blockedHoriz;
    }

    _collidesAt(x, y, z, hw, height) {
        const eps = 1e-3;
        const minBx = Math.floor(x - hw + eps);
        const maxBx = Math.floor(x + hw - eps);
        const minBy = Math.floor(y + eps);
        const maxBy = Math.floor(y + height - eps);
        const minBz = Math.floor(z - hw + eps);
        const maxBz = Math.floor(z + hw - eps);

        for (let by = minBy; by <= maxBy; by++) {
            for (let bz = minBz; bz <= maxBz; bz++) {
                for (let bx = minBx; bx <= maxBx; bx++) {
                    if (this.world.isSolidAt(bx, by, bz)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    _maintainPopulation(playerPos, isNight = false) {
        let passiveCount = 0;
        let hostileCount = 0;
        for (const m of this.mobs) {
            if (m.hostile) hostileCount++;
            else passiveCount++;
        }

        if (passiveCount < MAX_PASSIVE_MOBS) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 12 + Math.random() * 14;
            const wx = Math.round(playerPos.x + Math.cos(angle) * dist);
            const wz = Math.round(playerPos.z + Math.sin(angle) * dist);
            const pos = this._findSurfaceAt(wx, wz, playerPos.y);
            if (pos) {
                this.spawnMob('pig', pos.x, pos.y, pos.z);
            }
        }

        if (isNight && hostileCount < MAX_HOSTILE_MOBS) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 16 + Math.random() * 16;
            const wx = Math.round(playerPos.x + Math.cos(angle) * dist);
            const wz = Math.round(playerPos.z + Math.sin(angle) * dist);
            const pos = this._findSurfaceAt(wx, wz, playerPos.y);
            if (pos) {
                this.spawnMob('zombie', pos.x, pos.y, pos.z);
            }
        }
    }

    _removeMobAt(index) {
        const mob = this.mobs[index];
        if (!mob) return;
        if (mob.model) {
            if (this.scene) {
                this.scene.remove(mob.model.group);
            }
            for (const d of mob.model.disposables) {
                d?.dispose?.();
            }
        }
        this.mobs.splice(index, 1);
    }

    clearAll() {
        for (let i = this.mobs.length - 1; i >= 0; i--) {
            this._removeMobAt(i);
        }
    }

    dispose() {
        this.clearAll();
    }
}
