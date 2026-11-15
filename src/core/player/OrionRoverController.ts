import * as THREE from 'three';

export interface RoverTelemetry {
	isSeated: boolean;
	canBoard: boolean;
	speedKmh: number;
	headingDeg: number;
	batteryPct: number;
	headlightsOn: boolean;
	loadedItemName: string | null;
}

export class OrionRoverController {
	public rover: THREE.Object3D | null = null;
	public isSeated = false;

	private steerFL: THREE.Object3D | null = null;
	private steerFR: THREE.Object3D | null = null;
	private wheels: THREE.Object3D[] = [];
	private seatAnchor: THREE.Object3D | null = null;
	private cargoSlot: THREE.Object3D | null = null;
	private headlights: THREE.SpotLight[] = [];

	private speedMs = 0;
	private steerAngleRad = 0;
	private batteryPct = 100;
	private headlightsOn = true;
	private loadedItem: THREE.Object3D | null = null;

	// Real NASA Artemis LTV / Apollo LRV specs (loaded from .glb userData if present)
	private maxSpeedMs = 5.0; // 18.0 km/h
	private maxSlopeRad = THREE.MathUtils.degToRad(20);
	private wheelbaseM = 2.3;

	bindFromScene(outpostRoot: THREE.Object3D) {
		this.rover = outpostRoot.getObjectByName('Orion_Moon_Rover') ?? null;
		if (!this.rover) return;

		if (typeof this.rover.userData?.nasa_top_speed_kmh === 'number') {
			this.maxSpeedMs = this.rover.userData.nasa_top_speed_kmh / 3.6;
		}
		if (typeof this.rover.userData?.nasa_max_slope_deg === 'number') {
			this.maxSlopeRad = THREE.MathUtils.degToRad(this.rover.userData.nasa_max_slope_deg);
		}
		if (typeof this.rover.userData?.nasa_wheelbase_m === 'number') {
			this.wheelbaseM = this.rover.userData.nasa_wheelbase_m;
		}

		this.steerFL = this.rover.getObjectByName('Rover_Steer_FL') ?? null;
		this.steerFR = this.rover.getObjectByName('Rover_Steer_FR') ?? null;
		this.seatAnchor = this.rover.getObjectByName('Rover_Driver_Seat_Anchor') ?? null;
		this.cargoSlot = this.rover.getObjectByName('Rover_Cargo_Slot') ?? null;

		this.wheels = ['Rover_Wheel_FL', 'Rover_Wheel_FR', 'Rover_Wheel_RL', 'Rover_Wheel_RR']
			.map((n) => this.rover?.getObjectByName(n) ?? null)
			.filter((w): w is THREE.Object3D => w !== null);

		// Attach twin LED spotlights for driving inside the shadowed Ice Drill crater
		this.headlights = [];
		for (const hx of [-0.72, 0.72]) {
			const spot = new THREE.SpotLight(0xe0f2fe, 4.5, 42, Math.PI / 5, 0.45, 1.2);
			spot.position.set(hx, 0.25, 1.65);
			spot.target.position.set(hx, -0.4, 12.0);
			this.rover.add(spot, spot.target);
			this.headlights.push(spot);
		}
	}

	isPlayerInRange(playerPos: THREE.Vector3, radius = 4.5): boolean {
		if (!this.rover) return false;
		return playerPos.distanceTo(this.rover.position) <= radius;
	}

	/** Call when player presses [E] */
	toggleEnterExit(playerObject: THREE.Object3D): boolean {
		if (!this.rover) return false;

		if (!this.isSeated) {
			if (!this.isPlayerInRange(playerObject.position)) return false;
			this.isSeated = true;
			return true;
		} else {
			this.isSeated = false;
			this.speedMs = 0;
			// Step out safely beside the left side of the rover
			const exitOffset = new THREE.Vector3(-2.1, 0, 0).applyQuaternion(this.rover.quaternion);
			playerObject.position.copy(this.rover.position).add(exitOffset);
			return true;
		}
	}

	toggleHeadlights() {
		this.headlightsOn = !this.headlightsOn;
		for (const light of this.headlights) {
			light.visible = this.headlightsOn;
		}
	}

	/** Load/unload nearby movable Supply Crate or Lunar Sample onto rear rack ([F]) */
	toggleCargoItem(candidates: THREE.Object3D[], sceneRoot: THREE.Object3D): string | null {
		if (!this.rover || !this.cargoSlot) return null;

		if (this.loadedItem) {
			const dropWorld = new THREE.Vector3();
			this.cargoSlot.getWorldPosition(dropWorld);
			const sideDrop = new THREE.Vector3(2.0, -0.35, 0).applyQuaternion(this.rover.quaternion);
			sceneRoot.attach(this.loadedItem);
			this.loadedItem.position.copy(dropWorld).add(sideDrop);
			const droppedName = this.loadedItem.name;
			this.loadedItem = null;
			return `Unloaded ${droppedName}`;
		}

		let closest: THREE.Object3D | null = null;
		let bestDist = 4.2;
		for (const item of candidates) {
			const d = item.position.distanceTo(this.rover.position);
			if (d < bestDist) {
				bestDist = d;
				closest = item;
			}
		}

		if (closest) {
			this.cargoSlot.attach(closest);
			closest.position.set(0, 0.25, 0);
			closest.rotation.set(0, 0, 0);
			this.loadedItem = closest;
			return `Loaded ${closest.name}`;
		}
		return null;
	}

	update(
		dt: number,
		keys: Set<string>,
		playerObject: THREE.Object3D,
		getSurfaceHeightAt: (x: number, z: number) => number
	): RoverTelemetry {
		if (!this.rover) {
			return {
				isSeated: false,
				canBoard: false,
				speedKmh: 0,
				headingDeg: 0,
				batteryPct: this.batteryPct,
				headlightsOn: this.headlightsOn,
				loadedItemName: null
			};
		}

		let throttle = 0;
		let steerInput = 0;
		if (this.isSeated && this.batteryPct > 0) {
			if (keys.has('KeyW') || keys.has('ArrowUp')) throttle += 1;
			if (keys.has('KeyS') || keys.has('ArrowDown')) throttle -= 1;
			if (keys.has('KeyA') || keys.has('ArrowLeft')) steerInput += 1;
			if (keys.has('KeyD') || keys.has('ArrowRight')) steerInput -= 1;
		}

		// Acceleration & lunar regolith rolling resistance
		const accel = throttle >= 0 ? 3.8 : 4.5;
		if (throttle !== 0) {
			this.speedMs = THREE.MathUtils.clamp(
				this.speedMs + throttle * accel * dt,
				-this.maxSpeedMs * 0.5,
				this.maxSpeedMs
			);
			this.batteryPct = Math.max(0, this.batteryPct - Math.abs(throttle) * 0.08 * dt);
		} else {
			this.speedMs = THREE.MathUtils.lerp(this.speedMs, 0, Math.min(1, dt * 3.2));
		}

		// Ackermann front-wheel steering
		const targetSteer = steerInput * THREE.MathUtils.degToRad(28);
		this.steerAngleRad = THREE.MathUtils.lerp(
			this.steerAngleRad,
			targetSteer,
			Math.min(1, dt * 7.5)
		);
		if (this.steerFL) this.steerFL.rotation.y = this.steerAngleRad;
		if (this.steerFR) this.steerFR.rotation.y = this.steerAngleRad;

		if (Math.abs(this.speedMs) > 0.01) {
			const angularVel = (this.speedMs / this.wheelbaseM) * Math.tan(this.steerAngleRad);
			this.rover.rotation.y += angularVel * dt;

			const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(
				new THREE.Vector3(0, 1, 0),
				this.rover.rotation.y
			);
			const nextX = this.rover.position.x + forward.x * this.speedMs * dt;
			const nextZ = this.rover.position.z + forward.z * this.speedMs * dt;

			// Enforce NASA LTV 20-degree max crater wall climb limit
			const currGround = getSurfaceHeightAt(this.rover.position.x, this.rover.position.z);
			const nextGround = getSurfaceHeightAt(nextX, nextZ);
			const stepDist = Math.hypot(nextX - this.rover.position.x, nextZ - this.rover.position.z);
			const slopeRad = stepDist > 0.0001 ? Math.atan2(nextGround - currGround, stepDist) : 0;

			if (slopeRad <= this.maxSlopeRad) {
				this.rover.position.x = nextX;
				this.rover.position.z = nextZ;
				this.rover.position.y = nextGround + 0.54;
			} else {
				this.speedMs = 0;
			}

			// Spin all 4 wheels proportional to wheel radius (0.42m)
			const wheelSpin = (this.speedMs * dt) / 0.42;
			for (const w of this.wheels) {
				w.rotation.x += wheelSpin;
			}
		}

		// Keep seated astronaut synced to driver seat anchor
		if (this.isSeated && this.seatAnchor) {
			this.seatAnchor.getWorldPosition(playerObject.position);
			playerObject.rotation.y = this.rover.rotation.y;
		}

		return {
			isSeated: this.isSeated,
			canBoard: !this.isSeated && this.isPlayerInRange(playerObject.position),
			speedKmh: Math.abs(this.speedMs * 3.6),
			headingDeg: (THREE.MathUtils.radToDeg(this.rover.rotation.y) + 360) % 360,
			batteryPct: this.batteryPct,
			headlightsOn: this.headlightsOn,
			loadedItemName: this.loadedItem?.name ?? null
		};
	}
}
