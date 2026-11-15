import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LunarLandingConfig } from '../lunar-landing.config';
import hudMeta from '../lunar-landing.hud.json';

export class LanderBuilder {
	public readonly rootGroup = new THREE.Group();
	public readonly attitudePivot = new THREE.Group();
	public readonly padGroup = new THREE.Group();
	public readonly outpostGroup = new THREE.Group();
	public readonly radarRing: THREE.Mesh;

	private landerModelSlot = new THREE.Group();
	private padDisc!: THREE.Mesh;
	private padRing!: THREE.Mesh;
	private mainPlume!: THREE.Mesh;
	private dustRing!: THREE.Mesh;
	private rcsLeftPlume!: THREE.Mesh;
	private rcsRightPlume!: THREE.Mesh;
	private nasaLogoNode: THREE.Object3D | null = null;
	private nasaLogoRadius = 6.0;

	constructor() {
		this.radarRing = new THREE.Mesh(
			new THREE.RingGeometry(1.1, 1.35, 32),
			new THREE.MeshBasicMaterial({
				color: 0x4da6ff,
				side: THREE.DoubleSide,
				transparent: true,
				opacity: 0.75
			})
		);
		this.radarRing.rotation.x = -Math.PI / 2;

		this.dustRing = new THREE.Mesh(
			new THREE.RingGeometry(1.4, 3.6, 32),
			new THREE.MeshBasicMaterial({
				color: 0xcfd4dc,
				side: THREE.DoubleSide,
				transparent: true,
				opacity: 0.0
			})
		);
		this.dustRing.rotation.x = -Math.PI / 2;
	}

	init(scene: THREE.Scene) {
		this.buildLanderShell(scene);
		this.buildLandingPad(scene);
		scene.add(this.outpostGroup);
		scene.add(this.radarRing);
		scene.add(this.dustRing);

		void this.loadOrionLanderModel();
		void this.loadOutpostEnvironmentModel();
	}

	private buildLanderShell(scene: THREE.Scene) {
		this.rootGroup.add(this.attitudePivot);

		// Lightweight fallback mesh shown briefly until /models/OrionLander.glb finishes loading
		this.landerModelSlot.add(this.buildFallbackLander());
		this.attitudePivot.add(this.landerModelSlot);

		// Main Descent Engine Plume (starts below nozzle exit)
		this.mainPlume = new THREE.Mesh(
			new THREE.ConeGeometry(0.55, 3.4, 16),
			new THREE.MeshBasicMaterial({ color: 0x7cc8ff, transparent: true, opacity: 0.85 })
		);
		this.mainPlume.position.y = -2.82;
		this.mainPlume.rotation.x = Math.PI;
		this.mainPlume.visible = false;
		this.attitudePivot.add(this.mainPlume);

		// Lateral RCS Thruster Plumes
		const rcsGeo = new THREE.ConeGeometry(0.14, 0.9, 10);
		const rcsMat = new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: true,
			opacity: 0.85
		});

		this.rcsLeftPlume = new THREE.Mesh(rcsGeo, rcsMat);
		this.rcsLeftPlume.position.set(-1.52, 0.42, 0);
		this.rcsLeftPlume.rotation.z = Math.PI / 2;
		this.rcsLeftPlume.visible = false;
		this.attitudePivot.add(this.rcsLeftPlume);

		this.rcsRightPlume = new THREE.Mesh(rcsGeo, rcsMat);
		this.rcsRightPlume.position.set(1.52, 0.42, 0);
		this.rcsRightPlume.rotation.z = -Math.PI / 2;
		this.rcsRightPlume.visible = false;
		this.attitudePivot.add(this.rcsRightPlume);

		const { nodeName, ...inspectMeta } = hudMeta.inspectables.lander;
		this.rootGroup.name = nodeName;
		this.rootGroup.userData.inspect = inspectMeta;
		scene.add(this.rootGroup);
	}

	/**
	 * Loads `/models/OrionLander.glb` as the active descent spacecraft.
	 */
	private async loadOrionLanderModel() {
		const loader = new GLTFLoader();
		try {
			const gltf = await loader.loadAsync('/models/OrionLander.glb');
			const model = gltf.scene;
			model.updateMatrixWorld(true);

			const box = new THREE.Box3().setFromObject(model);
			if (!box.isEmpty()) {
				const size = new THREE.Vector3();
				box.getSize(size);

				if (size.y > 0.05 && (size.y < 2.1 || size.y > 4.6)) {
					const scale = 3.4 / size.y;
					model.scale.multiplyScalar(scale);
					model.updateMatrixWorld(true);
					box.setFromObject(model);
				}

				const center = new THREE.Vector3();
				box.getCenter(center);

				const targetFootY = -LunarLandingConfig.lander.touchdownFootY;
				model.position.x -= center.x;
				model.position.z -= center.z;
				model.position.y += targetFootY - box.min.y;
			}

			model.traverse((obj) => {
				if (obj instanceof THREE.Mesh) {
					obj.castShadow = true;
					obj.receiveShadow = true;
				}
			});

			this.landerModelSlot.clear();
			this.landerModelSlot.add(model);
		} catch {
			// Keep procedural fallback if /models/OrionLander.glb is unavailable
		}
	}

	/**
	 * Loads `/models/moon_outpost.glb` from Phase 06 into Phase 05 and aligns it
	 * so `Orion_Landing_Pad_NASALogo` sits directly at the landing target `[padX, 0, padZ]`.
	 */
	private async loadOutpostEnvironmentModel() {
		const loader = new GLTFLoader();
		try {
			const gltf = await loader.loadAsync('/models/moon_outpost.glb');
			const outpost = gltf.scene;
			outpost.updateMatrixWorld(true);

			outpost.traverse((obj) => {
				if (obj.name === 'Orion_LOLA_Crater_Terrain') {
					obj.visible = false;
				} else if (!obj.name.startsWith('Sample_') && /(rock|boulder|stone)/i.test(obj.name)) {
					obj.visible = false;
				} else if (obj instanceof THREE.Mesh) {
					obj.receiveShadow = true;
				}
			});

			const logoNode =
				outpost.getObjectByName('Orion_Landing_Pad_NASALogo') ??
				outpost.getObjectByName('Lander_Touchdown_Anchor');

			if (logoNode) {
				this.nasaLogoNode = logoNode;
				const logoBox = new THREE.Box3().setFromObject(logoNode);
				const logoCenter = new THREE.Vector3();
				if (!logoBox.isEmpty()) {
					logoBox.getCenter(logoCenter);
					const logoSize = new THREE.Vector3();
					logoBox.getSize(logoSize);
					this.nasaLogoRadius = Math.max(6.0, Math.max(logoSize.x, logoSize.z) * 0.5 + 1.0);
				} else {
					logoNode.getWorldPosition(logoCenter);
				}
				outpost.position.set(-logoCenter.x, -logoCenter.y + 0.03, -logoCenter.z);
			}

			this.outpostGroup.clear();
			this.outpostGroup.add(outpost);

			if (this.padDisc) {
				this.padDisc.visible = false;
			}
		} catch {
			// Keep standalone landing pad if /models/moon_outpost.glb is unavailable
		}
	}

	isOnNasaLogoPad(worldX: number, worldZ: number): boolean {
		if (this.nasaLogoNode) {
			this.nasaLogoNode.updateWorldMatrix(true, false);
			const logoWorldPos = new THREE.Vector3();
			this.nasaLogoNode.getWorldPosition(logoWorldPos);
			if (Math.hypot(worldX - logoWorldPos.x, worldZ - logoWorldPos.z) <= this.nasaLogoRadius) {
				return true;
			}
		}

		const dx = worldX - this.padGroup.position.x;
		const dz = worldZ - this.padGroup.position.z;
		return Math.hypot(dx, dz) <= this.nasaLogoRadius;
	}

	private buildFallbackLander(): THREE.Group {
		const fallback = new THREE.Group();

		const descentStage = new THREE.Mesh(
			new THREE.CylinderGeometry(1.15, 1.2, 0.58, 8),
			new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.75, roughness: 0.3 })
		);
		descentStage.position.y = -0.37;
		fallback.add(descentStage);

		const esm = new THREE.Mesh(
			new THREE.CylinderGeometry(0.88, 0.88, 0.68, 16),
			new THREE.MeshStandardMaterial({ color: 0xeef2f6, metalness: 0.2, roughness: 0.4 })
		);
		esm.position.y = 0.41;
		fallback.add(esm);

		const cm = new THREE.Mesh(
			new THREE.CylinderGeometry(0.38, 0.9, 0.52, 16),
			new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.8, roughness: 0.28 })
		);
		cm.position.y = 1.09;
		fallback.add(cm);

		const legMat = new THREE.MeshStandardMaterial({ color: 0x8892a0, metalness: 0.6 });
		const padMat = new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.7 });

		for (let i = 0; i < 4; i++) {
			const angle = (i * Math.PI) / 2 + Math.PI / 4;
			const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.22, 8), legMat);
			leg.position.set(Math.cos(angle) * 1.18, -0.84, Math.sin(angle) * 1.18);
			leg.rotation.z = -Math.cos(angle) * 0.42;
			leg.rotation.x = Math.sin(angle) * 0.42;
			fallback.add(leg);

			const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.31, 0.08, 12), padMat);
			foot.position.set(Math.cos(angle) * 1.44, -1.41, Math.sin(angle) * 1.44);
			fallback.add(foot);
		}

		return fallback;
	}

	private buildLandingPad(scene: THREE.Scene) {
		this.padDisc = new THREE.Mesh(
			new THREE.CylinderGeometry(4.8, 5.2, 0.14, 32),
			new THREE.MeshStandardMaterial({ color: 0x263244, roughness: 0.7 })
		);
		this.padDisc.position.y = 0.07;
		this.padGroup.add(this.padDisc);

		this.padRing = new THREE.Mesh(
			new THREE.RingGeometry(4.3, 4.7, 32),
			new THREE.MeshBasicMaterial({ color: 0x34ce57, side: THREE.DoubleSide })
		);
		this.padRing.rotation.x = -Math.PI / 2;
		this.padRing.position.y = 0.16;
		this.padGroup.add(this.padRing);

		const { nodeName: padNodeName, ...padInspect } = hudMeta.inspectables.landingPad;
		this.padGroup.name = padNodeName;
		this.padGroup.userData.inspect = padInspect;
		scene.add(this.padGroup);
	}

	positionSiteFixtures(padX: number, padZ: number) {
		this.padGroup.position.set(padX, 0, padZ);
		this.outpostGroup.position.set(padX, 0, padZ);
	}

	setHazardRingsVisible(visible: boolean) {
		if (this.padRing) {
			(this.padRing.material as THREE.MeshBasicMaterial).color.setHex(
				visible ? 0x38bdf8 : 0x34ce57
			);
		}
	}

	updateVisuals(params: {
		x: number;
		z: number;
		terrainY: number;
		footHeight: number;
		rollRad: number;
		pitchRad: number;
		isIgnited: boolean;
		throttleRatio: number;
		forceX: number;
	}) {
		this.attitudePivot.rotation.set(params.pitchRad, 0, params.rollRad);

		this.radarRing.position.set(params.x, params.terrainY + 0.18, params.z);
		const ringScale = 1 + Math.min(2.5, params.footHeight * 0.04);
		this.radarRing.scale.set(ringScale, ringScale, 1);

		if (params.isIgnited && params.throttleRatio > 0) {
			this.mainPlume.visible = true;
			this.mainPlume.scale.set(
				0.8 + params.throttleRatio * 0.4,
				0.45 + params.throttleRatio * 1.15 + Math.random() * 0.15,
				0.8 + params.throttleRatio * 0.4
			);
			this.rcsLeftPlume.visible = params.forceX > 1500;
			this.rcsRightPlume.visible = params.forceX < -1500;

			const dustFactor = Math.max(0, 1 - params.footHeight / 14) * params.throttleRatio;
			const dustMat = this.dustRing.material as THREE.MeshBasicMaterial;
			dustMat.opacity = dustFactor * 0.42;
			this.dustRing.position.set(params.x, params.terrainY + 0.12, params.z);
			const dustScale = 1 + (1 - Math.min(1, params.footHeight / 14)) * 2.2;
			this.dustRing.scale.set(dustScale, dustScale, 1);
		} else {
			this.mainPlume.visible = false;
			this.rcsLeftPlume.visible = false;
			this.rcsRightPlume.visible = false;
			(this.dustRing.material as THREE.MeshBasicMaterial).opacity = 0;
		}
	}
}
