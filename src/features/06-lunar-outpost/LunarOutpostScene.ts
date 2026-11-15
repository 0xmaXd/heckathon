import * as THREE from 'three';
import {
	sceneManager,
	type CameraController,
	type CameraPreset,
	type GameScene,
	type SceneFrameFeedback
} from '../../core/engine/SceneManager';
import { playerController } from '../../core/player/PlayerController.svelte';
import { lunarOutpostStore } from './lunarOutpostStore.svelte';
import { AstronautController } from './systems/AstronautController';
import { LunarSunCycleSystem } from './systems/LunarSunCycleSystem';
import { MissionGameplaySystem } from './systems/MissionGameplaySystem';
import { OrionRoverSystem } from './systems/OrionRoverSystem';
import { OutpostCollisionSystem } from './systems/OutpostCollisionSystem';
import { OutpostMachinerySystem } from './systems/OutpostMachinerySystem';
import { OutpostWorldBuilder } from './systems/OutpostWorldBuilder';

export class LunarOutpostScene implements GameScene, CameraController {
	public readonly scene = new THREE.Scene();
	public readonly cameraPreset: CameraPreset = {
		position: [11.5, 3.2, -24.0],
		target: [11.5, 2.2, -28.0],
		controlsEnabled: false
	};

	private world = new OutpostWorldBuilder();
	private collisions = new OutpostCollisionSystem();
	private sunCycle = new LunarSunCycleSystem();
	private machinery = new OutpostMachinerySystem();
	private astronaut = new AstronautController();
	private rover = new OrionRoverSystem();
	private mission = new MissionGameplaySystem();

	private suitHeadlamp!: THREE.SpotLight;
	private keys = new Set<string>();
	private isDragging = false;
	private isPointerLocked = false;
	private lastMouseX = 0;
	private lastMouseY = 0;
	private roverHeadYaw = 0;
	private isLoaded = false;

	init() {
		this.scene.background = new THREE.Color(0x03060f);
		this.scene.fog = new THREE.FogExp2(0x050914, 0.00045);
		this.buildStarfield();
		this.buildSuitHeadlamp();

		this.world.load(this.scene).then(() => {
			this.sunCycle.init(this.scene, this.world.lampPositions);
			this.machinery.init(this.world);
			this.astronaut.init(this.scene, 11.5, -24.0, this.world);
			this.rover.init(this.world);

			if (this.world.outpostRoot) {
				this.collisions.buildFromRoot(this.world.outpostRoot, this.world.supplyCrates, () =>
					this.machinery.isAirlockOpen()
				);
			}
			this.isLoaded = true;
		});
	}

	onEnter() {
		const cam = sceneManager.getCamera() as THREE.PerspectiveCamera | null;
		if (cam) {
			cam.near = 0.1;
			cam.updateProjectionMatrix();
		}

		// Boost renderer tone-mapping exposure for bright lunar regolith & crisp shadows
		const renderer = (sceneManager as unknown as { renderer?: THREE.WebGLRenderer }).renderer;
		if (renderer) {
			renderer.shadowMap.enabled = true;
			renderer.shadowMap.type = THREE.PCFSoftShadowMap;
			renderer.toneMapping = THREE.ACESFilmicToneMapping;
			renderer.toneMappingExposure = 1.55;
		}

		sceneManager.setCameraController(this);

		window.addEventListener('keydown', this.handleKeyDown);
		window.addEventListener('keyup', this.handleKeyUp);
		window.addEventListener('mousedown', this.handleMouseDown);
		window.addEventListener('mousemove', this.handleMouseMove);
		window.addEventListener('mouseup', this.handleMouseUp);
		document.addEventListener('pointerlockchange', this.handlePointerLockChange);
	}

	onExit() {
		window.removeEventListener('keydown', this.handleKeyDown);
		window.removeEventListener('keyup', this.handleKeyUp);
		window.removeEventListener('mousedown', this.handleMouseDown);
		window.removeEventListener('mousemove', this.handleMouseMove);
		window.removeEventListener('mouseup', this.handleMouseUp);
		document.removeEventListener('pointerlockchange', this.handlePointerLockChange);

		if (document.pointerLockElement) {
			document.exitPointerLock();
		}

		const renderer = (sceneManager as unknown as { renderer?: THREE.WebGLRenderer }).renderer;
		if (renderer) {
			renderer.toneMapping = THREE.NoToneMapping;
			renderer.toneMappingExposure = 1.0;
		}

		sceneManager.setCameraController(playerController);
		this.keys.clear();
		lunarOutpostStore.reset();
	}

	public dismissDiscoveryCard() {
		this.mission.dismissDiscoveryCard();
	}

	private buildSuitHeadlamp() {
		this.suitHeadlamp = new THREE.SpotLight(0xf0f9ff, 6.5, 58, Math.PI / 3.8, 0.55, 1.0);
		this.scene.add(this.suitHeadlamp);
		this.scene.add(this.suitHeadlamp.target);
	}

	private buildStarfield() {
		const starCount = 2800;
		const positions = new Float32Array(starCount * 3);
		for (let i = 0; i < starCount; i++) {
			const theta = Math.random() * Math.PI * 2;
			const phi = Math.acos(Math.random() * 0.96);
			const r = 740;
			positions[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
			positions[i * 3 + 1] = Math.cos(phi) * r + 20;
			positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		this.scene.add(
			new THREE.Points(
				geo,
				new THREE.PointsMaterial({ color: 0xe2e8f0, size: 1.4, sizeAttenuation: false, fog: false })
			)
		);
	}

	private handlePointerLockChange = () => {
		this.isPointerLocked = document.pointerLockElement?.id === 'game-canvas';
	};

	private handleMouseDown = (e: MouseEvent) => {
		const target = e.target as HTMLElement | null;
		if (target?.id !== 'game-canvas') return;

		this.isDragging = true;
		this.lastMouseX = e.clientX;
		this.lastMouseY = e.clientY;

		if (
			!this.isPointerLocked &&
			!this.mission.activeDiscoveryCard &&
			this.mission.phase !== 'launched'
		) {
			target.requestPointerLock?.();
		}
	};

	private handleMouseMove = (e: MouseEvent) => {
		if (!this.isPointerLocked && !this.isDragging) return;

		const dx = this.isPointerLocked ? e.movementX : e.clientX - this.lastMouseX;
		const dy = this.isPointerLocked ? e.movementY : e.clientY - this.lastMouseY;
		this.lastMouseX = e.clientX;
		this.lastMouseY = e.clientY;

		const sensitivity = 0.0028;
		if (this.rover.isSeated) {
			this.roverHeadYaw = THREE.MathUtils.clamp(this.roverHeadYaw - dx * sensitivity, -1.6, 1.6);
		} else {
			this.astronaut.yawRad -= dx * sensitivity;
		}

		this.astronaut.pitchRad = THREE.MathUtils.clamp(
			this.astronaut.pitchRad - dy * sensitivity,
			-1.42,
			1.42
		);
	};

	private handleMouseUp = () => {
		this.isDragging = false;
	};

	private handleKeyDown = (e: KeyboardEvent) => {
		const target = e.target as HTMLElement | null;
		if (
			target &&
			(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
		) {
			return;
		}

		this.keys.add(e.code);
		if (!this.isLoaded) return;

		if (e.code === 'KeyE') {
			if (this.rover.isSeated) {
				this.rover.toggleEnterExit(this.astronaut.root, this.world);
				this.astronaut.yawRad = this.rover.rover?.rotation.y ?? this.astronaut.yawRad;
				this.roverHeadYaw = 0;
				return;
			}
			if (this.rover.isInBoardingRange(this.astronaut.root.position)) {
				this.rover.toggleEnterExit(this.astronaut.root, this.world);
				this.roverHeadYaw = 0;
				return;
			}
			const interacted = this.mission.handleContextInteract(
				this.astronaut.root.position,
				this.scene,
				this.world,
				this.machinery
			);
			if (interacted) {
				if (this.mission.activeDiscoveryCard && document.pointerLockElement) {
					document.exitPointerLock();
				}
				if (this.mission.phase === 'launched') {
					sceneManager.shake(0.35, 1.4);
					if (document.pointerLockElement) document.exitPointerLock();
				}
			}
		} else if (e.code === 'KeyF') {
			if (this.rover.isSeated) {
				this.rover.loadOrUnloadCrate(this.world.supplyCrates, this.scene, this.world);
			} else {
				this.astronaut.pickUpOrDropCrate(this.world.supplyCrates, this.scene, this.world);
			}
		} else if (e.code === 'KeyL' && this.rover.isSeated) {
			this.rover.toggleHeadlights();
		} else if (e.code === 'Escape') {
			this.mission.dismissDiscoveryCard();
		}
	};

	private handleKeyUp = (e: KeyboardEvent) => {
		this.keys.delete(e.code);
	};

	updateCamera(_delta: number, camera: THREE.PerspectiveCamera): boolean {
		if (!this.isLoaded) return false;

		if (this.rover.isSeated) {
			this.rover.applyFirstPersonDriverCamera(camera, this.roverHeadYaw, this.astronaut.pitchRad);
		} else {
			this.astronaut.applyFirstPersonCamera(camera);
		}

		// Sync EVA suit visor headlamp with active first-person view
		const dir = new THREE.Vector3();
		camera.getWorldDirection(dir);
		this.suitHeadlamp.position.copy(camera.position);
		this.suitHeadlamp.target.position.copy(camera.position).addScaledVector(dir, 14);
		this.suitHeadlamp.target.updateMatrixWorld();
		this.suitHeadlamp.visible = !this.rover.isSeated;

		return true;
	}

	update(delta: number): SceneFrameFeedback | void {
		if (!this.isLoaded) return;

		const focusPos =
			this.rover.isSeated && this.rover.rover
				? this.rover.rover.position
				: this.astronaut.root.position;

		const solarState = this.sunCycle.update(delta, focusPos);
		this.machinery.update(delta);

		if (!this.rover.isSeated) {
			this.astronaut.updateOnFoot(delta, this.keys, this.world, this.collisions, this.rover.rover);
		}
		const roverState = this.rover.update(
			delta,
			this.keys,
			this.astronaut.root,
			this.world,
			this.collisions
		);

		const hudSnapshot = this.mission.update(
			delta,
			this.scene,
			this.world,
			this.astronaut,
			this.rover,
			this.machinery,
			roverState,
			solarState,
			this.isPointerLocked
		);
		lunarOutpostStore.update(hudSnapshot);
	}
}

export const lunarOutpostScene = new LunarOutpostScene();
