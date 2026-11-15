import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import sitesData from '#lib/assets/data/nasa/lunar_sites.json';
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
import { LunarLandingConfig } from './lunar-landing.config';
import hudMeta from './lunar-landing.hud.json';
import {
	type LandingStyleId,
	lunarLandingState,
	resetLunarLandingState
} from './lunarLandingState.svelte';
import { descentGuidance } from './systems/DescentGuidance';
import { LanderBuilder } from './systems/LanderBuilder';
import { LunarTerrainManager } from './systems/LunarTerrainManager';

export interface LunarLandingHandoffPayload {
	siteIndex: number;
	siteName: string;
	style: LandingStyleId;
	fuelRemainingPct: number;
	touchdownTiltDeg: number;
	padOffsetX: number;
	padOffsetZ: number;
	landedAt: number;
}

export const LUNAR_LANDING_HANDOFF_KEY = 'artemis_lunar_landing_handoff';
const TOUCHDOWN_TRANSITION_DELAY_MS = 2000;

const HANDLED_KEYS = new Set([
	'KeyI',
	'KeyM',
	'KeyW',
	'KeyA',
	'KeyS',
	'KeyD',
	'ArrowUp',
	'ArrowDown',
	'ArrowLeft',
	'ArrowRight',
	'Space'
]);

export class LunarLandingScene implements GameScene {
	public scene: THREE.Scene;
	public cameraPreset: CameraPreset = {
		position: [-10, 36, 28],
		target: [-8, 30, 0],
		maxPolarAngle: Math.PI / 2 - 0.01,
		minDistance: 6,
		maxDistance: 95
	};

	private terrain = new LunarTerrainManager();
	private landerVisuals = new LanderBuilder();
	private landerBody: RAPIER.RigidBody | null = null;

	private keys = new Set<string>();
	private currentRollRad = 0;
	private currentPitchRad = 0;
	private hdaAnnounced = false;
	private touchdownOffsetX = 0;
	private touchdownOffsetZ = 0;

	private isSceneActive = false;
	private blackoutTimer: ReturnType<typeof setTimeout> | null = null;
	private switchSceneTimer: ReturnType<typeof setTimeout> | null = null;
	private touchdownElapsedS = -1;
	private transitionDispatched = false;

	private boundKeyDown = (e: KeyboardEvent) => this.onKeyDown(e);
	private boundKeyUp = (e: KeyboardEvent) => this.onKeyUp(e);

	constructor() {
		this.scene = new THREE.Scene();
		this.scene.background = new THREE.Color(0x020308);
	}

	init() {
		const ambientLight = new THREE.AmbientLight(0x9fb8de, 0.42);
		this.scene.add(ambientLight);

		const sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
		sunLight.position.set(45, 70, 30);
		this.scene.add(sunLight);

		const starGeo = new THREE.BufferGeometry();
		const starPositions = new Float32Array(1000 * 3);
		for (let i = 0; i < 1000; i++) {
			const theta = Math.random() * Math.PI * 2;
			const phi = Math.acos(Math.random());
			const r = 460;
			starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
			starPositions[i * 3 + 1] = r * Math.cos(phi) + 30;
			starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
		}
		starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
		this.scene.add(
			new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.15 }))
		);

		this.terrain.init(this.scene);
		this.landerVisuals.init(this.scene);
	}

	private clearTransitionTimers() {
		if (this.blackoutTimer !== null) {
			clearTimeout(this.blackoutTimer);
			this.blackoutTimer = null;
		}
		if (this.switchSceneTimer !== null) {
			clearTimeout(this.switchSceneTimer);
			this.switchSceneTimer = null;
		}
		this.touchdownElapsedS = -1;
		this.transitionDispatched = false;
	}

	private scheduleTransitionToRoom06(immediate = false) {
		this.clearTransitionTimers();
		this.touchdownElapsedS = 0;

		if (immediate) {
			this.persistLandingHandoff();
			hudStore.triggerBlackout(hudMeta.hud.blackoutMessage);
			this.switchSceneTimer = setTimeout(() => this.executeSwitchToRoom06(), 600);
			return;
		}

		// Fade screen at 1.3s and switch to Room 06 (06-lunar-outpost) at 2.0s after touching Orion_Landing_Pad_NASALogo
		this.blackoutTimer = setTimeout(() => {
			if (!this.isSceneActive) return;
			hudStore.triggerBlackout(hudMeta.hud.blackoutMessage);
		}, 1300);

		this.switchSceneTimer = setTimeout(() => {
			this.executeSwitchToRoom06();
		}, TOUCHDOWN_TRANSITION_DELAY_MS);
	}

	private executeSwitchToRoom06() {
		if (this.transitionDispatched) return;
		this.transitionDispatched = true;
		this.persistLandingHandoff();

		// Sync missionStore directly to Phase 6 (avoid advancePhase() landing on Phase 2 if Phase 5 was jumped to)
		const store = missionStore as unknown as {
			phase?: number;
			currentPhase?: number;
			setPhase?: (phase: number) => void;
			goToPhase?: (phase: number) => void;
			advancePhase?: () => void;
		};

		if (typeof store.setPhase === 'function') {
			store.setPhase(6);
		} else if (typeof store.goToPhase === 'function') {
			store.goToPhase(6);
		} else if (typeof store.phase === 'number') {
			if (store.phase === 5 && typeof store.advancePhase === 'function') {
				store.advancePhase();
			} else {
				store.phase = 6;
			}
		} else if (typeof store.currentPhase === 'number') {
			store.currentPhase = 6;
		}

		// Directly switch SceneManager to Room 06 (06-lunar-outpost)
		sceneManager.switchScene(6);
	}

	private async spawnMission(style: LandingStyleId, siteIndex: number) {
		this.clearTransitionTimers();
		await physicsWorld.init(GameConfig.physics.gravityMoon);
		physicsWorld.reset(GameConfig.physics.gravityMoon);
		resetLunarLandingState(style, siteIndex);

		this.terrain.setSite(siteIndex);
		const site = this.terrain.getActiveSite();
		const [padX, padZ] = site.worldOffset;

		// Thin floor collider so top surface sits flush at y = 0.0 (footHeight reaches 0 on touchdown)
		physicsWorld.addFixedBox([2000, 0.1, 2000], [padX, -0.05, padZ]);
		for (const h of LunarLandingConfig.hazards) {
			physicsWorld.addFixedBox(
				[h.radius * 0.7, h.height * 0.5, h.radius * 0.7],
				[padX + h.dx, h.height * 0.5, padZ + h.dz]
			);
		}

		this.landerVisuals.positionSiteFixtures(padX, padZ);
		this.currentRollRad = 0;
		this.currentPitchRad = 0;
		this.hdaAnnounced = false;
		this.touchdownOffsetX = 0;
		this.touchdownOffsetZ = 0;

		const [ox, oy, oz] = LunarLandingConfig.spawnOffset;
		const spawnX = padX + ox;
		const spawnY = oy;
		const spawnZ = padZ + oz;

		this.landerVisuals.rootGroup.position.set(spawnX, spawnY, spawnZ);
		sceneManager.setCameraView(
			[spawnX + 8, spawnY - 6, spawnZ + 28],
			[spawnX + 6, spawnY - 12, spawnZ]
		);
		this.landerVisuals.rootGroup.quaternion.identity();
		this.terrain.updateAround(spawnX, spawnZ);

		this.landerBody = physicsWorld.addDynamicBox(
			this.landerVisuals.rootGroup,
			LunarLandingConfig.lander.halfExtents,
			{
				mass: LunarLandingConfig.lander.massKg,
				restitution: 0.0,
				friction: 0.95,
				linearDamping: 0.0
			}
		);

		if (this.landerBody) {
			this.landerBody.lockRotations(true, true);
			const [vx, vy, vz] = LunarLandingConfig.initialVelocity;
			this.landerBody.setLinvel({ x: vx, y: vy, z: vz }, true);
		}

		this.configureHud();
		hudStore.setComms(hudMeta.hud.comms.ready);
	}

	private persistLandingHandoff() {
		const payload: LunarLandingHandoffPayload = {
			siteIndex: lunarLandingState.siteIndex,
			siteName: lunarLandingState.siteName,
			style: lunarLandingState.style,
			fuelRemainingPct: Math.round(lunarLandingState.fuelPct),
			touchdownTiltDeg: lunarLandingState.tiltDeg,
			padOffsetX: Number(this.touchdownOffsetX.toFixed(2)),
			padOffsetZ: Number(this.touchdownOffsetZ.toFixed(2)),
			landedAt: Date.now()
		};
		try {
			sessionStorage.setItem(LUNAR_LANDING_HANDOFF_KEY, JSON.stringify(payload));
		} catch {
			// Ignore storage restrictions in private browsing
		}
	}

	private configureHud() {
		const labels = hudMeta.hud.telemetryLabels;
		const profile = descentGuidance.getProfile(lunarLandingState.style);
		const massStats = descentGuidance.computeMassStats(
			lunarLandingState.style,
			lunarLandingState.fuelPct
		);

		hudStore.configureScene({
			location: hudMeta.hud.location,
			objective: hudMeta.hud.objective,
			panelTitle: hudMeta.hud.panelTitle,
			telemetry: {
				[labels.site]: lunarLandingState.siteName,
				[labels.style]: lunarLandingState.style.toUpperCase(),
				[labels.mode]: lunarLandingState.controlMode === 'auto' ? 'AUTO GNC' : 'MANUAL ASSIST',
				[labels.phase]: lunarLandingState.guidancePhase,
				[labels.altitude]: `${lunarLandingState.altitudeM} m`,
				[labels.vertVel]: '0.0 m/s',
				[labels.horizVel]: `${lunarLandingState.horizontalVelMs} m/s`,
				[labels.tilt]: '0.0°',
				[labels.fuel]: `${Math.round(lunarLandingState.fuelPct)}%`
			},
			actions: [
				{
					id: 'ignite-dps',
					label: hudMeta.hud.actions.ignite,
					disabled: () => lunarLandingState.isIgnited || lunarLandingState.outcome !== 'descending',
					onClick: () => this.igniteEngine()
				},
				{
					id: 'toggle-mode',
					label:
						lunarLandingState.controlMode === 'auto'
							? hudMeta.hud.actions.toggleModeManual
							: hudMeta.hud.actions.toggleModeAuto,
					disabled: () => lunarLandingState.outcome !== 'descending',
					onClick: () => this.toggleControlMode()
				},
				{
					id: 'switch-style',
					label:
						lunarLandingState.style === 'apollo'
							? hudMeta.hud.actions.styleArtemis
							: hudMeta.hud.actions.styleApollo,
					disabled: () => lunarLandingState.outcome !== 'descending',
					onClick: () => {
						void this.spawnMission(
							lunarLandingState.style === 'apollo' ? 'artemis' : 'apollo',
							lunarLandingState.siteIndex
						);
					}
				},
				{
					id: 'cycle-site',
					label: hudMeta.hud.actions.cycleSite,
					disabled: () => lunarLandingState.outcome !== 'descending',
					onClick: () => {
						void this.spawnMission(
							lunarLandingState.style,
							(lunarLandingState.siteIndex + 1) % sitesData.sites.length
						);
					}
				},
				{
					id: 'retry-descent',
					label: hudMeta.hud.actions.retry,
					variant: 'danger',
					disabled: () => lunarLandingState.outcome === 'descending',
					onClick: () => {
						void this.spawnMission(lunarLandingState.style, lunarLandingState.siteIndex);
					}
				},
				{
					id: 'proceed-surface',
					label: hudMeta.hud.actions.proceed,
					variant: 'success',
					disabled: () => lunarLandingState.outcome !== 'landed',
					onClick: () => {
						this.scheduleTransitionToRoom06(true);
					}
				}
			]
		});

		hudStore.setRightPanel({
			title: 'Spacecraft Telemetry',
			subtitle: profile.vehicle,
			telemetry: {
				'TOTAL MASS': `${Math.round(massStats.currentMassKg).toLocaleString()} kg`,
				'DRY MASS': `${profile.dryMassKg.toLocaleString()} kg`,
				PROPELLANT: `${Math.round(massStats.propellantRemainingKg).toLocaleString()} kg`,
				'MAX THRUST': `${(profile.maxThrustN / 1000).toFixed(1)} kN`,
				'ACTIVE THRUST': '0.0 kN (0%)',
				'LUNAR TWR': `${massStats.lunarTwr.toFixed(2)} gₘ`,
				'SPECIFIC IMPULSE': `${profile.specificImpulseS} s`,
				DIMENSIONS: profile.dimensions
			}
		});
	}

	onEnter() {
		this.isSceneActive = true;
		window.addEventListener('keydown', this.boundKeyDown, { capture: true });
		window.addEventListener('keyup', this.boundKeyUp, { capture: true });
		void this.spawnMission('artemis', 0);
	}

	onExit() {
		this.isSceneActive = false;
		this.clearTransitionTimers();
		window.removeEventListener('keydown', this.boundKeyDown, { capture: true });
		window.removeEventListener('keyup', this.boundKeyUp, { capture: true });
		this.keys.clear();
		this.landerBody = null;
		hudStore.reset();
	}

	igniteEngine() {
		if (!lunarLandingState.isIgnited && lunarLandingState.outcome === 'descending') {
			lunarLandingState.isIgnited = true;
			sceneManager.shake(0.18, 0.35);
		}
	}

	toggleControlMode() {
		if (lunarLandingState.outcome !== 'descending') return;
		lunarLandingState.controlMode =
			lunarLandingState.controlMode === 'auto' ? 'manual-assisted' : 'auto';

		if (lunarLandingState.controlMode === 'manual-assisted' && !lunarLandingState.isIgnited) {
			this.igniteEngine();
		}

		hudStore.setComms(
			lunarLandingState.controlMode === 'manual-assisted'
				? hudMeta.hud.comms.manualEngaged
				: hudMeta.hud.comms.autoEngaged
		);
		this.configureHud();
	}

	private onKeyDown(event: KeyboardEvent) {
		if (HANDLED_KEYS.has(event.code)) {
			if (document.activeElement instanceof HTMLElement) {
				document.activeElement.blur();
			}
			event.preventDefault();
			event.stopPropagation();
		}

		this.keys.add(event.code);

		if (event.repeat) return;

		if (event.code === 'KeyI') {
			this.igniteEngine();
		} else if (event.code === 'KeyM') {
			this.toggleControlMode();
		}
	}

	private onKeyUp(event: KeyboardEvent) {
		if (HANDLED_KEYS.has(event.code)) {
			event.preventDefault();
			event.stopPropagation();
		}
		this.keys.delete(event.code);
	}

	update(delta: number): SceneFrameFeedback {
		if (!this.landerBody) return {};

		const dt = Math.min(delta, 0.05);
		const pos = this.landerBody.translation();
		const vel = this.landerBody.linvel();
		const site = this.terrain.getActiveSite();
		const [padX, padZ] = site.worldOffset;

		this.terrain.updateAround(pos.x, pos.z);
		const terrainY = this.terrain.getHeightAt(pos.x, pos.z);
		const footHeight = Math.max(0, pos.y - LunarLandingConfig.lander.touchdownFootY - terrainY);

		let throttleInput = 0;
		if (this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.keys.has('Space')) {
			throttleInput += 1;
		}
		if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) {
			throttleInput -= 1;
		}

		let lateralInputX = 0;
		if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) lateralInputX -= 1;
		if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) lateralInputX += 1;

		let activeForceX = 0;

		if (lunarLandingState.outcome === 'descending') {
			const guidance = descentGuidance.step({
				style: lunarLandingState.style,
				controlMode: lunarLandingState.controlMode,
				isIgnited: lunarLandingState.isIgnited,
				fuelPct: lunarLandingState.fuelPct,
				posX: pos.x,
				posZ: pos.z,
				velX: vel.x,
				velY: vel.y,
				velZ: vel.z,
				footHeight,
				targetPadX: padX,
				targetPadZ: padZ,
				throttleInput,
				lateralInputX,
				lateralInputZ: 0
			});

			if (guidance.shouldAutoIgnite) {
				this.igniteEngine();
			}

			if (guidance.triggerHdaScan && !this.hdaAnnounced) {
				this.hdaAnnounced = true;
				this.landerVisuals.setHazardRingsVisible(true);
				hudStore.setComms(hudMeta.hud.comms.hdaActive);
			}

			this.landerBody.resetForces(true);
			if (lunarLandingState.isIgnited && lunarLandingState.fuelPct > 0) {
				activeForceX = guidance.forceX;
				this.landerBody.addForce(
					{ x: guidance.forceX, y: guidance.forceY, z: guidance.forceZ },
					true
				);
				lunarLandingState.throttlePct = Math.round(guidance.throttleRatio * 100);
				lunarLandingState.fuelPct = Math.max(
					0,
					lunarLandingState.fuelPct - (0.3 + guidance.throttleRatio * 1.1) * dt
				);
			} else {
				lunarLandingState.throttlePct = 0;
			}

			this.currentRollRad = THREE.MathUtils.lerp(
				this.currentRollRad,
				guidance.desiredRollRad,
				Math.min(1, dt * 5.5)
			);
			this.currentPitchRad = THREE.MathUtils.lerp(
				this.currentPitchRad,
				guidance.desiredPitchRad,
				Math.min(1, dt * 5.5)
			);

			const totalTiltDeg = Math.hypot(
				THREE.MathUtils.radToDeg(this.currentRollRad),
				THREE.MathUtils.radToDeg(this.currentPitchRad)
			);

			lunarLandingState.guidancePhase = guidance.guidancePhaseName;
			lunarLandingState.altitudeM = Math.round(guidance.realAltitudeM);
			lunarLandingState.verticalVelMs = Number(guidance.realVerticalVelMs.toFixed(1));
			lunarLandingState.horizontalVelMs = Number(guidance.realHorizontalVelMs.toFixed(1));
			lunarLandingState.tiltDeg = Number(totalTiltDeg.toFixed(1));

			hudStore.setRightTelemetry(
				'TOTAL MASS',
				`${Math.round(guidance.currentMassKg).toLocaleString()} kg`
			);
			hudStore.setRightTelemetry(
				'PROPELLANT',
				`${Math.round(guidance.propellantRemainingKg).toLocaleString()} kg`
			);
			hudStore.setRightTelemetry(
				'ACTIVE THRUST',
				`${guidance.activeThrustKn.toFixed(1)} kN (${lunarLandingState.throttlePct}%)`
			);
			hudStore.setRightTelemetry('LUNAR TWR', `${guidance.lunarTwr.toFixed(2)} gₘ`);

			this.landerVisuals.updateVisuals({
				x: pos.x,
				z: pos.z,
				terrainY,
				footHeight,
				rollRad: this.currentRollRad,
				pitchRad: this.currentPitchRad,
				isIgnited: lunarLandingState.isIgnited,
				throttleRatio: guidance.throttleRatio,
				forceX: activeForceX
			});

			const touchedSurface = footHeight <= 0.18 && vel.y <= 0.35;
			const settledOnPad =
				footHeight <= 0.65 && Math.abs(vel.y) <= 0.06 && Math.hypot(vel.x, vel.z) <= 0.25;

			if (touchedSurface || settledOnPad) {
				this.touchdownOffsetX = pos.x - padX;
				this.touchdownOffsetZ = pos.z - padZ;
				const padOffsetM = Math.hypot(this.touchdownOffsetX, this.touchdownOffsetZ);
				const touchedNasaLogo = this.landerVisuals.isOnNasaLogoPad(pos.x, pos.z);
				const result = descentGuidance.evaluateTouchdown(
					lunarLandingState.style,
					padOffsetM,
					Math.abs(vel.y),
					Math.hypot(vel.x, vel.z),
					totalTiltDeg
				);

				// Seat footpads flush on Orion_Landing_Pad_NASALogo and lock body
				const flushY = terrainY + LunarLandingConfig.lander.touchdownFootY;
				this.landerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
				this.landerBody.setTranslation({ x: pos.x, y: flushY, z: pos.z }, true);
				this.landerBody.setBodyType(RAPIER.RigidBodyType.Fixed, true);
				this.landerVisuals.rootGroup.position.set(pos.x, flushY, pos.z);

				lunarLandingState.isIgnited = false;
				lunarLandingState.throttlePct = 0;
				lunarLandingState.altitudeM = 0;
				lunarLandingState.verticalVelMs = 0;
				lunarLandingState.horizontalVelMs = 0;

				const safeNasaPadTouch = touchedNasaLogo && Math.abs(vel.y) <= 6.0;

				if (result.success || safeNasaPadTouch) {
					lunarLandingState.outcome = 'landed';
					this.currentRollRad = 0;
					this.currentPitchRad = 0;
					this.persistLandingHandoff();
					sceneManager.shake(0.15, 0.3);
					hudStore.setComms(hudMeta.hud.comms.landedSuccess);
					this.scheduleTransitionToRoom06(false);
				} else {
					lunarLandingState.outcome = 'crashed';
					lunarLandingState.failureReason = result.failures.join(' | ');
					sceneManager.shake(0.55, 0.6);
					hudStore.setComms(`${hudMeta.hud.comms.crashed} (${lunarLandingState.failureReason})`);
				}

				this.landerVisuals.updateVisuals({
					x: pos.x,
					z: pos.z,
					terrainY,
					footHeight: 0,
					rollRad: 0,
					pitchRad: 0,
					isIgnited: false,
					throttleRatio: 0,
					forceX: 0
				});
				this.configureHud();
			}
		} else {
			this.landerBody.resetForces(true);

			// Frame-based 2.0s touchdown countdown backup
			if (lunarLandingState.outcome === 'landed' && this.touchdownElapsedS >= 0) {
				this.touchdownElapsedS += dt;
				if (this.touchdownElapsedS >= TOUCHDOWN_TRANSITION_DELAY_MS / 1000) {
					this.executeSwitchToRoom06();
				}
			}

			const massStats = descentGuidance.computeMassStats(
				lunarLandingState.style,
				lunarLandingState.fuelPct
			);
			hudStore.setRightTelemetry(
				'TOTAL MASS',
				`${Math.round(massStats.currentMassKg).toLocaleString()} kg`
			);
			hudStore.setRightTelemetry(
				'PROPELLANT',
				`${Math.round(massStats.propellantRemainingKg).toLocaleString()} kg`
			);
			hudStore.setRightTelemetry('ACTIVE THRUST', '0.0 kN (0%)');
			hudStore.setRightTelemetry('LUNAR TWR', `${massStats.lunarTwr.toFixed(2)} gₘ`);
		}

		const labels = hudMeta.hud.telemetryLabels;
		hudStore.setTelemetry(labels.site, lunarLandingState.siteName);
		hudStore.setTelemetry(labels.style, lunarLandingState.style.toUpperCase());
		hudStore.setTelemetry(
			labels.mode,
			lunarLandingState.controlMode === 'auto' ? 'AUTO GNC' : 'MANUAL ASSIST'
		);
		hudStore.setTelemetry(labels.phase, lunarLandingState.guidancePhase);
		hudStore.setTelemetry(labels.altitude, `${lunarLandingState.altitudeM} m`);
		hudStore.setTelemetry(labels.vertVel, `${lunarLandingState.verticalVelMs.toFixed(1)} m/s`);
		hudStore.setTelemetry(labels.horizVel, `${lunarLandingState.horizontalVelMs.toFixed(1)} m/s`);
		hudStore.setTelemetry(labels.tilt, `${lunarLandingState.tiltDeg.toFixed(1)}°`);
		hudStore.setTelemetry(labels.fuel, `${Math.round(lunarLandingState.fuelPct)}%`);

		const shakeIntensity =
			lunarLandingState.isIgnited && lunarLandingState.outcome === 'descending'
				? 0.045 * (lunarLandingState.throttlePct / 100)
				: 0;

		return {
			orbitTarget: [pos.x, Math.max(4, pos.y - 4), pos.z],
			shakeIntensity
		};
	}
}

export const lunarLandingScene = new LunarLandingScene();
