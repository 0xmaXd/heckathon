import * as THREE from 'three';
import { LunarOutpostConfig } from '../lunar-outpost.config';
import type { RoverHudState, SurfaceType } from '../lunar-outpost.types';
import type { OutpostCollisionSystem } from './OutpostCollisionSystem';
import type { OutpostWorldBuilder } from './OutpostWorldBuilder';

interface FallingOverflowCrate {
	crate: THREE.Object3D;
	velocity: THREE.Vector3;
	rollSpeed: number;
	pitchSpeed: number;
	ageSec: number;
}

export interface RoverCargoPlacementResult {
	accepted: boolean;
	message: string;
}

function normalizeAngleRad(angle: number): number {
	return ((angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}

export class OrionRoverSystem {
	public rover: THREE.Object3D | null = null;
	public isSeated = false;
	public loadedCrate: THREE.Object3D | null = null;

	private steerFL: THREE.Object3D | null = null;
	private steerFR: THREE.Object3D | null = null;
	private wheels: THREE.Object3D[] = [];
	private seatAnchor: THREE.Object3D | null = null;
	private cargoSlot: THREE.Object3D | null = null;
	private cargoRackFrame: THREE.Mesh | null = null;
	private headlights: THREE.SpotLight[] = [];

	// In moon_outpost.glb, Orion_Moon_Rover's front is -Z and its rear cargo rack is +Z
	private forwardSign: -1 | 1 = -1;

	private speedMs = 0;
	private steerAngleRad = 0;
	private batteryPct = 100;
	private headlightsOn = true;
	private currentSurface: SurfaceType = 'Loose_Regolith';
	private smoothedNormal = new THREE.Vector3(0, 1, 0);

	// Baseline yaw captured upon entering the driver's seat so camera always starts facing forward
	private boardingYawBaseline: number | null = null;

	private cargoSnapTimer = 0;
	private nextFallSide: 1 | -1 = 1;
	private fallingCrates: FallingOverflowCrate[] = [];

	private maxSpeedMs = LunarOutpostConfig.rover.defaultMaxSpeedKmh / 3.6;
	private maxSlopeRad = THREE.MathUtils.degToRad(LunarOutpostConfig.rover.defaultMaxSlopeDeg);
	private wheelbaseM = LunarOutpostConfig.rover.defaultWheelbaseM;

	init(world: OutpostWorldBuilder) {
		world.roverSystem = this;
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

		// Ensure a cargo mount always exists on the rear deck (+Z) of the rover
		if (!this.cargoSlot) {
			const slot = new THREE.Group();
			slot.name = 'Rover_Cargo_Slot';
			slot.position.set(0, 0.56, 1.02);
			this.rover.add(slot);
			this.cargoSlot = slot;
		}

		// Confirm front (-Z) vs rear (+Z) orientation from cargo slot / front wheels
		const wheelFL = this.rover.getObjectByName('Rover_Wheel_FL');
		const wheelRL = this.rover.getObjectByName('Rover_Wheel_RL');
		if (wheelFL && wheelRL && Math.abs(wheelFL.position.z - wheelRL.position.z) > 0.1) {
			this.forwardSign = wheelFL.position.z < wheelRL.position.z ? -1 : 1;
		} else if (Math.abs(this.cargoSlot.position.z) > 0.05) {
			this.forwardSign = this.cargoSlot.position.z > 0 ? -1 : 1;
		} else {
			this.forwardSign = -1;
		}

		// Visual magnetic cargo deck pad on top of the back of the car
		const rackFrame = new THREE.Mesh(
			new THREE.RingGeometry(0.46, 0.54, 4),
			new THREE.MeshBasicMaterial({
				color: 0xfacc15,
				side: THREE.DoubleSide,
				transparent: true,
				opacity: 0.48
			})
		);
		rackFrame.rotation.x = -Math.PI / 2;
		rackFrame.rotation.z = Math.PI / 4;
		rackFrame.position.set(0, 0.03, 0);
		rackFrame.name = 'Rover_Cargo_Rack_Indicator';
		this.cargoSlot.add(rackFrame);
		this.cargoRackFrame = rackFrame;

		this.wheels = ['Rover_Wheel_FL', 'Rover_Wheel_FR', 'Rover_Wheel_RL', 'Rover_Wheel_RR']
			.map((name) => this.rover?.getObjectByName(name) ?? null)
			.filter((w): w is THREE.Object3D => w !== null);

		// Mount headlights on the front end of the rover facing forward
		this.headlights = [];
		for (const hx of [-0.72, 0.72]) {
			const spot = new THREE.SpotLight(0xe0f2fe, 7.5, 65, Math.PI / 4.5, 0.45, 1.0);
			spot.position.set(hx, 0.35, 1.65 * this.forwardSign);
			spot.target.position.set(hx, -0.45, 16.0 * this.forwardSign);
			this.rover.add(spot, spot.target);
			this.headlights.push(spot);
		}

		this.relocateFrontAntennaAndShieldToRear();
	}

	/**
	 * Moves any front-mounted high-gain antenna dish or shield that blocks the driver's
	 * first-person sightline to the rear corner of the rover (or hides it if non-detachable).
	 */
	private relocateFrontAntennaAndShieldToRear() {
		if (!this.rover) return;

		this.rover.updateMatrixWorld(true);
		const invRoverMatrix = this.rover.matrixWorld.clone().invert();

		// Protect functional rover nodes so we never alter wheels, seat, lights, or cargo slot
		const protectedNodes = new Set<THREE.Object3D>();
		const protectSubtree = (root: THREE.Object3D | null) => {
			if (!root) return;
			root.traverse((child) => protectedNodes.add(child));
		};
		protectSubtree(this.cargoSlot);
		protectSubtree(this.cargoRackFrame);
		protectSubtree(this.seatAnchor);
		protectSubtree(this.steerFL);
		protectSubtree(this.steerFR);
		for (const w of this.wheels) protectSubtree(w);
		for (const h of this.headlights) {
			protectSubtree(h);
			protectSubtree(h.target);
		}

		const antennaNamePattern =
			/(antenna|dish|comm|radar|mast|shield|reflector|gimbal|sensor|scope|umbrella|canopy|visor|windscreen|windshield)/i;
		const corePartPattern =
			/(chassis|body|frame|wheel|tire|axle|suspension|seat|cargo|light|lamp|fender|bumper)/i;

		const candidates: THREE.Object3D[] = [];
		const box = new THREE.Box3();
		const center = new THREE.Vector3();
		const size = new THREE.Vector3();

		const visit = (node: THREE.Object3D) => {
			if (node !== this.rover) {
				if (protectedNodes.has(node)) return;

				const isNamedAntennaOrShield =
					antennaNamePattern.test(node.name) && !corePartPattern.test(node.name);

				if (isNamedAntennaOrShield) {
					candidates.push(node);
					return;
				}

				if (node instanceof THREE.Mesh && !corePartPattern.test(node.name)) {
					box.setFromObject(node);
					if (!box.isEmpty()) {
						box.applyMatrix4(invRoverMatrix);
						box.getCenter(center);
						box.getSize(size);

						// Compact front-mounted protrusion rising into the driver's windshield line of sight
						const inFrontHalf = center.z * this.forwardSign > 0.05;
						const protrudesIntoView = box.max.y > 0.78 && size.y > 0.22;
						const isCompactAttachment = size.x < 1.15 && size.z < 1.15;

						if (inFrontHalf && protrudesIntoView && isCompactAttachment) {
							candidates.push(node);
							return;
						}
					}
				}
			}

			for (const child of node.children) {
				visit(child);
			}
		};

		visit(this.rover);

		// Relocate each obstructing part to the rear corner behind the cargo rack
		const targetRearX = 0.64 * this.forwardSign;
		const targetRearZ = -1.42 * this.forwardSign;
		const localDelta = new THREE.Vector3();
		const worldDelta = new THREE.Vector3();
		const parentScale = new THREE.Vector3();
		const parentWorldQuat = new THREE.Quaternion();
		const invParentQuat = new THREE.Quaternion();

		for (const part of candidates) {
			this.rover.updateMatrixWorld(true);
			box.setFromObject(part);
			if (box.isEmpty()) {
				part.visible = false;
				continue;
			}
			box.applyMatrix4(invRoverMatrix);
			box.getCenter(center);

			// Only move/remove if it actually sits on the front/mid section near the driver view
			if (center.z * this.forwardSign <= -0.25) continue;

			localDelta.set(targetRearX - center.x, 0, targetRearZ - center.z);
			worldDelta
				.copy(localDelta)
				.transformDirection(this.rover.matrixWorld)
				.multiplyScalar(localDelta.length());

			if (part.parent) {
				part.parent.getWorldQuaternion(parentWorldQuat);
				part.parent.getWorldScale(parentScale);
				invParentQuat.copy(parentWorldQuat).invert();
				worldDelta.applyQuaternion(invParentQuat);
				part.position.x += worldDelta.x / (parentScale.x || 1);
				part.position.z += worldDelta.z / (parentScale.z || 1);
			}

			// Verify it is now cleanly behind the driver; if still forward, hide it completely
			this.rover.updateMatrixWorld(true);
			box.setFromObject(part);
			box.applyMatrix4(invRoverMatrix);
			box.getCenter(center);
			if (center.z * this.forwardSign > -0.35) {
				part.visible = false;
			}
		}
	}

	private getRoverForwardYaw(): number {
		if (!this.rover) return 0;
		return this.rover.rotation.y + (this.forwardSign < 0 ? Math.PI : 0);
	}

	isInBoardingRange(playerPos: THREE.Vector3): boolean {
		if (!this.rover) return false;
		return (
			playerPos.distanceTo(this.rover.position) <= LunarOutpostConfig.physics.interactionRadius
		);
	}

	/**
	 * Checks whether the astronaut is close enough to the rover or its rear cargo rack
	 * to place a carried box onto the top-back of the car (or take one off).
	 */
	isNearCargoRack(playerPos: THREE.Vector3, radius = 3.55): boolean {
		if (!this.rover) return false;
		if (playerPos.distanceTo(this.rover.position) <= radius) return true;

		if (this.cargoSlot) {
			const rackWorld = new THREE.Vector3();
			this.cargoSlot.getWorldPosition(rackWorld);
			if (playerPos.distanceTo(rackWorld) <= 2.55) return true;
		}
		return false;
	}

	isCrateFalling(crate: THREE.Object3D): boolean {
		return this.fallingCrates.some((f) => f.crate === crate);
	}

	/**
	 * Sticks a single box onto the top of the back of the car.
	 * If a box is already attached there, the extra box deflects and falls off to the side of the car.
	 */
	tryPlaceCrateFromAstronaut(
		crate: THREE.Object3D,
		scene: THREE.Object3D,
		world: OutpostWorldBuilder
	): RoverCargoPlacementResult {
		if (!this.rover || !this.cargoSlot) {
			return { accepted: false, message: `Dropped ${crate.name}` };
		}

		// Slot is open: stick the box onto the top-back of the car
		if (!this.loadedCrate) {
			this.attachCrateToRearDeck(crate);
			return {
				accepted: true,
				message: `Secured ${crate.name} onto top-back of Rover (1/1)`
			};
		}

		// Already 1 box on the back of the car: extra box slides/falls off to the side!
		this.launchOverflowCrateToSide(crate, scene, world);
		return {
			accepted: false,
			message: `Rover rack full (1 box max) — ${crate.name} fell off the side!`
		};
	}

	/**
	 * Lets an astronaut on foot take the currently attached box off the back of the rover.
	 */
	takeLoadedCrateForAstronaut(): THREE.Object3D | null {
		if (!this.loadedCrate) return null;
		const crate = this.loadedCrate;
		this.loadedCrate = null;
		this.cargoSnapTimer = 0;
		return crate;
	}

	private attachCrateToRearDeck(crate: THREE.Object3D) {
		if (!this.cargoSlot) return;
		this.cargoSlot.attach(crate);
		crate.position.set(0, 0.36, 0);
		crate.rotation.set(0, 0, 0);
		this.loadedCrate = crate;
		this.cargoSnapTimer = 0.28;
	}

	private resolveRootObject(obj: THREE.Object3D | null): THREE.Object3D | null {
		let cur = obj;
		while (cur?.parent) {
			cur = cur.parent;
		}
		return cur;
	}

	/**
	 * Detaches an extra crate at the occupied top-back rack and sends it tumbling
	 * off to the left or right side of the rover onto the lunar surface.
	 */
	private launchOverflowCrateToSide(
		crate: THREE.Object3D,
		parentScene: THREE.Object3D,
		world: OutpostWorldBuilder
	) {
		if (!this.rover || !this.cargoSlot) return;

		this.rover.updateMatrixWorld(true);
		const rackWorld = new THREE.Vector3();
		this.cargoSlot.getWorldPosition(rackWorld);

		// Place right above the occupied top-back cargo spot before sliding off
		parentScene.attach(crate);
		crate.position.set(rackWorld.x, rackWorld.y + 0.68, rackWorld.z);
		crate.rotation.set(0, this.rover.rotation.y, 0);

		const roverRight = new THREE.Vector3(-this.forwardSign, 0, 0)
			.applyQuaternion(this.rover.quaternion)
			.setY(0)
			.normalize();
		const roverForward = new THREE.Vector3(0, 0, this.forwardSign)
			.applyQuaternion(this.rover.quaternion)
			.setY(0)
			.normalize();

		// Alternate left/right side off the rover
		const sideDir = this.nextFallSide;
		this.nextFallSide = sideDir === 1 ? -1 : 1;

		const lateralSpeed = 2.65 + Math.random() * 0.45;
		const velocity = new THREE.Vector3()
			.addScaledVector(roverRight, sideDir * lateralSpeed)
			.addScaledVector(roverForward, -0.55)
			.add(new THREE.Vector3(0, 1.35, 0));

		// Ensure target landing zone isn't below terrain
		const projectedX = crate.position.x + velocity.x * 0.65;
		const projectedZ = crate.position.z + velocity.z * 0.65;
		const groundHit = world.sampleSurfaceAt(projectedX, projectedZ);
		if (crate.position.y < groundHit.y + 0.6) {
			crate.position.y = groundHit.y + 0.65;
		}

		this.fallingCrates = this.fallingCrates.filter((f) => f.crate !== crate);
		this.fallingCrates.push({
			crate,
			velocity,
			rollSpeed: -sideDir * 4.4,
			pitchSpeed: 1.5,
			ageSec: 0
		});
	}

	toggleEnterExit(
		playerObject: THREE.Object3D,
		world: OutpostWorldBuilder,
		scene?: THREE.Object3D
	): boolean {
		if (!this.rover) return false;

		if (!this.isSeated) {
			if (!this.isInBoardingRange(playerObject.position)) return false;

			// If the astronaut is carrying a box while boarding, either stick it to the back
			// of the car (if empty) or let it fall off to the side (if 1 box is already there)
			const astronaut = world.astronautController;
			if (astronaut?.carryingCrate) {
				const heldCrate = astronaut.carryingCrate;
				astronaut.carryingCrate = null;
				const targetScene = scene ?? this.resolveRootObject(this.rover);
				if (!this.loadedCrate) {
					this.attachCrateToRearDeck(heldCrate);
				} else if (targetScene) {
					this.launchOverflowCrateToSide(heldCrate, targetScene, world);
				}
			}

			// Reset camera look offset so driver always faces straight forward toward the front of the rover
			this.boardingYawBaseline = null;
			if (astronaut) {
				astronaut.yawRad = 0;
				astronaut.pitchRad = -0.05;
				astronaut.root.visible = false;
			}

			// Hide player character mesh while seated inside the rover
			playerObject.visible = false;
			this.isSeated = true;
			return true;
		}

		this.isSeated = false;
		this.speedMs = 0;
		this.boardingYawBaseline = null;

		const exitPos = new THREE.Vector3(2.3 * this.forwardSign, 0, 0)
			.applyQuaternion(this.rover.quaternion)
			.add(this.rover.position);
		const hit = world.sampleSurfaceAt(exitPos.x, exitPos.z);
		playerObject.position.set(exitPos.x, hit.y, exitPos.z);

		// Restore player character visibility upon exiting the rover
		playerObject.visible = true;
		if (world.astronautController) {
			world.astronautController.root.visible = true;
			world.astronautController.yawRad = this.getRoverForwardYaw();
			world.astronautController.pitchRad = 0;
		}
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
		scene: THREE.Object3D,
		world: OutpostWorldBuilder
	): string | null {
		if (!this.rover || !this.cargoSlot) return null;

		if (this.loadedCrate) {
			// If parked at an active drop-off ring, unload directly onto that ring's center
			const nearbyZone = world.findDropOffZoneNear(
				this.rover.position,
				LunarOutpostConfig.physics.crateDeliverRadius,
				true
			);

			const sideDrop = nearbyZone
				? nearbyZone.position.clone()
				: new THREE.Vector3(-2.2 * this.forwardSign, 0, -0.5 * this.forwardSign)
						.applyQuaternion(this.rover.quaternion)
						.add(this.rover.position);
			const hit = world.sampleSurfaceAt(sideDrop.x, sideDrop.z);

			scene.attach(this.loadedCrate);
			this.loadedCrate.position.set(sideDrop.x, hit.y + 0.39, sideDrop.z);
			this.loadedCrate.rotation.set(0, nearbyZone ? 0 : this.getRoverForwardYaw(), 0);

			const name = this.loadedCrate.name;
			this.loadedCrate = null;
			return `Unloaded ${name}`;
		}

		let closest: THREE.Object3D | null = null;
		let bestDist = 4.8;
		const cratePos = new THREE.Vector3();

		for (const crate of crates) {
			if (crate.userData?.delivered) continue;
			if (this.isCrateFalling(crate)) continue;
			crate.getWorldPosition(cratePos);
			const d = cratePos.distanceTo(this.rover.position);
			if (d < bestDist) {
				bestDist = d;
				closest = crate;
			}
		}

		if (closest) {
			this.attachCrateToRearDeck(closest);
			return `Loaded ${closest.name} onto top-back of Rover`;
		}
		return null;
	}

	applyFirstPersonDriverCamera(
		camera: THREE.PerspectiveCamera,
		headYawOffsetRad: number,
		headPitchRad: number
	): boolean {
		if (!this.isSeated || !this.rover) return false;

		// Capture baseline yaw on first seated frame so driver starts facing straight forward
		if (this.boardingYawBaseline === null) {
			this.boardingYawBaseline = headYawOffsetRad;
		}

		// Relative head turn clamped to ±115° so driver looks ahead over the front hood, not backward at the cargo box
		const relativeHeadYaw = THREE.MathUtils.clamp(
			normalizeAngleRad(headYawOffsetRad - this.boardingYawBaseline),
			-2.0,
			2.0
		);
		const clampedPitch = THREE.MathUtils.clamp(headPitchRad, -0.75, 0.85);

		this.rover.updateMatrixWorld(true);
		const eyeWorld = new THREE.Vector3();
		if (this.seatAnchor) {
			this.seatAnchor.getWorldPosition(eyeWorld);
			const upOffset = new THREE.Vector3(0, 0.68, 0.08 * this.forwardSign).applyQuaternion(
				this.rover.quaternion
			);
			eyeWorld.add(upOffset);
		} else {
			eyeWorld
				.set(-0.46 * this.forwardSign, 1.32, 0.28 * this.forwardSign)
				.applyMatrix4(this.rover.matrixWorld);
		}
		camera.position.copy(eyeWorld);

		// Subtle look-into-turn assistance when steering forward
		const turnLookAssist = this.speedMs >= -0.05 ? this.steerAngleRad * 0.2 : 0;
		const totalYaw = this.getRoverForwardYaw() + relativeHeadYaw + turnLookAssist;

		const lookDir = new THREE.Vector3(
			Math.sin(totalYaw) * Math.cos(clampedPitch),
			Math.sin(clampedPitch),
			Math.cos(totalYaw) * Math.cos(clampedPitch)
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
		this.updateFallingOverflowCrates(dt, world, collisions);

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

		// Magnetic snap-stick settle animation on the top-back cargo mount
		if (this.loadedCrate && this.cargoSnapTimer > 0) {
			this.cargoSnapTimer = Math.max(0, this.cargoSnapTimer - dt);
			const t = this.cargoSnapTimer / 0.28;
			this.loadedCrate.position.set(0, 0.36 + Math.sin(t * Math.PI) * 0.14, 0);
			this.loadedCrate.rotation.set(0, 0, 0);
		}

		if (this.cargoRackFrame) {
			const mat = this.cargoRackFrame.material as THREE.MeshBasicMaterial;
			if (this.loadedCrate) {
				mat.color.setHex(0x10b981);
				mat.opacity = 0.78;
			} else {
				mat.color.setHex(0xfacc15);
				mat.opacity = 0.45;
			}
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

			const forward = new THREE.Vector3(0, 0, this.forwardSign).applyAxisAngle(
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

				collisions.resolveHorizontal(this.rover.position, 1.38, 1.8, {
					includeRover: false,
					ignoredCrate: this.loadedCrate
				});

				const groundAtResolved = world.sampleSurfaceAt(
					this.rover.position.x,
					this.rover.position.z
				);
				this.rover.position.y = groundAtResolved.y + 0.54;
				this.smoothedNormal.lerp(groundAtResolved.normal, Math.min(1, dt * 8.0)).normalize();

				const movedDist = Math.hypot(this.rover.position.x - prevX, this.rover.position.z - prevZ);
				if (movedDist < stepDist * 0.35) {
					this.speedMs *= 0.25;
				}
			} else {
				this.speedMs = 0;
			}

			const wheelSpin =
				((this.speedMs * dt) / LunarOutpostConfig.rover.wheelRadiusM) * this.forwardSign;
			for (const wheel of this.wheels) {
				wheel.rotation.x += wheelSpin;
			}
		}

		// Gently align chassis pitch & roll with smoothed lunar regolith slope
		const yaw = this.rover.rotation.y;
		const localNormalX =
			this.smoothedNormal.x * Math.cos(yaw) - this.smoothedNormal.z * Math.sin(yaw);
		const localNormalZ =
			this.smoothedNormal.x * Math.sin(yaw) + this.smoothedNormal.z * Math.cos(yaw);
		this.rover.rotation.x = THREE.MathUtils.clamp(
			Math.atan2(localNormalZ, this.smoothedNormal.y),
			-0.32,
			0.32
		);
		this.rover.rotation.z = THREE.MathUtils.clamp(
			-Math.atan2(localNormalX, this.smoothedNormal.y),
			-0.32,
			0.32
		);

		if (this.isSeated) {
			playerObject.visible = false;
			if (this.seatAnchor) {
				this.seatAnchor.getWorldPosition(playerObject.position);
				playerObject.position.y -= 0.4;
				playerObject.rotation.y = this.getRoverForwardYaw();
			}
		}

		return {
			isSeated: this.isSeated,
			canBoard: !this.isSeated && this.isInBoardingRange(playerObject.position),
			speedKmh: Math.abs(this.speedMs * 3.6),
			headingDeg: Math.round(
				((THREE.MathUtils.radToDeg(this.getRoverForwardYaw()) % 360) + 360) % 360
			),
			batteryPct: Math.round(this.batteryPct),
			headlightsOn: this.headlightsOn,
			surfaceType: this.currentSurface,
			loadedCrateName: this.loadedCrate?.name ?? null
		};
	}

	private updateFallingOverflowCrates(
		dt: number,
		world: OutpostWorldBuilder,
		collisions: OutpostCollisionSystem
	) {
		if (this.fallingCrates.length === 0) return;

		const fallGravity = 4.6;
		for (let i = this.fallingCrates.length - 1; i >= 0; i--) {
			const item = this.fallingCrates[i];
			item.ageSec += dt;

			item.velocity.y -= fallGravity * dt;
			item.crate.position.addScaledVector(item.velocity, dt);
			item.crate.rotation.z += item.rollSpeed * dt;
			item.crate.rotation.x += item.pitchSpeed * dt;

			const ground = world.sampleSurfaceAt(item.crate.position.x, item.crate.position.z);
			const restY = ground.y + 0.39;

			if (item.crate.position.y <= restY || item.ageSec > 2.5) {
				item.crate.position.y = restY;
				item.crate.rotation.x = 0;
				item.crate.rotation.z = 0;

				collisions.resolveHorizontal(item.crate.position, 0.56, 0.85, {
					roverObj: this.rover,
					includeRover: true,
					ignoredCrate: item.crate
				});
				const settledGround = world.sampleSurfaceAt(item.crate.position.x, item.crate.position.z);
				item.crate.position.y = settledGround.y + 0.39;

				this.fallingCrates.splice(i, 1);
			}
		}
	}
}
