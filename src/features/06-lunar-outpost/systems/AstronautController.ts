import * as THREE from 'three';
import { LunarOutpostConfig } from '../lunar-outpost.config';
import { characterModelLoader, type EvaSuitRigRefs } from './CharacterModelLoader';
import type { OrionRoverSystem } from './OrionRoverSystem';
import type { OutpostCollisionSystem } from './OutpostCollisionSystem';
import type { OutpostWorldBuilder } from './OutpostWorldBuilder';

export class AstronautController {
	public readonly root = new THREE.Group();
	public yawRad = Math.PI;
	public pitchRad = 0.0;
	public carryingCrate: THREE.Object3D | null = null;

	private velocityY = 0;
	private isGrounded = true;
	private walkCycle = 0;
	private bobAmount = 0;
	private suitVisual: THREE.Group | null = null;
	private suitRig: EvaSuitRigRefs | null = null;

	async init(scene: THREE.Scene, spawnX: number, spawnZ: number, world: OutpostWorldBuilder) {
		world.astronautController = this;
		this.suitVisual = await characterModelLoader.createEvaSuitInstance({
			accentHex: 0xe6480d, // Artemis Orange-Red stripe for Player
			hideVisorForFirstPerson: true
		});
		this.suitRig = (this.suitVisual.userData?.rig as EvaSuitRigRefs) ?? null;
		this.root.add(this.suitVisual);

		const hit = world.sampleSurfaceAt(spawnX, spawnZ);
		this.root.position.set(spawnX, hit.y, spawnZ);
		this.root.name = 'EVA_Astronaut_Player';
		scene.add(this.root);
	}

	pickUpOrDropCrate(
		crates: THREE.Object3D[],
		scene: THREE.Scene,
		world: OutpostWorldBuilder,
		rover?: OrionRoverSystem
	): string | null {
		const activeRover = rover ?? world.roverSystem ?? null;

		if (this.carryingCrate) {
			const heldCrate = this.carryingCrate;

			// 1. Check if standing near the Rover's rear cargo rack to stick the box onto the car
			const nearbyZone = world.findDropOffZoneNear(
				this.root.position,
				LunarOutpostConfig.physics.crateDeliverRadius,
				true
			);
			const nearRover = activeRover?.isNearCargoRack(this.root.position) ?? false;

			let preferRover = nearRover;
			if (nearRover && nearbyZone && activeRover?.rover) {
				const distToZone = Math.hypot(
					this.root.position.x - nearbyZone.position.x,
					this.root.position.z - nearbyZone.position.z
				);
				const distToRover = this.root.position.distanceTo(activeRover.rover.position);
				preferRover = distToRover <= distToZone;
			}

			if (preferRover && activeRover) {
				this.carryingCrate = null;
				const result = activeRover.tryPlaceCrateFromAstronaut(heldCrate, scene, world);
				return result.message;
			}

			// 2. Otherwise drop onto a station drop-off zone or onto the lunar regolith in front
			const dropPos = nearbyZone
				? nearbyZone.position.clone()
				: new THREE.Vector3(0, 0, 1.35)
						.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.root.rotation.y)
						.add(this.root.position);
			const hit = world.sampleSurfaceAt(dropPos.x, dropPos.z);

			scene.attach(heldCrate);
			heldCrate.position.set(dropPos.x, hit.y + 0.39, dropPos.z);
			heldCrate.rotation.set(0, nearbyZone ? 0 : this.root.rotation.y, 0);

			const droppedName = heldCrate.name;
			this.carryingCrate = null;
			return `Placed ${droppedName}`;
		}

		// Find closest loose crate on the ground
		let closest: THREE.Object3D | null = null;
		let bestDist = LunarOutpostConfig.physics.interactionRadius;
		const cratePos = new THREE.Vector3();

		for (const crate of crates) {
			if (crate.userData?.delivered) continue;
			if (activeRover?.isCrateFalling(crate)) continue;
			if (crate === activeRover?.loadedCrate) continue;
			crate.getWorldPosition(cratePos);
			const d = cratePos.distanceTo(this.root.position);
			if (d < bestDist) {
				bestDist = d;
				closest = crate;
			}
		}

		// If standing near the Rover and it has a box stuck on its rear rack, allow taking it off
		if (!closest && activeRover?.loadedCrate && activeRover.isNearCargoRack(this.root.position)) {
			const taken = activeRover.takeLoadedCrateForAstronaut();
			if (taken) {
				this.root.attach(taken);
				taken.position.set(0, 0.92, 0.78);
				taken.rotation.set(0, 0, 0);
				this.carryingCrate = taken;
				return `Took ${taken.name} from Rover rear rack`;
			}
		}

		if (closest) {
			this.root.attach(closest);
			closest.position.set(0, 0.92, 0.78);
			closest.rotation.set(0, 0, 0);
			this.carryingCrate = closest;
			return `Carrying ${closest.name}`;
		}
		return null;
	}

	updateOnFoot(
		dt: number,
		keys: Set<string>,
		world: OutpostWorldBuilder,
		collisions: OutpostCollisionSystem,
		roverObj: THREE.Object3D | null
	) {
		const { evaWalkSpeed, evaSprintSpeed, evaJumpVelocity, lunarGravity } =
			LunarOutpostConfig.physics;

		this.root.rotation.y = this.yawRad;

		let forwardInput = 0;
		let strafeInput = 0;
		if (keys.has('KeyW') || keys.has('ArrowUp')) forwardInput += 1;
		if (keys.has('KeyS') || keys.has('ArrowDown')) forwardInput -= 1;
		if (keys.has('KeyA') || keys.has('ArrowLeft')) strafeInput -= 1;
		if (keys.has('KeyD') || keys.has('ArrowRight')) strafeInput += 1;

		const forward = new THREE.Vector3(Math.sin(this.yawRad), 0, Math.cos(this.yawRad));
		const right = new THREE.Vector3(-forward.z, 0, forward.x);

		const moveDir = new THREE.Vector3()
			.addScaledVector(forward, forwardInput)
			.addScaledVector(right, strafeInput);
		const isMoving = moveDir.lengthSq() > 0.001;

		if (isMoving) {
			moveDir.normalize();
			const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? evaSprintSpeed : evaWalkSpeed;
			this.root.position.x = THREE.MathUtils.clamp(
				this.root.position.x + moveDir.x * speed * dt,
				-215,
				215
			);
			this.root.position.z = THREE.MathUtils.clamp(
				this.root.position.z + moveDir.z * speed * dt,
				-215,
				215
			);
			this.walkCycle += dt * (speed * 2.1);
		} else {
			this.walkCycle = 0;
		}

		collisions.resolveHorizontal(this.root.position, 0.44, 1.8, {
			roverObj,
			includeRover: true,
			ignoredCrate: this.carryingCrate
		});

		if (keys.has('Space') && this.isGrounded) {
			this.velocityY = evaJumpVelocity;
			this.isGrounded = false;
		}

		const ground = world.sampleSurfaceAt(this.root.position.x, this.root.position.z);
		this.velocityY -= lunarGravity * dt;
		this.root.position.y += this.velocityY * dt;

		if (this.root.position.y <= ground.y) {
			this.root.position.y = ground.y;
			this.velocityY = 0;
			this.isGrounded = true;
		}

		const targetBob = isMoving && this.isGrounded ? Math.abs(Math.sin(this.walkCycle)) * 0.038 : 0;
		this.bobAmount = THREE.MathUtils.lerp(this.bobAmount, targetBob, Math.min(1, dt * 14));

		if (this.suitVisual) {
			this.suitVisual.position.y = this.bobAmount;
		}

		if (this.carryingCrate) {
			this.carryingCrate.position.y = 0.92 + this.bobAmount * 0.65;
		}

		this.animateSuitLimbs(isMoving);
	}

	private animateSuitLimbs(isMoving: boolean) {
		if (!this.suitRig) return;
		const {
			leftUpperArm,
			rightUpperArm,
			leftForearm,
			rightForearm,
			leftThigh,
			rightThigh,
			restRotations
		} = this.suitRig;

		const swing = isMoving && this.isGrounded ? Math.sin(this.walkCycle) * 0.45 : 0;

		if (leftThigh) {
			const rest = restRotations.get(leftThigh);
			leftThigh.rotation.x = (rest?.x ?? 0) + swing;
		}
		if (rightThigh) {
			const rest = restRotations.get(rightThigh);
			rightThigh.rotation.x = (rest?.x ?? 0) - swing;
		}

		if (this.carryingCrate) {
			// Hold arms forward supporting the supply crate
			if (leftUpperArm) {
				const rest = restRotations.get(leftUpperArm);
				leftUpperArm.rotation.x = (rest?.x ?? 0) - 0.72;
			}
			if (rightUpperArm) {
				const rest = restRotations.get(rightUpperArm);
				rightUpperArm.rotation.x = (rest?.x ?? 0) - 0.72;
			}
			if (leftForearm) {
				const rest = restRotations.get(leftForearm);
				leftForearm.rotation.x = (rest?.x ?? 0) - 0.45;
			}
			if (rightForearm) {
				const rest = restRotations.get(rightForearm);
				rightForearm.rotation.x = (rest?.x ?? 0) - 0.45;
			}
		} else {
			if (leftUpperArm) {
				const rest = restRotations.get(leftUpperArm);
				leftUpperArm.rotation.x = (rest?.x ?? 0) - swing * 0.65;
			}
			if (rightUpperArm) {
				const rest = restRotations.get(rightUpperArm);
				rightUpperArm.rotation.x = (rest?.x ?? 0) + swing * 0.65;
			}
			if (leftForearm) {
				const rest = restRotations.get(leftForearm);
				leftForearm.rotation.x = (rest?.x ?? 0) - 0.15;
			}
			if (rightForearm) {
				const rest = restRotations.get(rightForearm);
				rightForearm.rotation.x = (rest?.x ?? 0) - 0.15;
			}
		}
	}

	applyFirstPersonCamera(camera: THREE.PerspectiveCamera) {
		const eyeOffset = new THREE.Vector3(0, 1.66 + this.bobAmount, 0.25).applyAxisAngle(
			new THREE.Vector3(0, 1, 0),
			this.yawRad
		);
		camera.position.copy(this.root.position).add(eyeOffset);

		const lookDir = new THREE.Vector3(
			Math.sin(this.yawRad) * Math.cos(this.pitchRad),
			Math.sin(this.pitchRad),
			Math.cos(this.yawRad) * Math.cos(this.pitchRad)
		);
		camera.lookAt(camera.position.clone().add(lookDir));
	}
}
