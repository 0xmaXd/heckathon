import * as THREE from 'three';
import type { CollisionWorld, SurfaceProvider } from '../engine/CollisionWorld';
import type {
	CargoReceiver,
	CargoZoneProvider,
	VehicleCameraDelegate
} from './PlayerController.svelte';

export interface OrionRoverOptions {
	defaultMaxSpeedKmh: number;
	defaultMaxSlopeDeg: number;
	defaultWheelbaseM: number;
	wheelRadiusM: number;
	boardingRadius: number;
	deliverRadius: number;
	surfaceSpeedMultipliers: Record<string, number>;
	surfaceDrainMultipliers: Record<string, number>;
	/**
	 * Extra yaw (radians) applied to the rover MODEL so its visual front points along +Z,
	 * which is the direction driving, headlights, seat, rack and camera all use.
	 * Default Math.PI: the model's front is local -Z (cargo box on the +Z side).
	 * Use 0 if your model already faces +Z.
	 */
	modelYawOffsetRad?: number;
}

export interface RoverUpdateSnapshot {
	isSeated: boolean;
	canBoard: boolean;
	speedKmh: number;
	headingDeg: number;
	batteryPct: number;
	headlightsOn: boolean;
	surfaceType: string;
	loadedCrateName: string | null;
}

type SurfaceSample = ReturnType<SurfaceProvider['sampleSurfaceAt']>;

/** Seated hip height above the player root. Keep in sync with SEAT_DROP in PlayerController. */
const SEATED_HIP_HEIGHT = 0.5;
/** Eye position relative to the player root while seated. */
const SEATED_EYE_OFFSET = new THREE.Vector3(0, 1.12, 0.12);
/** Seat position used when no seat mesh can be found (in the UNROTATED model frame). */
const SEAT_FALLBACK = new THREE.Vector3(-0.38, 0.42, 0.12);

/** Layer used to hide the rover (and anything riding on it) from terrain raycasts. */
const RAYCAST_HIDDEN_LAYER = 31;

export class OrionRoverController implements CargoReceiver, VehicleCameraDelegate {
	public rover: THREE.Object3D | null = null;
	public isSeated = false;
	public loadedCrate: THREE.Object3D | null = null;

	private options: OrionRoverOptions;
	private initialPos = new THREE.Vector3();
	private initialQuat = new THREE.Quaternion();
	private initialYawRad = 0;
	private wheels: THREE.Object3D[] = [];
	private headlights: THREE.SpotLight[] = [];
	private headlightsOn = true;

	private speedMs = 0;
	private steerAngleRad = 0;
	private yawRad = 0;
	private battery = 100;
	private fallingCrates: {
		crate: THREE.Object3D;
		velY: number;
		targetY: number;
	}[] = [];

	private upAxis = new THREE.Vector3(0, 1, 0);
	private smoothNormal = new THREE.Vector3(0, 1, 0);

	/**
	 * Fixed rotation baked into the model (e.g. a Z-up -> Y-up export fix or any tilt).
	 * Final chassis rotation = slope * yaw * modelOffset.
	 */
	private modelOffset = new THREE.Quaternion();

	/** True once the rover sits at the scene root and its baseline pose has been captured. */
	private baselineReady = false;

	/** Ground-following state. */
	private groundY = 0;
	private groundReady = false;
	private lastSample: SurfaceSample | null = null;
	private warnedBadGround = false;

	/** Layout in rover-local space (front = +Z after the model pivot is applied). */
	private seatLocal = SEAT_FALLBACK.clone();
	private eyeLocal = SEAT_FALLBACK.clone().add(SEATED_EYE_OFFSET);
	private headlightX = 0;
	private headlightHalfWidth = 0.65;
	private headlightY = 0.75;
	private headlightZ = 1.4;
	private wheelSpinSign = 1;

	constructor(options: OrionRoverOptions) {
		this.options = options;
	}

	public get vehicleObject(): THREE.Object3D | null {
		return this.rover;
	}

	// ---------------------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------------------

	/**
	 * Samples the terrain while hiding the rover, its passengers and its cargo from any
	 * THREE.Raycaster-based lookup. Without this, a raycast from above can hit the rover's
	 * own roof, which makes the "ground" height rise every time the rover moves.
	 */
	private sampleGround(
		surface: SurfaceProvider,
		x: number,
		z: number,
		...extraHidden: (THREE.Object3D | null | undefined)[]
	): SurfaceSample {
		const saved: { obj: THREE.Object3D; mask: number }[] = [];
		const hide = (root: THREE.Object3D | null | undefined) => {
			if (!root) return;
			root.traverse((o) => {
				saved.push({ obj: o, mask: o.layers.mask });
				o.layers.set(RAYCAST_HIDDEN_LAYER);
			});
		};

		hide(this.rover);
		for (const e of extraHidden) hide(e);

		try {
			return surface.sampleSurfaceAt(x, z);
		} finally {
			// Restore in reverse so objects visited twice end up with their original mask.
			for (let i = saved.length - 1; i >= 0; i--) {
				saved[i].obj.layers.mask = saved[i].mask;
			}
		}
	}

	/** Derives a world yaw from forward (+Z) plus the residual rotation yaw does not explain. */
	private computeYawAndOffset(worldQuat: THREE.Quaternion): {
		yaw: number;
		offset: THREE.Quaternion;
	} {
		const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(worldQuat);
		const horizontalLen = Math.hypot(fwd.x, fwd.z);

		if (horizontalLen < 0.1) {
			return { yaw: 0, offset: worldQuat.clone() };
		}

		const yaw = Math.atan2(fwd.x, fwd.z);
		const yawQ = new THREE.Quaternion().setFromAxisAngle(this.upAxis, yaw);
		const offset = yawQ.clone().invert().multiply(worldQuat);
		return { yaw, offset };
	}

	/**
	 * Moves the rover to the scene root (so position.x/y/z are world coordinates) and
	 * records its starting pose. Returns false if the rover is not in a scene yet.
	 */
	private tryCaptureBaseline(): boolean {
		if (!this.rover) return false;

		let root: THREE.Object3D = this.rover;
		while (root.parent) root = root.parent;
		if (!(root as THREE.Scene).isScene) return false;

		this.rover.updateMatrixWorld(true);
		if (this.rover.parent !== root) {
			root.attach(this.rover); // preserves world transform
		}
		this.rover.updateMatrixWorld(true);

		this.initialPos.copy(this.rover.position);
		this.initialQuat.copy(this.rover.quaternion);

		const { yaw, offset } = this.computeYawAndOffset(this.rover.quaternion);
		this.yawRad = yaw;
		this.initialYawRad = yaw;
		this.modelOffset.copy(offset);

		this.groundReady = false;
		this.lastSample = null;
		this.baselineReady = true;
		return true;
	}

	private get modelYaw(): number {
		return this.options.modelYawOffsetRad ?? Math.PI;
	}

	/** Removes headlights from an earlier init() of the same rover object. */
	private cleanupPreviousSetup(rover: THREE.Object3D): void {
		const prev = rover.userData.orionHeadlights as THREE.SpotLight[] | undefined;
		if (prev) {
			for (const l of prev) {
				rover.remove(l);
				rover.remove(l.target);
			}
		}
		rover.userData.orionHeadlights = undefined;
	}

	/**
	 * Wraps the model's own children in a pivot rotated by modelYaw, so the rover node's
	 * local +Z is the model's visual FRONT. Everything attached to the rover node
	 * (headlights, seat, rack, camera, driving direction) then agrees with the model.
	 */
	private ensureModelPivot(rover: THREE.Object3D): void {
		let pivot = rover.userData.orionModelPivot as THREE.Group | undefined;
		if (!pivot) {
			pivot = new THREE.Group();
			pivot.name = 'OrionModelPivot';
			for (const c of [...rover.children]) pivot.add(c);
			rover.add(pivot);
			rover.userData.orionModelPivot = pivot;
		}
		pivot.rotation.set(0, this.modelYaw, 0);
		this.wheelSpinSign = Math.cos(this.modelYaw) < 0 ? -1 : 1;
	}

	/** Measures the model in rover-local space and derives seat, eye and headlight positions. */
	private computeLayout(): void {
		const rover = this.rover;
		if (!rover) return;

		rover.updateMatrixWorld(true);
		const inv = rover.matrixWorld.clone().invert();
		const tmp = new THREE.Matrix4();
		const all = new THREE.Box3();
		const cushions: THREE.Box3[] = [];
		const meshNames: string[] = [];

		const nameMatches = (o: THREE.Object3D, re: RegExp): boolean => {
			for (let n: THREE.Object3D | null = o; n && n !== rover; n = n.parent) {
				if (re.test(n.name)) return true;
			}
			return false;
		};

		rover.traverse((o) => {
			const mesh = o as THREE.Mesh;
			if (!mesh.isMesh || !mesh.geometry) return;
			if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
			const gb = mesh.geometry.boundingBox;
			if (!gb) return;
			const b = gb.clone().applyMatrix4(tmp.multiplyMatrices(inv, mesh.matrixWorld));
			all.union(b);
			meshNames.push(mesh.name || mesh.parent?.name || '(unnamed)');
			if (nameMatches(mesh, /seat/i) && !nameMatches(mesh, /back|rest|arm|head/i)) {
				cushions.push(b);
			}
		});

		const size = new THREE.Vector3();
		const center = new THREE.Vector3();
		if (!all.isEmpty()) {
			all.getSize(size);
			all.getCenter(center);
			this.headlightX = center.x;
			this.headlightHalfWidth = Math.min(0.65, size.x * 0.3);
			this.headlightY = Math.max(0.75, all.min.y + size.y * 0.48);
			this.headlightZ = all.max.z - 0.12; // front is +Z
		}

		// Seat: prefer the cushion on the -X side (the original seat side), else any cushion
		let seatSource: 'mesh' | 'fallback' = 'fallback';
		const fallbackSeat = SEAT_FALLBACK.clone().applyAxisAngle(this.upAxis, this.modelYaw);
		const seatPos = fallbackSeat.clone();

		if (cushions.length > 0 && !all.isEmpty()) {
			const preferred = cushions.filter((b) => b.getCenter(new THREE.Vector3()).x < center.x);
			const group = preferred.length > 0 ? preferred : cushions;
			const seatBox = new THREE.Box3();
			for (const b of group) seatBox.union(b);
			const c = seatBox.getCenter(new THREE.Vector3());
			const candidate = new THREE.Vector3(c.x, seatBox.max.y - SEATED_HIP_HEIGHT, c.z);
			const bounds = all.clone().expandByScalar(0.1);
			if (bounds.containsPoint(new THREE.Vector3(c.x, seatBox.max.y, c.z))) {
				seatPos.copy(candidate);
				seatSource = 'mesh';
			}
		}

		this.seatLocal.copy(seatPos);
		this.eyeLocal.copy(seatPos).add(SEATED_EYE_OFFSET);

		console.info('[OrionRover] layout', {
			seatSource,
			seatLocal: this.seatLocal.toArray().map((v) => +v.toFixed(2)),
			eyeLocal: this.eyeLocal.toArray().map((v) => +v.toFixed(2)),
			boundsMin: all.isEmpty() ? null : all.min.toArray().map((v) => +v.toFixed(2)),
			boundsMax: all.isEmpty() ? null : all.max.toArray().map((v) => +v.toFixed(2)),
			meshNames: meshNames.slice(0, 60)
		});
	}

	private idleSnapshot(): RoverUpdateSnapshot {
		return {
			isSeated: false,
			canBoard: false,
			speedKmh: 0,
			headingDeg: 0,
			batteryPct: Math.round(this.battery),
			headlightsOn: this.headlightsOn,
			surfaceType: 'Sintered_Regolith',
			loadedCrateName: null
		};
	}

	// ---------------------------------------------------------------------------------
	// Lifecycle
	// ---------------------------------------------------------------------------------

	public init(roverObj: THREE.Object3D | null): void {
		this.rover = roverObj;
		this.isSeated = false;
		this.loadedCrate = null;
		this.fallingCrates = [];
		this.wheels = [];
		this.headlights = [];
		this.speedMs = 0;
		this.steerAngleRad = 0;
		this.battery = 100;
		this.smoothNormal.set(0, 1, 0);
		this.modelOffset.identity();
		this.baselineReady = false;
		this.groundReady = false;
		this.lastSample = null;
		this.warnedBadGround = false;

		if (!this.rover) return;

		this.cleanupPreviousSetup(this.rover);
		this.ensureModelPivot(this.rover);

		// If the rover is not in the scene yet, update() will capture the baseline later.
		this.tryCaptureBaseline();
		this.computeLayout();

		this.rover.traverse((child) => {
			if (/wheel|tire/i.test(child.name)) {
				this.wheels.push(child);
			}
		});

		// Twin front SpotLights on the chassis; front is +Z
		for (const side of [-1, 1]) {
			const x = this.headlightX + side * this.headlightHalfWidth;
			const spot = new THREE.SpotLight(0xfff7ed, 28, 48, THREE.MathUtils.degToRad(34), 0.45, 1.3);
			spot.position.set(x, this.headlightY, this.headlightZ);
			spot.target.position.set(x, this.headlightY - 1.1, this.headlightZ + 12);
			this.rover.add(spot);
			this.rover.add(spot.target);
			this.headlights.push(spot);
		}
		this.rover.userData.orionHeadlights = [...this.headlights];
	}

	public reset(playerRoot: THREE.Object3D, scene: THREE.Scene): void {
		if (this.loadedCrate) {
			scene.attach(this.loadedCrate);
			this.loadedCrate = null;
		}
		this.fallingCrates = [];

		if (this.isSeated) {
			this.isSeated = false;
			scene.attach(playerRoot);
			playerRoot.userData?.controller?.setSeatedPose?.(false);
		}

		this.speedMs = 0;
		this.steerAngleRad = 0;
		this.battery = 100;
		this.smoothNormal.set(0, 1, 0);
		this.groundReady = false;
		this.lastSample = null;

		if (this.rover && this.baselineReady) {
			this.rover.position.copy(this.initialPos);
			this.rover.quaternion.copy(this.initialQuat);
			this.yawRad = this.initialYawRad;
		}
	}

	public isInBoardingRange(playerPos: THREE.Vector3): boolean {
		if (!this.rover) return false;
		return playerPos.distanceTo(this.rover.position) <= this.options.boardingRadius;
	}

	public isNearCargoRack(pos: THREE.Vector3): boolean {
		if (!this.rover) return false;
		return pos.distanceTo(this.rover.position) <= this.options.boardingRadius + 0.6;
	}

	public isCrateFalling(crate: THREE.Object3D): boolean {
		return this.fallingCrates.some((f) => f.crate === crate);
	}

	public toggleHeadlights(): void {
		this.headlightsOn = !this.headlightsOn;
		for (const light of this.headlights) {
			light.visible = this.headlightsOn;
		}
	}

	public toggleEnterExit(
		playerRoot: THREE.Object3D,
		surface: SurfaceProvider,
		scene: THREE.Scene
	): boolean {
		if (!this.rover) return false;

		if (!this.isSeated) {
			if (!this.isInBoardingRange(playerRoot.position)) return false;
			this.isSeated = true;
			this.speedMs = 0;
			this.rover.attach(playerRoot);
			playerRoot.position.copy(this.seatLocal);
			playerRoot.rotation.set(0, 0, 0); // faces rover +Z = the model's front
			const ctrl = playerRoot.userData?.controller;
			ctrl?.setSeatedPose?.(true);
			if (ctrl) {
				// Head look is relative to the rover's heading while seated
				ctrl.yawRad = 0;
				ctrl.pitchRad = 0;
			}
			return true;
		} else {
			this.isSeated = false;
			this.speedMs = 0;
			const exitOffset = new THREE.Vector3(-1.85, 0, 0).applyAxisAngle(this.upAxis, this.yawRad);
			const exitX = this.rover.position.x + exitOffset.x;
			const exitZ = this.rover.position.z + exitOffset.z;
			const hit = this.sampleGround(surface, exitX, exitZ, playerRoot);

			scene.attach(playerRoot);
			playerRoot.position.set(exitX, hit.y, exitZ);
			playerRoot.rotation.set(0, this.yawRad, 0);
			const ctrl = playerRoot.userData?.controller;
			ctrl?.setSeatedPose?.(false);
			if (ctrl) {
				ctrl.yawRad = this.yawRad;
				ctrl.pitchRad = 0;
			}
			return true;
		}
	}

	public tryPlaceCrateFromPlayer(
		crate: THREE.Object3D,
		_scene: THREE.Scene,
		_surface: SurfaceProvider
	): { accepted: boolean; message: string } {
		if (!this.rover) {
			return { accepted: false, message: 'Rover unavailable.' };
		}
		if (this.loadedCrate) {
			return { accepted: false, message: 'Rover cargo rack is already full.' };
		}

		this.rover.attach(crate);
		crate.position.set(0, 0.92, -1.15);
		crate.rotation.set(0, 0, 0);
		this.loadedCrate = crate;
		return { accepted: true, message: `Loaded ${crate.name} onto Rover rear rack` };
	}

	public takeLoadedCrateForPlayer(): THREE.Object3D | null {
		const crate = this.loadedCrate;
		this.loadedCrate = null;
		return crate;
	}

	public loadOrUnloadCrate(
		crates: THREE.Object3D[],
		scene: THREE.Scene,
		surface: SurfaceProvider,
		zoneProvider?: CargoZoneProvider | null
	): string | null {
		if (!this.rover) return null;

		if (this.loadedCrate) {
			const crate = this.loadedCrate;
			this.loadedCrate = null;

			const matchingZone =
				zoneProvider?.findDropOffZoneNear(this.rover.position, this.options.deliverRadius, true) ??
				null;

			const dropTarget = matchingZone
				? matchingZone.position.clone()
				: new THREE.Vector3(0, 0, -2.45)
						.applyAxisAngle(this.upAxis, this.yawRad)
						.add(this.rover.position);

			const ground = this.sampleGround(surface, dropTarget.x, dropTarget.z, crate);
			scene.attach(crate);
			crate.position.set(dropTarget.x, ground.y + 0.38, dropTarget.z);
			crate.rotation.set(0, this.yawRad, 0);
			return matchingZone ? `Delivered ${crate.name} to drop-off zone!` : `Unloaded ${crate.name}`;
		}

		let closest: THREE.Object3D | null = null;
		let bestDist = 4.8;
		const wp = new THREE.Vector3();

		for (const crate of crates) {
			if (crate.userData?.delivered) continue;
			if (this.isCrateFalling(crate)) continue;
			crate.getWorldPosition(wp);
			const d = wp.distanceTo(this.rover.position);
			if (d <= bestDist) {
				bestDist = d;
				closest = crate;
			}
		}

		if (closest) {
			this.rover.attach(closest);
			closest.position.set(0, 0.92, -1.15);
			closest.rotation.set(0, 0, 0);
			this.loadedCrate = closest;
			return `Loaded ${closest.name} onto Rover`;
		}

		return null;
	}

	public applyFirstPersonDriverCamera(
		camera: THREE.PerspectiveCamera,
		headYawOffsetRad: number,
		headPitchRad: number
	): boolean {
		if (!this.rover || !this.isSeated) return false;

		this.rover.updateMatrixWorld(true);
		const eyeWorld = this.eyeLocal.clone().applyMatrix4(this.rover.matrixWorld);
		camera.position.copy(eyeWorld);

		// Head yaw is an offset from the rover's current heading
		const combinedYaw = this.yawRad + headYawOffsetRad;
		const lookDir = new THREE.Vector3(
			Math.sin(combinedYaw) * Math.cos(headPitchRad),
			Math.sin(headPitchRad),
			Math.cos(combinedYaw) * Math.cos(headPitchRad)
		);
		camera.lookAt(camera.position.clone().add(lookDir));
		return true;
	}

	public update(
		dt: number,
		keys: Set<string>,
		playerRoot: THREE.Object3D,
		surface: SurfaceProvider,
		collisions?: CollisionWorld | null
	): RoverUpdateSnapshot {
		// Animate any settling crates
		for (let i = this.fallingCrates.length - 1; i >= 0; i--) {
			const item = this.fallingCrates[i];
			item.velY -= 1.62 * dt;
			item.crate.position.y += item.velY * dt;
			if (item.crate.position.y <= item.targetY) {
				item.crate.position.y = item.targetY;
				this.fallingCrates.splice(i, 1);
			}
		}

		if (!this.rover) return this.idleSnapshot();

		// Rover may have been created before it was added to the scene.
		if (!this.baselineReady && !this.tryCaptureBaseline()) return this.idleSnapshot();

		if (!this.lastSample) {
			this.lastSample = this.sampleGround(surface, this.rover.position.x, this.rover.position.z);
		}

		const surfaceType = this.lastSample.surfaceType ?? 'Sintered_Regolith';
		const speedMult = this.options.surfaceSpeedMultipliers[surfaceType] ?? 1.0;
		const drainMult = this.options.surfaceDrainMultipliers[surfaceType] ?? 0.05;
		const maxSpeedMs = (this.options.defaultMaxSpeedKmh * speedMult) / 3.6;

		let throttle = 0;
		let steerInput = 0;

		if (this.isSeated && this.battery > 0.5) {
			if (keys.has('KeyW') || keys.has('ArrowUp')) throttle += 1;
			if (keys.has('KeyS') || keys.has('ArrowDown')) throttle -= 1;
			if (keys.has('KeyA') || keys.has('ArrowLeft')) steerInput += 1;
			if (keys.has('KeyD') || keys.has('ArrowRight')) steerInput -= 1;
		}

		const accel = 7.5;
		const drag = 4.2;

		if (throttle !== 0) {
			this.speedMs = THREE.MathUtils.clamp(
				this.speedMs + throttle * accel * dt,
				-maxSpeedMs * 0.55,
				maxSpeedMs
			);
		} else {
			const decel = Math.min(Math.abs(this.speedMs), drag * dt);
			this.speedMs -= Math.sign(this.speedMs) * decel;
		}

		const targetSteer = steerInput * THREE.MathUtils.degToRad(32);
		this.steerAngleRad = THREE.MathUtils.lerp(this.steerAngleRad, targetSteer, Math.min(1, dt * 8));

		let movedDistance = 0;

		if (Math.abs(this.speedMs) > 0.02) {
			const reverseSign = this.speedMs >= 0 ? 1 : -1;
			const turnRate =
				(Math.abs(this.speedMs) / Math.max(1.2, this.options.defaultWheelbaseM)) *
				Math.tan(this.steerAngleRad) *
				reverseSign;
			this.yawRad += turnRate * dt;

			// Strictly horizontal world-space XZ displacement (rover lives at the scene root)
			const forwardX = Math.sin(this.yawRad);
			const forwardZ = Math.cos(this.yawRad);
			movedDistance = Math.abs(this.speedMs) * dt;

			this.rover.position.x = THREE.MathUtils.clamp(
				this.rover.position.x + forwardX * this.speedMs * dt,
				-210,
				210
			);
			this.rover.position.z = THREE.MathUtils.clamp(
				this.rover.position.z + forwardZ * this.speedMs * dt,
				-210,
				210
			);

			this.battery = Math.max(0, this.battery - Math.abs(this.speedMs) * drainMult * dt);
		}

		if (collisions) {
			collisions.resolveHorizontal(this.rover.position, 1.35, 1.6, {
				vehicleObj: this.rover,
				includeVehicle: false,
				ignoredObject: this.loadedCrate
			});
		}

		// Ground following. The rover is hidden from the raycast (see sampleGround), and the
		// height is additionally slope-limited: a sample that is higher than the terrain
		// slope could explain over the distance just travelled is treated as a bad hit
		// (e.g. the rover's own roof) and ignored instead of lifting the rover.
		const groundHit = this.sampleGround(
			surface,
			this.rover.position.x,
			this.rover.position.z,
			playerRoot,
			this.loadedCrate
		);

		let groundAccepted = true;
		if (!this.groundReady) {
			this.groundY = groundHit.y;
			this.groundReady = true;
		} else {
			const slopeDeg = Math.max(this.options.defaultMaxSlopeDeg, 25);
			const maxRise = Math.tan(THREE.MathUtils.degToRad(slopeDeg)) * movedDistance + 0.05;
			if (groundHit.y - this.groundY > maxRise) {
				groundAccepted = false;
				if (!this.warnedBadGround) {
					this.warnedBadGround = true;
					console.warn(
						'[OrionRover] Ignored an implausible ground height jump:',
						this.groundY.toFixed(2),
						'->',
						groundHit.y.toFixed(2),
						'. Check SurfaceProvider.sampleSurfaceAt (self-hits / wrong target meshes).'
					);
				}
			} else {
				this.groundY = groundHit.y;
			}
		}

		this.rover.position.y = this.groundY;

		if (groundAccepted) {
			this.lastSample = groundHit;
			this.smoothNormal.lerp(groundHit.normal, Math.min(1, dt * 10)).normalize();
		}

		// Align chassis with terrain slope, keep heading yaw and the model's baked offset
		const yawQuat = new THREE.Quaternion().setFromAxisAngle(this.upAxis, this.yawRad);
		const slopeQuat = new THREE.Quaternion().setFromUnitVectors(this.upAxis, this.smoothNormal);
		this.rover.quaternion.copy(slopeQuat).multiply(yawQuat).multiply(this.modelOffset);

		// Spin wheels visually
		const wheelSpin =
			(this.wheelSpinSign * this.speedMs * dt) / Math.max(0.15, this.options.wheelRadiusM);
		for (const wheel of this.wheels) {
			wheel.rotation.x += wheelSpin;
		}

		const canBoard = !this.isSeated && this.isInBoardingRange(playerRoot.position);
		const headingDeg = Math.round(((THREE.MathUtils.radToDeg(this.yawRad) % 360) + 360) % 360);

		return {
			isSeated: this.isSeated,
			canBoard,
			speedKmh: Math.round(Math.abs(this.speedMs) * 3.6 * 10) / 10,
			headingDeg,
			batteryPct: Math.round(this.battery),
			headlightsOn: this.headlightsOn,
			surfaceType,
			loadedCrateName: this.loadedCrate ? this.loadedCrate.name : null
		};
	}
}
