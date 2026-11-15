import * as THREE from 'three';
import { LunarOutpostConfig } from '../lunar-outpost.config';
import hudCopy from '../lunar-outpost.hud.json';
import type {
	DiscoveryCardData,
	OutpostHudSnapshot,
	OutpostPhase,
	RoverHudState,
	SolarCycleState
} from '../lunar-outpost.types';
import type { AstronautController } from './AstronautController';
import type { OrionRoverSystem } from './OrionRoverSystem';
import type { OutpostMachinerySystem } from './OutpostMachinerySystem';
import type { OutpostWorldBuilder } from './OutpostWorldBuilder';

interface LandingHandoffData {
	siteName: string;
	style: 'apollo' | 'artemis';
	fuelRemainingPct: number;
	touchdownTiltDeg: number;
}

function readLandingHandoff(): LandingHandoffData | null {
	try {
		const raw = sessionStorage.getItem('artemis_lunar_landing_handoff');
		if (!raw) return null;
		return JSON.parse(raw) as LandingHandoffData;
	} catch {
		return null;
	}
}

export class MissionGameplaySystem {
	public phase: OutpostPhase = 'resupply';
	public activeDiscoveryCard: DiscoveryCardData | null = null;

	private samples: DiscoveryCardData[] = structuredClone(LunarOutpostConfig.discoveryCards);
	private cratesDelivered = 0;
	private speaker: OutpostHudSnapshot['speaker'] = 'Commander Maya';
	private dialogue = hudCopy.briefing.dialogue;
	private maintenanceActive = false;
	private maintenanceTriggeredOnce = false;
	private launchSequenceTimer = 0;
	private handoffApplied = false;

	dismissDiscoveryCard() {
		this.activeDiscoveryCard = null;
	}

	private applyLandingHandoffIfPresent() {
		if (this.handoffApplied) return;
		this.handoffApplied = true;

		const handoff = readLandingHandoff();
		if (!handoff) return;

		this.speaker = 'Commander Maya';
		this.dialogue = `Orion Lander secured on the pad at ${handoff.siteName} (${handoff.style.toUpperCase()} GNC, ${handoff.fuelRemainingPct}% propellant remaining)! ${hudCopy.briefing.dialogue}`;
	}

	/** Handles primary [E] contextual action (outside Rover boarding) */
	handleContextInteract(
		actorPos: THREE.Vector3,
		_scene: THREE.Scene,
		world: OutpostWorldBuilder,
		machinery: OutpostMachinerySystem
	): boolean {
		// 1. Clean dusty solar panels if near one
		if (machinery.cleanNearbySolarPanel(actorPos)) {
			const remaining = machinery.getDustyPanelCount();
			if (remaining === 0 && this.maintenanceActive) {
				this.maintenanceActive = false;
				this.speaker = 'Geologist Leo';
				this.dialogue =
					'Solar Array is back at 100% output! Your Geology Scanner is fully powered again.';
			}
			return true;
		}

		// 2. Collect nearby geological sample (when in exploration phase)
		if (this.phase === 'exploration') {
			const samplePos = new THREE.Vector3();
			for (const sample of this.samples) {
				if (sample.collected) continue;
				const node = world.sampleNodes.get(sample.nodeName);
				if (!node) continue;
				node.getWorldPosition(samplePos);

				if (actorPos.distanceTo(samplePos) <= LunarOutpostConfig.physics.interactionRadius + 1.2) {
					sample.collected = true;
					node.visible = false;
					const beacon = world.sampleBeacons.get(sample.nodeName);
					if (beacon) beacon.visible = false;

					this.speaker = 'Geologist Leo';
					this.dialogue = `Collected ${sample.title} (${sample.category})! Bring it back to the ISS-inspired Geology Lab to run spectrometer analysis.`;
					return true;
				}
			}

			// 3. Analyze collected samples at the Geology Workstation
			if (
				actorPos.distanceTo(world.workstationPos) <= LunarOutpostConfig.physics.workstationRadius
			) {
				const pending = this.samples.find((s) => s.collected && !s.analyzed);
				if (pending) {
					pending.analyzed = true;
					this.activeDiscoveryCard = pending;
					this.speaker = 'Geologist Leo';
					this.dialogue = `Verified ${pending.title}! Discovery card unlocked.`;

					const analyzedCount = this.samples.filter((s) => s.analyzed).length;
					if (analyzedCount === 3 && !this.maintenanceTriggeredOnce) {
						this.maintenanceTriggeredOnce = true;
						this.maintenanceActive = true;
						machinery.triggerDustStorm(6);
						this.speaker = 'Geologist Leo';
						this.dialogue = hudCopy.maintenanceAlert.message;
					} else if (analyzedCount === this.samples.length) {
						this.phase = 'finale_ready';
						this.speaker = 'Commander Maya';
						this.dialogue = hudCopy.finaleReady.dialogue;
					}
					return true;
				}
			}
		}

		// 4. Trigger Sample Return Launch at Orion_Landing_Pad_NASALogo
		if (
			this.phase === 'finale_ready' &&
			actorPos.distanceTo(world.launchPadPos) <= LunarOutpostConfig.physics.launchPadRadius
		) {
			this.phase = 'launched';
			this.launchSequenceTimer = 0.01;
			if (world.landerAscentPlume) {
				world.landerAscentPlume.visible = true;
			}
			this.speaker = 'Mission Control';
			this.dialogue =
				'Ignition confirmed! Orion Lander ascending from Orion Landing Pad back to Earth orbit!';
			return true;
		}

		// 5. Toggle Airlock door
		if (machinery.isNearAirlock(actorPos)) {
			return machinery.toggleAirlockDoor();
		}

		return false;
	}

	update(
		dt: number,
		scene: THREE.Scene,
		world: OutpostWorldBuilder,
		astronaut: AstronautController,
		rover: OrionRoverSystem,
		machinery: OutpostMachinerySystem,
		roverState: RoverHudState,
		solar: SolarCycleState,
		isPointerLocked: boolean
	): OutpostHudSnapshot {
		this.applyLandingHandoffIfPresent();

		const actorPos = rover.isSeated && rover.rover ? rover.rover.position : astronaut.root.position;

		// Check Supply Crate delivery to Storage Pod Drop Ring
		if (this.phase === 'resupply') {
			const cratePos = new THREE.Vector3();
			for (const crate of world.supplyCrates) {
				if (crate.userData?.delivered) continue;
				crate.getWorldPosition(cratePos);

				if (
					cratePos.distanceTo(world.resupplyDropPos) <=
					LunarOutpostConfig.physics.crateDeliverRadius
				) {
					if (rover.loadedCrate === crate) rover.loadedCrate = null;
					if (astronaut.carryingCrate === crate) astronaut.carryingCrate = null;

					scene.attach(crate);
					const col = this.cratesDelivered % 3;
					const row = Math.floor(this.cratesDelivered / 3);
					const destX = world.resupplyDropPos.x - 1.2 + col * 1.2;
					const destZ = world.resupplyDropPos.z - 0.8 + row * 1.2;
					const hit = world.sampleSurfaceAt(destX, destZ);

					crate.position.set(destX, hit.y + 0.39, destZ);
					crate.rotation.set(0, 0, 0);
					crate.userData.delivered = true;
					this.cratesDelivered++;

					if (this.cratesDelivered >= LunarOutpostConfig.resupplyRequiredCount) {
						this.phase = 'exploration';
						this.speaker = 'Geologist Leo';
						this.dialogue = hudCopy.explorationStart.dialogue;
					} else {
						this.speaker = 'Commander Maya';
						this.dialogue = `Crate secured (${this.cratesDelivered}/${LunarOutpostConfig.resupplyRequiredCount})! Deliver the remaining supply crates to the Storage Pod ring.`;
					}
				}
			}
		}

		// Liftoff animation for OrionLander.glb from Orion_Landing_Pad_NASALogo
		if (this.phase === 'launched' && this.launchSequenceTimer > 0) {
			this.launchSequenceTimer += dt;
			if (world.landerAssembly) {
				const ascentSpeed = Math.min(48, this.launchSequenceTimer * this.launchSequenceTimer * 3.8);
				world.landerAssembly.position.y += ascentSpeed * dt;
			}
			if (world.landerAscentPlume) {
				world.landerAscentPlume.visible = true;
				world.landerAscentPlume.scale.set(
					0.95 + Math.random() * 0.25,
					0.9 + Math.random() * 0.45,
					0.95 + Math.random() * 0.25
				);
			}
		}

		const actionPrompt = this.computeActionPrompt(
			actorPos,
			world,
			astronaut,
			rover,
			machinery,
			roverState
		);

		const dustyRemaining = machinery.getDustyPanelCount();
		const scannerPowerPct = this.maintenanceActive
			? Math.max(40, Math.round(100 - dustyRemaining * 10))
			: 100;

		return {
			phase: this.phase,
			speaker: this.speaker,
			dialogue: this.dialogue,
			actionPrompt,
			cratesDelivered: this.cratesDelivered,
			cratesRequired: LunarOutpostConfig.resupplyRequiredCount,
			carryingCrateName: astronaut.carryingCrate?.name ?? null,
			samplesCollectedCount: this.samples.filter((s) => s.collected).length,
			samplesAnalyzedCount: this.samples.filter((s) => s.analyzed).length,
			samples: this.samples.map((s) => ({ ...s })),
			activeDiscoveryCard: this.activeDiscoveryCard ? { ...this.activeDiscoveryCard } : null,
			maintenanceAlert: {
				active: this.maintenanceActive,
				title: hudCopy.maintenanceAlert.title,
				message: hudCopy.maintenanceAlert.message,
				dustyPanelsRemaining: dustyRemaining,
				totalPanels: world.solarDustLayers.length
			},
			rover: roverState,
			solar,
			scannerPowerPct,
			isPointerLocked
		};
	}

	private computeActionPrompt(
		actorPos: THREE.Vector3,
		world: OutpostWorldBuilder,
		astronaut: AstronautController,
		rover: OrionRoverSystem,
		machinery: OutpostMachinerySystem,
		roverState: RoverHudState
	): string | null {
		if (roverState.canBoard) {
			return 'Press [E] to Drive Orion Moon Rover';
		}
		if (rover.isSeated) {
			if (this.phase === 'resupply') {
				return rover.loadedCrate
					? 'Drive to Orange Drop Ring by Storage Pod • [F] Unload • [E] Exit'
					: 'Press [F] near a Supply Crate to Load onto Rover • [E] Exit';
			}
			return 'WASD Drive • [L] Headlights • [E] Exit Rover';
		}
		if (machinery.hasDustyPanelNearby(actorPos)) {
			return 'Press [E] to Wipe Lunar Dust off Solar Panel';
		}
		if (this.phase === 'exploration') {
			const samplePos = new THREE.Vector3();
			for (const s of this.samples) {
				if (s.collected) continue;
				const node = world.sampleNodes.get(s.nodeName);
				if (!node) continue;
				node.getWorldPosition(samplePos);
				if (actorPos.distanceTo(samplePos) <= LunarOutpostConfig.physics.interactionRadius + 1.2) {
					return `Press [E] to Scan & Collect ${s.title}`;
				}
			}
			const hasPendingAnalysis = this.samples.some((s) => s.collected && !s.analyzed);
			if (
				hasPendingAnalysis &&
				actorPos.distanceTo(world.workstationPos) <= LunarOutpostConfig.physics.workstationRadius
			) {
				return 'Press [E] to Analyze Lunar Sample at Geology Lab';
			}
		}
		if (
			this.phase === 'finale_ready' &&
			actorPos.distanceTo(world.launchPadPos) <= LunarOutpostConfig.physics.launchPadRadius
		) {
			return 'Press [E] to Launch Orion Lander to Earth!';
		}
		if (this.phase === 'resupply') {
			return astronaut.carryingCrate
				? 'Carry Crate to Orange Drop Ring by Storage Pod • [F] Place'
				: 'Press [F] to Pick Up Supply Crate (or [E] at Rover to Haul)';
		}
		if (machinery.isNearAirlock(actorPos)) {
			return 'Press [E] to Toggle Airlock Hatch';
		}
		return null;
	}
}
