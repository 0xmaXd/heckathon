import * as THREE from 'three';
import { LunarOutpostConfig } from '../lunar-outpost.config';
import { characterModelLoader } from './CharacterModelLoader';
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
	private suitVisual: THREE.Group | null = null;

	async init(scene: THREE.Scene, spawnX: number, spawnZ: number, world: OutpostWorldBuilder) {
		this.suitVisual = await characterModelLoader.createEvaSuitInstance({
			accentHex: 0xe6480d, // Artemis Orange-Red stripe for Player
			hideVisorForFirstPerson: true
		});
		this.root.add(this.suitVisual);

		const hit = world.sampleSurfaceAt(spawnX, spawnZ);
		this.root.position.set(spawnX, hit.y, spawnZ);
		this.root.name = 'EVA_Astronaut_Player';
		scene.add(this.root);
	}

	pickUpOrDropCrate(
		crates: THREE.Object3D[],
		scene: THREE.Scene,
		world: OutpostWorldBuilder
	): string | null {
		if (this.carryingCrate) {
			// If standing inside an active drop-off ring, drop directly onto that zone's center
			const nearbyZone = world.findDropOffZoneNear(
				this.root.position,
				LunarOutpostConfig.physics.crateDeliverRadius,
				true
			);

			const dropPos = nearbyZone
				? nearbyZone.position.clone()
				: new THREE.Vector3(0, 0, 1.35)
						.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.root.rotation.y)
						.add(this.root.position);
			const hit = world.sampleSurfaceAt(dropPos.x, dropPos.z);

			scene.attach(this.carryingCrate);
			this.carryingCrate.position.set(dropPos.x, hit.y + 0.39, dropPos.z);
			this.carryingCrate.rotation.set(0, nearbyZone ? 0 : this.root.rotation.y, 0);

			const droppedName = this.carryingCrate.name;
			this.carryingCrate = null;
			return `Placed ${droppedName}`;
		}

		let closest: THREE.Object3D | null = null;
		let bestDist = LunarOutpostConfig.physics.interactionRadius;
		const cratePos = new THREE.Vector3();

		for (const crate of crates) {
			if (crate.userData?.delivered) continue;
			crate.getWorldPosition(cratePos);
			const d = cratePos.distanceTo(this.root.position);
			if (d < bestDist) {
				bestDist = d;
				closest = crate;
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

		if (this.suitVisual) {
			this.suitVisual.position.y =
				isMoving && this.isGrounded ? Math.abs(Math.sin(this.walkCycle)) * 0.035 : 0;
		}
	}

	applyFirstPersonCamera(camera: THREE.PerspectiveCamera) {
		const bobY = Math.abs(Math.sin(this.walkCycle)) * 0.04;
		const eyeOffset = new THREE.Vector3(0, 1.66 + bobY, 0.25).applyAxisAngle(
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
