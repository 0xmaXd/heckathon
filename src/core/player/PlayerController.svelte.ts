import * as THREE from 'three';
import {
	FlatSurfaceProvider,
	type CollisionWorld,
	type SurfaceProvider
} from '../engine/CollisionWorld';
import type { CameraController } from '../engine/SceneManager';
import {
	characterModelLoader,
	type CharacterInstanceOptions,
	type CharacterRigRefs
} from './CharacterModelLoader';
import { SvelteSet } from 'svelte/reactivity';

export interface PlayerPhysicsConfig {
	walkSpeed: number;
	sprintSpeed: number;
	jumpVelocity: number;
	gravity: number;
	colliderRadius: number;
	colliderHeight: number;
	eyeHeight: number;
	eyeForwardOffset: number;
	boundsXZ: number;
}

export const DEFAULT_EARTH_PLAYER_CONFIG: PlayerPhysicsConfig = {
	walkSpeed: 4.5,
	sprintSpeed: 7.5,
	jumpVelocity: 4.8,
	gravity: 9.81,
	colliderRadius: 0.44,
	colliderHeight: 1.8,
	eyeHeight: 1.66,
	eyeForwardOffset: 0.25,
	boundsXZ: 215
};

export interface PlayerSpawnOptions {
	position?: THREE.Vector3 | [number, number, number] | { x: number; y?: number; z: number };
	x?: number;
	y?: number;
	z?: number;
	yaw?: number;
	yawRad?: number;
	pitch?: number;
	pitchRad?: number;
	surface?: SurfaceProvider;
	canvas?: HTMLCanvasElement | null;
	vehicle?: VehicleCameraDelegate | null;
	physics?: Partial<PlayerPhysicsConfig>;
	visualOptions?: CharacterInstanceOptions;
}

export interface DropOffZoneMatch {
	position: THREE.Vector3;
}

export interface CargoZoneProvider {
	findDropOffZoneNear(
		pos: THREE.Vector3,
		radius?: number,
		onlyUndelivered?: boolean
	): DropOffZoneMatch | null;
}

export interface CargoReceiver {
	readonly vehicleObject: THREE.Object3D | null;
	readonly loadedCrate: THREE.Object3D | null;
	isNearCargoRack(pos: THREE.Vector3): boolean;
	isCrateFalling(crate: THREE.Object3D): boolean;
	tryPlaceCrateFromPlayer(
		crate: THREE.Object3D,
		scene: THREE.Scene,
		surface: SurfaceProvider
	): { accepted: boolean; message: string };
	takeLoadedCrateForPlayer(): THREE.Object3D | null;
}

export interface VehicleCameraDelegate {
	readonly isSeated: boolean;
	applyFirstPersonDriverCamera(
		camera: THREE.PerspectiveCamera,
		headYawOffsetRad: number,
		headPitchRad: number
	): boolean;
}

export interface PlayerCrateInteractOptions {
	vehicle?: CargoReceiver | null;
	zoneProvider?: CargoZoneProvider | null;
	deliverRadius?: number;
	interactionRadius?: number;
}

const MOVEMENT_CODES = new Set([
	'KeyW',
	'KeyA',
	'KeyS',
	'KeyD',
	'ArrowUp',
	'ArrowDown',
	'ArrowLeft',
	'ArrowRight',
	'Space',
	'ShiftLeft',
	'ShiftRight'
]);

export class PlayerController implements CameraController {
	public readonly root = new THREE.Group();
	public yawRad = Math.PI;
	public pitchRad = 0.0;
	public carryingCrate: THREE.Object3D | null = null;
	public physics: PlayerPhysicsConfig;

	// Svelte 5 reactive state consumed directly by GameHUD.svelte
	public isActive = $state(false);
	public isPointerLocked = $state(false);
	public debugOrbitMode = $state(false);
	public isGrounded = $state(true);
	public isMoving = $state(false);
	public isSeated = $state(false);
	public carryingItemName = $state<string | null>(null);

	private velocityY = 0;
	private walkCycle = 0;
	private bobAmount = 0;
	private characterVisual: THREE.Group | null = null;
	private characterRig: CharacterRigRefs | null = null;
	private activeVehicle: VehicleCameraDelegate | null = null;
	private canvasEl: HTMLCanvasElement | null = null;
	private boundCanvasTarget: HTMLCanvasElement | null = null;
	private listenersAttached = false;
	private spawnGeneration = 0;
	private ownKeys = new SvelteSet<string>();

	private boundMouseMove = (e: MouseEvent) => {
		if (!this.isActive || !this.isPointerLocked || this.debugOrbitMode) return;
		this.yawRad -= e.movementX * 0.0022;
		this.pitchRad = THREE.MathUtils.clamp(this.pitchRad - e.movementY * 0.0022, -1.25, 1.25);
	};

	private boundPointerLockChange = () => {
		this.isPointerLocked = Boolean(this.canvasEl && document.pointerLockElement === this.canvasEl);
	};

	private boundCanvasClick = () => {
		if (!this.isActive || this.debugOrbitMode || !this.canvasEl) return;
		if (document.pointerLockElement !== this.canvasEl) {
			void this.canvasEl.requestPointerLock?.();
		}
	};

	private boundKeyDown = (e: KeyboardEvent) => {
		if (!this.isActive) return;

		const target = e.target as HTMLElement | null;
		if (
			target &&
			(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
		) {
			return;
		}

		if (e.code === 'F2') {
			e.preventDefault();
			this.debugOrbitMode = !this.debugOrbitMode;
			if (this.debugOrbitMode && document.pointerLockElement) {
				document.exitPointerLock?.();
			}
			return;
		}

		if (MOVEMENT_CODES.has(e.code)) {
			this.ownKeys.add(e.code);
			if (
				e.code === 'Space' ||
				e.code === 'ArrowUp' ||
				e.code === 'ArrowDown' ||
				e.code === 'ArrowLeft' ||
				e.code === 'ArrowRight'
			) {
				e.preventDefault();
			}
		}
	};

	private boundKeyUp = (e: KeyboardEvent) => {
		this.ownKeys.delete(e.code);
	};

	private boundBlur = () => {
		this.ownKeys.clear();
	};

	constructor(physics: Partial<PlayerPhysicsConfig> = {}) {
		this.physics = { ...DEFAULT_EARTH_PLAYER_CONFIG, ...physics };
		this.root.userData.controller = this;
	}

	attachCanvas(canvas: HTMLCanvasElement | null) {
		if (this.boundCanvasTarget && this.boundCanvasTarget !== canvas) {
			this.boundCanvasTarget.removeEventListener('click', this.boundCanvasClick);
			this.boundCanvasTarget = null;
		}
		this.canvasEl = canvas;
		if (this.isActive && this.canvasEl && this.boundCanvasTarget !== this.canvasEl) {
			this.canvasEl.addEventListener('click', this.boundCanvasClick);
			this.boundCanvasTarget = this.canvasEl;
		}
	}

	async spawn(
		scene: THREE.Scene,
		posOrXOrOptions?: THREE.Vector3 | [number, number, number] | number | PlayerSpawnOptions,
		zOrYOrOptions?: number | SurfaceProvider | PlayerSpawnOptions,
		zOrSurface?: number | SurfaceProvider,
		yawOrVisualOptions?: number | CharacterInstanceOptions
	): Promise<void> {
		let spawnX = 0;
		let spawnY: number | undefined = undefined;
		let spawnZ = 0;
		let yaw = Math.PI;
		let pitch = 0;
		let explicitSurface: SurfaceProvider | undefined = undefined;
		let canvas: HTMLCanvasElement | null | undefined = undefined;
		let vehicle: VehicleCameraDelegate | null = null;
		let visualOptions: CharacterInstanceOptions = {
			accentHex: 0xe6480d,
			hideHeadForFirstPerson: true
		};

		const applyOptions = (opts: PlayerSpawnOptions) => {
			if (opts.physics) this.setPhysics(opts.physics);
			if (opts.position instanceof THREE.Vector3) {
				spawnX = opts.position.x;
				spawnY = opts.position.y;
				spawnZ = opts.position.z;
			} else if (Array.isArray(opts.position)) {
				[spawnX, spawnY, spawnZ] = opts.position;
			} else if (opts.position && typeof opts.position === 'object') {
				spawnX = opts.position.x;
				spawnY = opts.position.y;
				spawnZ = opts.position.z;
			}
			if (typeof opts.x === 'number') spawnX = opts.x;
			if (typeof opts.y === 'number') spawnY = opts.y;
			if (typeof opts.z === 'number') spawnZ = opts.z;
			if (typeof opts.yawRad === 'number') yaw = opts.yawRad;
			else if (typeof opts.yaw === 'number') yaw = opts.yaw;
			if (typeof opts.pitchRad === 'number') pitch = opts.pitchRad;
			else if (typeof opts.pitch === 'number') pitch = opts.pitch;
			if (opts.surface) explicitSurface = opts.surface;
			if (opts.canvas !== undefined) canvas = opts.canvas;
			if (opts.vehicle !== undefined) vehicle = opts.vehicle;
			if (opts.visualOptions) visualOptions = { ...visualOptions, ...opts.visualOptions };
		};

		if (posOrXOrOptions instanceof THREE.Vector3) {
			spawnX = posOrXOrOptions.x;
			spawnY = posOrXOrOptions.y;
			spawnZ = posOrXOrOptions.z;
			if (typeof zOrYOrOptions === 'number') yaw = zOrYOrOptions;
			else if (
				zOrYOrOptions &&
				typeof zOrYOrOptions === 'object' &&
				!('sampleSurfaceAt' in zOrYOrOptions)
			) {
				applyOptions(zOrYOrOptions);
			}
		} else if (Array.isArray(posOrXOrOptions)) {
			[spawnX, spawnY, spawnZ] = posOrXOrOptions;
			if (typeof zOrYOrOptions === 'number') yaw = zOrYOrOptions;
			else if (
				zOrYOrOptions &&
				typeof zOrYOrOptions === 'object' &&
				!('sampleSurfaceAt' in zOrYOrOptions)
			) {
				applyOptions(zOrYOrOptions);
			}
		} else if (typeof posOrXOrOptions === 'number') {
			spawnX = posOrXOrOptions;
			if (typeof zOrSurface === 'number') {
				spawnY = typeof zOrYOrOptions === 'number' ? zOrYOrOptions : 0;
				spawnZ = zOrSurface;
				if (typeof yawOrVisualOptions === 'number') yaw = yawOrVisualOptions;
			} else {
				spawnZ = typeof zOrYOrOptions === 'number' ? zOrYOrOptions : 0;
				if (zOrSurface && typeof zOrSurface === 'object' && 'sampleSurfaceAt' in zOrSurface) {
					explicitSurface = zOrSurface;
				}
				if (yawOrVisualOptions && typeof yawOrVisualOptions === 'object') {
					visualOptions = { ...visualOptions, ...yawOrVisualOptions };
				}
			}
		} else if (posOrXOrOptions && typeof posOrXOrOptions === 'object') {
			applyOptions(posOrXOrOptions);
		}

		const resolvedSurface =
			explicitSurface ?? new FlatSurfaceProvider(typeof spawnY === 'number' ? spawnY : 0);

		this.yawRad = yaw;
		this.pitchRad = pitch;
		this.activate(canvas, vehicle);
		await this.init(scene, spawnX, spawnZ, resolvedSurface, visualOptions);
		if (typeof spawnY === 'number' && !explicitSurface) {
			this.root.position.y = spawnY;
		}
	}

	despawn(scene?: THREE.Scene) {
		this.spawnGeneration++;
		this.deactivate();
		if (scene) {
			scene.remove(this.root);
		}
		this.reset();
	}

	async init(
		scene: THREE.Scene,
		spawnX: number,
		spawnZ: number,
		surface: SurfaceProvider = new FlatSurfaceProvider(0),
		visualOptions: CharacterInstanceOptions = {
			accentHex: 0xe6480d,
			hideHeadForFirstPerson: true
		}
	) {
		const gen = ++this.spawnGeneration;
		this.root.parent?.remove(this.root);
		this.root.visible = true;
		this.isSeated = false;
		this.velocityY = 0;
		this.isGrounded = true;
		this.isMoving = false;
		this.clearCarriedItem();

		if (this.characterVisual) {
			this.root.remove(this.characterVisual);
			this.characterVisual = null;
			this.characterRig = null;
		}

		const hit = surface.sampleSurfaceAt(spawnX, spawnZ);
		this.root.position.set(spawnX, hit.y, spawnZ);
		this.root.name = 'EVA_Astronaut_Player';
		scene.add(this.root);

		if (!this.isActive) {
			this.activate();
		}

		const visual = await characterModelLoader.createCharacterInstance(visualOptions);
		if (gen !== this.spawnGeneration) return;

		this.characterVisual = visual;
		this.characterRig = (this.characterVisual.userData?.rig as CharacterRigRefs) ?? null;
		this.root.add(this.characterVisual);
	}

	activate(canvas?: HTMLCanvasElement | null, vehicle: VehicleCameraDelegate | null = null) {
		this.isActive = true;
		this.activeVehicle = vehicle;

		const resolvedCanvas = canvas ?? this.canvasEl ?? document.querySelector('canvas');
		this.attachCanvas(resolvedCanvas);

		if (!this.listenersAttached) {
			window.addEventListener('mousemove', this.boundMouseMove);
			window.addEventListener('keydown', this.boundKeyDown);
			window.addEventListener('keyup', this.boundKeyUp);
			window.addEventListener('blur', this.boundBlur);
			document.addEventListener('pointerlockchange', this.boundPointerLockChange);
			this.listenersAttached = true;
		}

		if (this.canvasEl && this.boundCanvasTarget !== this.canvasEl) {
			this.canvasEl.addEventListener('click', this.boundCanvasClick);
			this.boundCanvasTarget = this.canvasEl;
		}
	}

	deactivate() {
		this.isActive = false;
		this.isSeated = false;
		this.isMoving = false;
		this.activeVehicle = null;
		this.ownKeys.clear();
		this.root.visible = true;
		if (this.canvasEl && document.pointerLockElement === this.canvasEl) {
			document.exitPointerLock?.();
		}
		this.isPointerLocked = false;
		if (this.listenersAttached) {
			window.removeEventListener('mousemove', this.boundMouseMove);
			window.removeEventListener('keydown', this.boundKeyDown);
			window.removeEventListener('keyup', this.boundKeyUp);
			window.removeEventListener('blur', this.boundBlur);
			document.removeEventListener('pointerlockchange', this.boundPointerLockChange);
			this.listenersAttached = false;
		}
		if (this.boundCanvasTarget) {
			this.boundCanvasTarget.removeEventListener('click', this.boundCanvasClick);
			this.boundCanvasTarget = null;
		}
	}

	dispose() {
		this.despawn();
		this.canvasEl = null;
	}

	setPhysics(physics: Partial<PlayerPhysicsConfig>) {
		this.physics = { ...this.physics, ...physics };
	}

	clearCarriedItem() {
		this.carryingCrate = null;
		this.carryingItemName = null;
	}

	setSeatedPose(seated: boolean) {
		this.isSeated = seated;
		if (!this.characterRig) return;

		const {
			pelvis,
			spine,
			leftThigh,
			rightThigh,
			leftCalf,
			rightCalf,
			leftUpperArm,
			rightUpperArm,
			leftForearm,
			rightForearm,
			restRotations,
			restPositions
		} = this.characterRig;

		if (seated) {
			if (pelvis) {
				const p = restPositions.get(pelvis);
				pelvis.position.y = (p?.y ?? 0.84) - 0.34;
			}
			if (spine) spine.rotation.x = THREE.MathUtils.degToRad(-10);
			if (leftThigh) leftThigh.rotation.x = THREE.MathUtils.degToRad(-86);
			if (rightThigh) rightThigh.rotation.x = THREE.MathUtils.degToRad(-86);
			if (leftCalf) leftCalf.rotation.x = THREE.MathUtils.degToRad(88);
			if (rightCalf) rightCalf.rotation.x = THREE.MathUtils.degToRad(88);
			if (leftUpperArm) {
				leftUpperArm.rotation.x = THREE.MathUtils.degToRad(-48);
				leftUpperArm.rotation.z = THREE.MathUtils.degToRad(14);
			}
			if (rightUpperArm) {
				rightUpperArm.rotation.x = THREE.MathUtils.degToRad(-52);
				rightUpperArm.rotation.z = THREE.MathUtils.degToRad(-18);
			}
			if (leftForearm) leftForearm.rotation.x = THREE.MathUtils.degToRad(-24);
			if (rightForearm) rightForearm.rotation.x = THREE.MathUtils.degToRad(-28);
		} else {
			for (const [joint, rot] of restRotations) {
				joint.rotation.copy(rot);
			}
			for (const [joint, pos] of restPositions) {
				joint.position.copy(pos);
			}
		}
	}

	reset() {
		this.yawRad = Math.PI;
		this.pitchRad = 0.0;
		this.velocityY = 0;
		this.walkCycle = 0;
		this.bobAmount = 0;
		this.isGrounded = true;
		this.isMoving = false;
		this.isSeated = false;
		this.ownKeys.clear();
		this.root.visible = true;
		this.clearCarriedItem();
		this.root.parent?.remove(this.root);
		this.root.clear();
		this.characterVisual = null;
		this.characterRig = null;
	}

	pickUpOrDropCrate(
		crates: THREE.Object3D[],
		scene: THREE.Scene,
		surface: SurfaceProvider,
		options?: PlayerCrateInteractOptions
	): string | null {
		const activeVehicle = options?.vehicle ?? null;
		const interactRadius = options?.interactionRadius ?? 2.8;
		const deliverRadius = options?.deliverRadius ?? 3.8;

		if (this.carryingCrate) {
			const heldCrate = this.carryingCrate;

			const nearbyZone =
				options?.zoneProvider?.findDropOffZoneNear(this.root.position, deliverRadius, true) ?? null;
			const nearVehicle = activeVehicle?.isNearCargoRack(this.root.position) ?? false;

			let preferVehicle = nearVehicle;
			if (nearVehicle && nearbyZone && activeVehicle?.vehicleObject) {
				const distToZone = Math.hypot(
					this.root.position.x - nearbyZone.position.x,
					this.root.position.z - nearbyZone.position.z
				);
				const distToVehicle = this.root.position.distanceTo(activeVehicle.vehicleObject.position);
				preferVehicle = distToVehicle <= distToZone;
			}

			if (preferVehicle && activeVehicle) {
				this.clearCarriedItem();
				const result = activeVehicle.tryPlaceCrateFromPlayer(heldCrate, scene, surface);
				return result.message;
			}

			const dropPos = nearbyZone
				? nearbyZone.position.clone()
				: new THREE.Vector3(0, 0, 1.35)
						.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.root.rotation.y)
						.add(this.root.position);
			const hit = surface.sampleSurfaceAt(dropPos.x, dropPos.z);

			scene.attach(heldCrate);
			heldCrate.position.set(dropPos.x, hit.y + 0.39, dropPos.z);
			heldCrate.rotation.set(0, nearbyZone ? 0 : this.root.rotation.y, 0);

			const droppedName = heldCrate.name;
			this.clearCarriedItem();
			return `Placed ${droppedName}`;
		}

		let closest: THREE.Object3D | null = null;
		let bestDist = interactRadius;
		const cratePos = new THREE.Vector3();

		for (const crate of crates) {
			if (crate.userData?.delivered) continue;
			if (activeVehicle?.isCrateFalling(crate)) continue;
			if (crate === activeVehicle?.loadedCrate) continue;
			crate.getWorldPosition(cratePos);
			const d = cratePos.distanceTo(this.root.position);
			if (d < bestDist) {
				bestDist = d;
				closest = crate;
			}
		}

		if (
			!closest &&
			activeVehicle?.loadedCrate &&
			activeVehicle.isNearCargoRack(this.root.position)
		) {
			const taken = activeVehicle.takeLoadedCrateForPlayer();
			if (taken) {
				this.root.attach(taken);
				taken.position.set(0, 0.92, 0.78);
				taken.rotation.set(0, 0, 0);
				this.carryingCrate = taken;
				this.carryingItemName = taken.name;
				return `Took ${taken.name} from Rover rear rack`;
			}
		}

		if (closest) {
			this.root.attach(closest);
			closest.position.set(0, 0.92, 0.78);
			closest.rotation.set(0, 0, 0);
			this.carryingCrate = closest;
			this.carryingItemName = closest.name;
			return `Carrying ${closest.name}`;
		}

		return null;
	}

	private hasInput(
		externalKeys: Set<string> | null | undefined,
		code: string,
		fallbackKey?: string
	): boolean {
		if (this.ownKeys.has(code)) return true;
		if (externalKeys) {
			if (externalKeys.has(code)) return true;
			if (
				fallbackKey &&
				(externalKeys.has(fallbackKey) || externalKeys.has(fallbackKey.toUpperCase()))
			) {
				return true;
			}
		}
		return false;
	}

	update(
		dt: number,
		keysOrSurface?: Set<string> | SurfaceProvider | null,
		surfaceOrCollisions?: SurfaceProvider | CollisionWorld | null,
		collisions?: CollisionWorld | null,
		vehicleObj: THREE.Object3D | null = null
	) {
		if (this.isSeated) {
			this.isMoving = false;
			return;
		}

		let externalKeys: Set<string> | null = null;
		let resolvedSurface: SurfaceProvider = new FlatSurfaceProvider(0);
		let resolvedCollisions: CollisionWorld | null = collisions ?? null;

		if (keysOrSurface instanceof Set) {
			externalKeys = keysOrSurface;
			if (surfaceOrCollisions && 'sampleSurfaceAt' in surfaceOrCollisions) {
				resolvedSurface = surfaceOrCollisions;
			}
		} else if (
			keysOrSurface &&
			typeof keysOrSurface === 'object' &&
			'sampleSurfaceAt' in keysOrSurface
		) {
			resolvedSurface = keysOrSurface;
			if (surfaceOrCollisions && !('sampleSurfaceAt' in surfaceOrCollisions)) {
				resolvedCollisions = surfaceOrCollisions;
			}
		} else if (surfaceOrCollisions && 'sampleSurfaceAt' in surfaceOrCollisions) {
			resolvedSurface = surfaceOrCollisions;
		}

		const {
			walkSpeed,
			sprintSpeed,
			jumpVelocity,
			gravity,
			colliderRadius,
			colliderHeight,
			boundsXZ
		} = this.physics;

		this.root.rotation.y = this.yawRad;

		let forwardInput = 0;
		let strafeInput = 0;
		if (this.hasInput(externalKeys, 'KeyW', 'w') || this.hasInput(externalKeys, 'ArrowUp')) {
			forwardInput += 1;
		}
		if (this.hasInput(externalKeys, 'KeyS', 's') || this.hasInput(externalKeys, 'ArrowDown')) {
			forwardInput -= 1;
		}
		if (this.hasInput(externalKeys, 'KeyA', 'a') || this.hasInput(externalKeys, 'ArrowLeft')) {
			strafeInput -= 1;
		}
		if (this.hasInput(externalKeys, 'KeyD', 'd') || this.hasInput(externalKeys, 'ArrowRight')) {
			strafeInput += 1;
		}

		const forward = new THREE.Vector3(Math.sin(this.yawRad), 0, Math.cos(this.yawRad));
		const right = new THREE.Vector3(-forward.z, 0, forward.x);

		const moveDir = new THREE.Vector3()
			.addScaledVector(forward, forwardInput)
			.addScaledVector(right, strafeInput);
		const moving = moveDir.lengthSq() > 0.001;
		this.isMoving = moving;

		if (moving) {
			moveDir.normalize();
			const sprinting =
				this.hasInput(externalKeys, 'ShiftLeft', 'shift') ||
				this.hasInput(externalKeys, 'ShiftRight', 'shift');
			const speed = sprinting ? sprintSpeed : walkSpeed;
			this.root.position.x = THREE.MathUtils.clamp(
				this.root.position.x + moveDir.x * speed * dt,
				-boundsXZ,
				boundsXZ
			);
			this.root.position.z = THREE.MathUtils.clamp(
				this.root.position.z + moveDir.z * speed * dt,
				-boundsXZ,
				boundsXZ
			);
			this.walkCycle += dt * (speed * 2.1);
		} else {
			this.walkCycle = 0;
		}

		if (resolvedCollisions) {
			resolvedCollisions.resolveHorizontal(this.root.position, colliderRadius, colliderHeight, {
				vehicleObj,
				includeVehicle: true,
				ignoredObject: this.carryingCrate
			});
		}

		if (this.hasInput(externalKeys, 'Space', ' ') && this.isGrounded) {
			this.velocityY = jumpVelocity;
			this.isGrounded = false;
		}

		const ground = resolvedSurface.sampleSurfaceAt(this.root.position.x, this.root.position.z);
		this.velocityY -= gravity * dt;
		this.root.position.y += this.velocityY * dt;

		if (this.root.position.y <= ground.y) {
			this.root.position.y = ground.y;
			this.velocityY = 0;
			this.isGrounded = true;
		}

		const targetBob = moving && this.isGrounded ? Math.abs(Math.sin(this.walkCycle)) * 0.038 : 0;
		this.bobAmount = THREE.MathUtils.lerp(this.bobAmount, targetBob, Math.min(1, dt * 14));

		if (this.characterVisual) {
			this.characterVisual.position.y = this.bobAmount;
		}

		if (this.carryingCrate) {
			this.carryingCrate.position.y = 0.92 + this.bobAmount * 0.65;
		}

		this.animateLimbs(moving);
	}

	private animateLimbs(isMoving: boolean) {
		if (!this.characterRig || this.isSeated) return;
		const {
			leftUpperArm,
			rightUpperArm,
			leftForearm,
			rightForearm,
			leftThigh,
			rightThigh,
			restRotations
		} = this.characterRig;

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
			if (leftUpperArm) leftUpperArm.rotation.x = (restRotations.get(leftUpperArm)?.x ?? 0) - 0.72;
			if (rightUpperArm)
				rightUpperArm.rotation.x = (restRotations.get(rightUpperArm)?.x ?? 0) - 0.72;
			if (leftForearm) leftForearm.rotation.x = (restRotations.get(leftForearm)?.x ?? 0) - 0.45;
			if (rightForearm) rightForearm.rotation.x = (restRotations.get(rightForearm)?.x ?? 0) - 0.45;
		} else {
			if (leftUpperArm)
				leftUpperArm.rotation.x = (restRotations.get(leftUpperArm)?.x ?? 0) - swing * 0.65;
			if (rightUpperArm)
				rightUpperArm.rotation.x = (restRotations.get(rightUpperArm)?.x ?? 0) + swing * 0.65;
			if (leftForearm) leftForearm.rotation.x = (restRotations.get(leftForearm)?.x ?? 0) - 0.15;
			if (rightForearm) rightForearm.rotation.x = (restRotations.get(rightForearm)?.x ?? 0) - 0.15;
		}
	}

	updateCamera(_delta: number, camera: THREE.PerspectiveCamera): boolean {
		if (!this.isActive || this.debugOrbitMode) return false;

		if (this.activeVehicle?.isSeated) {
			return this.activeVehicle.applyFirstPersonDriverCamera(camera, this.yawRad, this.pitchRad);
		}

		this.applyFirstPersonCamera(camera);
		return true;
	}

	applyFirstPersonCamera(camera: THREE.PerspectiveCamera) {
		const eyeOffset = new THREE.Vector3(
			0,
			this.physics.eyeHeight + this.bobAmount,
			this.physics.eyeForwardOffset
		).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yawRad);
		camera.position.copy(this.root.position).add(eyeOffset);

		const lookDir = new THREE.Vector3(
			Math.sin(this.yawRad) * Math.cos(this.pitchRad),
			Math.sin(this.pitchRad),
			Math.cos(this.yawRad) * Math.cos(this.pitchRad)
		);
		camera.lookAt(camera.position.clone().add(lookDir));
	}
}

export const playerController = new PlayerController();
