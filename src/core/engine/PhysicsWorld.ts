import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GameConfig } from '../../config/game.config';

interface TrackedBody {
	handle: RAPIER.RigidBodyHandle;
	object: THREE.Object3D;
	prevPos: THREE.Vector3;
	currPos: THREE.Vector3;
	prevRot: THREE.Quaternion;
	currRot: THREE.Quaternion;
}

export interface SensorCallbacks {
	onEnter?: () => void;
	onExit?: () => void;
}

export class PhysicsWorld {
	private isInitialized = false;
	private world: RAPIER.World | null = null;
	private eventQueue: RAPIER.EventQueue | null = null;
	private clock = new THREE.Timer();
	private accumulator = 0;

	private readonly fixedStep = GameConfig.physics.fixedTimeStep;
	private dynamicBodies = new Map<RAPIER.RigidBodyHandle, TrackedBody>();
	private sensors = new Map<RAPIER.ColliderHandle, SensorCallbacks>();

	// Player interpolation state for jitter-free rendering at any refresh rate
	private playerBody: RAPIER.RigidBody | null = null;
	private playerPrevPos = new THREE.Vector3();
	private playerCurrPos = new THREE.Vector3();

	async init(gravity = GameConfig.physics.gravityEarth) {
		if (this.isInitialized) return;

		await RAPIER.init();
		this.world = new RAPIER.World({ x: 0, y: this.normalizeGravityY(gravity), z: 0 });
		this.world.timestep = this.fixedStep;
		this.eventQueue = new RAPIER.EventQueue(true);
		this.isInitialized = true;
	}

	private normalizeGravityY(gravity: number): number {
		return gravity > 0 ? -gravity : gravity;
	}

	setGravity(gravity: number) {
		if (!this.world) return;
		this.world.gravity = { x: 0, y: this.normalizeGravityY(gravity), z: 0 };
	}

	/**
	 * Clears all bodies, colliders, and sensors when switching between phases.
	 */
	reset(gravity = GameConfig.physics.gravityEarth) {
		if (!this.isInitialized) return;

		this.dynamicBodies.clear();
		this.sensors.clear();
		this.playerBody = null;
		this.accumulator = 0;

		this.eventQueue?.free();
		this.world?.free();

		this.world = new RAPIER.World({ x: 0, y: this.normalizeGravityY(gravity), z: 0 });
		this.world.timestep = this.fixedStep;
		this.eventQueue = new RAPIER.EventQueue(true);
	}

	/**
	 * Registers an immovable collider (floors, walls, lockers, terminals).
	 * Zero per-frame physics calculation cost.
	 */
	addFixedBox(
		halfExtents: [number, number, number],
		position: [number, number, number],
		quaternion?: THREE.Quaternion
	): RAPIER.RigidBody | null {
		if (!this.world) return null;

		const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(...position);
		if (quaternion) {
			bodyDesc.setRotation({
				x: quaternion.x,
				y: quaternion.y,
				z: quaternion.z,
				w: quaternion.w
			});
		}

		const body = this.world.createRigidBody(bodyDesc);
		const colliderDesc = RAPIER.ColliderDesc.cuboid(...halfExtents).setFriction(0.8);
		this.world.createCollider(colliderDesc, body);

		return body;
	}

	/**
	 * Registers a non-solid trigger volume that fires callbacks when a dynamic body enters/exits.
	 */
	addSensorBox(
		halfExtents: [number, number, number],
		position: [number, number, number],
		callbacks: SensorCallbacks
	): RAPIER.Collider | null {
		if (!this.world) return null;

		const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(...position);
		const body = this.world.createRigidBody(bodyDesc);
		const colliderDesc = RAPIER.ColliderDesc.cuboid(...halfExtents)
			.setSensor(true)
			.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

		const collider = this.world.createCollider(colliderDesc, body);
		this.sensors.set(collider.handle, callbacks);

		return collider;
	}

	/**
	 * Registers a dynamic box and automatically syncs its Three.js Object3D each frame.
	 */
	addDynamicBox(
		object: THREE.Object3D,
		halfExtents: [number, number, number],
		options: { mass?: number; restitution?: number; friction?: number; linearDamping?: number } = {}
	): RAPIER.RigidBody | null {
		if (!this.world) return null;

		const { x, y, z } = object.position;
		const q = object.quaternion;

		const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
			.setTranslation(x, y, z)
			.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
			.setLinearDamping(options.linearDamping ?? 0.05);

		const body = this.world.createRigidBody(bodyDesc);
		const colliderDesc = RAPIER.ColliderDesc.cuboid(...halfExtents)
			.setRestitution(options.restitution ?? 0.2)
			.setFriction(options.friction ?? 0.6);

		if (options.mass !== undefined) {
			colliderDesc.setMass(options.mass);
		}

		this.world.createCollider(colliderDesc, body);
		this.dynamicBodies.set(body.handle, {
			handle: body.handle,
			object,
			prevPos: new THREE.Vector3(x, y, z),
			currPos: new THREE.Vector3(x, y, z),
			prevRot: q.clone(),
			currRot: q.clone()
		});

		return body;
	}

	/**
	 * Creates an upright capsule rigid body with locked rotation for the player.
	 * Friction is set to 0 so the player glides smoothly along walls and lockers.
	 */
	addPlayerCapsule(
		radius: number,
		halfHeight: number,
		position: [number, number, number]
	): RAPIER.RigidBody | null {
		if (!this.world) return null;

		const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
			.setTranslation(...position)
			.lockRotations()
			.setLinearDamping(0.0);

		const body = this.world.createRigidBody(bodyDesc);
		const colliderDesc = RAPIER.ColliderDesc.capsule(halfHeight, radius)
			.setFriction(0.0)
			.setRestitution(0.0);

		this.world.createCollider(colliderDesc, body);

		this.playerBody = body;
		this.playerPrevPos.set(...position);
		this.playerCurrPos.set(...position);

		return body;
	}

	/**
	 * Returns the render-interpolated player center position between fixed physics steps.
	 */
	getInterpolatedPlayerPosition(out = new THREE.Vector3()): THREE.Vector3 | null {
		if (!this.playerBody) return null;
		const alpha = Math.min(1, Math.max(0, this.accumulator / this.fixedStep));
		return out.lerpVectors(this.playerPrevPos, this.playerCurrPos, alpha);
	}

	/**
	 * Casts a short ray straight down from the body center (excluding the body itself)
	 * to check if the player is standing on a surface.
	 */
	isBodyGrounded(body: RAPIER.RigidBody, maxDistance: number): boolean {
		if (!this.world) return false;

		const pos = body.translation();
		const ray = new RAPIER.Ray({ x: pos.x, y: pos.y, z: pos.z }, { x: 0, y: -1, z: 0 });
		const hit = this.world.castRay(ray, maxDistance, true, undefined, undefined, undefined, body);

		return hit !== null;
	}

	removeBody(body: RAPIER.RigidBody) {
		if (!this.world) return;
		if (this.playerBody?.handle === body.handle) {
			this.playerBody = null;
		}
		this.dynamicBodies.delete(body.handle);
		if (this.world.getRigidBody(body.handle)) {
			this.world.removeRigidBody(body);
		}
	}

	get rawWorld(): RAPIER.World | null {
		return this.world;
	}

	step(rawDelta?: number) {
		if (!this.isInitialized || !this.world || !this.eventQueue) return;

		this.clock.update();
		const delta = Math.min(rawDelta ?? this.clock.getDelta(), 0.1);
		this.accumulator += delta;

		while (this.accumulator >= this.fixedStep) {
			// 1. Snapshot positions prior to stepping the simulation
			if (this.playerBody) {
				const t = this.playerBody.translation();
				this.playerPrevPos.set(t.x, t.y, t.z);
			}

			for (const [handle, tracked] of this.dynamicBodies) {
				const body = this.world.getRigidBody(handle);
				if (!body) continue;
				const pos = body.translation();
				const rot = body.rotation();
				tracked.prevPos.set(pos.x, pos.y, pos.z);
				tracked.prevRot.set(rot.x, rot.y, rot.z, rot.w);
			}

			// 2. Advance Rapier by one fixed 1/60s step
			this.world.step(this.eventQueue);

			// 3. Snapshot post-step positions
			if (this.playerBody) {
				const t = this.playerBody.translation();
				this.playerCurrPos.set(t.x, t.y, t.z);
			}

			for (const [handle, tracked] of this.dynamicBodies) {
				const body = this.world.getRigidBody(handle);
				if (!body) {
					this.dynamicBodies.delete(handle);
					continue;
				}
				const pos = body.translation();
				const rot = body.rotation();
				tracked.currPos.set(pos.x, pos.y, pos.z);
				tracked.currRot.set(rot.x, rot.y, rot.z, rot.w);
			}

			this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
				const sensor = this.sensors.get(handle1) ?? this.sensors.get(handle2);
				if (!sensor) return;

				if (started) {
					sensor.onEnter?.();
				} else {
					sensor.onExit?.();
				}
			});

			this.accumulator -= this.fixedStep;
		}

		// 4. Smoothly interpolate dynamic meshes using the remaining accumulator fraction
		const alpha = Math.min(1, Math.max(0, this.accumulator / this.fixedStep));
		for (const tracked of this.dynamicBodies.values()) {
			tracked.object.position.lerpVectors(tracked.prevPos, tracked.currPos, alpha);
			tracked.object.quaternion.slerpQuaternions(tracked.prevRot, tracked.currRot, alpha);
		}
	}
}

export const physicsWorld = new PhysicsWorld();
