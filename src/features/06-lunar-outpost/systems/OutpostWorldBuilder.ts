import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LunarOutpostConfig } from '../lunar-outpost.config';
import type { SurfaceType } from '../lunar-outpost.types';

export interface SurfaceHit {
	y: number;
	normal: THREE.Vector3;
	surfaceType: SurfaceType;
}

export class OutpostWorldBuilder {
	public outpostRoot: THREE.Object3D | null = null;
	public roverObject: THREE.Object3D | null = null;
	public workstationObject: THREE.Object3D | null = null;
	public storagePodObject: THREE.Object3D | null = null;
	public landingPadAnchor: THREE.Object3D | null = null;
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
		if (this.landingPadAnchor) {
			this.landingPadAnchor.getWorldPosition(this.launchPadPos);
		}
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
