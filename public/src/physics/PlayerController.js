/**
 * First-person Player Controller with PointerLock mouse look, WASD + sprint + jump + fly toggle,
 * and fixed-timestep axis-separated AABB voxel collision detection.
 */

import {
    PLAYER_HALF_WIDTH,
    PLAYER_HEIGHT,
    PLAYER_EYE_HEIGHT,
    GRAVITY,
    JUMP_VELOCITY,
    WALK_SPEED,
    SPRINT_SPEED,
    FLY_SPEED,
    SWIM_GRAVITY,
    SWIM_UP_SPEED,
    TERMINAL_VELOCITY,
    CHUNK_HEIGHT,
} from '../core/Constants.js';
import { BLOCK_IDS } from '../core/BlockRegistry.js';
import { clamp } from '../core/MathUtils.js';
import { AABB } from './AABB.js';

const EPS = 1e-4;
const PITCH_LIMIT = Math.PI / 2 - 0.01;

export class PlayerController {
    /**
     * @param {object} opts
     * @param {{ getBlock: Function, isSolidAt: Function, hasChunkAt: Function }} opts.world
     * @param {{ position: {x:number,y:number,z:number,set:Function}, rotation: {x:number,y:number,z:number}, fov?: number, updateProjectionMatrix?: Function }} [opts.camera]
     * @param {HTMLElement|null} [opts.domElement]
     * @param {import('../core/EventBus.js').EventBus} [opts.bus]
     */
    constructor({ world, camera = null, domElement = null, bus = null }) {
        this.world = world;
        this.camera = camera;
        this.domElement = domElement;
        this.bus = bus;

        // Feet position & velocity
        this.position = { x: 0.5, y: 70, z: 0.5 };
        this.velocity = { x: 0, y: 0, z: 0 };
        this.yaw = 0;
        this.pitch = -0.1;

        this.onGround = false;
        this.inWater = false;
        this.eyeInWater = false;
        this.flying = false;
        this.sprinting = false;
        this.pointerLocked = false;
        this.sensitivity = 0.0022;

        this.keys = new Set();
        this.walkBobPhase = 0;
        this.currentFov = 75;

        if (this.domElement && typeof document !== 'undefined') {
            this._bindInput();
        }
        this.syncCamera(0);
    }

    _bindInput() {
        this._onKeyDown = (e) => {
            if (this._isTypingInInput(e.target)) return;
            this.keys.add(e.code);

            if (e.code === 'KeyF' && this.pointerLocked) {
                this.flying = !this.flying;
                if (this.flying) this.velocity.y = 0;
                this.bus?.emit('player:flyToggled', this.flying);
            }
        };

        this._onKeyUp = (e) => {
            this.keys.delete(e.code);
        };

        this._onMouseMove = (e) => {
            if (!this.pointerLocked) return;
            this.yaw -= e.movementX * this.sensitivity;
            this.pitch = clamp(this.pitch - e.movementY * this.sensitivity, -PITCH_LIMIT, PITCH_LIMIT);
        };

        this._onMouseDown = (e) => {
            if (!this.pointerLocked) return;
            if (e.button === 0) {
                this.bus?.emit('player:primaryAction');
            } else if (e.button === 2) {
                this.bus?.emit('player:secondaryAction');
            } else if (e.button === 1) {
                e.preventDefault();
                this.bus?.emit('player:pickAction');
            }
        };

        this._onContextMenu = (e) => {
            e.preventDefault();
        };

        this._onPointerLockChange = () => {
            this.pointerLocked = document.pointerLockElement === this.domElement;
            if (!this.pointerLocked) {
                this.keys.clear();
            }
            this.bus?.emit('player:pointerLock', this.pointerLocked);
        };

        this._onBlur = () => {
            this.keys.clear();
        };

        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup', this._onKeyUp);
        window.addEventListener('blur', this._onBlur);
        document.addEventListener('mousemove', this._onMouseMove);
        document.addEventListener('pointerlockchange', this._onPointerLockChange);
        this.domElement.addEventListener('mousedown', this._onMouseDown);
        this.domElement.addEventListener('contextmenu', this._onContextMenu);
    }

    _isTypingInInput(target) {
        if (!target) return false;
        const tag = target.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    }

    requestPointerLock() {
        if (this.domElement && typeof this.domElement.requestPointerLock === 'function') {
            this.domElement.requestPointerLock();
        }
    }

    exitPointerLock() {
        if (typeof document !== 'undefined' && document.pointerLockElement) {
            document.exitPointerLock();
        }
    }

    setPosition(x, y, z) {
        this.position.x = x;
        this.position.y = y;
        this.position.z = z;
        this.velocity.x = 0;
        this.velocity.y = 0;
        this.velocity.z = 0;
        this.onGround = false;
        this.syncCamera(0);
    }

    setSensitivity(val) {
        this.sensitivity = val;
    }

    getAABB() {
        return AABB.fromPlayerPosition(
            this.position.x,
            this.position.y,
            this.position.z,
            PLAYER_HALF_WIDTH,
            PLAYER_HEIGHT
        );
    }

    getEyePosition() {
        return {
            x: this.position.x,
            y: this.position.y + PLAYER_EYE_HEIGHT,
            z: this.position.z,
        };
    }

    getLookDirection() {
        const cosPitch = Math.cos(this.pitch);
        return {
            x: -Math.sin(this.yaw) * cosPitch,
            y: Math.sin(this.pitch),
            z: -Math.cos(this.yaw) * cosPitch,
        };
    }

    isMovingHorizontally() {
        return Math.hypot(this.velocity.x, this.velocity.z) > 0.35;
    }

    /**
     * Check whether placing a solid voxel at (bx, by, bz) would intersect the player's body.
     */
    wouldBlockIntersectPlayer(bx, by, bz) {
        return this.getAABB().intersectsBlock(bx, by, bz, 1e-4);
    }

    /**
     * Step fixed-timestep physics and resolve AABB voxel collisions axis by axis.
     * @param {number} dt Fixed timestep in seconds (e.g. 1/60)
     */
    updatePhysics(dt) {
        // Guard against falling through unloaded terrain while streaming chunks
        if (typeof this.world.hasChunkAt === 'function' && !this.world.hasChunkAt(this.position.x, this.position.z)) {
            this.velocity.y = 0;
            this.syncCamera(dt);
            return;
        }

        // Check water state
        const bx = Math.floor(this.position.x);
        const bz = Math.floor(this.position.z);
        const feetBlock = this.world.getBlock(bx, Math.floor(this.position.y + 0.2), bz);
        const chestBlock = this.world.getBlock(bx, Math.floor(this.position.y + 1.0), bz);
        const eyeBlock = this.world.getBlock(bx, Math.floor(this.position.y + PLAYER_EYE_HEIGHT), bz);
        this.inWater = feetBlock === BLOCK_IDS.WATER || chestBlock === BLOCK_IDS.WATER;
        this.eyeInWater = eyeBlock === BLOCK_IDS.WATER;

        // Gather input intent (only active while pointer locked or in headless test mode)
        const activeControl = !this.domElement || this.pointerLocked;
        let moveForward = 0;
        let moveRight = 0;
        let jumpPressed = false;
        let descendPressed = false;

        if (activeControl) {
            if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveForward += 1;
            if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveForward -= 1;
            if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveRight += 1;
            if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveRight -= 1;
            jumpPressed = this.keys.has('Space');
            descendPressed = this.keys.has('KeyC');
            this.sprinting = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && moveForward > 0;
        } else {
            this.sprinting = false;
        }

        const inputLen = Math.hypot(moveForward, moveRight);
        if (inputLen > 1) {
            moveForward /= inputLen;
            moveRight /= inputLen;
        }

        // Camera horizontal basis vectors
        const fwdX = -Math.sin(this.yaw);
        const fwdZ = -Math.cos(this.yaw);
        const rightX = Math.cos(this.yaw);
        const rightZ = -Math.sin(this.yaw);

        const wishX = fwdX * moveForward + rightX * moveRight;
        const wishZ = fwdZ * moveForward + rightZ * moveRight;

        const targetSpeed = this.flying
            ? (this.sprinting ? FLY_SPEED * 1.5 : FLY_SPEED)
            : (this.sprinting ? SPRINT_SPEED : WALK_SPEED);

        const accel = this.flying ? 18 : this.onGround ? 26 : 9;
        const targetVx = wishX * targetSpeed;
        const targetVz = wishZ * targetSpeed;

        const blend = clamp(accel * dt, 0, 1);
        this.velocity.x += (targetVx - this.velocity.x) * blend;
        this.velocity.z += (targetVz - this.velocity.z) * blend;

        if (Math.abs(this.velocity.x) < 0.005 && targetVx === 0) this.velocity.x = 0;
        if (Math.abs(this.velocity.z) < 0.005 && targetVz === 0) this.velocity.z = 0;

        if (this.flying) {
            let targetVy = 0;
            if (jumpPressed) targetVy += FLY_SPEED * 0.75;
            if (descendPressed) targetVy -= FLY_SPEED * 0.75;
            this.velocity.y += (targetVy - this.velocity.y) * clamp(14 * dt, 0, 1);
        } else if (this.inWater) {
            this.velocity.y -= SWIM_GRAVITY * dt;
            if (jumpPressed) {
                this.velocity.y = Math.min(this.velocity.y + 24 * dt, SWIM_UP_SPEED);
            }
            this.velocity.y = clamp(this.velocity.y, -6.5, SWIM_UP_SPEED);
        } else {
            if (jumpPressed && this.onGround) {
                this.velocity.y = JUMP_VELOCITY;
                this.onGround = false;
            }
            this.velocity.y = Math.max(this.velocity.y - GRAVITY * dt, -TERMINAL_VELOCITY);
        }

        // Axis-separated AABB sweep & resolution
        this._moveAndCollideX(this.velocity.x * dt);
        this._moveAndCollideY(this.velocity.y * dt);
        this._moveAndCollideZ(this.velocity.z * dt);

        // Respawn rescue if somehow fallen below world floor
        if (this.position.y < -16) {
            const safe = typeof this.world.findSafeSpawn === 'function'
                ? this.world.findSafeSpawn(Math.round(this.position.x), Math.round(this.position.z))
                : { x: this.position.x, y: 80, z: this.position.z };
            this.setPosition(safe.x, safe.y, safe.z);
        }

        this.syncCamera(dt);
    }

    _moveAndCollideX(dx) {
        if (dx === 0) return;
        this.position.x += dx;

        const hw = PLAYER_HALF_WIDTH;
        const minBx = Math.floor(this.position.x - hw);
        const maxBx = Math.floor(this.position.x + hw - 1e-6);
        const minBy = Math.floor(this.position.y + EPS);
        const maxBy = Math.floor(this.position.y + PLAYER_HEIGHT - EPS);
        const minBz = Math.floor(this.position.z - hw + EPS);
        const maxBz = Math.floor(this.position.z + hw - EPS);

        for (let by = minBy; by <= maxBy; by++) {
            for (let bz = minBz; bz <= maxBz; bz++) {
                for (let bx = minBx; bx <= maxBx; bx++) {
                    if (!this.world.isSolidAt(bx, by, bz)) continue;
                    if (this.position.x + hw > bx + 1e-6 && this.position.x - hw < bx + 1 - 1e-6) {
                        if (dx > 0) {
                            this.position.x = bx - hw;
                        } else {
                            this.position.x = bx + 1 + hw;
                        }
                        this.velocity.x = 0;
                        return;
                    }
                }
            }
        }
    }

    _moveAndCollideY(dy) {
        this.position.y += dy;
        this.onGround = false;

        const hw = PLAYER_HALF_WIDTH;
        const minBx = Math.floor(this.position.x - hw + EPS);
        const maxBx = Math.floor(this.position.x + hw - EPS);
        const minBy = Math.floor(this.position.y);
        const maxBy = Math.floor(this.position.y + PLAYER_HEIGHT - 1e-6);
        const minBz = Math.floor(this.position.z - hw + EPS);
        const maxBz = Math.floor(this.position.z + hw - EPS);

        for (let bx = minBx; bx <= maxBx; bx++) {
            for (let bz = minBz; bz <= maxBz; bz++) {
                for (let by = minBy; by <= maxBy; by++) {
                    if (by < 0 || by >= CHUNK_HEIGHT) continue;
                    if (!this.world.isSolidAt(bx, by, bz)) continue;
                    if (this.position.y + PLAYER_HEIGHT > by + 1e-6 && this.position.y < by + 1 - 1e-6) {
                        if (dy < 0) {
                            this.position.y = by + 1;
                            this.onGround = true;
                        } else if (dy > 0) {
                            this.position.y = by - PLAYER_HEIGHT;
                        }
                        this.velocity.y = 0;
                        return;
                    }
                }
            }
        }
    }

    _moveAndCollideZ(dz) {
        if (dz === 0) return;
        this.position.z += dz;

        const hw = PLAYER_HALF_WIDTH;
        const minBx = Math.floor(this.position.x - hw + EPS);
        const maxBx = Math.floor(this.position.x + hw - EPS);
        const minBy = Math.floor(this.position.y + EPS);
        const maxBy = Math.floor(this.position.y + PLAYER_HEIGHT - EPS);
        const minBz = Math.floor(this.position.z - hw);
        const maxBz = Math.floor(this.position.z + hw - 1e-6);

        for (let by = minBy; by <= maxBy; by++) {
            for (let bx = minBx; bx <= maxBx; bx++) {
                for (let bz = minBz; bz <= maxBz; bz++) {
                    if (!this.world.isSolidAt(bx, by, bz)) continue;
                    if (this.position.z + hw > bz + 1e-6 && this.position.z - hw < bz + 1 - 1e-6) {
                        if (dz > 0) {
                            this.position.z = bz - hw;
                        } else {
                            this.position.z = bz + 1 + hw;
                        }
                        this.velocity.z = 0;
                        return;
                    }
                }
            }
        }
    }

    /**
     * Synchronize Three.js camera transform, subtle walk bobbing, and sprint FOV kick.
     */
    syncCamera(dt) {
        if (!this.camera) return;

        let bobY = 0;
        const speed = Math.hypot(this.velocity.x, this.velocity.z);
        if (this.onGround && !this.flying && speed > 0.5) {
            this.walkBobPhase += dt * (this.sprinting ? 14 : 10);
            bobY = Math.sin(this.walkBobPhase) * 0.045 * Math.min(1, speed / WALK_SPEED);
        }

        this.camera.position.set(
            this.position.x,
            this.position.y + PLAYER_EYE_HEIGHT + bobY,
            this.position.z
        );
        this.camera.rotation.y = this.yaw;
        this.camera.rotation.x = this.pitch;

        if (typeof this.camera.fov === 'number' && typeof this.camera.updateProjectionMatrix === 'function') {
            const targetFov = this.sprinting && speed > 1.0 ? 82 : 75;
            if (Math.abs(this.currentFov - targetFov) > 0.05) {
                this.currentFov += (targetFov - this.currentFov) * clamp(10 * dt, 0, 1);
                this.camera.fov = this.currentFov;
                this.camera.updateProjectionMatrix();
            }
        }
    }

    dispose() {
        if (this.domElement && typeof document !== 'undefined') {
            window.removeEventListener('keydown', this._onKeyDown);
            window.removeEventListener('keyup', this._onKeyUp);
            window.removeEventListener('blur', this._onBlur);
            document.removeEventListener('mousemove', this._onMouseMove);
            document.removeEventListener('pointerlockchange', this._onPointerLockChange);
            this.domElement.removeEventListener('mousedown', this._onMouseDown);
            this.domElement.removeEventListener('contextmenu', this._onContextMenu);
        }
    }
}
