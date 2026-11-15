/**
 * Articulated blocky 3D remote player avatar with smooth snapshot interpolation,
 * limb walking animation, held block indicator, and floating nametag sprite.
 */

import * as THREE from 'three';

function lerpAngle(current, target, t) {
    let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return current + diff * t;
}

export class RemotePlayerMesh {
    /**
     * @param {{ id: string, name: string, color?: string, x: number, y: number, z: number, yaw: number, pitch: number }} data
     */
    constructor(data) {
        this.id = data.id;
        this.name = data.name || 'Player';
        this.color = data.color || '#3b82f6';

        this.group = new THREE.Group();
        this.targetPos = new THREE.Vector3(data.x || 0, data.y || 64, data.z || 0);
        this.targetVel = new THREE.Vector3(0, 0, 0);
        this._predPos = new THREE.Vector3().copy(this.targetPos);
        this.snapshotAge = 0;
        this.targetYaw = data.yaw || 0;
        this.targetPitch = data.pitch || 0;
        this.walking = false;
        this.walkPhase = 0;

        this.group.position.copy(this.targetPos);
        this._buildModel();
    }

    _buildModel() {
        const skinMat = new THREE.MeshLambertMaterial({ color: 0xe8be9e });
        const shirtMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(this.color) });
        const pantsMat = new THREE.MeshLambertMaterial({ color: 0x2d3a54 });
        const hairMat = new THREE.MeshLambertMaterial({ color: 0x3a281d });

        // Pivot for body rotation (yaw)
        this.bodyPivot = new THREE.Group();
        this.group.add(this.bodyPivot);

        // Legs (0.7 tall, centered at x = +/- 0.11, pivot at hip y = 0.7)
        const legGeo = new THREE.BoxGeometry(0.22, 0.7, 0.24);
        legGeo.translate(0, -0.35, 0);

        this.leftLeg = new THREE.Mesh(legGeo, pantsMat);
        this.leftLeg.position.set(-0.12, 0.7, 0);
        this.bodyPivot.add(this.leftLeg);

        this.rightLeg = new THREE.Mesh(legGeo, pantsMat);
        this.rightLeg.position.set(0.12, 0.7, 0);
        this.bodyPivot.add(this.rightLeg);

        // Torso (0.68 tall, y = 0.7 .. 1.38)
        const torsoGeo = new THREE.BoxGeometry(0.48, 0.68, 0.26);
        this.torso = new THREE.Mesh(torsoGeo, shirtMat);
        this.torso.position.set(0, 1.04, 0);
        this.bodyPivot.add(this.torso);

        // Arms (pivot at shoulder y = 1.34)
        const armGeo = new THREE.BoxGeometry(0.18, 0.64, 0.2);
        armGeo.translate(0, -0.28, 0);

        this.leftArm = new THREE.Mesh(armGeo, shirtMat);
        this.leftArm.position.set(-0.34, 1.34, 0);
        this.bodyPivot.add(this.leftArm);

        this.rightArm = new THREE.Mesh(armGeo, shirtMat);
        this.rightArm.position.set(0.34, 1.34, 0);
        this.bodyPivot.add(this.rightArm);

        // Head pivot at neck y = 1.38 (local forward is -Z matching Three.js camera yaw=0)
        this.headPivot = new THREE.Group();
        this.headPivot.position.set(0, 1.38, 0);
        this.bodyPivot.add(this.headPivot);

        const headGeo = new THREE.BoxGeometry(0.44, 0.44, 0.44);
        const headMesh = new THREE.Mesh(headGeo, skinMat);
        headMesh.position.set(0, 0.22, 0);
        this.headPivot.add(headMesh);

        // Hair cap & simple eyes on -Z front face
        const hairGeo = new THREE.BoxGeometry(0.46, 0.14, 0.46);
        const hairMesh = new THREE.Mesh(hairGeo, hairMat);
        hairMesh.position.set(0, 0.39, 0);
        this.headPivot.add(hairMesh);

        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x161b22 });
        const eyeGeo = new THREE.BoxGeometry(0.07, 0.06, 0.02);
        const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
        leftEye.position.set(-0.1, 0.23, -0.225);
        const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
        rightEye.position.set(0.1, 0.23, -0.225);
        this.headPivot.add(leftEye, rightEye);

        // Floating nametag sprite
        this.nameSprite = this._createNameTag(this.name);
        this.nameSprite.position.set(0, 2.18, 0);
        this.group.add(this.nameSprite);

        this._disposables = [
            skinMat,
            shirtMat,
            pantsMat,
            hairMat,
            eyeMat,
            legGeo,
            torsoGeo,
            armGeo,
            headGeo,
            hairGeo,
            eyeGeo,
            this.nameSprite.material,
            this.nameSprite.material.map,
        ];
    }

    _createNameTag(text) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        ctx.font = 'bold 26px system-ui, -apple-system, sans-serif';
        const metrics = ctx.measureText(text);
        const padX = 16;
        const boxW = Math.min(248, Math.max(72, metrics.width + padX * 2));
        const boxX = (256 - boxW) / 2;

        ctx.fillStyle = 'rgba(15, 20, 28, 0.72)';
        ctx.beginPath();
        ctx.roundRect(boxX, 12, boxW, 40, 8);
        ctx.fill();

        ctx.fillStyle = '#f3f6fc';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 128, 33);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(1.8, 0.45, 1);
        return sprite;
    }

    applySnapshot(state) {
        if (typeof state.x === 'number') {
            const distSq =
                (state.x - this.targetPos.x) ** 2 +
                (state.y - this.targetPos.y) ** 2 +
                (state.z - this.targetPos.z) ** 2;
            this.walking = Boolean(state.walking) || distSq > 0.0004;
            this.targetPos.set(state.x, state.y, state.z);
            this.snapshotAge = 0;

            if (typeof state.vx === 'number') {
                this.targetVel.set(state.vx, state.vy || 0, state.vz || 0);
            } else {
                this.targetVel.set(0, 0, 0);
            }

            // Snap immediately on large teleports (> 8 blocks)
            if (this.group.position.distanceToSquared(this.targetPos) > 64) {
                this.group.position.copy(this.targetPos);
            }
        }
        if (typeof state.yaw === 'number') this.targetYaw = state.yaw;
        if (typeof state.pitch === 'number') this.targetPitch = state.pitch;
    }

    update(dt) {
        this.snapshotAge = Math.min(0.12, this.snapshotAge + dt);
        const lead = Math.min(0.08, this.snapshotAge);
        this._predPos.set(
            this.targetPos.x + this.targetVel.x * lead,
            this.targetPos.y + this.targetVel.y * lead,
            this.targetPos.z + this.targetVel.z * lead
        );

        const smooth = 1 - Math.exp(-24 * dt);
        const prevX = this.group.position.x;
        const prevZ = this.group.position.z;

        this.group.position.lerp(this._predPos, smooth);
        this.bodyPivot.rotation.y = lerpAngle(this.bodyPivot.rotation.y, this.targetYaw, smooth);
        this.headPivot.rotation.x = THREE.MathUtils.lerp(this.headPivot.rotation.x, this.targetPitch, smooth);

        const moveSpeed = Math.hypot(
            this.group.position.x - prevX,
            this.group.position.z - prevZ
        ) / Math.max(dt, 0.001);

        if (this.walking || moveSpeed > 0.35) {
            this.walkPhase += dt * 10.5;
            const swing = Math.sin(this.walkPhase) * 0.62;
            this.leftLeg.rotation.x = swing;
            this.rightLeg.rotation.x = -swing;
            this.leftArm.rotation.x = -swing * 0.8;
            this.rightArm.rotation.x = swing * 0.8;
        } else {
            this.leftLeg.rotation.x = THREE.MathUtils.lerp(this.leftLeg.rotation.x, 0, smooth);
            this.rightLeg.rotation.x = THREE.MathUtils.lerp(this.rightLeg.rotation.x, 0, smooth);
            this.leftArm.rotation.x = THREE.MathUtils.lerp(this.leftArm.rotation.x, 0, smooth);
            this.rightArm.rotation.x = THREE.MathUtils.lerp(this.rightArm.rotation.x, 0, smooth);
        }
    }

    dispose() {
        for (const item of this._disposables) {
            if (item && typeof item.dispose === 'function') {
                item.dispose();
            }
        }
    }
}
