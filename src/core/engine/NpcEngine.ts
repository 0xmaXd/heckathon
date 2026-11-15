import * as THREE from 'three';
import type { SurfaceProvider } from './CollisionWorld';
import { characterModelLoader, type CharacterRigRefs } from '../player/CharacterModelLoader';

export type NpcActivity = 'station_work' | 'walking' | 'beckoning' | 'talking' | 'watching_target';

export interface NpcDialogueChoice {
	id: string;
	label: string;
	nextNodeId: string | null;
}

export interface NpcDialogueInterjection<TSpeaker extends string = string> {
	speaker: TSpeaker;
	text: string;
}

export interface NpcDialogueNode<TSpeaker extends string = string> {
	speaker: TSpeaker;
	text: string;
	companionInterjection?: NpcDialogueInterjection<TSpeaker>;
	choices: NpcDialogueChoice[];
}

export interface NpcDialogueTurn<TId extends string = string, TSpeaker extends string = string> {
	npcId: TId;
	nodeId: string;
	speaker: TSpeaker;
	text: string;
	companionInterjection?: NpcDialogueInterjection<TSpeaker>;
	choices: NpcDialogueChoice[];
}

export interface NpcAmbientLine<TSpeaker extends string = string> {
	speaker: TSpeaker;
	line: string;
}

export interface NpcSpawnSpec<TId extends string = string, TName extends string = string> {
	id: TId;
	name: TName;
	role: string;
	position: THREE.Vector3;
	baseYaw: number;
	modelUrl?: string;
	accentHex?: number;
	phaseOffset?: number;
}

export interface NpcFrameDirective {
	stationPos?: THREE.Vector3;
	lookAtPos?: THREE.Vector3;
	pointAtPos?: THREE.Vector3 | null;
	forceActivity?: NpcActivity;
}

export interface NpcEngineConfig {
	talkRadius: number;
	ambientRadius: number;
	maxConversationRadius: number;
	beckonRadius: number;
	walkSpeed: number;
	ambientCycleSec: number;
}

export const DEFAULT_NPC_ENGINE_CONFIG: NpcEngineConfig = {
	talkRadius: 3.6,
	ambientRadius: 9.0,
	maxConversationRadius: 8.5,
	beckonRadius: 11.5,
	walkSpeed: 1.85,
	ambientCycleSec: 6.5
};

export interface NpcEngineSnapshot<
	TId extends string = string,
	TName extends string = string,
	TSpeaker extends string = string
> {
	activeTurn: NpcDialogueTurn<TId, TSpeaker> | null;
	nearbyNpcId: TId | null;
	nearbyNpcName: TName | null;
	talkPrompt: string | null;
	ambientSpeaker: TSpeaker | null;
	ambientLine: string | null;
}

interface ManagedNpcEntity<TId extends string, TName extends string> {
	id: TId;
	name: TName;
	role: string;
	root: THREE.Group;
	rig: CharacterRigRefs | null;
	homePos: THREE.Vector3;
	targetPos: THREE.Vector3;
	baseYaw: number;
	phaseOffset: number;
	walkCycle: number;
	activity: NpcActivity;
	gestureSeed: number;
}

export class NpcEngine<
	TId extends string = string,
	TName extends string = string,
	TSpeaker extends string = string
> {
	public readonly config: NpcEngineConfig;

	private entities: ManagedNpcEntity<TId, TName>[] = [];
	private surface: SurfaceProvider | null = null;
	private dialogueResolver:
		((npcId: TId, nodeId: string) => NpcDialogueNode<TSpeaker> | null) | null = null;
	private ambientBanter: readonly NpcAmbientLine<TSpeaker>[] = [];

	private activeTurn: NpcDialogueTurn<TId, TSpeaker> | null = null;
	private nearbyEntity: ManagedNpcEntity<TId, TName> | null = null;
	private ambientTimer = 0;
	private ambientIndex = 0;

	constructor(config: Partial<NpcEngineConfig> = {}) {
		this.config = { ...DEFAULT_NPC_ENGINE_CONFIG, ...config };
	}

	public get isTalking(): boolean {
		return this.activeTurn !== null;
	}

	public get currentTurn(): NpcDialogueTurn<TId, TSpeaker> | null {
		return this.activeTurn;
	}

	public get nearbyNpcId(): TId | null {
		return this.nearbyEntity?.id ?? null;
	}

	public setDialogueSource(
		resolver: (npcId: TId, nodeId: string) => NpcDialogueNode<TSpeaker> | null,
		ambientBanter: readonly NpcAmbientLine<TSpeaker>[] = []
	): void {
		this.dialogueResolver = resolver;
		this.ambientBanter = ambientBanter;
		this.ambientIndex = 0;
		this.ambientTimer = 0;
	}

	public async init(
		scene: THREE.Scene,
		surface: SurfaceProvider,
		specs: readonly NpcSpawnSpec<TId, TName>[]
	): Promise<void> {
		this.dispose(scene);
		this.surface = surface;

		for (const spec of specs) {
			const meshGroup = await characterModelLoader.createCharacterInstance({
				modelUrl: spec.modelUrl,
				accentHex: spec.accentHex,
				hideHeadForFirstPerson: false
			});

			const hit = surface.sampleSurfaceAt(spec.position.x, spec.position.z);
			const homePos = new THREE.Vector3(spec.position.x, hit.y, spec.position.z);

			meshGroup.name = `EVA_Astronaut_NPC_${spec.id}`;
			meshGroup.position.copy(homePos);
			meshGroup.rotation.y = spec.baseYaw;
			scene.add(meshGroup);

			this.entities.push({
				id: spec.id,
				name: spec.name,
				role: spec.role,
				root: meshGroup,
				rig: (meshGroup.userData?.rig as CharacterRigRefs) ?? null,
				homePos: homePos.clone(),
				targetPos: homePos.clone(),
				baseYaw: spec.baseYaw,
				phaseOffset: spec.phaseOffset ?? 0,
				walkCycle: 0,
				activity: 'station_work',
				gestureSeed: Math.random() * 10
			});
		}
	}

	public reset(): void {
		this.activeTurn = null;
		this.nearbyEntity = null;
		this.ambientTimer = 0;
		this.ambientIndex = 0;

		for (const npc of this.entities) {
			npc.root.position.copy(npc.homePos);
			npc.targetPos.copy(npc.homePos);
			npc.root.rotation.y = npc.baseYaw;
			npc.walkCycle = 0;
			npc.activity = 'station_work';
		}
	}

	public dispose(scene?: THREE.Scene): void {
		for (const npc of this.entities) {
			if (scene) {
				scene.remove(npc.root);
			} else {
				npc.root.parent?.remove(npc.root);
			}
		}
		this.entities = [];
		this.activeTurn = null;
		this.nearbyEntity = null;
		this.ambientTimer = 0;
		this.ambientIndex = 0;
	}

	public startDialogue(npcId: TId, nodeId: string): boolean {
		const turn = this.buildTurn(npcId, nodeId);
		if (!turn) return false;

		this.activeTurn = turn;
		const speaker = this.entities.find((n) => n.id === npcId);
		if (speaker) {
			speaker.gestureSeed = performance.now() * 0.001;
		}
		return true;
	}

	public tryStartOrAdvanceDialogue(resolveInitialNodeId: (npcId: TId) => string): {
		startedOrAdvanced: boolean;
		startedNpcId: TId | null;
	} {
		if (this.activeTurn) {
			const firstChoice = this.activeTurn.choices[0];
			if (firstChoice) {
				this.selectChoice(firstChoice.id);
			} else {
				this.closeDialogue();
			}
			return { startedOrAdvanced: true, startedNpcId: null };
		}

		if (!this.nearbyEntity) {
			return { startedOrAdvanced: false, startedNpcId: null };
		}

		const npcId = this.nearbyEntity.id;
		const nodeId = resolveInitialNodeId(npcId);
		const started = this.startDialogue(npcId, nodeId);
		return {
			startedOrAdvanced: started,
			startedNpcId: started ? npcId : null
		};
	}

	public selectChoice(choiceId: string): {
		handled: boolean;
		selectedChoice: NpcDialogueChoice | null;
		speakerNpcId: TId | null;
	} {
		if (!this.activeTurn) {
			return { handled: false, selectedChoice: null, speakerNpcId: null };
		}

		const speakerNpcId = this.activeTurn.npcId;
		const choice = this.activeTurn.choices.find((c) => c.id === choiceId) ?? null;
		if (!choice) {
			return { handled: false, selectedChoice: null, speakerNpcId };
		}

		const speaker = this.entities.find((n) => n.id === speakerNpcId);
		if (speaker) {
			speaker.gestureSeed = performance.now() * 0.001;
		}

		if (!choice.nextNodeId) {
			this.closeDialogue();
			return { handled: true, selectedChoice: choice, speakerNpcId };
		}

		this.activeTurn = this.buildTurn(speakerNpcId, choice.nextNodeId);
		return { handled: true, selectedChoice: choice, speakerNpcId };
	}

	public selectChoiceByIndex(index: number): {
		handled: boolean;
		selectedChoice: NpcDialogueChoice | null;
		speakerNpcId: TId | null;
	} {
		if (!this.activeTurn) {
			return { handled: false, selectedChoice: null, speakerNpcId: null };
		}
		const choice = this.activeTurn.choices[index];
		if (!choice) {
			return { handled: false, selectedChoice: null, speakerNpcId: this.activeTurn.npcId };
		}
		return this.selectChoice(choice.id);
	}

	public closeDialogue(): void {
		this.activeTurn = null;
	}

	public resolvePlayerCollisions(playerPos: THREE.Vector3, playerRadius = 0.44): void {
		const minDist = playerRadius + 0.45;
		for (const npc of this.entities) {
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

	public getNpcPosition(npcId: TId, out = new THREE.Vector3()): THREE.Vector3 | null {
		const found = this.entities.find((n) => n.id === npcId);
		if (!found) return null;
		return out.copy(found.root.position);
	}

	public update(
		dt: number,
		playerPos: THREE.Vector3,
		suppressInteraction: boolean,
		getDirective?: (npcId: TId, homePos: THREE.Vector3, baseYaw: number) => NpcFrameDirective,
		fallbackNodeResolver?: (npcId: TId) => string
	): NpcEngineSnapshot<TId, TName, TSpeaker> {
		if (this.ambientBanter.length > 0) {
			this.ambientTimer += dt;
			if (this.ambientTimer >= this.config.ambientCycleSec) {
				this.ambientTimer = 0;
				this.ambientIndex = (this.ambientIndex + 1) % this.ambientBanter.length;
			}
		}

		let closest: ManagedNpcEntity<TId, TName> | null = null;
		let bestTalkDist = this.config.talkRadius;
		let minAnyDist = Infinity;
		const nowSec = performance.now() * 0.001;

		for (const npc of this.entities) {
			const directive = getDirective?.(npc.id, npc.homePos, npc.baseYaw);
			const stationPos = directive?.stationPos ?? npc.homePos;
			const lookAtPos =
				directive?.lookAtPos ??
				new THREE.Vector3(
					npc.homePos.x + Math.sin(npc.baseYaw) * 4,
					npc.homePos.y,
					npc.homePos.z + Math.cos(npc.baseYaw) * 4
				);

			npc.targetPos.copy(stationPos);

			const distToPlayer = npc.root.position.distanceTo(playerPos);
			if (distToPlayer < minAnyDist) minAnyDist = distToPlayer;

			if (!suppressInteraction && distToPlayer < bestTalkDist) {
				bestTalkDist = distToPlayer;
				closest = npc;
			}

			const isSpeakingWithThisNpc = this.activeTurn?.npcId === npc.id;
			const isPlayerNear = !suppressInteraction && distToPlayer < this.config.talkRadius;
			const isPlayerApproaching =
				!suppressInteraction &&
				!isSpeakingWithThisNpc &&
				distToPlayer >= this.config.talkRadius &&
				distToPlayer < this.config.beckonRadius;

			const dxStation = npc.targetPos.x - npc.root.position.x;
			const dzStation = npc.targetPos.z - npc.root.position.z;
			const distToStation = Math.hypot(dxStation, dzStation);

			let targetYaw = npc.baseYaw;

			if (directive?.forceActivity === 'watching_target') {
				npc.activity = 'watching_target';
				targetYaw = Math.atan2(
					lookAtPos.x - npc.root.position.x,
					lookAtPos.z - npc.root.position.z
				);
			} else if (isSpeakingWithThisNpc) {
				npc.activity = 'talking';
				targetYaw = Math.atan2(
					playerPos.x - npc.root.position.x,
					playerPos.z - npc.root.position.z
				);
			} else if (!isSpeakingWithThisNpc && !isPlayerNear && distToStation > 0.35) {
				npc.activity = 'walking';
				const step = Math.min(distToStation, this.config.walkSpeed * dt);
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
					Math.atan2(lookAtPos.x - npc.root.position.x, lookAtPos.z - npc.root.position.z) +
					Math.sin((nowSec + npc.phaseOffset) * 0.6) * 0.14;
			}

			const groundY = this.surface
				? this.surface.sampleSurfaceAt(npc.root.position.x, npc.root.position.z).y
				: npc.homePos.y;
			const verticalBob =
				npc.activity === 'walking'
					? Math.abs(Math.sin(npc.walkCycle)) * 0.032
					: Math.sin((nowSec + npc.phaseOffset) * 1.8) * 0.01;
			npc.root.position.y = groundY + verticalBob;
			npc.root.rotation.y = this.lerpAngle(npc.root.rotation.y, targetYaw, Math.min(1, dt * 5.0));

			this.animateNpcRig(npc, nowSec, directive?.pointAtPos ?? null);
		}

		this.nearbyEntity = closest;

		if (this.activeTurn) {
			const speakerNpc = this.entities.find((n) => n.id === this.activeTurn?.npcId);
			if (
				speakerNpc &&
				speakerNpc.root.position.distanceTo(playerPos) > this.config.maxConversationRadius
			) {
				this.closeDialogue();
			}
		}

		if (
			this.activeTurn &&
			!this.buildTurn(this.activeTurn.npcId, this.activeTurn.nodeId) &&
			fallbackNodeResolver
		) {
			const fallbackNode = fallbackNodeResolver(this.activeTurn.npcId);
			this.activeTurn = this.buildTurn(this.activeTurn.npcId, fallbackNode);
		}

		const showAmbient =
			!this.activeTurn && this.ambientBanter.length > 0 && minAnyDist <= this.config.ambientRadius;
		const ambient = showAmbient ? this.ambientBanter[this.ambientIndex] : null;

		return {
			activeTurn: this.activeTurn,
			nearbyNpcId: closest ? closest.id : null,
			nearbyNpcName: closest ? closest.name : null,
			talkPrompt: !this.activeTurn && closest ? `Press [T] to talk with ${closest.name}` : null,
			ambientSpeaker: ambient ? ambient.speaker : null,
			ambientLine: ambient ? ambient.line : null
		};
	}

	private buildTurn(npcId: TId, nodeId: string): NpcDialogueTurn<TId, TSpeaker> | null {
		const node = this.dialogueResolver?.(npcId, nodeId) ?? null;
		if (!node) return null;

		return {
			npcId,
			nodeId,
			speaker: node.speaker,
			text: node.text,
			companionInterjection: node.companionInterjection,
			choices: node.choices
		};
	}

	private animateNpcRig(
		npc: ManagedNpcEntity<TId, TName>,
		nowSec: number,
		pointAtPos: THREE.Vector3 | null
	): void {
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
			if (head) {
				head.rotation.x = rest(head).x + 0.14 + Math.sin(t * 1.4) * 0.06;
				head.rotation.y = rest(head).y + Math.sin(t * 0.85) * 0.22;
			}
			if (spine) spine.rotation.x = rest(spine).x + 0.05;
			if (leftUpperArm) {
				leftUpperArm.rotation.x = rest(leftUpperArm).x - 0.48;
				leftUpperArm.rotation.z = rest(leftUpperArm).z + 0.12;
			}
			if (leftForearm) leftForearm.rotation.x = rest(leftForearm).x - 0.78;
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
			if (leftForearm) leftForearm.rotation.x = rest(leftForearm).x - 0.22;
			return;
		}

		if (npc.activity === 'talking') {
			const elapsedTalk = nowSec - npc.gestureSeed;
			const isPointingPhase = pointAtPos !== null && Math.sin(elapsedTalk * 0.9) > 0.45;

			if (head) {
				head.rotation.x = rest(head).x + Math.sin(t * 3.6) * 0.09;
				head.rotation.y = rest(head).y + Math.cos(t * 1.9) * 0.08;
			}
			if (spine) spine.rotation.x = rest(spine).x + 0.04;

			if (isPointingPhase && pointAtPos) {
				const objWorldAngle = Math.atan2(
					pointAtPos.x - npc.root.position.x,
					pointAtPos.z - npc.root.position.z
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

		if (npc.activity === 'watching_target') {
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
