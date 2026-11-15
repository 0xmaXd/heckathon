import * as THREE from 'three';
import sitesData from '#lib/assets/data/nasa/lunar_sites.json';
import { GameConfig } from '../../../config/game.config';
import { LunarLandingConfig } from '../lunar-landing.config';

interface TerrainChunk {
	mesh: THREE.Mesh;
	gridX: number;
	gridZ: number;
}

export class LunarTerrainManager {
	public readonly group = new THREE.Group();
	private chunks: TerrainChunk[] = [];
	private siteMarkers: THREE.Group[] = [];
	private material: THREE.MeshStandardMaterial;

	private activeSiteIndex = 0;
	private lastCenterGridX = Number.NaN;
	private lastCenterGridZ = Number.NaN;

	constructor() {
		this.material = new THREE.MeshStandardMaterial({
			color: 0x767980,
			roughness: 0.96,
			metalness: 0.04,
			flatShading: true
		});
	}

	init(scene: THREE.Scene) {
		scene.fog = new THREE.FogExp2(0x020308, 0.0055);
		scene.add(this.group);

		const { tileSize, tileSegments, gridRadius } = LunarLandingConfig.terrain;

		for (let gz = -gridRadius; gz <= gridRadius; gz++) {
			for (let gx = -gridRadius; gx <= gridRadius; gx++) {
				const geo = new THREE.PlaneGeometry(tileSize, tileSize, tileSegments, tileSegments);
				geo.rotateX(-Math.PI / 2);

				const mesh = new THREE.Mesh(geo, this.material);
				this.group.add(mesh);
				this.chunks.push({ mesh, gridX: Number.NaN, gridZ: Number.NaN });
			}
		}

		// Build distant orbital/surface site markers for all real NASA lunar sites
		const markerGeo = new THREE.CylinderGeometry(0.15, 0.15, 18, 8);
		const markerMat = new THREE.MeshBasicMaterial({
			color: 0x4da6ff,
			transparent: true,
			opacity: 0.45
		});

		for (const site of sitesData.sites) {
			const markerGroup = new THREE.Group();
			const beam = new THREE.Mesh(markerGeo, markerMat);
			beam.position.y = 9;
			markerGroup.add(beam);

			markerGroup.position.set(site.worldOffset[0], 0, site.worldOffset[1]);
			markerGroup.name = site.name;
			markerGroup.userData.inspect = {
				name: site.name,
				category: `NASA Target Site // ${site.region}`,
				description: site.description,
				specs: {
					Coordinates: site.coordinates,
					Roughness: `${site.craterRoughness}x`
				}
			};
			this.siteMarkers.push(markerGroup);
			scene.add(markerGroup);
		}

		this.setSite(0);
		this.updateAround(0, 0);
	}

	setSite(siteIndex: number) {
		this.activeSiteIndex = siteIndex;
		this.lastCenterGridX = Number.NaN;
		this.lastCenterGridZ = Number.NaN;
	}

	getActiveSite() {
		return sitesData.sites[this.activeSiteIndex] ?? sitesData.sites[0];
	}

	/**
	 * Deterministic selenographic heightfield h(x, z) seeded from GameConfig.seed.
	 * Keeps a wide flat clearing around Orion_Landing_Pad_NASALogo so the full
	 * moon_outpost.glb complex sits cleanly on the surface without terrain clipping.
	 */
	getHeightAt(worldX: number, worldZ: number): number {
		const site = this.getActiveSite();
		const [padX, padZ] = site.worldOffset;
		const distFromPad = Math.hypot(worldX - padX, worldZ - padZ);

		const outpostClearingRadius = Math.max(site.clearingRadiusM, 95);
		const clearMin = outpostClearingRadius * 0.85;
		const clearMax = outpostClearingRadius * 1.35;
		const flatMask = THREE.MathUtils.smoothstep(distFromPad, clearMin, clearMax);
		if (flatMask <= 0.001) return 0;

		const s = GameConfig.seed * 0.13;
		const rolling =
			Math.sin(worldX * 0.022 + s) * Math.cos(worldZ * 0.022 - s) * 2.4 +
			Math.sin(worldX * 0.065 - worldZ * 0.055) * 0.85;

		// Deterministic multi-scale crater bowls with raised rims
		const cellSize = 44;
		const cx = Math.floor(worldX / cellSize);
		const cz = Math.floor(worldZ / cellSize);
		const hash = Math.sin(cx * 127.1 + cz * 311.7 + GameConfig.seed) * 43758.5453;
		const frac = hash - Math.floor(hash);

		let craterOffset = 0;
		if (frac > 0.35) {
			const centerX = (cx + 0.25 + (frac % 0.5)) * cellSize;
			const centerZ = (cz + 0.25 + ((frac * 7) % 0.5)) * cellSize;
			const radius = 8 + frac * 11;
			const d = Math.hypot(worldX - centerX, worldZ - centerZ) / radius;

			if (d < 1.35) {
				if (d < 0.85) {
					craterOffset = -2.2 * (1 - (d / 0.85) * (d / 0.85));
				} else {
					const rimT = 1 - Math.abs(d - 1.05) / 0.3;
					craterOffset = 0.65 * Math.max(0, rimT);
				}
			}
		}

		return (rolling + craterOffset) * site.craterRoughness * flatMask;
	}

	/**
	 * Recycles terrain tiles as the lander moves so the lunar surface stretches infinitely.
	 */
	updateAround(focusX: number, focusZ: number) {
		const { tileSize, gridRadius } = LunarLandingConfig.terrain;
		const centerGridX = Math.round(focusX / tileSize);
		const centerGridZ = Math.round(focusZ / tileSize);

		if (centerGridX === this.lastCenterGridX && centerGridZ === this.lastCenterGridZ) {
			return;
		}

		this.lastCenterGridX = centerGridX;
		this.lastCenterGridZ = centerGridZ;

		let idx = 0;
		for (let gz = -gridRadius; gz <= gridRadius; gz++) {
			for (let gx = -gridRadius; gx <= gridRadius; gx++) {
				const chunk = this.chunks[idx++];
				const targetGX = centerGridX + gx;
				const targetGZ = centerGridZ + gz;

				if (chunk.gridX === targetGX && chunk.gridZ === targetGZ) continue;

				chunk.gridX = targetGX;
				chunk.gridZ = targetGZ;
				const originX = targetGX * tileSize;
				const originZ = targetGZ * tileSize;

				chunk.mesh.position.set(originX, 0, originZ);
				this.displaceChunkVertices(chunk.mesh.geometry as THREE.BufferGeometry, originX, originZ);
			}
		}
	}

	private displaceChunkVertices(geo: THREE.BufferGeometry, originX: number, originZ: number) {
		const posAttr = geo.attributes.position as THREE.BufferAttribute;
		for (let i = 0; i < posAttr.count; i++) {
			const vx = posAttr.getX(i) + originX;
			const vz = posAttr.getZ(i) + originZ;
			posAttr.setY(i, this.getHeightAt(vx, vz));
		}
		posAttr.needsUpdate = true;
		geo.computeVertexNormals();
	}
}
