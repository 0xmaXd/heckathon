import * as THREE from 'three';
import type {
	CargoZoneProvider,
	DropOffZoneMatch
} from '../../../core/player/PlayerController.svelte';
import { LunarOutpostConfig } from '../lunar-outpost.config';
import type { DiscoveryCardData, DropOffZoneId, OutpostPhase } from '../lunar-outpost.types';
import { outpostEventBus } from './OutpostEventBus';
import type { OutpostWorldBuilder, WorldDropOffZoneEntry } from './OutpostWorldBuilder';

export interface DropOffZoneRuntime extends DropOffZoneMatch, WorldDropOffZoneEntry {
	id: DropOffZoneId;
	label: string;
	shortHint: string;
	delivered: boolean;
	deliveredCrateName: string | null;
	ringMesh: THREE.Mesh;
	beaconMesh: THREE.Mesh;
}

export interface MissionPromptHint {
	key: 'E' | 'F';
	label: string;
}

export interface MissionUpdateContext {
	isSeated: boolean;
	carryingCrateName: string | null;
	roverLoadedCrateName: string | null;
}

interface SampleNodeRuntime {
	card: DiscoveryCardData;
	object: THREE.Object3D;
}

const MINERAL_MATERIAL_SPECS: Record<
	string,
	{ color: number; metalness: number; roughness: number; emissive: number }
> = {
	titanium: { color: 0x1b1f2a, metalness: 0.85, roughness: 0.28, emissive: 0x1e293b },
	iron: { color: 0x6e737b, metalness: 0.9, roughness: 0.32, emissive: 0x334155 },
	aluminum: { color: 0xdde2ea, metalness: 0.65, roughness: 0.35, emissive: 0x475569 },
	oxygen: { color: 0x9c4a32, metalness: 0.18, roughness: 0.72, emissive: 0x451a03 },
	silicon: { color: 0xb99345, metalness: 0.45, roughness: 0.3, emissive: 0x422006 },
	water_ice: { color: 0x6ec8e8, metalness: 0.1, roughness: 0.18, emissive: 0x0c4a6e }
};

export class MissionGameplaySystem implements CargoZoneProvider {
	public phase: OutpostPhase = 'briefing';
	public crates: THREE.Object3D[] = [];
	public dropOffZones: DropOffZoneRuntime[] = [];
	public samples: DiscoveryCardData[] = [];
	public activeDiscoveryCard: DiscoveryCardData | null = null;
	public scannerPowerPct = 100;
	public dustyPanelsRemaining = 0;

	private sampleNodes: SampleNodeRuntime[] = [];
	private dustyPanels: THREE.Object3D[] = [];
	private geologyConsole: THREE.Object3D | null = null;
	private launchPad: THREE.Object3D | null = null;
	private orionLander: THREE.Object3D | null = null;
	private landerRestPos = new THREE.Vector3(46, 0.89, -52);
	private crateInitialTransforms: {
		obj: THREE.Object3D;
		pos: THREE.Vector3;
		quat: THREE.Quaternion;
	}[] = [];

	init(scene: THREE.Scene, world: OutpostWorldBuilder): void {
		this.crates = [];
		this.crateInitialTransforms = [];
		this.dropOffZones = [];
		world.dropOffZones.length = 0;
		this.sampleNodes = [];
		this.dustyPanels = [];
		this.activeDiscoveryCard = null;
		this.phase = 'briefing';

		this.samples = LunarOutpostConfig.discoveryCards.map((c) => ({
			...c,
			collected: false,
			analyzed: false
		}));

		const consoleMatches: THREE.Object3D[] = [];
		const padMatches: THREE.Object3D[] = [];
		const landerMatches: THREE.Object3D[] = [];

		world.outpostRoot?.traverse((obj) => {
			if (/Supply_Crate/i.test(obj.name) && obj.parent === world.outpostRoot) {
				this.crates.push(obj);
			} else if (/Solar_Dust_Layer/i.test(obj.name)) {
				this.dustyPanels.push(obj);
			} else if (/Geology_Workstation_Console/i.test(obj.name)) {
				consoleMatches.push(obj);
			} else if (/Orion_Landing_Pad/i.test(obj.name)) {
				padMatches.push(obj);
			} else if (/OrionLander|Orion_Lander/i.test(obj.name)) {
				landerMatches.push(obj);
			}
		});

		this.geologyConsole = consoleMatches[0] ?? null;
		this.launchPad = padMatches[0] ?? null;
		this.orionLander = landerMatches[0] ?? null;

		if (this.crates.length === 0) {
			const crateMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.45 });
			for (let i = 0; i < 6; i++) {
				const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.65, 0.75), crateMat);
				mesh.name = `Supply_Crate_0${i + 1}`;
				const x = 6 + (i % 3) * 1.6;
				const z = -22 + Math.floor(i / 3) * 1.6;
				const y = world.getGroundHeight(x, z) + 0.35;
				mesh.position.set(x, y, z);
				mesh.castShadow = true;
				scene.add(mesh);
				this.crates.push(mesh);
			}
		}

		for (const crate of this.crates) {
			this.crateInitialTransforms.push({
				obj: crate,
				pos: crate.position.clone(),
				quat: crate.quaternion.clone()
			});
		}

		for (const def of LunarOutpostConfig.dropOffZoneDefinitions) {
			const targetNode = world.findObjectByPatterns(def.nodePatterns);
			const pos = new THREE.Vector3(...def.fallbackPos);
			if (targetNode) {
				targetNode.getWorldPosition(pos);
				pos.z += def.offsetDistance;
			}
			pos.y = world.getGroundHeight(pos.x, pos.z);

			const ringMesh = new THREE.Mesh(
				new THREE.RingGeometry(1.45, 1.85, 32),
				new THREE.MeshBasicMaterial({
					color: 0xfbbf24,
					side: THREE.DoubleSide,
					transparent: true,
					opacity: 0.75
				})
			);
			ringMesh.rotation.x = -Math.PI / 2;
			ringMesh.position.set(pos.x, pos.y + 0.05, pos.z);
			ringMesh.name = `DropOff_Ring_${def.id}`;
			scene.add(ringMesh);

			const zoneEntry: DropOffZoneRuntime = {
				id: def.id,
				label: def.label,
				shortHint: def.shortHint,
				position: pos,
				delivered: false,
				deliveredCrateName: null,
				ringMesh,
				beaconMesh: ringMesh
			};

			this.dropOffZones.push(zoneEntry);
			world.dropOffZones.push(zoneEntry);
		}

		for (const card of this.samples) {
			const node = world.outpostRoot?.getObjectByName(card.nodeName) ?? null;
			if (node) {
				this.applyMineralAppearance(node, card.id, false, 0.2);
				this.sampleNodes.push({ card, object: node });
			}
		}

		if (this.orionLander) {
			this.landerRestPos.copy(this.orionLander.position);
		}
		this.dustyPanelsRemaining = this.dustyPanels.filter((p) => p.visible).length;
	}

	resetMission(scene: THREE.Scene, world: OutpostWorldBuilder): void {
		this.phase = 'briefing';
		this.activeDiscoveryCard = null;

		for (const item of this.crateInitialTransforms) {
			scene.attach(item.obj);
			item.obj.position.copy(item.pos);
			item.obj.quaternion.copy(item.quat);
			item.obj.userData.delivered = false;
			item.obj.visible = true;
		}

		for (const zone of this.dropOffZones) {
			zone.delivered = false;
			zone.deliveredCrateName = null;
			(zone.ringMesh.material as THREE.MeshBasicMaterial).color.setHex(0xfbbf24);
		}

		for (const card of this.samples) {
			card.collected = false;
			card.analyzed = false;
		}
		for (const entry of this.sampleNodes) {
			entry.object.visible = true;
			this.applyMineralAppearance(entry.object, entry.card.id, false, 0.2);
		}

		for (const dust of this.dustyPanels) {
			dust.visible = true;
		}
		this.dustyPanelsRemaining = this.dustyPanels.length;
		this.scannerPowerPct = 100;

		if (this.orionLander) {
			const padY = world.getGroundHeight(this.landerRestPos.x, this.landerRestPos.z);
			this.orionLander.position.set(this.landerRestPos.x, padY, this.landerRestPos.z);
			this.orionLander.visible = true;
		}
	}

	findDropOffZoneNear(
		pos: THREE.Vector3,
		radius = LunarOutpostConfig.physics.crateDeliverRadius,
		onlyUndelivered = true
	): DropOffZoneRuntime | null {
		let best: DropOffZoneRuntime | null = null;
		let bestDist = radius;
		for (const zone of this.dropOffZones) {
			if (onlyUndelivered && zone.delivered) continue;
			const d = Math.hypot(pos.x - zone.position.x, pos.z - zone.position.z);
			if (d <= bestDist) {
				bestDist = d;
				best = zone;
			}
		}
		return best;
	}

	beginResupply(): void {
		if (this.phase === 'briefing') {
			this.phase = 'resupply';
			outpostEventBus.emit('mission:phaseChanged', { phase: this.phase });
		}
	}

	tryContextInteract(playerPos: THREE.Vector3): string | null {
		for (const dust of this.dustyPanels) {
			if (!dust.visible) continue;
			const wp = new THREE.Vector3();
			dust.getWorldPosition(wp);
			if (wp.distanceTo(playerPos) <= LunarOutpostConfig.physics.interactionRadius) {
				dust.visible = false;
				this.dustyPanelsRemaining = this.dustyPanels.filter((p) => p.visible).length;
				this.scannerPowerPct = Math.min(100, this.scannerPowerPct + 25);
				return 'Solar panel wiped clean! Scanner power restored.';
			}
		}

		for (const entry of this.sampleNodes) {
			if (entry.card.collected) continue;
			const wp = new THREE.Vector3();
			entry.object.getWorldPosition(wp);
			if (wp.distanceTo(playerPos) <= LunarOutpostConfig.physics.interactionRadius) {
				entry.card.collected = true;
				this.applyMineralAppearance(entry.object, entry.card.id, true, 0.55);
				outpostEventBus.emit('sample:collected', {
					nodeName: entry.card.nodeName,
					title: entry.card.title
				});
				if (this.phase === 'briefing' || this.phase === 'resupply') {
					this.phase = 'exploration';
					outpostEventBus.emit('mission:phaseChanged', { phase: this.phase });
				}
				return `Scanned ${entry.card.title} (${entry.card.formula})! Bring data to Geology Lab.`;
			}
		}

		if (this.geologyConsole) {
			const labPos = new THREE.Vector3();
			this.geologyConsole.getWorldPosition(labPos);
			if (labPos.distanceTo(playerPos) <= LunarOutpostConfig.physics.workstationRadius) {
				const pending = this.samples.find((s) => s.collected && !s.analyzed);
				if (pending) {
					pending.analyzed = true;
					this.activeDiscoveryCard = pending;
					const analyzedCount = this.samples.filter((s) => s.analyzed).length;
					outpostEventBus.emit('sample:analyzed', {
						nodeName: pending.nodeName,
						title: pending.title,
						analyzedCount
					});
					if (this.samples.every((s) => s.analyzed)) {
						this.phase = 'finale_ready';
						outpostEventBus.emit('mission:phaseChanged', { phase: this.phase });
					}
					return `Verified ${pending.title} at Geology Lab!`;
				}
			}
		}

		if (this.phase === 'finale_ready' && this.launchPad) {
			const padPos = new THREE.Vector3();
			this.launchPad.getWorldPosition(padPos);
			if (padPos.distanceTo(playerPos) <= LunarOutpostConfig.physics.launchPadRadius) {
				this.phase = 'launched';
				outpostEventBus.emit('mission:phaseChanged', { phase: this.phase });
				return 'Orion Sample Return Ascent Stage launched!';
			}
		}

		return null;
	}

	update(
		dt: number,
		playerPos: THREE.Vector3,
		roverObj: THREE.Object3D | null,
		context?: MissionUpdateContext
	): MissionPromptHint | null {
		const crateWorld = new THREE.Vector3();
		for (const zone of this.dropOffZones) {
			if (zone.delivered) continue;
			for (const crate of this.crates) {
				if (crate.userData?.delivered) continue;
				if (roverObj && crate.parent) {
					let isMountedOnRover = false;
					crate.traverseAncestors((anc) => {
						if (anc === roverObj) isMountedOnRover = true;
					});
					if (isMountedOnRover) continue;
				}
				crate.getWorldPosition(crateWorld);
				const dist = Math.hypot(crateWorld.x - zone.position.x, crateWorld.z - zone.position.z);
				if (dist <= 2.4) {
					crate.userData.delivered = true;
					zone.delivered = true;
					zone.deliveredCrateName = crate.name;
					(zone.ringMesh.material as THREE.MeshBasicMaterial).color.setHex(0x10b981);
					if (this.phase === 'briefing') this.phase = 'resupply';
					const deliveredCount = this.dropOffZones.filter((z) => z.delivered).length;
					outpostEventBus.emit('crate:delivered', {
						zoneId: zone.id,
						crateName: crate.name,
						deliveredCount
					});
					break;
				}
			}
		}

		if (
			(this.phase === 'briefing' || this.phase === 'resupply') &&
			this.dropOffZones.every((z) => z.delivered)
		) {
			this.phase = 'exploration';
			outpostEventBus.emit('mission:phaseChanged', { phase: this.phase });
		}

		const samplePos = new THREE.Vector3();
		for (const entry of this.sampleNodes) {
			if (entry.card.collected) continue;
			entry.object.getWorldPosition(samplePos);
			const playerDist = playerPos.distanceTo(samplePos);
			const roverDist = roverObj ? roverObj.position.distanceTo(samplePos) : Infinity;
			const near = Math.min(playerDist, roverDist) <= 12.0;
			this.applyMineralAppearance(entry.object, entry.card.id, false, near ? 0.45 : 0.2);
		}

		if (this.phase === 'launched' && this.orionLander) {
			this.orionLander.position.y = Math.min(
				this.landerRestPos.y + 180,
				this.orionLander.position.y + 18 * dt
			);
		}

		return this.computeContextPrompt(playerPos, roverObj, context);
	}

	private computeContextPrompt(
		playerPos: THREE.Vector3,
		roverObj: THREE.Object3D | null,
		context?: MissionUpdateContext
	): MissionPromptHint | null {
		const isSeated = context?.isSeated ?? false;
		const carryingCrateName = context?.carryingCrateName ?? null;
		const roverLoadedCrateName = context?.roverLoadedCrateName ?? null;

		if (isSeated && roverObj) {
			if (roverLoadedCrateName) {
				const zone = this.findDropOffZoneNear(
					roverObj.position,
					LunarOutpostConfig.physics.crateDeliverRadius,
					true
				);
				if (zone) {
					return { key: 'F', label: `Unload ${roverLoadedCrateName} at ${zone.label}` };
				}
				return { key: 'F', label: `Unload ${roverLoadedCrateName} from Rover` };
			}

			const nearCrate = this.findNearestCrate(roverObj.position, 4.8);
			if (nearCrate) {
				return { key: 'F', label: `Load ${nearCrate.name} onto Rover` };
			}
			return null;
		}

		if (carryingCrateName) {
			const zone = this.findDropOffZoneNear(
				playerPos,
				LunarOutpostConfig.physics.crateDeliverRadius,
				true
			);
			if (zone) {
				return { key: 'F', label: `Drop ${carryingCrateName} at ${zone.label}` };
			}
			if (roverObj && playerPos.distanceTo(roverObj.position) <= 3.55 && !roverLoadedCrateName) {
				return { key: 'F', label: `Load ${carryingCrateName} onto Rover` };
			}
			return { key: 'F', label: `Drop ${carryingCrateName}` };
		}

		for (const dust of this.dustyPanels) {
			if (!dust.visible) continue;
			const wp = new THREE.Vector3();
			dust.getWorldPosition(wp);
			if (wp.distanceTo(playerPos) <= LunarOutpostConfig.physics.interactionRadius) {
				return { key: 'E', label: 'Wipe Lunar Dust off Solar Panel' };
			}
		}

		for (const entry of this.sampleNodes) {
			if (entry.card.collected) continue;
			const wp = new THREE.Vector3();
			entry.object.getWorldPosition(wp);
			if (wp.distanceTo(playerPos) <= LunarOutpostConfig.physics.interactionRadius) {
				return { key: 'E', label: `Scan ${entry.card.title} (${entry.card.formula})` };
			}
		}

		if (this.geologyConsole) {
			const labPos = new THREE.Vector3();
			this.geologyConsole.getWorldPosition(labPos);
			if (labPos.distanceTo(playerPos) <= LunarOutpostConfig.physics.workstationRadius) {
				const pending = this.samples.find((s) => s.collected && !s.analyzed);
				if (pending) {
					return { key: 'E', label: `Analyze ${pending.title} at Geology Lab` };
				}
			}
		}

		if (this.phase === 'finale_ready' && this.launchPad) {
			const padPos = new THREE.Vector3();
			this.launchPad.getWorldPosition(padPos);
			if (padPos.distanceTo(playerPos) <= LunarOutpostConfig.physics.launchPadRadius) {
				return { key: 'E', label: 'Trigger Sample Return Launch' };
			}
		}

		if (roverObj && roverLoadedCrateName && playerPos.distanceTo(roverObj.position) <= 3.55) {
			return { key: 'F', label: `Take ${roverLoadedCrateName} from Rover` };
		}

		const nearCrate = this.findNearestCrate(
			playerPos,
			LunarOutpostConfig.physics.interactionRadius
		);
		if (nearCrate) {
			return { key: 'F', label: `Pick Up ${nearCrate.name}` };
		}

		return null;
	}

	private findNearestCrate(origin: THREE.Vector3, maxDist: number): THREE.Object3D | null {
		let best: THREE.Object3D | null = null;
		let bestDist = maxDist;
		const wp = new THREE.Vector3();
		for (const crate of this.crates) {
			if (crate.userData?.delivered) continue;
			crate.getWorldPosition(wp);
			const d = origin.distanceTo(wp);
			if (d <= bestDist) {
				bestDist = d;
				best = crate;
			}
		}
		return best;
	}

	private applyMineralAppearance(
		node: THREE.Object3D,
		sampleId: string,
		scanned: boolean,
		emissiveIntensity: number
	): void {
		const spec = MINERAL_MATERIAL_SPECS[sampleId];
		if (!spec) return;

		node.traverse((child) => {
			if (!(child instanceof THREE.Mesh)) return;
			const mat = (child.material as THREE.MeshStandardMaterial).clone();
			mat.color.setHex(spec.color);
			mat.metalness = spec.metalness;
			mat.roughness = spec.roughness;
			mat.emissive.setHex(spec.emissive);
			mat.emissiveIntensity = scanned ? 0.55 : emissiveIntensity;
			child.material = mat;
		});
	}
}
