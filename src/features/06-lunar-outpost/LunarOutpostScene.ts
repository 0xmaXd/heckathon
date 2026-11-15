import * as THREE from 'three';
import { CollisionWorld } from '../../core/engine/CollisionWorld';
import { EnvironmentLightingEngine } from '../../core/engine/EnvironmentLightingEngine';
import { sceneManager, type GameScene } from '../../core/engine/SceneManager';
import { hudStore } from '../../core/hud/hudStore.svelte';
import { characterModelLoader } from '../../core/player/CharacterModelLoader';
import { OrionRoverController } from '../../core/player/OrionRoverController';
import { playerController } from '../../core/player/PlayerController.svelte';
import { LunarOutpostConfig } from './lunar-outpost.config';
import hudCopy from './lunar-outpost.hud.json';
import { lunarOutpostStore } from './lunarOutpostStore.svelte';
import { MissionGameplaySystem } from './systems/MissionGameplaySystem';
import { outpostEventBus } from './systems/OutpostEventBus';
import { OutpostMachinerySystem } from './systems/OutpostMachinerySystem';
import { OutpostNpcSystem } from './systems/OutpostNpcSystem';
import { OutpostWorldBuilder } from './systems/OutpostWorldBuilder';

export class LunarOutpostScene implements GameScene {
	public readonly scene = new THREE.Scene();

	private world = new OutpostWorldBuilder();
	private collisions = new CollisionWorld();
	private sunCycle = new EnvironmentLightingEngine();
	private rover = new OrionRoverController({
		...LunarOutpostConfig.rover,
		boardingRadius: LunarOutpostConfig.physics.interactionRadius,
		deliverRadius: LunarOutpostConfig.physics.crateDeliverRadius
	});
	private mission = new MissionGameplaySystem();
	private machinery = new OutpostMachinerySystem();
	private npcs = new OutpostNpcSystem();

	private worldBuilt = false;
	private isReady = false;
	private isSceneActive = false;
	private setupGeneration = 0;
	private landerInitialPos = new THREE.Vector3();
	private keys = new Set<string>();
	private boundKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);
	private boundKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);

	init(): void {
		const gen = ++this.setupGeneration;
		void this.setupAsync(gen);
	}

	private async setupAsync(gen: number): Promise<void> {
		this.isReady = false;

		await this.world.build(this.scene);
		if (gen !== this.setupGeneration) return;

		characterModelLoader.registerEmbeddedTemplate(this.world.outpostRoot);

		if (this.world.outpostRoot) {
			this.collisions.buildFromSceneRoot(this.world.outpostRoot, {
				excludedKeywords: ['Terrain', 'Ground', 'Floor', 'Rover', 'Sample_', 'Supply_Crate']
			});
		}

		if (this.world.landerAssembly) {
			this.landerInitialPos.copy(this.world.landerAssembly.position);
		}

		const roverObj =
			this.world.outpostRoot?.getObjectByName('Orion_Moon_Rover') ??
			this.world.findObjectByPatterns([/Orion_Moon_Rover/i, /Orion.*Rover/i, /Rover/i]);

		this.sunCycle.init(this.scene, this.world.lampPositions);
		this.rover.init(roverObj);
		this.machinery.init(this.world);
		await this.npcs.init(this.scene, this.world, () => this.mission.beginResupply());
		if (gen !== this.setupGeneration) return;

		this.mission.init(this.scene, this.world);
		this.collisions.registerDynamicProps(this.mission.crates);
		this.worldBuilt = true;

		if (this.isSceneActive) {
			await this.attachPlayerToScene(gen);
		}
	}

	private async attachPlayerToScene(gen: number): Promise<void> {
		characterModelLoader.registerEmbeddedTemplate(this.world.outpostRoot);

		playerController.setPhysics({
			walkSpeed: LunarOutpostConfig.physics.evaWalkSpeed,
			sprintSpeed: LunarOutpostConfig.physics.evaSprintSpeed,
			jumpVelocity: LunarOutpostConfig.physics.evaJumpVelocity,
			gravity: LunarOutpostConfig.physics.lunarGravity
		});
		playerController.yawRad = Math.PI;
		playerController.pitchRad = 0;

		await playerController.init(this.scene, 11.5, -24.0, this.world, {
			modelUrl: LunarOutpostConfig.characterModelUrl,
			accentHex: 0xe6480d,
			hideHeadForFirstPerson: true
		});

		if (gen !== this.setupGeneration || !this.isSceneActive) return;

		playerController.activate(null, this.rover);
		sceneManager.setCameraController(playerController);
		this.world.updateLighting(0, playerController.root.position, 22, false);
		this.isReady = true;
	}

	onEnter(): void {
		this.isSceneActive = true;
		window.addEventListener('keydown', this.boundKeyDown);
		window.addEventListener('keyup', this.boundKeyUp);

		hudStore.configureScene({
			location: hudCopy.locationLabel,
			objective: hudCopy.briefing.dialogue,
			panelTitle: hudCopy.outpostName,
			telemetry: {
				'Solar Cycle': 'Lunar Day',
				'Rover Battery': '100%',
				'Drop-Offs': `0 / ${LunarOutpostConfig.resupplyRequiredCount}`,
				'ISRU Samples': '0 / 6'
			},
			actions: [
				{
					id: 'restart-outpost',
					label: 'Restart Outpost Mission',
					onClick: () => this.restartMission()
				}
			]
		});

		if (this.worldBuilt) {
			const gen = ++this.setupGeneration;
			void this.attachPlayerToScene(gen);
		}
	}

	onExit(): void {
		this.isSceneActive = false;
		this.isReady = false;
		this.setupGeneration++;

		this.rover.reset(playerController.root, this.scene);
		playerController.deactivate();
		playerController.root.parent?.remove(playerController.root);
		characterModelLoader.clearEmbeddedTemplate();

		window.removeEventListener('keydown', this.boundKeyDown);
		window.removeEventListener('keyup', this.boundKeyUp);
		this.keys.clear();
		hudStore.reset();
		lunarOutpostStore.reset();
	}

	closeNpcDialogue(): void {
		this.npcs.closeDialogue();
	}

	selectNpcDialogueChoice(choiceId: string): void {
		this.npcs.selectChoice(choiceId);
	}

	dismissDiscoveryCard(): void {
		this.mission.activeDiscoveryCard = null;
	}

	restartMission(): void {
		this.npcs.reset();
		this.rover.reset(playerController.root, this.scene);
		playerController.clearCarriedItem();
		const spawn = this.world.sampleSurfaceAt(11.5, -24.0);
		playerController.root.position.set(11.5, spawn.y, -24.0);
		playerController.yawRad = Math.PI;
		playerController.pitchRad = 0;

		if (this.world.landerAssembly) {
			this.world.landerAssembly.position.copy(this.landerInitialPos);
		}
		if (this.world.landerAscentPlume) {
			this.world.landerAscentPlume.visible = false;
		}
		this.machinery.init(this.world);
		this.mission.resetMission(this.scene, this.world);
	}

	private handleKeyDown(e: KeyboardEvent): void {
		if (!this.isReady) return;

		const currentTurn = lunarOutpostStore.snapshot?.npcComms?.activeTurn ?? null;

		if (e.code === 'Escape' && currentTurn) {
			this.closeNpcDialogue();
			return;
		}

		if (currentTurn && ['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
			const idx = Number(e.code.replace('Digit', '')) - 1;
			this.npcs.selectChoiceByIndex(idx);
			return;
		}

		this.keys.add(e.code);

		if (e.code === 'KeyT') {
			this.npcs.tryStartOrAdvanceDialogue(
				this.mission.phase,
				this.mission.dustyPanelsRemaining > 0
			);
		} else if (e.code === 'KeyE') {
			if (this.rover.isSeated || this.rover.isInBoardingRange(playerController.root.position)) {
				this.rover.toggleEnterExit(playerController.root, this.world, this.scene);
			} else {
				const prevPhase = this.mission.phase;
				const msg = this.mission.tryContextInteract(playerController.root.position);
				if (msg) {
					hudStore.setComms(msg);
					if (prevPhase !== 'launched' && this.mission.phase === 'launched') {
						this.machinery.triggerLanderLaunch();
						outpostEventBus.emit('lander:launched', { launchPadPos: [46, 0, -52] });
					}
				} else if (this.machinery.isNearAirlock(playerController.root.position)) {
					this.machinery.toggleAirlockDoor();
					hudStore.setComms(
						this.machinery.isAirlockOpen() ? 'Habitat Airlock opened.' : 'Habitat Airlock sealed.'
					);
				}
			}
		} else if (e.code === 'KeyF') {
			if (this.rover.isSeated) {
				const msg = this.rover.loadOrUnloadCrate(
					this.mission.crates,
					this.scene,
					this.world,
					this.mission
				);
				if (msg) hudStore.setComms(msg);
			} else {
				const msg = playerController.pickUpOrDropCrate(
					this.mission.crates,
					this.scene,
					this.world,
					{
						vehicle: this.rover,
						zoneProvider: this.mission,
						deliverRadius: LunarOutpostConfig.physics.crateDeliverRadius,
						interactionRadius: LunarOutpostConfig.physics.interactionRadius
					}
				);
				if (msg) hudStore.setComms(msg);
			}
		} else if (e.code === 'KeyL' && this.rover.isSeated) {
			this.rover.toggleHeadlights();
		}
	}

	update(delta: number): void {
		if (!this.isReady) return;

		const sun = this.sunCycle.update(delta, playerController.root.position);
		this.world.updateLighting(
			delta,
			playerController.root.position,
			sun.sunElevationDeg,
			sun.isNight ?? false
		);

		const roverState = this.rover.update(
			delta,
			this.keys,
			playerController.root,
			this.world,
			this.collisions
		);
		playerController.update(delta, this.keys, this.world, this.collisions, this.rover.rover);
		if (!roverState.isSeated) {
			this.npcs.resolvePlayerCollisions(playerController.root.position);
		}
		this.machinery.update(delta);

		const missionPrompt = this.mission.update(
			delta,
			playerController.root.position,
			this.rover.rover,
			{
				isSeated: roverState.isSeated,
				carryingCrateName: playerController.carryingItemName,
				roverLoadedCrateName: roverState.loadedCrateName
			}
		);

		const dustAlertActive = this.mission.dustyPanelsRemaining > 0;
		const npcComms = this.npcs.update(
			delta,
			playerController.root.position,
			roverState.isSeated,
			this.mission.phase,
			dustAlertActive
		);

		const deliveredCount = this.mission.dropOffZones.filter((z) => z.delivered).length;
		const collectedCount = this.mission.samples.filter((s) => s.collected).length;
		const analyzedCount = this.mission.samples.filter((s) => s.analyzed).length;

		hudStore.setTelemetry('Solar Cycle', `${sun.phaseLabel} (${sun.sunElevationDeg}°)`);
		hudStore.setTelemetry('Rover Battery', `${roverState.batteryPct}%`);
		hudStore.setTelemetry(
			'Drop-Offs',
			`${deliveredCount} / ${LunarOutpostConfig.resupplyRequiredCount}`
		);
		hudStore.setTelemetry('ISRU Samples', `${analyzedCount} / 6`);

		let actionPrompt: string | null = null;
		if (roverState.isSeated) {
			if (missionPrompt) {
				hudStore.setPrompt(missionPrompt.key, missionPrompt.label);
				actionPrompt = `[${missionPrompt.key}] ${missionPrompt.label}`;
			} else {
				hudStore.setPrompt('E', 'Exit Orion LTV Rover');
				actionPrompt = '[E] Exit Orion LTV Rover';
			}
		} else if (missionPrompt) {
			hudStore.setPrompt(missionPrompt.key, missionPrompt.label);
			actionPrompt = `[${missionPrompt.key}] ${missionPrompt.label}`;
		} else if (roverState.canBoard) {
			hudStore.setPrompt('E', 'Board Orion LTV Rover');
			actionPrompt = '[E] Board Orion LTV Rover';
		} else if (npcComms.talkPrompt && npcComms.nearbyNpcName) {
			hudStore.setPrompt('T', `Talk to ${npcComms.nearbyNpcName}`);
			actionPrompt = npcComms.talkPrompt;
		} else {
			hudStore.clearPrompt();
		}

		const commsHeader =
			this.mission.phase === 'launched' || this.mission.phase === 'finale_ready'
				? hudCopy.finaleReady
				: this.mission.phase === 'exploration'
					? hudCopy.explorationStart
					: hudCopy.briefing;

		lunarOutpostStore.update({
			phase: this.mission.phase,
			speaker: commsHeader.speaker as 'Commander Maya' | 'Geologist Leo' | 'Mission Control',
			dialogue: commsHeader.dialogue,
			actionPrompt,
			cratesDelivered: deliveredCount,
			cratesRequired: LunarOutpostConfig.resupplyRequiredCount,
			dropOffZones: this.mission.dropOffZones.map((z) => ({
				id: z.id,
				label: z.label,
				shortHint: z.shortHint,
				delivered: z.delivered,
				deliveredCrateName: z.deliveredCrateName
			})),
			carryingCrateName: playerController.carryingItemName,
			samplesCollectedCount: collectedCount,
			samplesAnalyzedCount: analyzedCount,
			samples: this.mission.samples,
			activeDiscoveryCard: this.mission.activeDiscoveryCard,
			maintenanceAlert: {
				active: dustAlertActive,
				title: hudCopy.maintenanceAlert.title,
				message: hudCopy.maintenanceAlert.message,
				dustyPanelsRemaining: this.mission.dustyPanelsRemaining,
				totalPanels: this.world.solarDustLayers.length
			},
			rover: {
				...roverState,
				surfaceType: roverState.surfaceType as typeof roverState.surfaceType &
					('Sintered_Regolith' | 'Compacted_Wheel_Ruts' | 'Graded_Crater_Trail' | 'Loose_Regolith')
			},
			solar: {
				phaseLabel: sun.phaseLabel as 'Lunar Day' | 'Crater Twilight' | 'Lunar Night',
				sunElevationDeg: sun.sunElevationDeg,
				cycleProgressPct: sun.cycleProgressPct ?? 0,
				isNight: sun.isNight ?? false
			},
			scannerPowerPct: this.mission.scannerPowerPct,
			isPointerLocked: playerController.isPointerLocked,
			npcComms
		});
	}
}

export const lunarOutpostScene = new LunarOutpostScene();
