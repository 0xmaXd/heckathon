import * as THREE from 'three';

export interface OutpostMachineryNodes {
	airlockDoor: THREE.Object3D | null;
	iceDrillAuger: THREE.Object3D | null;
	commDishes: THREE.Object3D[];
	solarDustLayers: THREE.Object3D[];
	sampleBeacons: Map<string, THREE.Mesh>;
	dropOffZones: Array<{ beaconMesh: THREE.Mesh }>;
	landerAssembly: THREE.Group | null;
	landerAscentPlume: THREE.Mesh | null;
}

export class OutpostMachinerySystem {
	private nodes!: OutpostMachineryNodes;
	private airlockOpen = false;
	private airlockClosedZ = 0;
	private launchSequenceTimer = 0;
	private elapsed = 0;

	init(nodes: OutpostMachineryNodes) {
		this.nodes = nodes;
		this.launchSequenceTimer = 0;
		if (this.nodes.airlockDoor) {
			this.airlockClosedZ = this.nodes.airlockDoor.position.z;
		}
	}

	triggerLanderLaunch(): boolean {
		this.launchSequenceTimer = 0.01;
		if (this.nodes.landerAscentPlume) {
			this.nodes.landerAscentPlume.visible = true;
		}
		return true;
	}

	isAirlockOpen(): boolean {
		return this.airlockOpen;
	}

	toggleAirlockDoor(): boolean {
		if (!this.nodes.airlockDoor) return false;
		this.airlockOpen = !this.airlockOpen;
		return true;
	}

	isNearAirlock(pos: THREE.Vector3, radius = 5.0): boolean {
		if (!this.nodes.airlockDoor) return false;
		const doorWorld = new THREE.Vector3();
		this.nodes.airlockDoor.getWorldPosition(doorWorld);
		return pos.distanceTo(doorWorld) <= radius;
	}

	cleanNearbySolarPanel(pos: THREE.Vector3, radius = 5.2): boolean {
		const dustPos = new THREE.Vector3();
		for (const dust of this.nodes.solarDustLayers) {
			if (!dust.visible) continue;
			dust.getWorldPosition(dustPos);
			if (pos.distanceTo(dustPos) <= radius) {
				dust.visible = false;
				return true;
			}
		}
		return false;
	}

	hasDustyPanelNearby(pos: THREE.Vector3, radius = 5.2): boolean {
		const dustPos = new THREE.Vector3();
		for (const dust of this.nodes.solarDustLayers) {
			if (!dust.visible) continue;
			dust.getWorldPosition(dustPos);
			if (pos.distanceTo(dustPos) <= radius) return true;
		}
		return false;
	}

	getDustyPanelCount(): number {
		let count = 0;
		for (const dust of this.nodes.solarDustLayers) {
			if (dust.visible) count++;
		}
		return count;
	}

	triggerDustStorm(panelCount = 6) {
		let dirtied = 0;
		for (const dust of this.nodes.solarDustLayers) {
			if (!dust.visible) {
				dust.visible = true;
				dirtied++;
				if (dirtied >= panelCount) break;
			}
		}
	}

	update(dt: number) {
		this.elapsed += dt;

		if (this.nodes.iceDrillAuger) {
			this.nodes.iceDrillAuger.rotation.y += dt * 3.4;
		}

		for (let i = 0; i < this.nodes.commDishes.length; i++) {
			const dish = this.nodes.commDishes[i];
			dish.rotation.y = Math.sin(this.elapsed * 0.25 + i * 0.9) * 0.14;
		}

		if (this.nodes.airlockDoor) {
			const targetZ = this.airlockClosedZ + (this.airlockOpen ? 1.85 : 0);
			this.nodes.airlockDoor.position.z = THREE.MathUtils.lerp(
				this.nodes.airlockDoor.position.z,
				targetZ,
				Math.min(1, dt * 5.0)
			);
		}

		if (this.launchSequenceTimer > 0) {
			this.launchSequenceTimer += dt;
			if (this.nodes.landerAssembly) {
				const ascentSpeed = Math.min(48, this.launchSequenceTimer * this.launchSequenceTimer * 3.8);
				this.nodes.landerAssembly.position.y += ascentSpeed * dt;
			}
		}

		for (const beacon of this.nodes.sampleBeacons.values()) {
			if (!beacon.visible) continue;
			const mat = beacon.material as THREE.MeshBasicMaterial;
			mat.opacity = 0.18 + Math.sin(this.elapsed * 2.5) * 0.05;
		}

		for (const zone of this.nodes.dropOffZones) {
			if (!zone.beaconMesh.visible) continue;
			const mat = zone.beaconMesh.material as THREE.MeshBasicMaterial;
			mat.opacity = 0.16 + Math.sin(this.elapsed * 2.3) * 0.05;
		}
	}
}
