import * as THREE from 'three';
import type { CameraPreset, GameScene } from '../../core/engine/SceneManager';
import { hudStore } from '../../core/hud/hudStore.svelte';
import { missionStore } from '../../core/state/missionStore.svelte';
import hudMeta from './locker.hud.json';

export class LockerRoomScene implements GameScene {
	public scene: THREE.Scene;
	public cameraPreset: CameraPreset = {
		position: [0, 1.5, 5],
		target: [0, 1, 0],
		maxPolarAngle: Math.PI / 2 - 0.05,
		minDistance: 1.5,
		maxDistance: 8
	};

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
		const lockerPositionsX = [-2, -1, 0];

		hudMeta.inspectables.lockers.forEach((meta, index) => {
			const locker = new THREE.Mesh(lockerGeo, lockerMat);
			locker.position.set(lockerPositionsX[index] ?? index - 2, 1, -3);
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

	onEnter() {
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
		hudStore.reset();
	}
}

export const lockerRoomScene = new LockerRoomScene();
