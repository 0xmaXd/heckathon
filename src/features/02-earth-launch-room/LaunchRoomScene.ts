import { untrack } from 'svelte';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
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
import { IssLiveTracker } from './IssLiveTracker';
import { LaunchRoomConfig } from './launch-room.config';
import launchHudData from './launch-room.hud.json';
import {
	buildFallbackMobileLauncherDock,
	buildFallbackSlsOrion,
	buildOrbitalIssStation,
	buildPadEnvironment,
	type OrbitalIssRefs,
	type PadEnvironmentRefs
} from './LaunchRoomBuilders';
import { type LaunchActionId, LaunchRoomInspector } from './LaunchRoomInspector';
import { launchState, resetLaunchState } from './launchState.svelte';
import { createSLSExhaustFire, type SLSExhaustFireController } from './SLSExhaustFire';

const PAD_DECK_Y = 8.0;
const LAUNCH_KEY_CODES = new Set(['KeyU', 'KeyI', 'Space', 'KeyB', 'KeyR', 'Enter', 'Escape']);

interface SolarWingRig {
	node: THREE.Object3D;
	openPos: THREE.Vector3;
	stowedPos: THREE.Vector3;
	openQuat: THREE.Quaternion;
	stowedQuat: THREE.Quaternion;
	openScale: THREE.Vector3;
}

export class LaunchRoomScene implements GameScene {
	public scene: THREE.Scene;
	public cameraPreset: CameraPreset = {
		position: [56, 48, 96],
		target: [0, 46, 0],
		maxPolarAngle: Math.PI / 2 - 0.01,
		minDistance: 14,
		maxDistance: 340
	};

	private inspector = new LaunchRoomInspector(launchHudData.inspectables);
	private issTracker: IssLiveTracker;
	private slsRocket: THREE.Group | null = null;
	private dockRoot: THREE.Group | null = null;
	private slsFire: SLSExhaustFireController | null = null;
	private padEnv: PadEnvironmentRefs | null = null;
	private issStation: OrbitalIssRefs | null = null;

	private srbLeft: THREE.Object3D | null = null;
	private srbRight: THREE.Object3D | null = null;
	private srbLeftBasePos = new THREE.Vector3(-6.32, 0, 0);
	private srbRightBasePos = new THREE.Vector3(6.32, 0, 0);

	private lasObject: THREE.Object3D | null = null;
	private lasBasePos = new THREE.Vector3(0, 83.02, 0);

	private solarWings: SolarWingRig[] = [];

	private crewAccessArm: THREE.Object3D | null = null;
	private icpsArm: THREE.Object3D | null = null;
	private coreArm: THREE.Object3D | null = null;
	private holdDownClamps: THREE.Object3D[] = [];

	private dockProgress = 0;
	private ignitionRamp = 0;
	private visualAltitudeM = 0;
	private visualVelocityMs = 0;
	private boosterSepTimeSec = 0;
	private lasJettisoned = false;
	private lasSepTimeSec = 0;
	private solarDeployProgress = 0;
	private solarDeployAnnounced = false;
	private sceneCompleted = false;
	private endSceneTimerId: number | null = null;
	private pulseClock = 0;

	private skyColorDay = new THREE.Color(0x6fa4dc);
	private skyColorSpace = new THREE.Color(0x040711);
	private currentSkyColor = new THREE.Color(0x6fa4dc);

	private boundKeyDown = (e: KeyboardEvent) => this.handleKeyEvent(e, true);
	private boundKeyUp = (e: KeyboardEvent) => this.handleKeyEvent(e, false);
	private boundPointerDown = (e: PointerEvent) => {
		if (e.button === 1) {
			e.preventDefault();
			e.stopPropagation();
			hudStore.clearInspection();
			this.inspector.inspectAtPointer(e.clientX, e.clientY, sceneManager.getCamera());
		}
	};

	constructor() {
		this.scene = new THREE.Scene();
		this.scene.background = this.skyColorDay.clone();
		this.scene.fog = new THREE.FogExp2(0x88b4e2, 0.0011);

		this.inspector.setActionHandler((action) => this.executeAction(action));
		this.issTracker = new IssLiveTracker((data) => {
			launchState.nasaApiKeyConfigured = data.hasApiKey;
			launchState.issStatusText = data.statusLabel;

			if (data.hasApiKey) {
				this.inspector.updateLiveIssSpecs(data.statusLabel, data.altitudeKm, data.velocityKmh);
			}

			hudStore.setTelemetry('ISS LIVE', data.statusLabel);
			this.inspector.updateKeyboardBanner();
		});
	}

	init() {
		this.scene.add(new THREE.HemisphereLight(0xe4f0ff, 0x4b5548, 0.95));

		const sunLight = new THREE.DirectionalLight(0xfff6e5, 2.3);
		sunLight.position.set(95, 150, 80);
		this.scene.add(sunLight);

		this.padEnv = buildPadEnvironment(this.scene);
		this.issStation = buildOrbitalIssStation(this.scene);
		this.loadModels();
	}

	private loadModels() {
		const loader = new GLTFLoader();

		loader.load(
			'/models/mobile_dock.glb',
			(gltf) => this.attachDock(gltf.scene),
			undefined,
			() => this.attachDock(buildFallbackMobileLauncherDock())
		);

		loader.load(
			'/models/Orion.glb',
			(gltf) => this.attachRocket(gltf.scene),
			undefined,
			() => this.attachRocket(buildFallbackSlsOrion())
		);
	}

	private findNode(
		root: THREE.Object3D,
		exactName: string,
		partialLower: string
	): THREE.Object3D | null {
		const exact = root.getObjectByName(exactName);
		if (exact) return exact;
		let found: THREE.Object3D | null = null;
		root.traverse((obj) => {
			if (!found && obj.name.toLowerCase().includes(partialLower)) {
				found = obj;
			}
		});
		return found;
	}

	private attachDock(group: THREE.Group) {
		if (this.dockRoot) this.scene.remove(this.dockRoot);
		this.dockRoot = group;
		this.scene.add(group);

		this.crewAccessArm = this.findNode(group, 'Dock_Crew_Access_Arm', 'crew_access');
		this.icpsArm = this.findNode(group, 'Dock_ICPS_Umbilical_Arm', 'icps_umbilical');
		this.coreArm = this.findNode(group, 'Dock_Core_Intertank_Arm', 'core_intertank');

		this.holdDownClamps = [];
		group.traverse((obj) => {
			if (obj.name.toLowerCase().includes('holddown')) {
				this.holdDownClamps.push(obj);
			}
		});
		this.applyDockTransforms(this.dockProgress);
		this.syncInspectTargets();
	}

	private attachRocket(group: THREE.Group) {
		if (this.slsRocket) {
			this.slsFire?.dispose();
			this.scene.remove(this.slsRocket);
		}
		this.slsRocket = group;
		this.slsRocket.position.set(0, PAD_DECK_Y + this.visualAltitudeM, 0);
		this.scene.add(group);

		this.srbLeft = this.findNode(group, 'SLS_SRB_Left', 'srb_left');
		this.srbRight = this.findNode(group, 'SLS_SRB_Right', 'srb_right');
		if (this.srbLeft) this.srbLeftBasePos.copy(this.srbLeft.position);
		if (this.srbRight) this.srbRightBasePos.copy(this.srbRight.position);

		this.lasObject = this.findNode(group, 'Orion_Launch_Abort_System', 'launch_abort');
		if (this.lasObject) this.lasBasePos.copy(this.lasObject.position);

		// Collect top-level solar wing groups AND any ungrouped solar/panel meshes
		this.solarWings = [];
		const wingNodes: THREE.Object3D[] = [];
		const groupedSet = new Set<THREE.Object3D>();

		group.traverse((obj) => {
			if (obj.name.toLowerCase().includes('solararray')) {
				wingNodes.push(obj);
				obj.traverse((child) => groupedSet.add(child));
			}
		});

		group.traverse((obj) => {
			if (groupedSet.has(obj)) return;
			const low = obj.name.toLowerCase();
			if (low.includes('solar') || low.includes('panel') || low.includes('wing')) {
				wingNodes.push(obj);
			}
		});

		group.updateMatrixWorld(true);
		const box = new THREE.Box3();
		const wingCenter = new THREE.Vector3();

		for (const obj of wingNodes) {
			const openPos = obj.position.clone();
			const openQuat = obj.quaternion.clone();
			const openScale = obj.scale.clone();

			box.setFromObject(obj);
			box.getCenter(wingCenter);
			if (obj.parent) {
				obj.parent.worldToLocal(wingCenter);
			}
			const radial = new THREE.Vector3(wingCenter.x, 0, wingCenter.z);
			if (radial.lengthSq() > 0.0001) {
				radial.normalize();
			} else {
				radial.set(1, 0, 0);
			}

			const stowedPos = openPos.clone().addScaledVector(radial, -2.6);
			const foldAxis = new THREE.Vector3(-radial.z, 0, radial.x).normalize();
			const foldQuat = new THREE.Quaternion().setFromAxisAngle(
				foldAxis,
				THREE.MathUtils.degToRad(86)
			);
			const stowedQuat = foldQuat.multiply(openQuat);

			this.solarWings.push({
				node: obj,
				openPos,
				stowedPos,
				openQuat,
				stowedQuat,
				openScale
			});
		}

		this.applySolarArrayDeploy(this.solarDeployProgress);
		this.slsFire = createSLSExhaustFire(group);
		this.syncInspectTargets();
	}

	private applySolarArrayDeploy(t: number) {
		const slideT = THREE.MathUtils.smoothstep(t, 0.0, 0.45);
		const unfoldT = THREE.MathUtils.smoothstep(t, 0.2, 1.0);

		for (const w of this.solarWings) {
			w.node.visible = t > 0.01;
			w.node.position.lerpVectors(w.stowedPos, w.openPos, slideT);
			w.node.quaternion.slerpQuaternions(w.stowedQuat, w.openQuat, unfoldT);
			w.node.scale.copy(w.openScale).multiplyScalar(0.1 + 0.9 * slideT);
		}
	}

	private syncInspectTargets() {
		const targets: THREE.Object3D[] = [];
		if (this.slsRocket) targets.push(this.slsRocket);
		if (this.dockRoot) targets.push(this.dockRoot);
		if (this.issStation) targets.push(this.issStation.root);
		this.inspector.setTargets(targets);
	}

	private blurFocusedElement() {
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
	}

	private clearEndSceneTimer() {
		if (this.endSceneTimerId !== null) {
			window.clearTimeout(this.endSceneTimerId);
			this.endSceneTimerId = null;
		}
	}

	private syncHudActions() {
		untrack(() => {
			const actions: Array<{ id: string; label: string; onClick: () => void }> = [];

			if (!launchState.isIgnited && !launchState.isLaunched) {
				actions.push({
					id: 'undock',
					label:
						launchState.dockState === 'DOCKED' || launchState.dockState === 'DOCKING'
							? '[U] Undock Bridge'
							: '[U] Re-Dock Bridge',
					onClick: () => this.executeAction('undock')
				});
			}
			if (launchState.dockState === 'UNDOCKED' && !launchState.isIgnited) {
				actions.push({
					id: 'ignite',
					label: '[I] Ignite Engines',
					onClick: () => this.executeAction('ignite')
				});
			}
			if (launchState.isIgnited && !launchState.isLaunched) {
				actions.push({
					id: 'liftoff',
					label: '[SPACE] Blast Off!',
					onClick: () => this.executeAction('liftoff')
				});
			}
			if (launchState.isBoosterQtePaused && !launchState.boostersDetached) {
				actions.push({
					id: 'detach_boosters',
					label: '[B] Drop Boosters',
					onClick: () => this.executeAction('detach_boosters')
				});
			}
			if (
				launchState.isLaunched &&
				launchState.altitudeKm >= LaunchRoomConfig.ascent.sceneEndAltitudeKm
			) {
				actions.push({
					id: 'complete_orbit',
					label: '[ENTER] End Scene (600 km)',
					onClick: () => this.executeAction('complete_orbit')
				});
			}
			actions.push({
				id: 'reset',
				label: '[R] Reset Pad',
				onClick: () => this.executeAction('reset')
			});

			hudStore.actions = actions;
			this.inspector.updateKeyboardBanner();
		});
	}

	private executeAction(action: LaunchActionId) {
		this.blurFocusedElement();

		switch (action) {
			case 'reset':
				this.resetSequence();
				return;

			case 'undock':
				if (!launchState.isIgnited && !launchState.isLaunched) {
					if (launchState.dockState === 'DOCKED') {
						launchState.dockState = 'UNDOCKING';
						hudStore.setComms('Swinging the White Room bridge away from Orion!');
					} else if (launchState.dockState === 'UNDOCKED') {
						launchState.dockState = 'DOCKING';
						hudStore.setComms('Swinging the bridge back to Orion!');
					}
					this.syncHudActions();
				}
				return;

			case 'ignite':
				if (launchState.dockState === 'UNDOCKED' && !launchState.isIgnited) {
					launchState.isIgnited = true;
					sceneManager.shake(0.32, 0.75);
					hudStore.setComms('ROAR! 4 RS-25 main engines lit! Press [SPACE] to blast off!');
					this.syncHudActions();
				}
				return;

			case 'liftoff':
				if (launchState.isIgnited && !launchState.isLaunched) {
					launchState.isLaunched = true;
					sceneManager.shake(0.62, 0.95);
					hudStore.setComms('3... 2... 1... BLAST OFF! Climbing through the Troposphere!');
					this.syncHudActions();
				}
				return;

			case 'detach_boosters':
				if (launchState.isBoosterQtePaused && !launchState.boostersDetached) {
					launchState.boostersDetached = true;
					launchState.isBoosterQtePaused = false;
					this.boosterSepTimeSec = 0;
					sceneManager.shake(0.35, 0.5);
					this.inspector.completeBoosterQte();
					hudStore.setComms('SRB SEPARATION! Empty boosters peeling away at 45 km!');
					this.syncHudActions();
				}
				return;

			case 'complete_orbit':
				if (
					launchState.isLaunched &&
					launchState.altitudeKm >= LaunchRoomConfig.ascent.sceneEndAltitudeKm &&
					!launchState.isBlackout
				) {
					this.clearEndSceneTimer();
					launchState.isBlackout = true;
					hudStore.triggerBlackout(launchHudData.hud.blackoutMessage);
					setTimeout(() => missionStore.advancePhase(), 1500);
				}
				return;
		}
	}

	private resetSequence() {
		this.blurFocusedElement();
		this.clearEndSceneTimer();
		resetLaunchState();

		this.dockProgress = 0;
		this.ignitionRamp = 0;
		this.visualAltitudeM = 0;
		this.visualVelocityMs = 0;
		this.boosterSepTimeSec = 0;
		this.lasJettisoned = false;
		this.lasSepTimeSec = 0;
		this.solarDeployProgress = 0;
		this.solarDeployAnnounced = false;
		this.sceneCompleted = false;

		if (this.slsRocket) {
			this.slsRocket.position.set(0, PAD_DECK_Y, 0);
			this.slsRocket.rotation.set(0, 0, 0);
		}
		if (this.srbLeft) {
			this.srbLeft.position.copy(this.srbLeftBasePos);
			this.srbLeft.rotation.set(0, 0, 0);
			this.srbLeft.visible = true;
		}
		if (this.srbRight) {
			this.srbRight.position.copy(this.srbRightBasePos);
			this.srbRight.rotation.set(0, 0, 0);
			this.srbRight.visible = true;
		}
		if (this.lasObject) {
			this.lasObject.position.copy(this.lasBasePos);
			this.lasObject.visible = true;
		}
		if (this.padEnv) {
			this.padEnv.ground.visible = true;
			(this.padEnv.ground.material as THREE.MeshStandardMaterial).opacity = 1;
			(this.padEnv.apron.material as THREE.MeshStandardMaterial).opacity = 1;
			(this.padEnv.trench.material as THREE.MeshStandardMaterial).opacity = 1;
		}
		if (this.issStation) {
			this.issStation.root.visible = false;
		}

		this.applyDockTransforms(0);
		this.applySolarArrayDeploy(0);
		this.inspector.reset();

		const latestIss = this.issTracker.getLatest();
		hudStore.configureScene({
			location: launchHudData.hud.location,
			objective: launchHudData.hud.objective,
			panelTitle: launchHudData.hud.panelTitle,
			telemetry: {
				...launchHudData.hud.initialTelemetry,
				'ISS LIVE': latestIss.statusLabel
			},
			actions: []
		});
		this.syncHudActions();

		if (!latestIss.hasApiKey) {
			hudStore.setComms(
				'Pad 39B Ready! NASA API key is not set in .env (ISS hidden). Press [U] to undock.'
			);
		} else {
			hudStore.setComms(
				`Pad 39B Ready! Live ISS tracked at ${latestIss.statusLabel}. Press [U] to undock.`
			);
		}
	}

	async onEnter() {
		untrack(() => {
			sceneManager.setCameraController(null);

			this.inspector.mount();
			this.issTracker.start();
			window.addEventListener('keydown', this.boundKeyDown, { capture: true });
			window.addEventListener('keyup', this.boundKeyUp, { capture: true });
			window.addEventListener('pointerdown', this.boundPointerDown, { capture: true });
			this.resetSequence();
		});

		await physicsWorld.init(GameConfig.physics.gravityEarth);
		physicsWorld.reset(GameConfig.physics.gravityEarth);
	}

	onExit() {
		untrack(() => {
			this.clearEndSceneTimer();
			this.issTracker.stop();
			window.removeEventListener('keydown', this.boundKeyDown, { capture: true });
			window.removeEventListener('keyup', this.boundKeyUp, { capture: true });
			window.removeEventListener('pointerdown', this.boundPointerDown, { capture: true });
			this.inspector.unmount();
			hudStore.reset();
		});
	}

	private handleKeyEvent(event: KeyboardEvent, isDown: boolean) {
		const key = event.key.toLowerCase();
		const isHandled =
			LAUNCH_KEY_CODES.has(event.code) ||
			key === 'u' ||
			key === 'i' ||
			key === ' ' ||
			key === 'b' ||
			key === 'r' ||
			key === 'enter' ||
			key === 'escape';

		if (!isHandled) return;

		this.blurFocusedElement();
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();

		if (!isDown || event.repeat) return;

		if (event.code === 'Escape' || key === 'escape') {
			if (!launchState.isBoosterQtePaused) this.inspector.hideInfoCard();
		} else if (event.code === 'KeyR' || key === 'r') {
			this.executeAction('reset');
		} else if (event.code === 'KeyU' || key === 'u') {
			this.executeAction('undock');
		} else if (event.code === 'KeyI' || key === 'i') {
			this.executeAction('ignite');
		} else if (event.code === 'Space' || key === ' ') {
			this.executeAction('liftoff');
		} else if (event.code === 'KeyB' || key === 'b') {
			this.executeAction('detach_boosters');
		} else if (event.code === 'Enter' || key === 'enter') {
			this.executeAction('complete_orbit');
		}
	}

	private applyDockTransforms(t: number) {
		const ease = t * t * (3 - 2 * t);
		if (this.crewAccessArm) this.crewAccessArm.rotation.y = ease * THREE.MathUtils.degToRad(68);
		if (this.icpsArm) this.icpsArm.rotation.y = -ease * THREE.MathUtils.degToRad(62);
		if (this.coreArm) this.coreArm.rotation.y = ease * THREE.MathUtils.degToRad(62);
		for (const clamp of this.holdDownClamps) {
			clamp.rotation.z = (clamp.position.x < 0 ? -1 : 1) * ease * 0.45;
		}
	}

	private getAtmosphereLayer(altKm: number): string {
		for (const layer of LaunchRoomConfig.atmosphereLayers) {
			if (altKm < layer.maxKm) return layer.name;
		}
		return 'Exosphere';
	}

	update(delta: number): SceneFrameFeedback {
		const dt = Math.min(delta, 0.05);
		this.pulseClock += dt;
		let shakeIntensity = 0;

		if (launchState.dockState === 'UNDOCKING') {
			this.dockProgress = Math.min(1, this.dockProgress + dt * 0.55);
			this.applyDockTransforms(this.dockProgress);
			if (this.dockProgress >= 1) {
				launchState.dockState = 'UNDOCKED';
				hudStore.setComms('Bridge clear! Press [I] to light the main engines!');
				this.syncHudActions();
			}
		} else if (launchState.dockState === 'DOCKING') {
			this.dockProgress = Math.max(0, this.dockProgress - dt * 0.55);
			this.applyDockTransforms(this.dockProgress);
			if (this.dockProgress <= 0) {
				launchState.dockState = 'DOCKED';
				hudStore.setComms('Bridge locked. Press [U] to undock.');
				this.syncHudActions();
			}
		}

		if (launchState.isIgnited && !launchState.isLaunched) {
			this.ignitionRamp = Math.min(1, this.ignitionRamp + dt * 0.65);
			shakeIntensity = 0.11 * this.ignitionRamp;
		}

		if (launchState.isLaunched && !launchState.isBoosterQtePaused) {
			this.ignitionRamp = 1.0;

			const accel = launchState.boostersDetached ? 18.0 : 11.5;
			this.visualVelocityMs = Math.min(310, this.visualVelocityMs + accel * dt);
			this.visualAltitudeM += this.visualVelocityMs * dt;

			// Ascent rate scales up once shed of heavy SRBs so 45 km -> 600 km takes ~14 seconds
			const climbRateKmS = launchState.boostersDetached
				? 24.0 + Math.min(26.0, (launchState.altitudeKm - 45.0) * 0.06)
				: 5.6;

			launchState.altitudeKm = Math.min(
				LaunchRoomConfig.ascent.targetAltitudeKm,
				launchState.altitudeKm + climbRateKmS * dt
			);
			launchState.currentLayer = this.getAtmosphereLayer(launchState.altitudeKm);

			if (this.slsRocket) this.slsRocket.position.y = PAD_DECK_Y + this.visualAltitudeM;

			if (
				!launchState.boostersDetached &&
				launchState.altitudeKm >= LaunchRoomConfig.ascent.srbSeparationAltitudeKm
			) {
				untrack(() => {
					launchState.isBoosterQtePaused = true;
					this.inspector.triggerBoosterQte();
					this.syncHudActions();
					hudStore.setComms('45 km Stratosphere! Boosters empty—press [B] to drop them!');
				});
			}

			if (
				!this.lasJettisoned &&
				launchState.altitudeKm >= LaunchRoomConfig.ascent.lasJettisonAltitudeKm
			) {
				this.lasJettisoned = true;
				this.lasSepTimeSec = 0;
				hudStore.setComms('88 km! Escape tower & fairings jettisoned!');
			}

			if (launchState.altitudeKm >= LaunchRoomConfig.ascent.solarDeployAltitudeKm) {
				if (!this.solarDeployAnnounced) {
					this.solarDeployAnnounced = true;
					hudStore.setComms('102 km Outer Space! Orion solar wings unfolding!');
				}
				this.solarDeployProgress = Math.min(1, this.solarDeployProgress + dt * 0.55);
				this.applySolarArrayDeploy(this.solarDeployProgress);
			}

			// End scene cleanly at 600 km
			if (
				!this.sceneCompleted &&
				launchState.altitudeKm >= LaunchRoomConfig.ascent.sceneEndAltitudeKm
			) {
				this.sceneCompleted = true;
				launchState.altitudeKm = LaunchRoomConfig.ascent.sceneEndAltitudeKm;
				this.syncHudActions();
				hudStore.setComms('600.0 km Exosphere reached! Mission complete!');

				this.endSceneTimerId = window.setTimeout(() => {
					this.executeAction('complete_orbit');
				}, 2500);
			}

			const spaceFactor = THREE.MathUtils.clamp(launchState.altitudeKm / 100, 0, 1);
			this.currentSkyColor.lerpColors(this.skyColorDay, this.skyColorSpace, spaceFactor);
			this.scene.background = this.currentSkyColor;
			if (this.scene.fog instanceof THREE.FogExp2) {
				this.scene.fog.color.copy(this.currentSkyColor);
				this.scene.fog.density = 0.0011 * (1 - spaceFactor);
			}

			if (this.padEnv) {
				const padOpacity = Math.max(0, 1 - spaceFactor * 1.4);
				this.padEnv.ground.visible = padOpacity > 0.01;
				(this.padEnv.ground.material as THREE.MeshStandardMaterial).opacity = padOpacity;
				(this.padEnv.apron.material as THREE.MeshStandardMaterial).opacity = padOpacity;
				(this.padEnv.trench.material as THREE.MeshStandardMaterial).opacity = padOpacity;

				this.padEnv.stars.position.y = this.visualAltitudeM;
				(this.padEnv.stars.material as THREE.PointsMaterial).opacity = Math.max(
					0,
					(spaceFactor - 0.35) * 1.5
				);
			}

			// Show 3D ISS in orbit around ~418 km ONLY when VITE_NASA_API_KEY is configured in .env
			if (this.issStation) {
				const issInfo = this.issTracker.getLatest();
				const nearIssBand = launchState.altitudeKm >= 260 && launchState.altitudeKm <= 580;
				const showIss = issInfo.hasApiKey && nearIssBand;
				this.issStation.root.visible = showIss;

				if (showIss) {
					const relOffsetY = (issInfo.altitudeKm - launchState.altitudeKm) * 0.45;
					this.issStation.root.position.set(
						-38,
						PAD_DECK_Y + this.visualAltitudeM + 62 + relOffsetY,
						-46
					);
					this.issStation.root.rotation.y += dt * 0.12;
					const pulse = 1.0 + Math.sin(this.pulseClock * 4.5) * 0.14;
					this.issStation.pulseRing.scale.set(pulse, pulse, 1);
				}
			}

			shakeIntensity = Math.max(0.018, 0.19 * Math.exp(-this.visualAltitudeM / 220));
		}

		// Ballistic booster arc: coast upward first, then peel outward and fall over 12s
		if (
			launchState.boostersDetached &&
			!launchState.isBoosterQtePaused &&
			this.srbLeft &&
			this.srbRight
		) {
			this.boosterSepTimeSec += dt;
			const t = this.boosterSepTimeSec;
			if (t < 12.0) {
				const outward = 2.6 * t + 0.35 * t * t;
				const ballisticY = 18.0 * t - 2.4 * t * t;
				const tilt = Math.min(1.15, 0.14 * t);
				this.srbLeft.position.set(
					this.srbLeftBasePos.x - outward,
					this.srbLeftBasePos.y + ballisticY,
					this.srbLeftBasePos.z
				);
				this.srbLeft.rotation.z = tilt;
				this.srbRight.position.set(
					this.srbRightBasePos.x + outward,
					this.srbRightBasePos.y + ballisticY,
					this.srbRightBasePos.z
				);
				this.srbRight.rotation.z = -tilt;
			} else {
				this.srbLeft.visible = false;
				this.srbRight.visible = false;
			}
		}

		if (this.lasJettisoned && this.lasObject) {
			this.lasSepTimeSec += dt;
			if (this.lasSepTimeSec < 6.0) {
				this.lasObject.position.y =
					this.lasBasePos.y +
					18.0 * this.lasSepTimeSec +
					14.0 * this.lasSepTimeSec * this.lasSepTimeSec;
				this.lasObject.position.x =
					this.lasBasePos.x + 2.5 * this.lasSepTimeSec * this.lasSepTimeSec;
			} else {
				this.lasObject.visible = false;
			}
		}

		if (this.slsFire) {
			this.slsFire.update(dt, {
				coreThrottle: launchState.isIgnited ? this.ignitionRamp : 0,
				srbThrottle: launchState.isLaunched && !launchState.boostersDetached ? 1.0 : 0.0,
				padGroundY: PAD_DECK_Y
			});
		}

		hudStore.setTelemetry('BRIDGE ARM', launchState.dockState);
		hudStore.setTelemetry('BOOSTERS', launchState.boostersDetached ? 'DROPPED' : 'ATTACHED');
		hudStore.setTelemetry('HEIGHT', `${launchState.altitudeKm.toFixed(1)} km`);
		hudStore.setTelemetry('SKY LAYER', launchState.currentLayer.toUpperCase());
		hudStore.setTelemetry('ISS LIVE', launchState.issStatusText);

		return {
			orbitTargetY: 46 + this.visualAltitudeM,
			shakeIntensity: launchState.isBoosterQtePaused ? 0 : shakeIntensity
		};
	}
}

export const launchRoomScene = new LaunchRoomScene();
