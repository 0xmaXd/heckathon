import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LunarOutpostConfig } from '../lunar-outpost.config';
import type { DropOffZoneId, SurfaceType } from '../lunar-outpost.types';

export interface SurfaceHit {
	y: number;
	normal: THREE.Vector3;
	surfaceType: SurfaceType;
}

export interface WorldDropOffZone {
	id: DropOffZoneId;
	label: string;
	shortHint: string;
	position: THREE.Vector3;
	delivered: boolean;
	deliveredCrateName: string | null;
	ringMesh: THREE.Mesh;
	beaconMesh: THREE.Mesh;
}

const PAD_OR_GROUND_PATTERN =
	/(_Pad|_Apron|_Anchor|_Ring|_HazardRing|_Decal|_Logo|_Disc|_Walkway|_Foundation|Terrain|Beacon|Light)/i;
const LANDER_NAME_PATTERN = /(lander|sample[_\s-]*return|ascent|descent[_\s-]*stage|capsule)/i;

export class OutpostWorldBuilder {
	public outpostRoot: THREE.Object3D | null = null;
	public roverObject: THREE.Object3D | null = null;
	public workstationObject: THREE.Object3D | null = null;
	public storagePodObject: THREE.Object3D | null = null;
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
	public dropOffZones: WorldDropOffZone[] = [];

	public resupplyDropPos = new THREE.Vector3(-22, 0, 14);
	public workstationPos = new THREE.Vector3(6.5, 0, -1.5);
	public launchPadPos = new THREE.Vector3(46, 0, -52);

	private landmarkMatches = new Map<DropOffZoneId, THREE.Object3D>();
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
		this.assembleLanderOnPad();
		this.buildDropOffZones(scene);
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
		this.landmarkMatches.clear();

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

			// Match the 5 designated landmark objects in moon_outpost.glb
			for (const def of LunarOutpostConfig.dropOffZoneDefinitions) {
				if (this.landmarkMatches.has(def.id)) continue;
				if (def.nodePatterns.some((pattern) => pattern.test(obj.name))) {
					this.landmarkMatches.set(def.id, obj);
				}
			}
		});

		if (this.storagePodObject) {
			this.storagePodObject.getWorldPosition(this.resupplyDropPos);
			this.resupplyDropPos.x += 5.5;
		}
		if (this.workstationObject) {
			this.workstationObject.getWorldPosition(this.workstationPos);
		}
		if (this.landingPadAnchor) {
			this.landingPadAnchor.getWorldPosition(this.launchPadPos);
		}
	}

	/**
	 * Builds the 5 designated Supply Box Drop-Off Rings anchored beside the real
	 * landmarks in `moon_outpost.glb` (Command Control, Electricity, Storage Pod, Geology Lab, Airlock).
	 */
	private buildDropOffZones(scene: THREE.Scene) {
		this.dropOffZones = [];
		const courtyardCenter = new THREE.Vector3(0, 0, -10);
		const box = new THREE.Box3();
		const center = new THREE.Vector3();
		const size = new THREE.Vector3();

		for (const def of LunarOutpostConfig.dropOffZoneDefinitions) {
			let zoneX = def.fallbackPos[0];
			let zoneZ = def.fallbackPos[2];

			const matched = this.landmarkMatches.get(def.id);
			if (matched) {
				box.setFromObject(matched);
				if (!box.isEmpty()) {
					box.getCenter(center);
					box.getSize(size);
				} else {
					matched.getWorldPosition(center);
					size.set(3.0, 2.0, 3.0);
				}

				const buildingRadius = Math.min(6.0, Math.max(size.x, size.z) * 0.5);
				const radialDist = def.id === 'airlock' ? 3.2 : buildingRadius + def.offsetDistance;

				const toCourtyardX = courtyardCenter.x - center.x;
				const toCourtyardZ = courtyardCenter.z - center.z;
				const len = Math.hypot(toCourtyardX, toCourtyardZ);

				const dirX = len > 0.05 ? toCourtyardX / len : 0;
				const dirZ = len > 0.05 ? toCourtyardZ / len : 1;

				zoneX = center.x + dirX * radialDist;
				zoneZ = center.z + dirZ * radialDist;
			}

			// Ensure minimum 8.5 m spacing between any two drop-off rings
			for (const existing of this.dropOffZones) {
				const dx = zoneX - existing.position.x;
				const dz = zoneZ - existing.position.z;
				const d = Math.hypot(dx, dz);
				if (d < 8.5) {
					const pushAngle = d > 0.01 ? Math.atan2(dz, dx) : Math.PI * 0.5;
					zoneX = existing.position.x + Math.cos(pushAngle) * 8.8;
					zoneZ = existing.position.z + Math.sin(pushAngle) * 8.8;
				}
			}

			const hit = this.sampleSurfaceAt(zoneX, zoneZ);
			const position = new THREE.Vector3(zoneX, hit.y, zoneZ);

			const ringMesh = new THREE.Mesh(
				new THREE.RingGeometry(2.8, 3.35, 36),
				new THREE.MeshBasicMaterial({
					color: 0xf59e0b,
					side: THREE.DoubleSide,
					transparent: true,
					opacity: 0.9
				})
			);
			ringMesh.rotation.x = -Math.PI / 2;
			ringMesh.position.set(position.x, hit.y + 0.09, position.z);
			ringMesh.name = `DropOff_Ring_${def.id}`;
			scene.add(ringMesh);

			const beaconMesh = new THREE.Mesh(
				new THREE.CylinderGeometry(0.14, 0.55, 6.8, 16, 1, true),
				new THREE.MeshBasicMaterial({
					color: 0xf59e0b,
					transparent: true,
					opacity: 0.24,
					side: THREE.DoubleSide,
					depthWrite: false
				})
			);
			beaconMesh.position.set(position.x, hit.y + 3.4, position.z);
			beaconMesh.name = `DropOff_Beacon_${def.id}`;
			scene.add(beaconMesh);

			this.dropOffZones.push({
				id: def.id,
				label: def.label,
				shortHint: def.shortHint,
				position,
				delivered: false,
				deliveredCrateName: null,
				ringMesh,
				beaconMesh
			});
		}
	}

	public findDropOffZoneNear(
		pos: THREE.Vector3,
		radius: number = LunarOutpostConfig.physics.crateDeliverRadius,
		onlyUndelivered = true
	): WorldDropOffZone | null {
		let best: WorldDropOffZone | null = null;
		let bestDist = radius;

		for (const zone of this.dropOffZones) {
			if (onlyUndelivered && zone.delivered) continue;
			const horizDist = Math.hypot(pos.x - zone.position.x, pos.z - zone.position.z);
			if (horizDist <= bestDist) {
				bestDist = horizDist;
				best = zone;
			}
		}
		return best;
	}

	/**
	 * Groups the lander meshes parked at `Lander_Touchdown_Anchor` so the spacecraft
	 * stays solid on the pad and can ignite & ascend during the finale launch.
	 */
	private assembleLanderOnPad() {
		if (!this.outpostRoot) return;

		const landerParts: THREE.Object3D[] = [];
		const box = new THREE.Box3();
		const center = new THREE.Vector3();
		const size = new THREE.Vector3();

		this.outpostRoot.traverse((obj) => {
			if (!(obj instanceof THREE.Mesh) || !obj.geometry) return;
			if (PAD_OR_GROUND_PATTERN.test(obj.name)) return;

			box.setFromObject(obj);
			if (box.isEmpty()) return;
			box.getCenter(center);
			box.getSize(size);

			if (size.y < 0.22 && Math.max(size.x, size.z) > 5.0) return;

			const matchesName = LANDER_NAME_PATTERN.test(obj.name);
			const nearPad =
				Math.hypot(center.x - this.launchPadPos.x, center.z - this.launchPadPos.z) <= 5.2 &&
				box.min.y >= this.launchPadPos.y - 0.35 &&
				box.max.y <= this.launchPadPos.y + 15.0;

			if (matchesName || nearPad) {
				landerParts.push(obj);
			}
		});

		if (landerParts.length === 0) return;

		const assembly = new THREE.Group();
		assembly.name = 'Outpost_Landed_Spacecraft';
		assembly.position.copy(this.launchPadPos);
		this.outpostRoot.add(assembly);
		assembly.updateMatrixWorld(true);

		for (const part of landerParts) {
			assembly.attach(part);
		}

		const plume = new THREE.Mesh(
			new THREE.ConeGeometry(0.95, 6.5, 18),
			new THREE.MeshBasicMaterial({
				color: 0x7cc8ff,
				transparent: true,
				opacity: 0.88
			})
		);
		plume.position.set(0, -2.4, 0);
		plume.rotation.x = Math.PI;
		plume.visible = false;
		assembly.add(plume);

		this.landerAssembly = assembly;
		this.landerAscentPlume = plume;
	}

	private buildZoneRings(scene: THREE.Scene) {
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
