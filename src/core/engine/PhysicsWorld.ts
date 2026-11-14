import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { GameConfig } from '../../config/game.config';

interface TrackedBody {
	handle: RAPIER.RigidBodyHandle;
	object: THREE.Object3D;
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

	private readonly fixedStep = 1 / 60;
	private dynamicBodies = new Map<RAPIER.RigidBodyHandle, TrackedBody>();
	private sensors = new Map<RAPIER.ColliderHandle, SensorCallbacks>();

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
		this.dynamicBodies.set(body.handle, { handle: body.handle, object });

		return body;
	}

	removeBody(body: RAPIER.RigidBody) {
		if (!this.world) return;
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
			this.world.step(this.eventQueue);

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

		for (const [handle, tracked] of this.dynamicBodies) {
			const body = this.world.getRigidBody(handle);
			if (!body) {
				this.dynamicBodies.delete(handle);
				continue;
			}
			if (body.isSleeping()) continue;

			const pos = body.translation();
			const rot = body.rotation();
			tracked.object.position.set(pos.x, pos.y, pos.z);
			tracked.object.quaternion.set(rot.x, rot.y, rot.z, rot.w);
		}
	}
}

export const physicsWorld = new PhysicsWorld();
