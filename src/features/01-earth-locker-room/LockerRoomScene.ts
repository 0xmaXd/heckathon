import * as THREE from 'three';
import { GameConfig } from '../../config/game.config';
import { physicsWorld } from '../../core/engine/PhysicsWorld';
import type { CameraPreset, GameScene } from '../../core/engine/SceneManager';
import { hudStore } from '../../core/hud/hudStore.svelte';
import { missionStore } from '../../core/state/missionStore.svelte';
import hudMeta from './locker.hud.json';
import { playerController } from '../../core/player/PlayerController.svelte';

export class LockerRoomScene implements GameScene {
	public scene: THREE.Scene;
	public cameraPreset: CameraPreset = {
		position: [0, 1.5, 5],
		target: [0, 1, 0],
		maxPolarAngle: Math.PI / 2 - 0.05,
		minDistance: 1.5,
		maxDistance: 8
	};

	private readonly lockerPositionsX = [-2, -1, 0];

	constructor() {
		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color(0x111111);
		this.scene.fog = new THREE.Fog(0x111111, 2, 15);
	}

	init() {
		const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
		this.scene.add(ambientLight);

		const ceilingLight = new THREE.PointLight(0xaaccff, 1, 10);
		ceilingLight.position.set(0, 4, 0);
		this.scene.add(ceilingLight);

		const floorGeo = new THREE.PlaneGeometry(10, 10);
		const floorMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 });
		const floor = new THREE.Mesh(floorGeo, floorMat);
		floor.rotation.x = -Math.PI / 2;
		this.scene.add(floor);

		// 3 EVA Equipment Lockers populated from locker.hud.json
		const lockerGeo = new THREE.BoxGeometry(0.8, 2, 0.8);
		const lockerMat = new THREE.MeshStandardMaterial({ color: 0x1f4b8e });

		hudMeta.inspectables.lockers.forEach((meta, index) => {
			const x = this.lockerPositionsX[index] ?? index - 2;
			const locker = new THREE.Mesh(lockerGeo, lockerMat);
			locker.position.set(x, 1, -3);
			locker.name = meta.name;
			locker.userData.inspect = meta;
			this.scene.add(locker);
		});

		// Utility Terminal populated from locker.hud.json
		const terminalGeo = new THREE.BoxGeometry(1.5, 1, 1);
		const terminalMat = new THREE.MeshStandardMaterial({ color: 0xcca300 });
		const terminal = new THREE.Mesh(terminalGeo, terminalMat);
		terminal.position.set(2, 0.5, -2);
		terminal.name = hudMeta.inspectables.terminal.name;
		terminal.userData.inspect = hudMeta.inspectables.terminal;
		this.scene.add(terminal);
	}

	private buildColliders() {
		physicsWorld.reset(GameConfig.physics.gravityEarth);

		// 1. Floor top surface at y = 0 (PlaneGeometry 10x10 -> half-extents 5 x 0.5 x 5)
		physicsWorld.addFixedBox([5, 0.5, 5], [0, -0.5, 0]);

		// 2. Room boundary walls so the player cannot walk off the 10x10 platform
		physicsWorld.addFixedBox([5.5, 2, 0.25], [0, 2, -5.25]); // Back wall
		physicsWorld.addFixedBox([5.5, 2, 0.25], [0, 2, 5.25]); // Front wall
		physicsWorld.addFixedBox([0.25, 2, 5.5], [-5.25, 2, 0]); // Left wall
		physicsWorld.addFixedBox([0.25, 2, 5.5], [5.25, 2, 0]); // Right wall

		// 3. Static colliders for the 3 lockers (0.8 x 2.0 x 0.8 -> half-extents 0.4 x 1.0 x 0.4)
		hudMeta.inspectables.lockers.forEach((_, index) => {
			const x = this.lockerPositionsX[index] ?? index - 2;
			physicsWorld.addFixedBox([0.4, 1.0, 0.4], [x, 1.0, -3]);
		});

		// 4. Static collider for the Utility Terminal (1.5 x 1.0 x 1.0 -> half-extents 0.75 x 0.5 x 0.5)
		physicsWorld.addFixedBox([0.75, 0.5, 0.5], [2, 0.5, -2]);

		// 5. Proximity trigger sensor around the terminal for HUD interaction prompts
		physicsWorld.addSensorBox([1.35, 1.0, 1.35], [2, 1.0, -2], {
			onEnter: () => hudStore.setPrompt('E', 'Access Diagnostic Terminal'),
			onExit: () => hudStore.clearPrompt()
		});
	}

	onEnter() {
		this.buildColliders();

		playerController.spawn({
			position: [0, 0.9, 3.5],
			yaw: 0,
			profile: 'earthWalk'
		});

		hudStore.configureScene({
			location: hudMeta.hud.location,
			objective: hudMeta.hud.objective,
			panelTitle: hudMeta.hud.panelTitle,
			actions: [
				{
					id: 'proceed-pad',
					label: hudMeta.hud.actions.proceedPad,
					variant: 'success',
					onClick: () => missionStore.advancePhase()
				}
			]
		});
	}

	onExit() {
		playerController.despawn();
		hudStore.reset();
	}
}

export const lockerRoomScene = new LockerRoomScene();
