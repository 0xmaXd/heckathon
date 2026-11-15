import { untrack } from 'svelte';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface CameraPreset {
	position: [number, number, number];
	target: [number, number, number];
	maxPolarAngle?: number;
	minDistance?: number;
	maxDistance?: number;
	controlsEnabled?: boolean;
}

export interface SceneFrameFeedback {
	orbitTargetY?: number;
	orbitTarget?: [number, number, number];
	shakeIntensity?: number;
}

export interface GameScene {
	scene: THREE.Scene;
	cameraPreset?: CameraPreset;
	init(): void;
	onEnter?(): void;
	onExit?(): void;
	update?(delta: number): SceneFrameFeedback | void;
}

export interface CameraController {
	updateCamera(delta: number, camera: THREE.PerspectiveCamera): boolean;
}

export class SceneManager {
	private canvas: HTMLCanvasElement | null = null;
	private renderer: THREE.WebGLRenderer | null = null;
	private camera: THREE.PerspectiveCamera | null = null;
	private controls: OrbitControls | null = null;
	private clock = new THREE.Timer();
	private fps = 0;
	private fpsFrames = 0;
	private fpsElapsed = 0;

	private scenes = new Map<number, GameScene>();
	private initializedScenes = new Set<number>();
	private activeScene: GameScene | null = null;
	private currentPhase = 1;

	// Camera shake state (supports both one-shot impulses and continuous scene feedback)
	private lastShake = new THREE.Vector3();
	private shakeTimeRemaining = 0;
	private shakeDuration = 0;
	private shakeMaxIntensity = 0;

	// Ray Casting YAY!!!!!!
	private raycaster = new THREE.Raycaster();

	private cameraController: CameraController | null = null;

	private boundResize = () => this.onWindowResize();

	registerScene(phase: number, gameScene: GameScene) {
		this.scenes.set(phase, gameScene);
	}

	hasScene(phase: number): boolean {
		return this.scenes.has(phase);
	}

	// Registration for Camera
	setCameraController(controller: CameraController | null) {
		this.cameraController = controller;
	}

	init(canvasElement: HTMLCanvasElement) {
		this.canvas = canvasElement;

		this.renderer = new THREE.WebGLRenderer({
			canvas: this.canvas,
			antialias: true
		});
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

		this.camera = new THREE.PerspectiveCamera(
			75,
			window.innerWidth / window.innerHeight,
			0.1,
			2000
		);

		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.05;

		this.switchScene(this.currentPhase);
		window.addEventListener('resize', this.boundResize);
	}

	getFps(): number {
		return this.fps;
	}

	/**
	 * Scene switches call into $state-backed stores (PlayerController, hudStore). If the caller is a
	 * Svelte $effect, those reads/writes would be tracked and the effect would re-run itself forever
	 * (effect_update_depth_exceeded). Running the whole switch untracked prevents that.
	 */
	switchScene(phase: number): number {
		return untrack(() => this.switchSceneUntracked(phase));
	}

	private switchSceneUntracked(phase: number): number {
		let resolvedPhase = phase;

		if (!this.scenes.has(resolvedPhase)) {
			const upcoming = [...this.scenes.keys()]
				.filter((p) => p > resolvedPhase)
				.sort((a, b) => a - b);
			if (upcoming.length > 0) {
				resolvedPhase = upcoming[0];
			}
		}

		this.currentPhase = resolvedPhase;

		const nextScene = this.scenes.get(resolvedPhase);
		if (!nextScene || !this.camera || !this.controls) return resolvedPhase;

		this.activeScene?.onExit?.();

		// Lazy-initialize only when the phase is entered for the first time
		if (!this.initializedScenes.has(resolvedPhase)) {
			nextScene.init();
			this.initializedScenes.add(resolvedPhase);
		}

		this.activeScene = nextScene;

		// Clear any active camera shake from the previous scene
		this.lastShake.set(0, 0, 0);
		this.shakeTimeRemaining = 0;
		this.shakeMaxIntensity = 0;

		const preset = this.activeScene.cameraPreset ?? {
			position: [0, 1.5, 5],
			target: [0, 1, 0]
		};

		this.controls.enabled = preset.controlsEnabled ?? true;
		this.controls.maxPolarAngle = preset.maxPolarAngle ?? Math.PI / 2 - 0.05;
		this.controls.minDistance = preset.minDistance ?? 1;
		this.controls.maxDistance = preset.maxDistance ?? 500;

		this.camera.position.set(...preset.position);
		this.controls.target.set(...preset.target);
		this.controls.update();

		this.activeScene.onEnter?.();
		return resolvedPhase;
	}

	setCameraView(position: [number, number, number], target: [number, number, number]) {
		if (!this.camera || !this.controls) return;
		this.camera.position.set(...position);
		this.controls.target.set(...target);
		this.controls.update();
	}

	/**
	 * Universal camera shake usable from any scene, collision, or UI event.
	 * @param intensity Peak displacement in world units (e.g., 0.1 = subtle thud, 0.5 = heavy impact)
	 * @param duration Duration in seconds before shake decays to zero (default: 0.35s)
	 */
	shake(intensity: number, duration = 0.35) {
		if (intensity <= 0 || duration <= 0) return;

		// Preserve whichever shake is stronger if one is already active
		if (intensity >= this.shakeMaxIntensity || this.shakeTimeRemaining <= 0) {
			this.shakeMaxIntensity = intensity;
			this.shakeDuration = duration;
			this.shakeTimeRemaining = duration;
		} else {
			this.shakeTimeRemaining = Math.max(this.shakeTimeRemaining, duration);
		}
	}

	private onWindowResize() {
		if (!this.camera || !this.renderer) return;
		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(window.innerWidth, window.innerHeight);
	}

	// Method for picking up object with the ray caster
	pickObject(ndcX: number, ndcY: number): THREE.Object3D | null {
		if (!this.camera || !this.activeScene) return null;

		this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
		const hits = this.raycaster.intersectObjects(this.activeScene.scene.children, true);

		return hits.length > 0 ? hits[0].object : null;
	}

	// Getting camera position for stuff like changing hiding dialog, etc.
	getCameraPosition(target = new THREE.Vector3()): THREE.Vector3 | null {
		if (!this.camera) return null;
		return this.camera.getWorldPosition(target);
	}

	public getCamera(): THREE.Camera | null {
		return this.camera;
	}

	// Get the World point of the object
	projectWorldPoint(
		worldPos: THREE.Vector3,
		out = new THREE.Vector3()
	): { x: number; y: number; z: number; inFront: boolean } | null {
		if (!this.camera) return null;

		out.copy(worldPos).project(this.camera);

		return {
			x: (out.x * 0.5 + 0.5) * window.innerWidth,
			y: (-out.y * 0.5 + 0.5) * window.innerHeight,
			z: out.z,
			inFront: out.z >= -1 && out.z <= 1
		};
	}

	render() {
		this.clock.update();
		const delta = Math.min(this.clock.getDelta(), 0.1);

		// Update smoothed FPS readout every 0.25s
		if (delta > 0) {
			this.fpsFrames++;
			this.fpsElapsed += delta;
			if (this.fpsElapsed >= 0.25) {
				this.fps = Math.round(this.fpsFrames / this.fpsElapsed);
				this.fpsFrames = 0;
				this.fpsElapsed = 0;
			}
		}

		if (this.renderer && this.camera && this.controls && this.activeScene) {
			// 1. Subtract previous frame's shake offset so controls calculate from true position
			this.camera.position.sub(this.lastShake);
			this.lastShake.set(0, 0, 0);

			// 2. Step active scene and apply vertical orbit tracking if requested
			const feedback = this.activeScene.update?.(delta);

			// 3. Let PlayerController drive the camera if active; otherwise use OrbitControls
			const drivenByPlayer = this.cameraController?.updateCamera(delta, this.camera) ?? false;
			const allowOrbit =
				!drivenByPlayer && (this.activeScene.cameraPreset?.controlsEnabled ?? true);
			this.controls.enabled = allowOrbit;

			if (allowOrbit) {
				if (feedback?.orbitTarget) {
					const [tx, ty, tz] = feedback.orbitTarget;
					const dx = tx - this.controls.target.x;
					const dy = ty - this.controls.target.y;
					const dz = tz - this.controls.target.z;
					this.controls.target.set(tx, ty, tz);
					this.camera.position.x += dx;
					this.camera.position.y += dy;
					this.camera.position.z += dz;
				} else if (feedback?.orbitTargetY !== undefined) {
					const deltaY = feedback.orbitTargetY - this.controls.target.y;
					this.controls.target.y = feedback.orbitTargetY;
					this.camera.position.y += deltaY;
				}
				this.controls.update();
			}

			// 4. Compute combined shake (continuous scene feedback vs. decaying impulse shake)
			let impulseIntensity = 0;
			if (this.shakeTimeRemaining > 0) {
				const progress = this.shakeTimeRemaining / this.shakeDuration;
				impulseIntensity = this.shakeMaxIntensity * (progress * progress);
				this.shakeTimeRemaining = Math.max(0, this.shakeTimeRemaining - delta);
			}

			const totalShake = Math.max(feedback?.shakeIntensity ?? 0, impulseIntensity);

			if (totalShake > 0) {
				this.lastShake.set(
					(Math.random() - 0.5) * totalShake,
					(Math.random() - 0.5) * totalShake,
					(Math.random() - 0.5) * totalShake * 0.5
				);
				this.camera.position.add(this.lastShake);
			}

			this.renderer.render(this.activeScene.scene, this.camera);
		}
	}

	dispose() {
		window.removeEventListener('resize', this.boundResize);
		this.controls?.dispose();
		this.renderer?.dispose();
	}
}

export const sceneManager = new SceneManager();
