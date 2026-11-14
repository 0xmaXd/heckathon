import * as THREE from 'three';
import atmosphereLayers from '#lib/assets/data/nasa/atmosphere_layers.json';
import { GameConfig } from '../../config/game.config';
import { physicsWorld } from '../../core/engine/PhysicsWorld';
import {
	type CameraPreset,
	type GameScene,
	type SceneFrameFeedback,
	sceneManager
} from '../../core/engine/SceneManager';
import { hudStore } from '../../core/hud/hudStore.svelte';
import { missionStore } from '../../core/state/missionStore.svelte';
import { LaunchRoomConfig } from './launch-room.config';
import { launchState, resetLaunchState } from './launchState.svelte';
import hudMeta from './launch-room.hud.json';

export class LaunchRoomScene implements GameScene {
	public scene: THREE.Scene;
	public cameraPreset: CameraPreset = {
		position: [0, 12, 26],
		target: [0, 12, 0],
		maxPolarAngle: Math.PI / 2 - 0.02,
		minDistance: 8,
		maxDistance: 80
	};

	private rocketGroup: THREE.Group;
	private gantryGroup: THREE.Group;
	private flame!: THREE.Mesh;

	private launchElapsed = 0;
	private rocketVelocity = 0;
	private climbRateKmS = 0;
	private altitudeKm = 0;

	private readonly dockedX = 0;
	private readonly undockedX = -1.6;

	constructor() {
		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color(0x5ca2e0);
		this.rocketGroup = new THREE.Group();
		this.gantryGroup = new THREE.Group();
	}

	init() {
		const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
		this.scene.add(ambientLight);

		const sunLight = new THREE.DirectionalLight(0xffdfbb, 1.2);
		sunLight.position.set(-10, 20, 10);
		this.scene.add(sunLight);

		// 1. Launch Pad Base
		const padGeo = new THREE.CylinderGeometry(15, 15, 2, 32);
		const padMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 1.0 });
		const pad = new THREE.Mesh(padGeo, padMat);
		pad.position.y = -1;
		this.scene.add(pad);

		// 2. Rocket Assembly (outer hull at x = -1.5)
		const rocketGeo = new THREE.CylinderGeometry(1.5, 1.5, 18, 32);
		const rocketMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 0.2 });
		const rocketBody = new THREE.Mesh(rocketGeo, rocketMat);
		rocketBody.position.y = 9;
		this.rocketGroup.add(rocketBody);

		const coneGeo = new THREE.ConeGeometry(1.5, 4, 32);
		const cone = new THREE.Mesh(coneGeo, rocketMat);
		cone.position.y = 20;
		this.rocketGroup.add(cone);

		const nozzleGeo = new THREE.ConeGeometry(1.2, 2, 16);
		const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8 });
		const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
		nozzle.position.y = 0.5;
		nozzle.rotation.x = Math.PI;
		this.rocketGroup.add(nozzle);

		// Exhaust Flame
		const flameGeo = new THREE.ConeGeometry(1.4, 6, 16);
		const flameMat = new THREE.MeshBasicMaterial({ color: 0xff6600 });
		this.flame = new THREE.Mesh(flameGeo, flameMat);
		this.flame.position.y = -3.5;
		this.flame.rotation.x = Math.PI;
		this.flame.visible = false;
		this.rocketGroup.add(this.flame);

		this.scene.add(this.rocketGroup);

		// 3. Launch Tower (spans x = -6.0 to -3.0, height = 22)
		const towerGeo = new THREE.BoxGeometry(3, 22, 3);
		const towerMat = new THREE.MeshStandardMaterial({ color: 0xcc3333 });
		const tower = new THREE.Mesh(towerGeo, towerMat);
		tower.position.set(-4.5, 11, 0);
		this.scene.add(tower);

		// 4. Retractable Gantry Arm + Docking Collar
		const armGeo = new THREE.BoxGeometry(2.2, 0.5, 1.2);
		const armMat = new THREE.MeshStandardMaterial({ color: 0x999999 });
		const arm = new THREE.Mesh(armGeo, armMat);
		arm.position.set(-2.7, 16, 0);
		this.gantryGroup.add(arm);

		const collarGeo = new THREE.BoxGeometry(0.25, 1.1, 1.8);
		const collarMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, metalness: 0.5 });
		const collar = new THREE.Mesh(collarGeo, collarMat);
		collar.position.set(-1.62, 16, 0);
		this.gantryGroup.add(collar);

		this.gantryGroup.position.x = this.dockedX;
		this.scene.add(this.gantryGroup);

		// 5. Rocket metadata populated from launch-room.hud.json
		const { nodeName, ...inspectMeta } = hudMeta.inspectables.rocket;
		this.rocketGroup.name = nodeName;
		this.rocketGroup.userData.inspect = inspectMeta;
	}

	onEnter() {
		physicsWorld.reset(GameConfig.physics.gravityEarth);

		resetLaunchState();
		this.launchElapsed = 0;
		this.rocketVelocity = 0;
		this.climbRateKmS = 0;
		this.altitudeKm = 0;
		this.rocketGroup.position.y = 0;
		this.gantryGroup.position.x = this.dockedX;
		this.flame.visible = false;
		this.scene.background = new THREE.Color(0x5ca2e0);

		hudStore.configureScene({
			location: hudMeta.hud.location,
			objective: hudMeta.hud.objective,
			panelTitle: hudMeta.hud.panelTitle,
			telemetry: { ...hudMeta.hud.initialTelemetry },
			actions: [
				{
					id: 'undock',
					label: hudMeta.hud.actions.undock,
					disabled: () =>
						launchState.isIgnited ||
						launchState.dockState === 'UNDOCKED' ||
						launchState.dockState === 'UNDOCKING',
					onClick: () => this.undockGantry()
				},
				{
					id: 'dock',
					label: hudMeta.hud.actions.dock,
					disabled: () =>
						launchState.isIgnited ||
						launchState.dockState === 'DOCKED' ||
						launchState.dockState === 'DOCKING',
					onClick: () => this.dockGantry()
				},
				{
					id: 'ignite',
					label: hudMeta.hud.actions.ignite,
					disabled: () => launchState.dockState !== 'UNDOCKED' || launchState.isIgnited,
					onClick: () => this.igniteEngines()
				},
				{
					id: 'launch',
					label: hudMeta.hud.actions.launch,
					variant: 'danger',
					disabled: () => !launchState.isIgnited || launchState.isLaunched,
					onClick: () => this.releaseClampsAndLaunch()
				}
			]
		});
	}

	onExit() {
		hudStore.reset();
	}

	undockGantry() {
		if (
			!launchState.isIgnited &&
			(launchState.dockState === 'DOCKED' || launchState.dockState === 'DOCKING')
		) {
			launchState.dockState = 'UNDOCKING';
			sceneManager.shake(0.08, 0.2);
		}
	}

	dockGantry() {
		if (
			!launchState.isIgnited &&
			(launchState.dockState === 'UNDOCKED' || launchState.dockState === 'UNDOCKING')
		) {
			launchState.dockState = 'DOCKING';
		}
	}

	igniteEngines() {
		if (launchState.dockState === 'UNDOCKED' && !launchState.isIgnited) {
			launchState.isIgnited = true;
			this.flame.visible = true;
			sceneManager.shake(0.35, 0.5);
		}
	}

	releaseClampsAndLaunch() {
		if (launchState.isIgnited && !launchState.isLaunched) {
			launchState.isLaunched = true;
			sceneManager.shake(0.3, 0.4);
		}
	}

	private getAtmosphereLayer(altitudeKm: number): string {
		const layer = atmosphereLayers.find(
			(l) => altitudeKm >= l.altitudeStartKm && altitudeKm < l.altitudeEndKm
		);
		return layer ? layer.name : 'Exosphere';
	}

	update(delta: number): SceneFrameFeedback {
		const gantrySpeed = 1.2;

		if (launchState.dockState === 'UNDOCKING') {
			this.gantryGroup.position.x -= gantrySpeed * delta;
			if (this.gantryGroup.position.x <= this.undockedX) {
				this.gantryGroup.position.x = this.undockedX;
				launchState.dockState = 'UNDOCKED';
			}
		} else if (launchState.dockState === 'DOCKING') {
			this.gantryGroup.position.x += gantrySpeed * delta;
			if (this.gantryGroup.position.x >= this.dockedX) {
				this.gantryGroup.position.x = this.dockedX;
				launchState.dockState = 'DOCKED';
				sceneManager.shake(0.12, 0.25);
			}
		}

		if (launchState.isIgnited) {
			this.flame.scale.y = (launchState.isLaunched ? 1.2 : 0.6) + Math.random() * 0.4;
		}

		let orbitTargetY: number | undefined;
		const {
			targetAltitudeKm,
			karmanSkyBlackoutKm,
			visualBaseAccel,
			visualThrustRamp,
			baseClimbAccelKmS2,
			climbThrustRampKmS3
		} = LaunchRoomConfig.ascent;

		if (launchState.isLaunched) {
			this.launchElapsed += delta;

			// Visual 3D climb: clears the 22-unit launch tower right around Troposphere exit (~5s)
			const visualAccel = visualBaseAccel + visualThrustRamp * this.launchElapsed;
			this.rocketVelocity += visualAccel * delta;
			this.rocketGroup.position.y += this.rocketVelocity * delta;
			orbitTargetY = this.rocketGroup.position.y + 12;

			// Progressive atmospheric ascent curve (slow off the pad, accelerating as propellant burns)
			const climbAccel = baseClimbAccelKmS2 + climbThrustRampKmS3 * this.launchElapsed;
			this.climbRateKmS += climbAccel * delta;
			this.altitudeKm = Math.min(targetAltitudeKm, this.altitudeKm + this.climbRateKmS * delta);
		}

		launchState.altitudeKm = Math.round(this.altitudeKm);
		launchState.currentLayer = this.getAtmosphereLayer(this.altitudeKm);

		const labels = hudMeta.hud.telemetryLabels;
		hudStore.setTelemetry(labels.dock, launchState.dockState);
		hudStore.setTelemetry(labels.altitude, `${launchState.altitudeKm} km`);
		hudStore.setTelemetry(labels.atmosphere, launchState.currentLayer.toUpperCase());

		// Sky transitions to pitch black across the Kármán line (~100-120 km)
		const spaceFactor = Math.min(1, this.altitudeKm / karmanSkyBlackoutKm);
		this.scene.background = new THREE.Color(0x5ca2e0).lerp(new THREE.Color(0x000000), spaceFactor);

		const shakeIntensity = launchState.isIgnited ? Math.max(0, 0.25 - this.altitudeKm * 0.002) : 0;

		if (this.altitudeKm >= targetAltitudeKm && !launchState.isBlackout) {
			launchState.isBlackout = true;
			launchState.isLaunched = false;
			hudStore.triggerBlackout(hudMeta.hud.blackoutMessage);

			setTimeout(() => {
				missionStore.advancePhase();
			}, 2000);
		}

		return { orbitTargetY, shakeIntensity };
	}
}

export const launchRoomScene = new LaunchRoomScene();
