import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LunarOutpostConfig } from '../lunar-outpost.config';
import type { SurfaceType } from '../lunar-outpost.types';

export interface SurfaceHit {
	y: number;
	normal: THREE.Vector3;
	surfaceType: SurfaceType;
}

interface LandingHandoffOffset {
	padOffsetX?: number;
	padOffsetZ?: number;
}

function readLandingPadOffset(): { dx: number; dz: number } {
	try {
		const raw = sessionStorage.getItem('artemis_lunar_landing_handoff');
		if (!raw) return { dx: 0, dz: 0 };
		const parsed = JSON.parse(raw) as LandingHandoffOffset;
		return {
			dx: THREE.MathUtils.clamp(parsed.padOffsetX ?? 0, -2.4, 2.4),
			dz: THREE.MathUtils.clamp(parsed.padOffsetZ ?? 0, -2.4, 2.4)
		};
	} catch {
		return { dx: 0, dz: 0 };
	}
}

export class OutpostWorldBuilder {
	public outpostRoot: THREE.Object3D | null = null;
	public roverObject: THREE.Object3D | null = null;
	public workstationObject: THREE.Object3D | null = null;
	public storagePodObject: THREE.Object3D | null = null;
	public landingPadLogo: THREE.Object3D | null = null;
	public landingPadAnchor: THREE.Object3D | null = null;
	public landerAssembly: THREE.Group | null = null;
	public landerAscentPlume: THREE.Mesh | null = null;
	public airlockDoor: THREE.Object3D | null = null;
	public iceDrillAuger: THREE.Object3D | null = null;

	public commDishes: THREE.Object3D[] = [];
	public supplyCrates: THREE.Object3D[] = [];
	public sampleNodes = new Map<string, THREE.Object3D>();
	public sampleBeacons = new Map<string, THREE.Mesh>();
	public solarDustLayers: THREE.Object3D[] = [];
	public lampPositions: THREE.Vector3[] = [];

	public resupplyDropPos = new THREE.Vector3(-22, 0, 14);
	public workstationPos = new THREE.Vector3(6.5, 0, -1.5);
	public launchPadPos = new THREE.Vector3(46, 0, -52);

	private raycaster = new THREE.Raycaster();
	private downDir = new THREE.Vector3(0, -1, 0);
	private rayOrigin = new THREE.Vector3();
	private groundMeshes: THREE.Object3D[] = [];

	async load(scene: THREE.Scene): Promise<void> {
		const loader = new GLTFLoader();
		const gltf = await loader.loadAsync(LunarOutpostConfig.modelUrl);

		this.outpostRoot = gltf.scene;
		scene.add(this.outpostRoot);
		this.outpostRoot.updateMatrixWorld(true);

		this.indexSceneNodes(this.outpostRoot);
		this.removeLandingZoneRocks(this.outpostRoot);
		await this.spawnOrionLanderOnPad(loader);
		this.buildZoneRings(scene);
		this.buildSampleBeacons(scene);
	}

	private indexSceneNodes(root: THREE.Object3D) {
		this.groundMeshes = [];
		this.commDishes = [];
		this.supplyCrates = [];
		this.solarDustLayers = [];
		this.lampPositions = [];
		this.sampleNodes.clear();

		root.traverse((obj) => {
			if (obj instanceof THREE.Mesh) {
				const isTransparent =
					(obj.material as THREE.Material)?.transparent === true ||
					obj.name.startsWith('Solar_Dust_Layer_');
				obj.castShadow = !isTransparent;
				obj.receiveShadow = true;
			}

			if (
				obj.name === 'Orion_LOLA_Crater_Terrain' ||
				obj.name.startsWith('Corridor_') ||
				obj.name.endsWith('_Pad') ||
				obj.name.endsWith('_Apron') ||
				obj.name.endsWith('_Foundation') ||
				obj.name.endsWith('_Deck') ||
				obj.name.endsWith('_Walkway') ||
				obj.name.startsWith('Terrace_Stair_Step_')
			) {
				this.groundMeshes.push(obj);
			}

			if (obj.name === 'Orion_Moon_Rover') this.roverObject = obj;
			else if (obj.name === 'Geology_Workstation_Console') this.workstationObject = obj;
			else if (obj.name === 'Storage_Pod_Base') this.storagePodObject = obj;
			else if (obj.name === 'Orion_Landing_Pad_NASALogo') this.landingPadLogo = obj;
			else if (obj.name === 'Lander_Touchdown_Anchor') this.landingPadAnchor = obj;
			else if (obj.name === 'Airlock_Outer_Door') this.airlockDoor = obj;
			else if (obj.name === 'Ice_Drill_Auger') this.iceDrillAuger = obj;
			else if (obj.name.startsWith('Comm_Dish_Reflector_')) this.commDishes.push(obj);
			else if (obj.name.startsWith('Supply_Crate_0')) this.supplyCrates.push(obj);
			else if (obj.name.startsWith('Solar_Dust_Layer_')) this.solarDustLayers.push(obj);
			else if (obj.name.startsWith('Outpost_Lamp_Pole_')) {
				const wp = new THREE.Vector3();
				obj.getWorldPosition(wp);
				this.lampPositions.push(wp);
			} else if (obj.name.startsWith('Sample_Metal_') || obj.name.startsWith('Sample_NonMetal_')) {
				this.sampleNodes.set(obj.name, obj);
			}
		});

		if (this.storagePodObject) {
			this.storagePodObject.getWorldPosition(this.resupplyDropPos);
			this.resupplyDropPos.x += 5.5;
		}
		if (this.workstationObject) {
			this.workstationObject.getWorldPosition(this.workstationPos);
		}

		const padTarget = this.landingPadLogo ?? this.landingPadAnchor;
		if (padTarget) {
			padTarget.getWorldPosition(this.launchPadPos);
		}
	}

	/**
	 * Removes any non-sample rocks/boulders around Orion_Landing_Pad_NASALogo and outpost walkways
	 * while preserving Sample_Metal_* and Sample_NonMetal_* collectibles.
	 */
	private removeLandingZoneRocks(root: THREE.Object3D) {
		const toRemove: THREE.Object3D[] = [];
		const pos = new THREE.Vector3();

		root.traverse((obj) => {
			if (obj === root) return;
			if (obj.name.startsWith('Sample_Metal_') || obj.name.startsWith('Sample_NonMetal_')) return;

			if (/(rock|boulder|stone)/i.test(obj.name)) {
				obj.getWorldPosition(pos);
				const distToPad = Math.hypot(pos.x - this.launchPadPos.x, pos.z - this.launchPadPos.z);
				if (distToPad <= 22) {
					toRemove.push(obj);
				}
			}
		});

		for (const rock of toRemove) {
			rock.removeFromParent();
		}
	}

	/**
	 * Loads `/models/OrionLander.glb` and parks it on `Orion_Landing_Pad_NASALogo`
	 * at the touchdown offset handed off from Room 05.
	 */
	private async spawnOrionLanderOnPad(loader: GLTFLoader) {
		if (!this.outpostRoot) return;

		const { dx, dz } = readLandingPadOffset();
		const targetX = this.launchPadPos.x + dx;
		const targetZ = this.launchPadPos.z + dz;
		const padHit = this.sampleSurfaceAt(targetX, targetZ);
		const surfaceY = Math.max(padHit.y, this.launchPadPos.y);

		let landerModel: THREE.Object3D;
		try {
			const gltf = await loader.loadAsync('/models/OrionLander.glb');
			landerModel = gltf.scene;
			landerModel.updateMatrixWorld(true);

			const box = new THREE.Box3().setFromObject(landerModel);
			if (!box.isEmpty()) {
				const size = new THREE.Vector3();
				box.getSize(size);

				if (size.y > 0.05 && (size.y < 2.1 || size.y > 4.6)) {
					const scale = 3.4 / size.y;
					landerModel.scale.multiplyScalar(scale);
					landerModel.updateMatrixWorld(true);
					box.setFromObject(landerModel);
				}

				const center = new THREE.Vector3();
				box.getCenter(center);

				landerModel.position.x -= center.x;
				landerModel.position.z -= center.z;
				landerModel.position.y -= box.min.y;
			}

			landerModel.traverse((obj) => {
				if (obj instanceof THREE.Mesh) {
					obj.castShadow = true;
					obj.receiveShadow = true;
				}
			});
		} catch {
			landerModel = this.buildFallbackLander();
		}

		const assembly = new THREE.Group();
		assembly.name = 'Orion_Landed_Spacecraft';
		assembly.position.set(targetX, surfaceY, targetZ);
		assembly.add(landerModel);

		const plume = new THREE.Mesh(
			new THREE.ConeGeometry(0.75, 4.8, 16),
			new THREE.MeshBasicMaterial({
				color: 0x7cc8ff,
				transparent: true,
				opacity: 0.88
			})
		);
		plume.name = 'Orion_Lander_Ascent_Beacon';
		plume.position.set(0, -1.6, 0);
		plume.rotation.x = Math.PI;
		plume.visible = false;
		assembly.add(plume);

		this.outpostRoot.add(assembly);
		this.outpostRoot.updateMatrixWorld(true);

		this.landerAssembly = assembly;
		this.landerAscentPlume = plume;
	}

	private buildFallbackLander(): THREE.Group {
		const fallback = new THREE.Group();
		const descentStage = new THREE.Mesh(
			new THREE.CylinderGeometry(1.15, 1.2, 0.58, 8),
			new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.75, roughness: 0.3 })
		);
		descentStage.position.y = 1.08;
		fallback.add(descentStage);

		const esm = new THREE.Mesh(
			new THREE.CylinderGeometry(0.88, 0.88, 0.68, 16),
			new THREE.MeshStandardMaterial({ color: 0xeef2f6, metalness: 0.2, roughness: 0.4 })
		);
		esm.position.y = 1.86;
		fallback.add(esm);

		const cm = new THREE.Mesh(
			new THREE.CylinderGeometry(0.38, 0.9, 0.52, 16),
			new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.8, roughness: 0.28 })
		);
		cm.position.y = 2.54;
		fallback.add(cm);

		const legMat = new THREE.MeshStandardMaterial({ color: 0x8892a0, metalness: 0.6 });
		const padMat = new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.7 });
		for (let i = 0; i < 4; i++) {
			const angle = (i * Math.PI) / 2 + Math.PI / 4;
			const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.22, 8), legMat);
			leg.position.set(Math.cos(angle) * 1.18, 0.61, Math.sin(angle) * 1.18);
			leg.rotation.z = -Math.cos(angle) * 0.42;
			leg.rotation.x = Math.sin(angle) * 0.42;
			fallback.add(leg);

			const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.31, 0.08, 12), padMat);
			foot.position.set(Math.cos(angle) * 1.44, 0.04, Math.sin(angle) * 1.44);
			fallback.add(foot);
		}
		return fallback;
	}

	private buildZoneRings(scene: THREE.Scene) {
		const dropHit = this.sampleSurfaceAt(this.resupplyDropPos.x, this.resupplyDropPos.z);
		this.resupplyDropPos.y = dropHit.y;

		const dropRing = new THREE.Mesh(
			new THREE.RingGeometry(3.2, 3.65, 36),
			new THREE.MeshBasicMaterial({
				color: 0xf59e0b,
				side: THREE.DoubleSide,
				transparent: true,
				opacity: 0.85
			})
		);
		dropRing.rotation.x = -Math.PI / 2;
		dropRing.position.set(this.resupplyDropPos.x, dropHit.y + 0.08, this.resupplyDropPos.z);
		dropRing.name = 'Resupply_Drop_Ring';
		scene.add(dropRing);

		const labHit = this.sampleSurfaceAt(this.workstationPos.x, this.workstationPos.z);
		const labRing = new THREE.Mesh(
			new THREE.RingGeometry(2.6, 2.95, 36),
			new THREE.MeshBasicMaterial({
				color: 0x38bdf8,
				side: THREE.DoubleSide,
				transparent: true,
				opacity: 0.85
			})
		);
		labRing.rotation.x = -Math.PI / 2;
		labRing.position.set(this.workstationPos.x, labHit.y + 0.08, this.workstationPos.z + 2.2);
		labRing.name = 'Geology_Analysis_Ring';
		scene.add(labRing);
	}

	private buildSampleBeacons(scene: THREE.Scene) {
		for (const [nodeName, sampleObj] of this.sampleNodes.entries()) {
			const pos = new THREE.Vector3();
			sampleObj.getWorldPosition(pos);
			const isMetal = nodeName.startsWith('Sample_Metal_');

			const beacon = new THREE.Mesh(
				new THREE.CylinderGeometry(0.12, 0.45, 7.5, 16, 1, true),
				new THREE.MeshBasicMaterial({
					color: isMetal ? 0xfbbf24 : 0x38bdf8,
					transparent: true,
					opacity: 0.28,
					side: THREE.DoubleSide,
					depthWrite: false
				})
			);
			beacon.position.set(pos.x, pos.y + 3.6, pos.z);
			scene.add(beacon);
			this.sampleBeacons.set(nodeName, beacon);
		}
	}

	sampleSurfaceAt(x: number, z: number): SurfaceHit {
		this.rayOrigin.set(x, 120, z);
		this.raycaster.set(this.rayOrigin, this.downDir);
		this.raycaster.far = 260;

		const hits = this.raycaster.intersectObjects(this.groundMeshes, false);
		if (hits.length > 0) {
			const topHit = hits[0];
			const normal = topHit.face
				? topHit.face.normal.clone().transformDirection(topHit.object.matrixWorld).normalize()
				: new THREE.Vector3(0, 1, 0);

			let surfaceType: SurfaceType = 'Loose_Regolith';
			for (const h of hits) {
				const st = h.object.userData?.surface_type as SurfaceType | undefined;
				if (st) {
					surfaceType = st;
					break;
				}
				if (h.object.name.endsWith('_Pad') || h.object.name.endsWith('_Apron')) {
					surfaceType = 'Sintered_Regolith';
					break;
				}
			}

			return { y: topHit.point.y, normal, surfaceType };
		}

		return { y: 0, normal: new THREE.Vector3(0, 1, 0), surfaceType: 'Loose_Regolith' };
	}
}
