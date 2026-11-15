import * as THREE from 'three';
import { LunarOutpostConfig } from '../lunar-outpost.config';
import type { NpcCommsState, NpcDialogueTurn, NpcId, OutpostPhase } from '../lunar-outpost.types';
import {
	buildDialogueTurn,
	getInitialDialogueNodeId,
	ROOM_07_AMBIENT_BANTER
} from '../outpost-npc-dialogue';
import { characterModelLoader } from './CharacterModelLoader';
import type { OutpostWorldBuilder } from './OutpostWorldBuilder';

interface OutpostNpcEntity {
	id: NpcId;
	name: 'Commander Maya' | 'Geologist Leo';
	role: string;
	root: THREE.Group;
	mixer: THREE.AnimationMixer | null;
	baseY: number;
	baseYaw: number;
	phaseOffset: number;
}

const DEFAULT_STAGING_POS = new THREE.Vector3(11.5, 0, -24.0);

export class OutpostNpcSystem {
	private npcs: OutpostNpcEntity[] = [];
	private activeTurn: NpcDialogueTurn | null = null;
	private nearbyNpc: OutpostNpcEntity | null = null;
	private ambientTimer = 0;
	private ambientIndex = 0;

	public get isTalking(): boolean {
		return this.activeTurn !== null;
	}

	async init(scene: THREE.Scene, world: OutpostWorldBuilder): Promise<void> {
		this.npcs = [];
		this.activeTurn = null;

		characterModelLoader.registerOutpostScene(world.outpostRoot);

		// Anchor right in front of the player's Room 07 spawn (11.5, -24.0)
		const anchor = this.resolveRoom07Anchor(world);

		const specs: Array<{
			id: NpcId;
			name: 'Commander Maya' | 'Geologist Leo';
			role: string;
			offsetX: number;
			offsetZ: number;
			accentHex: number;
			phaseOffset: number;
		}> = [
			{
				id: 'maya',
				name: 'Commander Maya',
				role: 'Mission Commander • Room 07',
				offsetX: -1.45,
				offsetZ: -3.2,
				accentHex: 0xdc2626, // Command Crimson
				phaseOffset: 0.0
			},
			{
				id: 'leo',
				name: 'Geologist Leo',
				role: 'Planetary Geologist • Room 07',
				offsetX: 1.45,
				offsetZ: -3.3,
				accentHex: 0x0284c7, // Science Cyan
				phaseOffset: 1.7
			}
		];

		for (const spec of specs) {
			const meshGroup = await characterModelLoader.createEvaSuitInstance({
				accentHex: spec.accentHex,
				hideVisorForFirstPerson: false
			});

			const x = anchor.x + spec.offsetX;
			const z = anchor.z + spec.offsetZ;
			const hit = world.sampleSurfaceAt(x, z);

			meshGroup.name = `EVA_Astronaut_NPC_${spec.id}`;
			meshGroup.position.set(x, hit.y, z);

			// Face toward the Room 07 staging area / player spawn (+Z)
			const baseYaw = Math.atan2(anchor.x - x, anchor.z - z);
			meshGroup.rotation.y = baseYaw;
			scene.add(meshGroup);

			this.npcs.push({
				id: spec.id,
				name: spec.name,
				role: spec.role,
				root: meshGroup,
				mixer: (meshGroup.userData.mixer as THREE.AnimationMixer | undefined) ?? null,
				baseY: hit.y,
				baseYaw,
				phaseOffset: spec.phaseOffset
			});
		}
	}

	private resolveRoom07Anchor(world: OutpostWorldBuilder): THREE.Vector3 {
		let foundAnchor: THREE.Vector3 | null = null;
		world.outpostRoot?.traverse((obj) => {
			if (foundAnchor) return;
			// Only match actual room/bay names, never unrelated props ending in _07
			if (/^(room|bay|module|airlock)[_\s-]*0?7\b/i.test(obj.name)) {
				const pos = new THREE.Vector3();
				obj.getWorldPosition(pos);
				if (pos.distanceTo(DEFAULT_STAGING_POS) <= 16.0) {
					foundAnchor = pos;
				}
			}
		});
		return foundAnchor ?? DEFAULT_STAGING_POS.clone();
	}

	public tryStartOrAdvanceDialogue(phase: OutpostPhase, dustAlertActive: boolean): boolean {
		if (this.activeTurn) {
			const firstChoice = this.activeTurn.choices[0];
			if (firstChoice) {
				this.selectChoice(firstChoice.id);
			} else {
				this.closeDialogue();
			}
			return true;
		}

		if (!this.nearbyNpc) return false;
		const startNode = getInitialDialogueNodeId(this.nearbyNpc.id, phase, dustAlertActive);
		this.activeTurn = buildDialogueTurn(this.nearbyNpc.id, startNode);
		return this.activeTurn !== null;
	}

	public selectChoice(choiceId: string): boolean {
		if (!this.activeTurn) return false;
		const choice = this.activeTurn.choices.find((c) => c.id === choiceId);
		if (!choice) return false;

		if (!choice.nextNodeId) {
			this.closeDialogue();
			return true;
		}

		this.activeTurn = buildDialogueTurn(this.activeTurn.npcId, choice.nextNodeId);
		return true;
	}

	public selectChoiceByIndex(index: number): boolean {
		if (!this.activeTurn) return false;
		const choice = this.activeTurn.choices[index];
		if (!choice) return false;
		return this.selectChoice(choice.id);
	}

	public closeDialogue() {
		this.activeTurn = null;
	}

	public resolvePlayerCollisions(playerPos: THREE.Vector3, playerRadius = 0.44) {
		const minDist = playerRadius + 0.45;
		for (const npc of this.npcs) {
			const dx = playerPos.x - npc.root.position.x;
			const dz = playerPos.z - npc.root.position.z;
			const distSq = dx * dx + dz * dz;
			if (distSq > 0.0001 && distSq < minDist * minDist) {
				const dist = Math.sqrt(distSq);
				const push = (minDist - dist) / dist;
				playerPos.x += dx * push;
				playerPos.z += dz * push;
			}
		}
	}

	public update(
		dt: number,
		playerPos: THREE.Vector3,
		isSeatedInRover: boolean,
		phase: OutpostPhase,
		dustAlertActive: boolean
	): NpcCommsState {
		this.ambientTimer += dt;
		if (this.ambientTimer >= 6.5) {
			this.ambientTimer = 0;
			this.ambientIndex = (this.ambientIndex + 1) % ROOM_07_AMBIENT_BANTER.length;
		}

		let closest: OutpostNpcEntity | null = null;
		let bestTalkDist = LunarOutpostConfig.physics.npcTalkRadius;
		let minAnyDist = Infinity;

		for (const npc of this.npcs) {
			npc.mixer?.update(dt);

			const dist = npc.root.position.distanceTo(playerPos);
			if (dist < minAnyDist) minAnyDist = dist;

			if (!isSeatedInRover && dist < bestTalkDist) {
				bestTalkDist = dist;
				closest = npc;
			}

			const t = performance.now() * 0.0018 + npc.phaseOffset;
			npc.root.position.y = npc.baseY + Math.sin(t) * 0.012;

			const isEngaged =
				this.activeTurn?.npcId === npc.id || (!isSeatedInRover && dist < bestTalkDist);

			const targetYaw = isEngaged
				? Math.atan2(playerPos.x - npc.root.position.x, playerPos.z - npc.root.position.z)
				: npc.baseYaw + Math.sin(t * 0.55) * 0.22;

			npc.root.rotation.y = this.lerpAngle(npc.root.rotation.y, targetYaw, Math.min(1, dt * 4.5));
		}

		this.nearbyNpc = closest;

		if (this.activeTurn) {
			const speakerNpc = this.npcs.find((n) => n.id === this.activeTurn?.npcId);
			if (speakerNpc && speakerNpc.root.position.distanceTo(playerPos) > 8.5) {
				this.closeDialogue();
			}
		}

		if (this.activeTurn && !buildDialogueTurn(this.activeTurn.npcId, this.activeTurn.nodeId)) {
			const fallbackNode = getInitialDialogueNodeId(this.activeTurn.npcId, phase, dustAlertActive);
			this.activeTurn = buildDialogueTurn(this.activeTurn.npcId, fallbackNode);
		}

		const showAmbient =
			!this.activeTurn && minAnyDist <= LunarOutpostConfig.physics.npcAmbientRadius;
		const ambient = showAmbient ? ROOM_07_AMBIENT_BANTER[this.ambientIndex] : null;

		return {
			activeTurn: this.activeTurn,
			nearbyNpcName: closest ? closest.name : null,
			talkPrompt: !this.activeTurn && closest ? `Press [T] to talk with ${closest.name}` : null,
			ambientSpeaker: ambient ? ambient.speaker : null,
			ambientLine: ambient ? ambient.line : null
		};
	}

	private lerpAngle(a: number, b: number, t: number): number {
		const diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
		return a + diff * t;
	}
}
