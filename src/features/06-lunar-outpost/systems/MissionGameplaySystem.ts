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
import type {
	OutpostWorldBuilder,
	SkywardWaypointTarget,
	WorldDropOffZone
} from './OutpostWorldBuilder';

export class MissionGameplaySystem {
	public phase: OutpostPhase = 'briefing';
	public activeDiscoveryCard: DiscoveryCardData | null = null;

	private samples: DiscoveryCardData[] = structuredClone(LunarOutpostConfig.discoveryCards);
	private cratesDelivered = 0;
	private speaker: OutpostHudSnapshot['speaker'] = 'Commander Maya';
	private dialogue = hudCopy.briefing.dialogue;
	private maintenanceActive = false;
	private maintenanceTriggeredOnce = false;
	private launchSequenceTimer = 0;
	private elapsedSec = 0;

	dismissDiscoveryCard() {
		this.activeDiscoveryCard = null;
	}

	startResupplyMission() {
		if (this.phase === 'briefing') {
			this.phase = 'resupply';
			this.speaker = 'Commander Maya';
			this.dialogue =
				'Orders active! Pick up any supply box [F] (or stick 1 box onto the back of the Rover) and drop 1 box at each of the 5 stations: Command Control, Electricity, Storage Pod, Geology Lab, and Habitat Airlock.';
		}
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

		// 4. Trigger Sample Return Launch at the Orion Landing Pad
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
				'Ignition confirmed! Sample Return Vehicle ascending from Orion Moon Outpost back to Earth!';
			return true;
		}

		// 5. Toggle Airlock door
		if (machinery.isNearAirlock(actorPos)) {
			return machinery.toggleAirlockDoor();
		}

		return false;
	}

	private completeDropOffAtZone(
		zone: WorldDropOffZone,
		crate: THREE.Object3D,
		scene: THREE.Scene,
		world: OutpostWorldBuilder
	) {
		scene.attach(crate);
		const hit = world.sampleSurfaceAt(zone.position.x, zone.position.z);
		crate.position.set(zone.position.x, hit.y + 0.39, zone.position.z);
		crate.rotation.set(0, 0, 0);
		crate.userData.delivered = true;
		crate.userData.deliveredZoneId = zone.id;

		zone.delivered = true;
		zone.deliveredCrateName = crate.name;
		zone.beaconMesh.visible = false;
		(zone.ringMesh.material as THREE.MeshBasicMaterial).color.setHex(0x10b981);

		this.cratesDelivered = world.dropOffZones.filter((z) => z.delivered).length;

		if (this.cratesDelivered >= LunarOutpostConfig.resupplyRequiredCount) {
			this.phase = 'exploration';
			this.speaker = 'Geologist Leo';
			this.dialogue = hudCopy.explorationStart.dialogue;
		} else {
			const remainingNames = world.dropOffZones
				.filter((z) => !z.delivered)
				.map((z) => z.label)
				.join(', ');
			this.speaker = 'Commander Maya';
			this.dialogue = `Box delivered to ${zone.label} (${this.cratesDelivered}/${LunarOutpostConfig.resupplyRequiredCount})! Remaining drop-offs: ${remainingNames}.`;
		}
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
		this.elapsedSec += dt;
		const actorPos = rover.isSeated && rover.rover ? rover.rover.position : astronaut.root.position;

		// Auto-activate resupply phase if player picks up a crate or boards the rover directly
		if (
			this.phase === 'briefing' &&
			(astronaut.carryingCrate !== null || rover.loadedCrate !== null || rover.isSeated)
		) {
			this.startResupplyMission();
		}

		// Any box can be taken anywhere, and dropping it off inside a designated zone completes that delivery
		if (this.phase === 'briefing' || this.phase === 'resupply') {
			const cratePos = new THREE.Vector3();
			for (const crate of world.supplyCrates) {
				if (crate.userData?.delivered) continue;
				// Must be landed on the ground (not held by astronaut, stuck to rover, or mid-fall)
				if (
					crate === astronaut.carryingCrate ||
					crate === rover.loadedCrate ||
					rover.isCrateFalling(crate)
				) {
					continue;
				}

				crate.getWorldPosition(cratePos);
				const targetZone = world.findDropOffZoneNear(
					cratePos,
					LunarOutpostConfig.physics.crateDeliverRadius,
					true
				);

				if (targetZone) {
					if (this.phase === 'briefing') {
						this.phase = 'resupply';
					}
					this.completeDropOffAtZone(targetZone, crate, scene, world);
				}
			}
		}

		if (this.phase === 'launched' && this.launchSequenceTimer > 0) {
			this.launchSequenceTimer += dt;
			if (world.landerAssembly) {
				const ascentSpeed = Math.min(48, this.launchSequenceTimer * this.launchSequenceTimer * 3.8);
				world.landerAssembly.position.y += ascentSpeed * dt;
			}
		}

		this.syncSkywardMissionBeacons(world, astronaut, rover);

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

		const carriedName = rover.isSeated
			? (rover.loadedCrate?.name ?? null)
			: (astronaut.carryingCrate?.name ?? null);

		return {
			phase: this.phase,
			speaker: this.speaker,
			dialogue: this.dialogue,
			actionPrompt,
			cratesDelivered: this.cratesDelivered,
			cratesRequired: LunarOutpostConfig.resupplyRequiredCount,
			dropOffZones: world.dropOffZones.map((z) => ({
				id: z.id,
				label: z.label,
				shortHint: z.shortHint,
				delivered: z.delivered,
				deliveredCrateName: z.deliveredCrateName
			})),
			carryingCrateName: carriedName,
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

	/**
	 * Routes faint yellow skyward light pillars to every active waypoint across all phases
	 * so objectives stand out clearly across the lunar crater terrain.
	 */
	private syncSkywardMissionBeacons(
		world: OutpostWorldBuilder,
		astronaut: AstronautController,
		rover: OrionRoverSystem
	) {
		const waypoints: SkywardWaypointTarget[] = [];
		const isSupplyPhase = this.phase === 'briefing' || this.phase === 'resupply';

		// Drop-off ring pillars only stay visible during supply phases
		for (const zone of world.dropOffZones) {
			zone.beaconMesh.visible = isSupplyPhase && !zone.delivered;
		}

		// Sample pillars only appear during exploration for uncollected nodes
		for (const sample of this.samples) {
			const beacon = world.sampleBeacons.get(sample.nodeName);
			if (beacon) {
				beacon.visible = this.phase === 'exploration' && !sample.collected;
			}
		}

		if (isSupplyPhase) {
			const holdingCrate = astronaut.carryingCrate !== null || rover.loadedCrate !== null;
			if (!holdingCrate) {
				// Point skyward beams to undelivered supply crates so the player can spot them easily
				const cratePos = new THREE.Vector3();
				for (const crate of world.supplyCrates) {
					if (crate.userData?.delivered) continue;
					crate.getWorldPosition(cratePos);
					const hit = world.sampleSurfaceAt(cratePos.x, cratePos.z);
					waypoints.push({
						id: `crate_${crate.name}`,
						position: new THREE.Vector3(cratePos.x, hit.y, cratePos.z),
						intensity: 0.9,
						radiusScale: 0.72
					});
				}
			}
		}

		// Solar panel dust maintenance beacons take priority when active
		if (this.maintenanceActive) {
			const dustPos = new THREE.Vector3();
			for (let i = 0; i < world.solarDustLayers.length; i++) {
				const dust = world.solarDustLayers[i];
				if (!dust.visible) continue;
				dust.getWorldPosition(dustPos);
				const hit = world.sampleSurfaceAt(dustPos.x, dustPos.z);
				waypoints.push({
					id: `solar_dust_${i}`,
					position: new THREE.Vector3(dustPos.x, hit.y, dustPos.z),
					intensity: 1.05,
					radiusScale: 0.85
				});
			}
		}

		const hasPendingAnalysis = this.samples.some((s) => s.collected && !s.analyzed);
		if (this.phase === 'exploration' && hasPendingAnalysis) {
			const labHit = world.sampleSurfaceAt(world.workstationPos.x, world.workstationPos.z);
			waypoints.push({
				id: 'geology_workstation',
				position: new THREE.Vector3(world.workstationPos.x, labHit.y, world.workstationPos.z + 2.0),
				intensity: 1.15,
				radiusScale: 1.15
			});
		}

		if (this.phase === 'finale_ready') {
			const padHit = world.sampleSurfaceAt(world.launchPadPos.x, world.launchPadPos.z);
			waypoints.push({
				id: 'landing_pad_launch',
				position: new THREE.Vector3(world.launchPadPos.x, padHit.y, world.launchPadPos.z),
				intensity: 1.25,
				radiusScale: 1.5
			});
		}

		world.updateSkywardBeacons(waypoints, this.elapsedSec, hasPendingAnalysis);
	}

	private computeActionPrompt(
		actorPos: THREE.Vector3,
		world: OutpostWorldBuilder,
		astronaut: AstronautController,
		rover: OrionRoverSystem,
		machinery: OutpostMachinerySystem,
		roverState: RoverHudState
	): string | null {
		const isSupplyPhase = this.phase === 'briefing' || this.phase === 'resupply';
		const nearbyDropZone = isSupplyPhase
			? world.findDropOffZoneNear(actorPos, LunarOutpostConfig.physics.crateDeliverRadius, true)
			: null;
		const nearRoverCargo = !rover.isSeated && rover.isNearCargoRack(actorPos);

		if (rover.isSeated) {
			if (isSupplyPhase) {
				if (rover.loadedCrate) {
					return nearbyDropZone
						? `Press [F] to Drop Supply Box at ${nearbyDropZone.label}!`
						: 'Box Secured on Rear Rack (1/1) • Drive to Station Ring & Press [F] to Unload';
				}
				return 'Drive near any Supply Box & press [F] to Stick onto Rear Rack • [E] Exit Rover';
			}
			return 'WASD Drive • [L] Headlights • [E] Exit Rover';
		}

		if (astronaut.carryingCrate && nearRoverCargo) {
			return rover.loadedCrate
				? 'Press [F] to Place on Rover (Full 1/1 — Extra Box Will Fall Off Side)'
				: 'Press [F] to Stick Supply Box onto Top-Back of Rover';
		}

		if (!astronaut.carryingCrate && nearRoverCargo && rover.loadedCrate) {
			return 'Press [F] to Take Supply Box from Rover (or [E] to Drive)';
		}

		if (roverState.canBoard) {
			return 'Press [E] to Drive Orion Moon Rover';
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
			return 'Press [E] to Launch Sample Return Capsule to Earth!';
		}
		if (isSupplyPhase) {
			if (astronaut.carryingCrate) {
				return nearbyDropZone
					? `Press [F] to Drop Supply Box at ${nearbyDropZone.label}!`
					: 'Take Box to Rover Rear Rack or Station Ring (Command Control, Lab, etc.) • [F] Drop';
			}
			return 'Press [F] to Pick Up Supply Box (Stick 1 Box onto Rover Rear Rack)';
		}
		if (machinery.isNearAirlock(actorPos)) {
			return 'Press [E] to Toggle Airlock Hatch';
		}
		return null;
	}
}
