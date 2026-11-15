import * as THREE from 'three';
import { LunarOutpostConfig } from '../lunar-outpost.config';
import type { RoverHudState, SurfaceType } from '../lunar-outpost.types';
import type { OutpostCollisionSystem } from './OutpostCollisionSystem';
import type { OutpostWorldBuilder } from './OutpostWorldBuilder';

export class OrionRoverSystem {
	public rover: THREE.Object3D | null = null;
	public isSeated = false;
	public loadedCrate: THREE.Object3D | null = null;

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
	private currentSurface: SurfaceType = 'Loose_Regolith';

	private maxSpeedMs = LunarOutpostConfig.rover.defaultMaxSpeedKmh / 3.6;
	private maxSlopeRad = THREE.MathUtils.degToRad(LunarOutpostConfig.rover.defaultMaxSlopeDeg);
	private wheelbaseM = LunarOutpostConfig.rover.defaultWheelbaseM;

	init(world: OutpostWorldBuilder) {
		this.rover = world.roverObject;
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
			.map((name) => this.rover?.getObjectByName(name) ?? null)
			.filter((w): w is THREE.Object3D => w !== null);

		this.headlights = [];
		for (const hx of [-0.72, 0.72]) {
			const spot = new THREE.SpotLight(0xe0f2fe, 7.5, 65, Math.PI / 4.5, 0.45, 1.0);
			spot.position.set(hx, 0.35, 1.65);
			spot.target.position.set(hx, -0.45, 16.0);
			this.rover.add(spot, spot.target);
			this.headlights.push(spot);
		}
	}

	isInBoardingRange(playerPos: THREE.Vector3): boolean {
		if (!this.rover) return false;
		return (
			playerPos.distanceTo(this.rover.position) <= LunarOutpostConfig.physics.interactionRadius
		);
	}

	toggleEnterExit(playerObject: THREE.Object3D, world: OutpostWorldBuilder): boolean {
		if (!this.rover) return false;

		if (!this.isSeated) {
			if (!this.isInBoardingRange(playerObject.position)) return false;
			this.isSeated = true;
			return true;
		}

		this.isSeated = false;
		this.speedMs = 0;
		const exitPos = new THREE.Vector3(-2.3, 0, 0)
			.applyQuaternion(this.rover.quaternion)
			.add(this.rover.position);
		const hit = world.sampleSurfaceAt(exitPos.x, exitPos.z);
		playerObject.position.set(exitPos.x, hit.y, exitPos.z);
		return true;
	}

	toggleHeadlights() {
		this.headlightsOn = !this.headlightsOn;
		for (const light of this.headlights) {
			light.visible = this.headlightsOn;
		}
	}

	loadOrUnloadCrate(
		crates: THREE.Object3D[],
		scene: THREE.Scene,
		world: OutpostWorldBuilder
	): string | null {
		if (!this.rover || !this.cargoSlot) return null;

		if (this.loadedCrate) {
			const sideDrop = new THREE.Vector3(2.2, 0, -0.5)
				.applyQuaternion(this.rover.quaternion)
				.add(this.rover.position);
			const hit = world.sampleSurfaceAt(sideDrop.x, sideDrop.z);

			scene.attach(this.loadedCrate);
			this.loadedCrate.position.set(sideDrop.x, hit.y + 0.39, sideDrop.z);
			this.loadedCrate.rotation.set(0, this.rover.rotation.y, 0);

			const name = this.loadedCrate.name;
			this.loadedCrate = null;
			return `Unloaded ${name}`;
		}

		let closest: THREE.Object3D | null = null;
		let bestDist = 4.8;
		const cratePos = new THREE.Vector3();

		for (const crate of crates) {
			if (crate.userData?.delivered) continue;
			crate.getWorldPosition(cratePos);
			const d = cratePos.distanceTo(this.rover.position);
			if (d < bestDist) {
				bestDist = d;
				closest = crate;
			}
		}

		if (closest) {
			this.cargoSlot.attach(closest);
			closest.position.set(0, 0.32, 0);
			closest.rotation.set(0, 0, 0);
			this.loadedCrate = closest;
			return `Loaded ${closest.name} onto Rover Rack`;
		}
		return null;
	}

	applyFirstPersonDriverCamera(
		camera: THREE.PerspectiveCamera,
		headYawOffsetRad: number,
		headPitchRad: number
	): boolean {
		if (!this.isSeated || !this.rover) return false;

		const eyeLocal = new THREE.Vector3(-0.46, 1.24, 0.22);
		const eyeWorld = eyeLocal.applyMatrix4(this.rover.matrixWorld);
		camera.position.copy(eyeWorld);

		const totalYaw = this.rover.rotation.y + headYawOffsetRad;
		const lookDir = new THREE.Vector3(
			Math.sin(totalYaw) * Math.cos(headPitchRad),
			Math.sin(headPitchRad),
			Math.cos(totalYaw) * Math.cos(headPitchRad)
		);
		camera.lookAt(eyeWorld.clone().add(lookDir));
		return true;
	}

	update(
		dt: number,
		keys: Set<string>,
		playerObject: THREE.Object3D,
		world: OutpostWorldBuilder,
		collisions: OutpostCollisionSystem
	): RoverHudState {
		if (!this.rover) {
			return {
				isSeated: false,
				canBoard: false,
				speedKmh: 0,
				headingDeg: 0,
				batteryPct: 100,
				headlightsOn: true,
				surfaceType: 'Loose_Regolith',
				loadedCrateName: null
			};
		}

		const hit = world.sampleSurfaceAt(this.rover.position.x, this.rover.position.z);
		this.currentSurface = hit.surfaceType;

		let throttle = 0;
		let steerInput = 0;
		if (this.isSeated && this.batteryPct > 0) {
			if (keys.has('KeyW') || keys.has('ArrowUp')) throttle += 1;
			if (keys.has('KeyS') || keys.has('ArrowDown')) throttle -= 1;
			if (keys.has('KeyA') || keys.has('ArrowLeft')) steerInput += 1;
			if (keys.has('KeyD') || keys.has('ArrowRight')) steerInput -= 1;
		}

		const surfaceMult = LunarOutpostConfig.rover.surfaceSpeedMultipliers[this.currentSurface];
		const effectiveMaxSpeed = this.maxSpeedMs * surfaceMult;

		if (throttle !== 0) {
			const accel = throttle > 0 ? 4.2 : 5.0;
			this.speedMs = THREE.MathUtils.clamp(
				this.speedMs + throttle * accel * dt,
				-effectiveMaxSpeed * 0.5,
				effectiveMaxSpeed
			);
			const drain = LunarOutpostConfig.rover.surfaceDrainMultipliers[this.currentSurface];
			this.batteryPct = Math.max(0, this.batteryPct - Math.abs(throttle) * drain * dt);
		} else {
			this.speedMs = THREE.MathUtils.lerp(this.speedMs, 0, Math.min(1, dt * 3.4));
		}

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
			const nextX = THREE.MathUtils.clamp(
				this.rover.position.x + forward.x * this.speedMs * dt,
				-215,
				215
			);
			const nextZ = THREE.MathUtils.clamp(
				this.rover.position.z + forward.z * this.speedMs * dt,
				-215,
				215
			);

			const nextHit = world.sampleSurfaceAt(nextX, nextZ);
			const stepDist = Math.hypot(nextX - this.rover.position.x, nextZ - this.rover.position.z);
			const slopeRad = stepDist > 0.0001 ? Math.atan2(nextHit.y - hit.y, stepDist) : 0;

			if (slopeRad <= this.maxSlopeRad) {
				const prevX = this.rover.position.x;
				const prevZ = this.rover.position.z;

				this.rover.position.x = nextX;
				this.rover.position.z = nextZ;

				// Prevent Rover from driving through buildings, domes, tanks, or panels
				collisions.resolveHorizontal(this.rover.position, 1.38, 1.8, {
					includeRover: false,
					ignoredCrate: this.loadedCrate
				});

				const groundAtResolved = world.sampleSurfaceAt(
					this.rover.position.x,
					this.rover.position.z
				);
				this.rover.position.y = groundAtResolved.y + 0.54;

				const movedDist = Math.hypot(this.rover.position.x - prevX, this.rover.position.z - prevZ);
				if (movedDist < stepDist * 0.35) {
					this.speedMs *= 0.25;
				}
			} else {
				this.speedMs = 0;
			}

			const wheelSpin = (this.speedMs * dt) / LunarOutpostConfig.rover.wheelRadiusM;
			for (const wheel of this.wheels) {
				wheel.rotation.x += wheelSpin;
			}
		}

		if (this.isSeated && this.seatAnchor) {
			this.seatAnchor.getWorldPosition(playerObject.position);
			playerObject.position.y -= 0.4;
			playerObject.rotation.y = this.rover.rotation.y;
		}

		return {
			isSeated: this.isSeated,
			canBoard: !this.isSeated && this.isInBoardingRange(playerObject.position),
			speedKmh: Math.abs(this.speedMs * 3.6),
			headingDeg: Math.round(((THREE.MathUtils.radToDeg(this.rover.rotation.y) % 360) + 360) % 360),
			batteryPct: Math.round(this.batteryPct),
			headlightsOn: this.headlightsOn,
			surfaceType: this.currentSurface,
			loadedCrateName: this.loadedCrate?.name ?? null
		};
	}
}
