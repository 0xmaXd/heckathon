import * as THREE from 'three';
import { LunarOutpostConfig } from '../lunar-outpost.config';
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
	private headGroup!: THREE.Group;
	private leftLeg!: THREE.Mesh;
	private rightLeg!: THREE.Mesh;
	private leftArm!: THREE.Mesh;
	private rightArm!: THREE.Mesh;

	init(scene: THREE.Scene, spawnX: number, spawnZ: number, world: OutpostWorldBuilder) {
		this.buildAstronautMesh();
		const hit = world.sampleSurfaceAt(spawnX, spawnZ);
		this.root.position.set(spawnX, hit.y, spawnZ);
		this.root.name = 'EVA_Astronaut_Player';
		scene.add(this.root);
	}

	private buildAstronautMesh() {
		const suitMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.42 });
		const trimMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.58 });
		const dcmMat = new THREE.MeshStandardMaterial({
			color: 0xd97706,
			metalness: 0.65,
			roughness: 0.3
		});
		const visorMat = new THREE.MeshStandardMaterial({
			color: 0xf59e0b,
			metalness: 0.92,
			roughness: 0.12
		});

		const torso = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.66, 0.3), suitMat);
		torso.position.set(0, 1.12, -0.02);
		torso.castShadow = true;
		this.root.add(torso);

		const chestDcm = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.12), dcmMat);
		chestDcm.position.set(0, 1.24, 0.17);
		this.root.add(chestDcm);

		const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.58, 0.24), suitMat);
		backpack.position.set(0, 1.16, -0.26);
		backpack.castShadow = true;
		this.root.add(backpack);

		this.headGroup = new THREE.Group();
		this.headGroup.position.set(0, 1.66, -0.08);
		const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), suitMat);
		helmet.castShadow = true;
		this.headGroup.add(helmet);

		const visor = new THREE.Mesh(
			new THREE.SphereGeometry(0.18, 14, 12, 0, Math.PI, 0.25, Math.PI * 0.55),
			visorMat
		);
		visor.position.z = 0.03;
		this.headGroup.add(visor);
		this.root.add(this.headGroup);

		const legGeo = new THREE.BoxGeometry(0.17, 0.72, 0.2);
		this.leftLeg = new THREE.Mesh(legGeo, trimMat);
		this.leftLeg.position.set(-0.14, 0.38, 0.02);
		this.leftLeg.castShadow = true;
		this.root.add(this.leftLeg);

		this.rightLeg = new THREE.Mesh(legGeo, trimMat);
		this.rightLeg.position.set(0.14, 0.38, 0.02);
		this.rightLeg.castShadow = true;
		this.root.add(this.rightLeg);

		const armGeo = new THREE.BoxGeometry(0.14, 0.56, 0.15);
		this.leftArm = new THREE.Mesh(armGeo, suitMat);
		this.leftArm.position.set(-0.34, 1.12, 0.05);
		this.leftArm.castShadow = true;
		this.root.add(this.leftArm);

		this.rightArm = new THREE.Mesh(armGeo, suitMat);
		this.rightArm.position.set(0.34, 1.12, 0.05);
		this.rightArm.castShadow = true;
		this.root.add(this.rightArm);
	}

	pickUpOrDropCrate(
		crates: THREE.Object3D[],
		scene: THREE.Scene,
		world: OutpostWorldBuilder
	): string | null {
		if (this.carryingCrate) {
			const dropPos = new THREE.Vector3(0, 0, 1.45)
				.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.root.rotation.y)
				.add(this.root.position);
			const hit = world.sampleSurfaceAt(dropPos.x, dropPos.z);

			scene.attach(this.carryingCrate);
			this.carryingCrate.position.set(dropPos.x, hit.y + 0.39, dropPos.z);
			this.carryingCrate.rotation.set(0, this.root.rotation.y, 0);

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
		// Fixed: KeyA = Left (-1), KeyD = Right (+1) along right-hand vector
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

		// Resolve solid obstacle collisions (buildings, domes, tanks, panels, crates, rover)
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

		const swing = isMoving && this.isGrounded ? Math.sin(this.walkCycle) * 0.55 : 0;
		this.leftLeg.rotation.x = swing;
		this.rightLeg.rotation.x = -swing;
		this.leftArm.rotation.x = this.carryingCrate ? -0.95 : -0.25 - swing * 0.55;
		this.rightArm.rotation.x = this.carryingCrate ? -0.95 : -0.25 + swing * 0.55;
	}

	applyFirstPersonCamera(camera: THREE.PerspectiveCamera) {
		const bobY = Math.abs(Math.sin(this.walkCycle)) * 0.04;
		const eyeOffset = new THREE.Vector3(0, 1.66 + bobY, 0.16).applyAxisAngle(
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
