import * as THREE from 'three';
import { LunarOutpostConfig } from '../lunar-outpost.config';
import type { NpcCommsState, NpcDialogueTurn, NpcId, OutpostPhase } from '../lunar-outpost.types';
import {
	buildDialogueTurn,
	getInitialDialogueNodeId,
	ROOM_07_AMBIENT_BANTER
} from '../outpost-npc-dialogue';
import { characterModelLoader, type EvaSuitRigRefs } from './CharacterModelLoader';
import type { OutpostWorldBuilder } from './OutpostWorldBuilder';

type NpcBehaviorActivity = 'station_work' | 'walking' | 'beckoning' | 'talking' | 'watching_launch';

interface OutpostNpcEntity {
	id: NpcId;
	name: 'Commander Maya' | 'Geologist Leo';
	role: string;
	root: THREE.Group;
	rig: EvaSuitRigRefs | null;
	homePos: THREE.Vector3;
	targetPos: THREE.Vector3;
	baseYaw: number;
	phaseOffset: number;
	walkCycle: number;
	activity: NpcBehaviorActivity;
	gestureSeed: number;
}

export class OutpostNpcSystem {
	private npcs: OutpostNpcEntity[] = [];
	private world: OutpostWorldBuilder | null = null;
	private activeTurn: NpcDialogueTurn | null = null;
	private nearbyNpc: OutpostNpcEntity | null = null;
	private ambientTimer = 0;
	private ambientIndex = 0;
	private onResupplyAssigned?: () => void;

	public get isTalking(): boolean {
		return this.activeTurn !== null;
	}

	async init(
		scene: THREE.Scene,
		world: OutpostWorldBuilder,
		onResupplyAssigned?: () => void
	): Promise<void> {
		this.world = world;
		this.npcs = [];
		this.activeTurn = null;
		this.onResupplyAssigned = onResupplyAssigned;

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
				offsetX: -1.65,
				offsetZ: -3.2,
				accentHex: 0xdc2626,
				phaseOffset: 0.0
			},
			{
				id: 'leo',
				name: 'Geologist Leo',
				role: 'Planetary Geologist • Room 07',
				offsetX: 1.65,
				offsetZ: -3.35,
				accentHex: 0x0284c7,
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
			const homePos = new THREE.Vector3(x, hit.y, z);

			meshGroup.name = `EVA_Astronaut_NPC_${spec.id}`;
			meshGroup.position.copy(homePos);

			const baseYaw = Math.atan2(anchor.x - x, anchor.z - 1.4 - z);
			meshGroup.rotation.y = baseYaw;
			scene.add(meshGroup);

			this.npcs.push({
				id: spec.id,
				name: spec.name,
				role: spec.role,
				root: meshGroup,
				rig: (meshGroup.userData?.rig as EvaSuitRigRefs) ?? null,
				homePos: homePos.clone(),
				targetPos: homePos.clone(),
				baseYaw,
				phaseOffset: spec.phaseOffset,
				walkCycle: 0,
				activity: 'station_work',
				gestureSeed: Math.random() * 10
			});
		}
	}

	private resolveRoom07Anchor(world: OutpostWorldBuilder): THREE.Vector3 {
		let foundAnchor: THREE.Vector3 | null = null;
		world.outpostRoot?.traverse((obj) => {
			if (foundAnchor) return;
			if (/07|room.?07|bay.?07/i.test(obj.name)) {
				const pos = new THREE.Vector3();
				obj.getWorldPosition(pos);
				if (pos.lengthSq() > 0.1) {
					foundAnchor = pos;
				}
			}
		});
		return foundAnchor ?? new THREE.Vector3(11.5, 0, -24.0);
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
		this.nearbyNpc.gestureSeed = performance.now() * 0.001;

		// Commander Maya assigns the 5-station supply box mission upon speaking with her
		if (this.activeTurn && this.nearbyNpc.id === 'maya' && phase === 'briefing') {
			this.onResupplyAssigned?.();
		}

		return this.activeTurn !== null;
	}

	public selectChoice(choiceId: string): boolean {
		if (!this.activeTurn) return false;
		const choice = this.activeTurn.choices.find((c) => c.id === choiceId);
		if (!choice) return false;

		if (this.activeTurn.npcId === 'maya') {
			this.onResupplyAssigned?.();
		}

		const speaker = this.npcs.find((n) => n.id === this.activeTurn?.npcId);
		if (speaker) {
			speaker.gestureSeed = performance.now() * 0.001;
		}

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

	/**
	 * Computes contextual outpost duty stations for Commander Maya and Geologist Leo
	 * so they actively work around the base as mission phases evolve.
	 */
	private resolveDutyStation(
		npc: OutpostNpcEntity,
		phase: OutpostPhase,
		dustAlertActive: boolean
	): { pos: THREE.Vector3; lookAt: THREE.Vector3 } {
		if (!this.world) {
			return {
				pos: npc.homePos,
				lookAt: new THREE.Vector3(0, npc.homePos.y, 0)
			};
		}

		if (npc.id === 'leo') {
			if (dustAlertActive && this.world.solarDustLayers.length > 0) {
				const dustTarget =
					this.world.solarDustLayers.find((d) => d.visible) ?? this.world.solarDustLayers[0];
				const wp = new THREE.Vector3();
				dustTarget.getWorldPosition(wp);
				return {
					pos: new THREE.Vector3(wp.x - 2.4, 0, wp.z + 2.2),
					lookAt: wp
				};
			}

			if (phase === 'exploration') {
				const ws = this.world.workstationPos;
				return {
					pos: new THREE.Vector3(ws.x - 1.55, 0, ws.z + 1.35),
					lookAt: ws
				};
			}

			if (phase === 'finale_ready' || phase === 'launched') {
				const pad = this.world.launchPadPos;
				return {
					pos: new THREE.Vector3(pad.x - 9.5, 0, pad.z + 7.5),
					lookAt: pad
				};
			}
		}

		if (npc.id === 'maya') {
			if (phase === 'finale_ready' || phase === 'launched') {
				const pad = this.world.launchPadPos;
				return {
					pos: new THREE.Vector3(pad.x - 8.2, 0, pad.z + 9.2),
					lookAt: pad
				};
			}

			if (phase === 'resupply') {
				const pod = this.world.resupplyDropPos;
				return {
					pos: new THREE.Vector3(pod.x - 3.2, 0, pod.z - 2.8),
					lookAt: pod
				};
			}
		}

		return {
			pos: npc.homePos,
			lookAt: new THREE.Vector3(
				npc.homePos.x + Math.sin(npc.baseYaw) * 4,
				npc.homePos.y,
				npc.homePos.z + Math.cos(npc.baseYaw) * 4
			)
		};
	}

	private resolveActiveObjectivePoint(
		phase: OutpostPhase,
		dustAlertActive: boolean
	): THREE.Vector3 | null {
		if (!this.world) return null;

		if (dustAlertActive) {
			const dusty = this.world.solarDustLayers.find((d) => d.visible);
			if (dusty) {
				const p = new THREE.Vector3();
				dusty.getWorldPosition(p);
				return p;
			}
		}

		if (phase === 'briefing' || phase === 'resupply') {
			const nextZone = this.world.dropOffZones.find((z) => !z.delivered);
			if (nextZone) return nextZone.position;
		}

		if (phase === 'exploration') {
			for (const node of this.world.sampleNodes.values()) {
				if (node.visible) {
					const p = new THREE.Vector3();
					node.getWorldPosition(p);
					return p;
				}
			}
			return this.world.workstationPos;
		}

		if (phase === 'finale_ready' || phase === 'launched') {
			return this.world.launchPadPos;
		}

		return null;
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
		const nowSec = performance.now() * 0.001;
		const objectiveTarget = this.resolveActiveObjectivePoint(phase, dustAlertActive);

		for (const npc of this.npcs) {
			const duty = this.resolveDutyStation(npc, phase, dustAlertActive);
			npc.targetPos.copy(duty.pos);

			const distToPlayer = npc.root.position.distanceTo(playerPos);
			if (distToPlayer < minAnyDist) minAnyDist = distToPlayer;

			if (!isSeatedInRover && distToPlayer < bestTalkDist) {
				bestTalkDist = distToPlayer;
				closest = npc;
			}

			const isSpeakingWithThisNpc = this.activeTurn?.npcId === npc.id;
			const isPlayerNear = !isSeatedInRover && distToPlayer < bestTalkDist;
			const isPlayerApproaching =
				!isSeatedInRover &&
				!isSpeakingWithThisNpc &&
				distToPlayer >= bestTalkDist &&
				distToPlayer < 11.5;

			// Move toward duty station unless engaged in conversation with the player
			const dxStation = npc.targetPos.x - npc.root.position.x;
			const dzStation = npc.targetPos.z - npc.root.position.z;
			const distToStation = Math.hypot(dxStation, dzStation);

			let targetYaw = npc.baseYaw;

			if (phase === 'launched') {
				npc.activity = 'watching_launch';
				targetYaw = Math.atan2(
					duty.lookAt.x - npc.root.position.x,
					duty.lookAt.z - npc.root.position.z
				);
			} else if (isSpeakingWithThisNpc) {
				npc.activity = 'talking';
				targetYaw = Math.atan2(
					playerPos.x - npc.root.position.x,
					playerPos.z - npc.root.position.z
				);
			} else if (!isSpeakingWithThisNpc && !isPlayerNear && distToStation > 0.35) {
				npc.activity = 'walking';
				const step = Math.min(distToStation, 1.85 * dt);
				npc.root.position.x += (dxStation / distToStation) * step;
				npc.root.position.z += (dzStation / distToStation) * step;
				npc.walkCycle += dt * 5.2;
				targetYaw = Math.atan2(dxStation, dzStation);
			} else if (isPlayerNear || isPlayerApproaching) {
				npc.activity = 'beckoning';
				targetYaw = Math.atan2(
					playerPos.x - npc.root.position.x,
					playerPos.z - npc.root.position.z
				);
			} else {
				npc.activity = 'station_work';
				targetYaw =
					Math.atan2(duty.lookAt.x - npc.root.position.x, duty.lookAt.z - npc.root.position.z) +
					Math.sin((nowSec + npc.phaseOffset) * 0.6) * 0.14;
			}

			// Ground NPC onto terrain/pad surface cleanly
			const groundY = this.world
				? this.world.sampleSurfaceAt(npc.root.position.x, npc.root.position.z).y
				: npc.homePos.y;
			const verticalBob =
				npc.activity === 'walking'
					? Math.abs(Math.sin(npc.walkCycle)) * 0.032
					: Math.sin((nowSec + npc.phaseOffset) * 1.8) * 0.01;
			npc.root.position.y = groundY + verticalBob;

			npc.root.rotation.y = this.lerpAngle(npc.root.rotation.y, targetYaw, Math.min(1, dt * 5.0));

			this.animateNpcRig(npc, nowSec, objectiveTarget);
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

	/**
	 * Drives contextual skeletal / articulated animations on Commander Maya and Geologist Leo
	 * (console work, beckoning wave, conversation gestures & pointing, walking stride, launch salute).
	 */
	private animateNpcRig(
		npc: OutpostNpcEntity,
		nowSec: number,
		objectiveTarget: THREE.Vector3 | null
	) {
		const rig = npc.rig;
		if (!rig) return;

		const {
			head,
			spine,
			leftUpperArm,
			rightUpperArm,
			leftForearm,
			rightForearm,
			leftThigh,
			rightThigh,
			restRotations
		} = rig;

		const rest = (obj: THREE.Object3D | null) =>
			(obj ? restRotations.get(obj) : undefined) ?? new THREE.Euler();

		const t = nowSec + npc.phaseOffset;

		// Reset legs unless walking
		if (npc.activity === 'walking') {
			const stride = Math.sin(npc.walkCycle) * 0.48;
			if (leftThigh) leftThigh.rotation.x = rest(leftThigh).x + stride;
			if (rightThigh) rightThigh.rotation.x = rest(rightThigh).x - stride;
			if (leftUpperArm) leftUpperArm.rotation.x = rest(leftUpperArm).x - stride * 0.55;
			if (rightUpperArm) rightUpperArm.rotation.x = rest(rightUpperArm).x + stride * 0.55;
			if (leftForearm) leftForearm.rotation.x = rest(leftForearm).x - 0.18;
			if (rightForearm) rightForearm.rotation.x = rest(rightForearm).x - 0.18;
			if (head) {
				head.rotation.x = rest(head).x;
				head.rotation.y = rest(head).y;
			}
			if (spine) spine.rotation.x = rest(spine).x + 0.04;
			return;
		}

		if (leftThigh) leftThigh.rotation.x = rest(leftThigh).x;
		if (rightThigh) rightThigh.rotation.x = rest(rightThigh).x;

		if (npc.activity === 'station_work') {
			// Operating wrist datapad / geology console with subtle head scans
			if (head) {
				head.rotation.x = rest(head).x + 0.14 + Math.sin(t * 1.4) * 0.06;
				head.rotation.y = rest(head).y + Math.sin(t * 0.85) * 0.22;
			}
			if (spine) {
				spine.rotation.x = rest(spine).x + 0.05;
			}
			if (leftUpperArm) {
				leftUpperArm.rotation.x = rest(leftUpperArm).x - 0.48;
				leftUpperArm.rotation.z = rest(leftUpperArm).z + 0.12;
			}
			if (leftForearm) {
				leftForearm.rotation.x = rest(leftForearm).x - 0.78;
			}
			if (rightUpperArm) {
				rightUpperArm.rotation.x = rest(rightUpperArm).x - 0.42 + Math.sin(t * 4.5) * 0.05;
				rightUpperArm.rotation.z = rest(rightUpperArm).z - 0.14;
			}
			if (rightForearm) {
				rightForearm.rotation.x = rest(rightForearm).x - 0.72 + Math.cos(t * 5.2) * 0.08;
			}
			return;
		}

		if (npc.activity === 'beckoning') {
			// Friendly wave to catch the astronaut's attention
			const wave = Math.sin(t * 5.5);
			if (head) {
				head.rotation.x = rest(head).x - 0.04 + Math.sin(t * 2.2) * 0.04;
				head.rotation.y = rest(head).y;
			}
			if (spine) spine.rotation.x = rest(spine).x;
			if (rightUpperArm) {
				rightUpperArm.rotation.x = rest(rightUpperArm).x - 1.35;
				rightUpperArm.rotation.z = rest(rightUpperArm).z - 0.35 + wave * 0.18;
			}
			if (rightForearm) {
				rightForearm.rotation.x = rest(rightForearm).x - 0.55 + wave * 0.24;
			}
			if (leftUpperArm) {
				leftUpperArm.rotation.x = rest(leftUpperArm).x - 0.12;
				leftUpperArm.rotation.z = rest(leftUpperArm).z;
			}
			if (leftForearm) {
				leftForearm.rotation.x = rest(leftForearm).x - 0.22;
			}
			return;
		}

		if (npc.activity === 'talking') {
			const elapsedTalk = nowSec - npc.gestureSeed;
			const isPointingPhase = objectiveTarget !== null && Math.sin(elapsedTalk * 0.9) > 0.45;

			if (head) {
				head.rotation.x = rest(head).x + Math.sin(t * 3.6) * 0.09;
				head.rotation.y = rest(head).y + Math.cos(t * 1.9) * 0.08;
			}
			if (spine) {
				spine.rotation.x = rest(spine).x + 0.04;
			}

			if (isPointingPhase && objectiveTarget) {
				// Point toward the active mission waypoint while explaining the objective
				const objWorldAngle = Math.atan2(
					objectiveTarget.x - npc.root.position.x,
					objectiveTarget.z - npc.root.position.z
				);
				const relAngle =
					((objWorldAngle - npc.root.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
				const useRightArm = relAngle <= 0.3;

				if (useRightArm && rightUpperArm) {
					rightUpperArm.rotation.x = rest(rightUpperArm).x - 1.25;
					rightUpperArm.rotation.z =
						rest(rightUpperArm).z + THREE.MathUtils.clamp(relAngle * 0.4, -0.5, 0.35);
					if (rightForearm) rightForearm.rotation.x = rest(rightForearm).x - 0.12;
				} else if (leftUpperArm) {
					leftUpperArm.rotation.x = rest(leftUpperArm).x - 1.25;
					leftUpperArm.rotation.z =
						rest(leftUpperArm).z + THREE.MathUtils.clamp(relAngle * 0.4, -0.35, 0.5);
					if (leftForearm) leftForearm.rotation.x = rest(leftForearm).x - 0.12;
				}
			} else {
				// Expressive conversational hand gestures
				if (rightUpperArm) {
					rightUpperArm.rotation.x = rest(rightUpperArm).x - 0.55 + Math.sin(t * 3.2) * 0.22;
					rightUpperArm.rotation.z = rest(rightUpperArm).z - 0.12;
				}
				if (rightForearm) {
					rightForearm.rotation.x = rest(rightForearm).x - 0.65 + Math.cos(t * 3.8) * 0.25;
				}
				if (leftUpperArm) {
					leftUpperArm.rotation.x = rest(leftUpperArm).x - 0.42 + Math.cos(t * 2.7) * 0.18;
					leftUpperArm.rotation.z = rest(leftUpperArm).z + 0.12;
				}
				if (leftForearm) {
					leftForearm.rotation.x = rest(leftForearm).x - 0.58 + Math.sin(t * 3.1) * 0.2;
				}
			}
			return;
		}

		if (npc.activity === 'watching_launch') {
			// Track ascending lander skyward and salute
			const upwardPitch = Math.min(0.68, 0.2 + (nowSec % 8) * 0.06);
			if (head) {
				head.rotation.x = rest(head).x - upwardPitch;
				head.rotation.y = rest(head).y;
			}
			if (rightUpperArm) {
				rightUpperArm.rotation.x = rest(rightUpperArm).x - 1.55;
				rightUpperArm.rotation.z = rest(rightUpperArm).z - 0.25;
			}
			if (rightForearm) {
				rightForearm.rotation.x = rest(rightForearm).x - 1.35;
			}
		}
	}

	private lerpAngle(a: number, b: number, t: number): number {
		const diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
		return a + diff * t;
	}
}
