/**
 * Three.js WebGL renderer setup, sky lighting, distance fog, shared chunk materials,
 * and voxel selection highlight wireframe.
 */

import * as THREE from 'three';
import { CHUNK_SIZE_X, DEFAULT_RENDER_DISTANCE } from '../core/Constants.js';

export class Renderer {
    /**
     * @param {HTMLElement} container
     * @param {import('./TextureAtlas.js').TextureAtlas} atlas
     */
    constructor(container, atlas) {
        this.container = container;
        this.atlas = atlas;

        this.scene = new THREE.Scene();
        this.skyColor = new THREE.Color(0x88c4ff);
        this.waterFogColor = new THREE.Color(0x1f5c8a);
        this.scene.background = this.skyColor.clone();
        this.fog = new THREE.FogExp2(this.skyColor.getHex(), 0.0085);
        this.scene.fog = this.fog;

        const width = container.clientWidth || window.innerWidth;
        const height = container.clientHeight || window.innerHeight;

        this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 450);
        this.camera.rotation.order = 'YXZ';

        this.webgl = new THREE.WebGLRenderer({
            antialias: false,
            powerPreference: 'high-performance',
        });
        this.webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.webgl.setSize(width, height);
        this.webgl.outputColorSpace = THREE.SRGBColorSpace;
        container.appendChild(this.webgl.domElement);

        this._setupLighting();
        this._setupCelestials();
        this._setupMaterials();
        this._setupHighlightBox();
        this._setupCrackBox();
        this._setupTorchLights();
        this.setRenderDistance(DEFAULT_RENDER_DISTANCE);

        this._onResize = () => this.resize();
        window.addEventListener('resize', this._onResize);
    }

    _setupLighting() {
        this.hemiLight = new THREE.HemisphereLight(0xdff2ff, 0x4c483d, 0.95);
        this.scene.add(this.hemiLight);

        this.sunLight = new THREE.DirectionalLight(0xfff8ea, 0.92);
        this.sunLight.position.set(80, 140, 60);
        this.scene.add(this.sunLight);

        this.fillLight = new THREE.DirectionalLight(0xaad2ff, 0.25);
        this.fillLight.position.set(-60, 40, -70);
        this.scene.add(this.fillLight);
    }

    _setupCelestials() {
        this.celestialGroup = new THREE.Group();
        this.scene.add(this.celestialGroup);

        const sunGeo = new THREE.PlaneGeometry(16, 16);
        const sunMat = new THREE.MeshBasicMaterial({
            color: 0xfff0a8,
            side: THREE.DoubleSide,
            fog: false,
            depthWrite: false,
        });
        this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
        this.celestialGroup.add(this.sunMesh);

        const moonGeo = new THREE.PlaneGeometry(12, 12);
        const moonMat = new THREE.MeshBasicMaterial({
            color: 0xdce8ff,
            side: THREE.DoubleSide,
            fog: false,
            depthWrite: false,
        });
        this.moonMesh = new THREE.Mesh(moonGeo, moonMat);
        this.celestialGroup.add(this.moonMesh);

        // Starfield dome
        const starCount = 260;
        const starPositions = new Float32Array(starCount * 3);
        for (let i = 0; i < starCount; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(Math.random() * 0.92 + 0.08);
            const r = 175;
            starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            starPositions[i * 3 + 1] = r * Math.cos(phi);
            starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
        }
        const starGeo = new THREE.BufferGeometry();
        starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
        this.starMat = new THREE.PointsMaterial({
            color: 0xeaf2ff,
            size: 1.6,
            transparent: true,
            opacity: 0,
            fog: false,
            depthWrite: false,
        });
        this.stars = new THREE.Points(starGeo, this.starMat);
        this.celestialGroup.add(this.stars);
    }

    _setupMaterials() {
        const map = this.atlas.texture;

        this.materials = {
            opaque: new THREE.MeshLambertMaterial({
                map,
                vertexColors: true,
                side: THREE.FrontSide,
            }),
            cutout: new THREE.MeshLambertMaterial({
                map,
                vertexColors: true,
                alphaTest: 0.5,
                side: THREE.DoubleSide,
            }),
            translucent: new THREE.MeshLambertMaterial({
                map,
                vertexColors: true,
                transparent: true,
                opacity: 0.88,
                depthWrite: false,
                side: THREE.FrontSide,
            }),
        };
    }

    _setupHighlightBox() {
        const boxGeo = new THREE.BoxGeometry(1.005, 1.005, 1.005);
        const edges = new THREE.EdgesGeometry(boxGeo);
        boxGeo.dispose();

        const lineMat = new THREE.LineBasicMaterial({
            color: 0x101418,
            transparent: true,
            opacity: 0.85,
        });
        this.highlightBox = new THREE.LineSegments(edges, lineMat);
        this.highlightBox.visible = false;
        this.highlightBox.renderOrder = 10;
        this.scene.add(this.highlightBox);
    }

    _setupCrackBox() {
        this.crackTextures = [];
        for (let stage = 0; stage < 10; stage++) {
            const canvas = document.createElement('canvas');
            canvas.width = 16;
            canvas.height = 16;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, 16, 16);
            ctx.strokeStyle = 'rgba(18, 18, 22, 0.85)';
            ctx.lineWidth = 1;

            // Deterministic branching cracks growing with stage 0..9
            const branches = 2 + stage * 2;
            for (let b = 0; b < branches; b++) {
                let x = 8 + (((b * 7) % 5) - 2);
                let y = 8 + (((b * 11) % 5) - 2);
                ctx.beginPath();
                ctx.moveTo(x, y);
                const steps = 1 + Math.floor((stage + 2) * 0.65);
                for (let s = 0; s < steps; s++) {
                    const angle = ((b * 137 + s * 53) % 360) * (Math.PI / 180);
                    x += Math.cos(angle) * 2.1;
                    y += Math.sin(angle) * 2.1;
                    ctx.lineTo(Math.round(x), Math.round(y));
                }
                ctx.stroke();
            }
            const tex = new THREE.CanvasTexture(canvas);
            tex.magFilter = THREE.NearestFilter;
            tex.minFilter = THREE.NearestFilter;
            this.crackTextures.push(tex);
        }

        const geo = new THREE.BoxGeometry(1.004, 1.004, 1.004);
        this.crackMat = new THREE.MeshBasicMaterial({
            map: this.crackTextures[0],
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
        });
        this.crackBox = new THREE.Mesh(geo, this.crackMat);
        this.crackBox.visible = false;
        this.crackBox.renderOrder = 9;
        this.scene.add(this.crackBox);
        this._lastCrackStage = -1;
    }

    _setupTorchLights() {
        this.torchLightPool = [];
        for (let i = 0; i < 6; i++) {
            const light = new THREE.PointLight(0xffaa44, 0, 12, 1.6);
            light.visible = false;
            this.scene.add(light);
            this.torchLightPool.push(light);
        }
    }

    /**
     * Update sun/moon positions, sky/fog colors, stars, and directional lighting.
     */
    updateDayNight(dayNight, playerPos) {
        const state = dayNight.getLightingState();
        this.skyColor.setRGB(dayNight.skyColor.r, dayNight.skyColor.g, dayNight.skyColor.b);

        if (!this.isUnderwater) {
            this.scene.background.copy(this.skyColor);
            this.fog.color.setRGB(dayNight.fogColor.r, dayNight.fogColor.g, dayNight.fogColor.b);
        }

        this.hemiLight.color.setRGB(dayNight.hemiSkyColor.r, dayNight.hemiSkyColor.g, dayNight.hemiSkyColor.b);
        this.hemiLight.intensity = state.hemiIntensity;

        this.sunLight.color.setRGB(dayNight.sunColor.r, dayNight.sunColor.g, dayNight.sunColor.b);
        this.sunLight.intensity = state.sunIntensity;
        this.fillLight.intensity = state.fillIntensity;

        const angle = state.sunAngle;
        const dist = 160;
        const sx = Math.cos(angle) * dist;
        const sy = Math.sin(angle) * dist;
        const sz = 45;

        if (playerPos) {
            this.celestialGroup.position.set(playerPos.x, playerPos.y, playerPos.z);
        }
        this.sunMesh.position.set(sx, sy, sz);
        this.sunMesh.lookAt(this.celestialGroup.position);
        this.sunMesh.visible = sy > -25;

        this.moonMesh.position.set(-sx, -sy, -sz);
        this.moonMesh.lookAt(this.celestialGroup.position);
        this.moonMesh.visible = -sy > -25;

        this.starMat.opacity = state.starOpacity;
        this.stars.visible = state.starOpacity > 0.02;

        // Keep directional light above horizon (follows sun by day, moon by night)
        if (sy >= 0) {
            this.sunLight.position.set(sx * 0.6, Math.max(18, sy * 0.6), sz);
        } else {
            this.sunLight.position.set(-sx * 0.6, Math.max(18, -sy * 0.6), -sz);
        }
    }

    /**
     * Show or hide the 10-stage block-breaking crack overlay.
     * @param {{x: number, y: number, z: number}|null} blockPos
     * @param {number} progress [0..1]
     */
    setCrackProgress(blockPos, progress) {
        if (!blockPos || progress <= 0.01) {
            this.crackBox.visible = false;
            this._lastCrackStage = -1;
            return;
        }
        const stage = Math.min(9, Math.max(0, Math.floor(progress * 10)));
        if (stage !== this._lastCrackStage) {
            this.crackMat.map = this.crackTextures[stage];
            this.crackMat.needsUpdate = true;
            this._lastCrackStage = stage;
        }
        this.crackBox.position.set(blockPos.x + 0.5, blockPos.y + 0.5, blockPos.z + 0.5);
        this.crackBox.visible = true;
    }

    /**
     * Assign pooled PointLights to the nearest placed torches.
     */
    updateTorchLights(torchPositions, playerPos, timeNow) {
        if (!torchPositions || torchPositions.length === 0) {
            for (const l of this.torchLightPool) l.visible = false;
            return;
        }
        // Sort up to pool size nearest to player
        const sorted = torchPositions
            .map((p) => {
                const dx = p.x + 0.5 - playerPos.x;
                const dy = p.y + 0.5 - playerPos.y;
                const dz = p.z + 0.5 - playerPos.z;
                return { p, d2: dx * dx + dy * dy + dz * dz };
            })
            .filter((item) => item.d2 < 36 * 36)
            .sort((a, b) => a.d2 - b.d2);

        for (let i = 0; i < this.torchLightPool.length; i++) {
            const light = this.torchLightPool[i];
            if (i < sorted.length) {
                const p = sorted[i].p;
                light.position.set(p.x + 0.5, p.y + 0.72, p.z + 0.5);
                const flicker = 1.18 + Math.sin(timeNow * 9.5 + i * 2.1) * 0.08;
                light.intensity = flicker;
                light.visible = true;
            } else {
                light.visible = false;
            }
        }
    }

    /**
     * Update fog density and camera far plane cleanly based on chunk render distance.
     * @param {number} chunkRadius
     */
    setRenderDistance(chunkRadius) {
        this.renderDistance = chunkRadius;
        const maxDist = chunkRadius * CHUNK_SIZE_X;
        this.camera.far = Math.max(120, maxDist * 1.65);
        this.camera.updateProjectionMatrix();
        this.baseFogDensity = 1.65 / Math.max(48, maxDist);
        if (!this.isUnderwater) {
            this.fog.density = this.baseFogDensity;
        }
    }

    /**
     * Toggle underwater atmospheric fog tint.
     * @param {boolean} underwater
     */
    setUnderwater(underwater) {
        if (this.isUnderwater === underwater) return;
        this.isUnderwater = underwater;
        if (underwater) {
            this.scene.background.copy(this.waterFogColor);
            this.fog.color.copy(this.waterFogColor);
            this.fog.density = 0.065;
        } else {
            this.scene.background.copy(this.skyColor);
            this.fog.color.copy(this.skyColor);
            this.fog.density = this.baseFogDensity || 0.014;
        }
    }

    /**
     * Position the targeted voxel outline box.
     * @param {{x: number, y: number, z: number}|null} blockPos
     */
    setHighlightBlock(blockPos) {
        if (!blockPos) {
            this.highlightBox.visible = false;
            return;
        }
        this.highlightBox.visible = true;
        this.highlightBox.position.set(blockPos.x + 0.5, blockPos.y + 0.5, blockPos.z + 0.5);
    }

    resize() {
        const width = this.container.clientWidth || window.innerWidth;
        const height = this.container.clientHeight || window.innerHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.webgl.setSize(width, height);
    }

    render() {
        this.webgl.render(this.scene, this.camera);
    }

    getDrawCallsAndTriangles() {
        return {
            calls: this.webgl.info.render.calls,
            triangles: this.webgl.info.render.triangles,
        };
    }

    dispose() {
        window.removeEventListener('resize', this._onResize);
        this.materials.opaque.dispose();
        this.materials.cutout.dispose();
        this.materials.translucent.dispose();
        this.highlightBox.geometry.dispose();
        this.highlightBox.material.dispose();
        this.crackBox.geometry.dispose();
        this.crackMat.dispose();
        for (const tex of this.crackTextures) tex.dispose();
        this.sunMesh.geometry.dispose();
        this.sunMesh.material.dispose();
        this.moonMesh.geometry.dispose();
        this.moonMesh.material.dispose();
        this.stars.geometry.dispose();
        this.starMat.dispose();
        this.webgl.dispose();
    }
}
