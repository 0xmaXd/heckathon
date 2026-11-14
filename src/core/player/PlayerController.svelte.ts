import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import {
	GameConfig,
	type MovementProfile,
	type MovementProfileName
} from '../../config/game.config';
import { physicsWorld } from '../engine/PhysicsWorld';
import type { CameraController } from '../engine/SceneManager';
import { SvelteSet } from 'svelte/reactivity';

export interface SpawnOptions {
	position: [number, number, number];
	yaw?: number;
	pitch?: number;
	profile?: MovementProfileName;
}

export class PlayerController implements CameraController {
	public isActive = $state(false);
	public isPointerLocked = $state(false);
	public debugOrbitMode = $state(false);
	public jumpStamina = $state(1.0);

	private body: RAPIER.RigidBody | null = null;
	private canvas: HTMLCanvasElement | null = null;

	// Capsule dimensions: total height = 2 * (0.525 + 0.35) = 1.75m
	private readonly radius = 0.35;
	private readonly halfHeight = 0.525;
	private readonly eyeOffsetY = 0.65;

	private yaw = 0;
	private pitch = 0;
	private readonly lookSensitivity = 0.0022;
	private profile: MovementProfile = GameConfig.physics.movementProfiles.earthWalk;

	// Jump & airborne trajectory state
	private wasGrounded = true;
	private jumpCooldown = 0;
	private hasHorizontalJump = false;
	private jumpDir = new THREE.Vector2(0, -1);

	private keys = new SvelteSet<string>();
	private euler = new THREE.Euler(0, 0, 0, 'YXZ');
	private forwardVec = new THREE.Vector3();
	private rightVec = new THREE.Vector3();
	private wishDir = new THREE.Vector3();
	private interpPos = new THREE.Vector3();

	private boundKeyDown = (e: KeyboardEvent) => this.onKeyDown(e);
	private boundKeyUp = (e: KeyboardEvent) => this.onKeyUp(e);
	private boundBlur = () => this.keys.clear();
	private boundMouseMove = (e: MouseEvent) => this.onMouseMove(e);
	private boundPointerLockChange = () => this.onPointerLockChange();
	private boundCanvasClick = () => this.requestPointerLock();

	attachCanvas(canvasElement: HTMLCanvasElement) {
		this.canvas = canvasElement;
		this.canvas.addEventListener('click', this.boundCanvasClick);
		window.addEventListener('keydown', this.boundKeyDown);
		window.addEventListener('keyup', this.boundKeyUp);
		window.addEventListener('blur', this.boundBlur);
		document.addEventListener('mousemove', this.boundMouseMove);
		document.addEventListener('pointerlockchange', this.boundPointerLockChange);
	}

	spawn(options: SpawnOptions) {
		this.despawn();

		this.profile = GameConfig.physics.movementProfiles[options.profile ?? 'earthWalk'];
		this.yaw = options.yaw ?? 0;
		this.pitch = options.pitch ?? 0;
		this.debugOrbitMode = false;
		this.jumpStamina = 1.0;
		this.wasGrounded = true;
		this.jumpCooldown = 0;
		this.hasHorizontalJump = false;

		this.body = physicsWorld.addPlayerCapsule(this.radius, this.halfHeight, options.position);
		this.isActive = this.body !== null;
	}

	despawn() {
		if (this.body) {
			physicsWorld.removeBody(this.body);
			this.body = null;
		}
		this.keys.clear();
		this.isActive = false;
		this.debugOrbitMode = false;

		if (document.pointerLockElement === this.canvas) {
			document.exitPointerLock();
		}
	}

	requestPointerLock() {
		if (!this.isActive || this.debugOrbitMode || !this.canvas) return;
		if (document.pointerLockElement !== this.canvas) {
			this.canvas.requestPointerLock();
		}
	}

	private onPointerLockChange() {
		this.isPointerLocked = Boolean(this.canvas && document.pointerLockElement === this.canvas);
	}

	private onKeyDown(event: KeyboardEvent) {
		if (!this.isActive) return;

		if (event.code === 'F2') {
			event.preventDefault();
			this.debugOrbitMode = !this.debugOrbitMode;
			if (this.debugOrbitMode && document.pointerLockElement === this.canvas) {
				document.exitPointerLock();
			}
			return;
		}

		this.keys.add(event.code);

		if (event.code === 'Space' && !this.debugOrbitMode) {
			this.tryJump();
		}
	}

	private onKeyUp(event: KeyboardEvent) {
		this.keys.delete(event.code);
	}

	private onMouseMove(event: MouseEvent) {
		if (!this.isActive || !this.isPointerLocked || this.debugOrbitMode) return;

		this.yaw -= event.movementX * this.lookSensitivity;
		this.pitch -= event.movementY * this.lookSensitivity;

		const maxPitch = Math.PI / 2 - 0.08;
		this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));
	}

	private checkGrounded(): boolean {
		if (!this.body || this.jumpCooldown > 0) return false;
		const rayLength = this.halfHeight + this.radius + 0.06;
		return physicsWorld.isBodyGrounded(this.body, rayLength);
	}

	private lockAirborneDirection(vx: number, vz: number) {
		const horizSpeed = Math.hypot(vx, vz);
		if (horizSpeed > 0.15) {
			this.hasHorizontalJump = true;
			this.jumpDir.set(vx / horizSpeed, vz / horizSpeed);
		} else {
			this.hasHorizontalJump = false;
		}
	}

	private tryJump() {
		if (!this.body || this.profile.zeroG || this.profile.jumpVelocity <= 0) return;
		if (!this.checkGrounded()) return;

		const vel = this.body.linvel();

		const fatigueScale =
			this.profile.minJumpMultiplier + (1 - this.profile.minJumpMultiplier) * this.jumpStamina;
		const takeoffVy = this.profile.jumpVelocity * fatigueScale;

		this.jumpStamina = Math.max(0, this.jumpStamina - this.profile.jumpFatiguePerJump);
		this.jumpCooldown = 0.15;
		this.wasGrounded = false;
		this.lockAirborneDirection(vel.x, vel.z);

		this.body.setLinvel({ x: vel.x, y: takeoffVy, z: vel.z }, true);
	}

	/**
	 * Called by SceneManager each frame when First-Person control is active.
	 */
	updateCamera(delta: number, camera: THREE.PerspectiveCamera): boolean {
		if (!this.isActive || !this.body || this.debugOrbitMode) {
			return false;
		}

		if (this.jumpCooldown > 0) {
			this.jumpCooldown = Math.max(0, this.jumpCooldown - delta);
		}

		this.forwardVec.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
		this.rightVec.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

		let moveForward = 0;
		let moveRight = 0;

		if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) moveForward += 1;
		if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) moveForward -= 1;
		if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) moveRight += 1;
		if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) moveRight -= 1;

		this.wishDir
			.set(0, 0, 0)
			.addScaledVector(this.forwardVec, moveForward)
			.addScaledVector(this.rightVec, moveRight);

		const hasMoveInput = this.wishDir.lengthSq() > 0;
		if (hasMoveInput) {
			this.wishDir.normalize();
		}

		const sprinting = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
		const maxSpeed = this.profile.walkSpeed * (sprinting ? this.profile.sprintMultiplier : 1);

		const currentVel = this.body.linvel();
		const grounded = this.profile.zeroG || this.checkGrounded();

		if (this.wasGrounded && !grounded && !this.profile.zeroG) {
			this.lockAirborneDirection(currentVel.x, currentVel.z);
		}
		this.wasGrounded = grounded;

		let nextVx = currentVel.x;
		let nextVz = currentVel.z;
		let nextVy = currentVel.y;

		if (grounded) {
			if (!this.profile.zeroG && this.jumpStamina < 1.0) {
				this.jumpStamina = Math.min(
					1.0,
					this.jumpStamina + this.profile.staminaRecoveryRate * delta
				);
			}

			const targetVx = hasMoveInput ? this.wishDir.x * maxSpeed : 0;
			const targetVz = hasMoveInput ? this.wishDir.z * maxSpeed : 0;

			const diffX = targetVx - currentVel.x;
			const diffZ = targetVz - currentVel.z;
			const diffLen = Math.hypot(diffX, diffZ);

			const accelRate = hasMoveInput ? this.profile.groundAccel : this.profile.groundDecel;
			const maxDelta = accelRate * delta;

			if (diffLen <= maxDelta || diffLen === 0) {
				nextVx = targetVx;
				nextVz = targetVz;
			} else {
				nextVx += (diffX / diffLen) * maxDelta;
				nextVz += (diffZ / diffLen) * maxDelta;
			}

			if (this.profile.zeroG) {
				let vertical = 0;
				if (this.keys.has('Space')) vertical += 1;
				if (this.keys.has('ControlLeft') || this.keys.has('KeyC')) vertical -= 1;

				const targetVy = vertical * maxSpeed;
				const diffY = targetVy - currentVel.y;
				const maxDeltaY =
					(vertical !== 0 ? this.profile.groundAccel : this.profile.groundDecel) * delta;

				nextVy =
					Math.abs(diffY) <= maxDeltaY ? targetVy : currentVel.y + Math.sign(diffY) * maxDeltaY;
			}
		} else if (hasMoveInput && this.hasHorizontalJump) {
			const alignment = this.wishDir.x * this.jumpDir.x + this.wishDir.z * this.jumpDir.y;

			if (alignment < -0.25) {
				const opposingStrength = Math.abs(alignment);
				const currentHorizSpeed = Math.hypot(currentVel.x, currentVel.z);

				if (currentHorizSpeed > 0.01) {
					const reducedSpeed = Math.max(
						0,
						currentHorizSpeed - this.profile.airBrakeDecel * opposingStrength * delta
					);
					const scale = reducedSpeed / currentHorizSpeed;
					nextVx = currentVel.x * scale;
					nextVz = currentVel.z * scale;
				}
			}
		}

		this.body.setLinvel({ x: nextVx, y: nextVy, z: nextVz }, true);

		const pos =
			physicsWorld.getInterpolatedPlayerPosition(this.interpPos) ?? this.body.translation();
		camera.position.set(pos.x, pos.y + this.eyeOffsetY, pos.z);

		this.euler.set(this.pitch, this.yaw, 0, 'YXZ');
		camera.quaternion.setFromEuler(this.euler);

		return true;
	}

	dispose() {
		this.despawn();
		this.canvas?.removeEventListener('click', this.boundCanvasClick);
		window.removeEventListener('keydown', this.boundKeyDown);
		window.removeEventListener('keyup', this.boundKeyUp);
		window.removeEventListener('blur', this.boundBlur);
		document.removeEventListener('mousemove', this.boundMouseMove);
		document.removeEventListener('pointerlockchange', this.boundPointerLockChange);
	}
}

export const playerController = new PlayerController();
