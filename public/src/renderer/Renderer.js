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
        this._setupMaterials();
        this._setupHighlightBox();
        this.setRenderDistance(DEFAULT_RENDER_DISTANCE);

        this._onResize = () => this.resize();
        window.addEventListener('resize', this._onResize);
    }

    _setupLighting() {
        const hemi = new THREE.HemisphereLight(0xdff2ff, 0x4c483d, 0.95);
        this.scene.add(hemi);

        const sun = new THREE.DirectionalLight(0xfff8ea, 0.92);
        sun.position.set(80, 140, 60);
        this.scene.add(sun);

        const fill = new THREE.DirectionalLight(0xaad2ff, 0.25);
        fill.position.set(-60, 40, -70);
        this.scene.add(fill);
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
        this.webgl.dispose();
    }
}
