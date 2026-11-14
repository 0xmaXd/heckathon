import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { lockerRoomScene } from '../../features/01-earth-locker-room/LockerRoomScene';
import { launchRoomScene } from '../../features/02-earth-launch-room/LaunchRoomScene';

export interface CameraPreset {
	position: [number, number, number];
	target: [number, number, number];
}

export interface SceneFrameFeedback {
	orbitTargetY?: number;
	shakeIntensity?: number;
}

export interface GameScene {
	scene: THREE.Scene;
	cameraPreset?: CameraPreset;
	init(): void;
	update?(delta: number): SceneFrameFeedback | void;
}

export class SceneManager {
	private canvas: HTMLCanvasElement | null = null;
	private renderer: THREE.WebGLRenderer | null = null;
	private camera: THREE.PerspectiveCamera | null = null;
	private controls: OrbitControls | null = null;
	private clock = new THREE.Timer();

	private scenes = new Map<number, GameScene>();
	private activeScene: GameScene | null = null;

	constructor() {
		this.scenes.set(1, lockerRoomScene);
		this.scenes.set(2, launchRoomScene);
	}

	init(canvasElement: HTMLCanvasElement) {
		this.canvas = canvasElement;

		this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
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
		this.controls.maxPolarAngle = Math.PI / 2 - 0.05;

		for (const gameScene of this.scenes.values()) {
			gameScene.init();
		}

		this.switchScene(1);
		window.addEventListener('resize', () => this.onWindowResize());
	}

	switchScene(phase: number) {
		const nextScene = this.scenes.get(phase);
		if (!nextScene || !this.camera || !this.controls) return;

		this.activeScene = nextScene;

		const preset = this.activeScene.cameraPreset ?? {
			position: [0, 1.5, 5],
			target: [0, 1, 0]
		};

		this.camera.position.set(...preset.position);
		this.controls.target.set(...preset.target);
		this.controls.update();
	}

	private onWindowResize() {
		if (!this.camera || !this.renderer) return;
		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(window.innerWidth, window.innerHeight);
	}

	render() {
		this.clock.update();
		const delta = this.clock.getDelta();

		if (this.renderer && this.camera && this.controls && this.activeScene) {
			const feedback = this.activeScene.update?.(delta);

			if (feedback?.orbitTargetY !== undefined) {
				const deltaY = feedback.orbitTargetY - this.controls.target.y;
				this.controls.target.y = feedback.orbitTargetY;
				this.camera.position.y += deltaY;
			}

			if (feedback?.shakeIntensity && feedback.shakeIntensity > 0) {
				this.camera.position.x += (Math.random() - 0.5) * feedback.shakeIntensity;
				this.camera.position.y += (Math.random() - 0.5) * feedback.shakeIntensity;
			}

			this.controls.update();
			this.renderer.render(this.activeScene.scene, this.camera);
		}
	}
}

export const sceneManager = new SceneManager();
