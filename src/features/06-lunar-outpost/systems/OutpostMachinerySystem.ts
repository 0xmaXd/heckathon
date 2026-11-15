import * as THREE from 'three';
import type { OutpostWorldBuilder } from './OutpostWorldBuilder';

export class OutpostMachinerySystem {
	private world!: OutpostWorldBuilder;
	private airlockOpen = false;
	private airlockClosedZ = 0;
	private elapsed = 0;

	init(world: OutpostWorldBuilder) {
		this.world = world;
		if (this.world.airlockDoor) {
			this.airlockClosedZ = this.world.airlockDoor.position.z;
		}
	}

	isAirlockOpen(): boolean {
		return this.airlockOpen;
	}

	toggleAirlockDoor(): boolean {
		if (!this.world.airlockDoor) return false;
		this.airlockOpen = !this.airlockOpen;
		return true;
	}

	isNearAirlock(pos: THREE.Vector3, radius = 5.0): boolean {
		if (!this.world.airlockDoor) return false;
		const doorWorld = new THREE.Vector3();
		this.world.airlockDoor.getWorldPosition(doorWorld);
		return pos.distanceTo(doorWorld) <= radius;
	}

	cleanNearbySolarPanel(pos: THREE.Vector3, radius = 5.2): boolean {
		const dustPos = new THREE.Vector3();
		for (const dust of this.world.solarDustLayers) {
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
		for (const dust of this.world.solarDustLayers) {
			if (!dust.visible) continue;
			dust.getWorldPosition(dustPos);
			if (pos.distanceTo(dustPos) <= radius) return true;
		}
		return false;
	}

	getDustyPanelCount(): number {
		let count = 0;
		for (const dust of this.world.solarDustLayers) {
			if (dust.visible) count++;
		}
		return count;
	}

	triggerDustStorm(panelCount = 6) {
		let dirtied = 0;
		for (const dust of this.world.solarDustLayers) {
			if (!dust.visible) {
				dust.visible = true;
				dirtied++;
				if (dirtied >= panelCount) break;
			}
		}
	}

	update(dt: number) {
		this.elapsed += dt;

		if (this.world.iceDrillAuger) {
			this.world.iceDrillAuger.rotation.y += dt * 3.4;
		}

		for (let i = 0; i < this.world.commDishes.length; i++) {
			const dish = this.world.commDishes[i];
			dish.rotation.y = Math.sin(this.elapsed * 0.25 + i * 0.9) * 0.14;
		}

		if (this.world.airlockDoor) {
			const targetZ = this.airlockClosedZ + (this.airlockOpen ? 1.85 : 0);
			this.world.airlockDoor.position.z = THREE.MathUtils.lerp(
				this.world.airlockDoor.position.z,
				targetZ,
				Math.min(1, dt * 5.0)
			);
		}

		for (const beacon of this.world.sampleBeacons.values()) {
			if (!beacon.visible) continue;
			const mat = beacon.material as THREE.MeshBasicMaterial;
			mat.opacity = 0.22 + Math.sin(this.elapsed * 2.8) * 0.08;
		}
	}
}
