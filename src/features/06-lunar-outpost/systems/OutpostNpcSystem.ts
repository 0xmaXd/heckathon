import * as THREE from 'three';
import type { SurfaceProvider } from '../../../core/engine/CollisionWorld';
import { NpcEngine, type NpcFrameDirective } from '../../../core/engine/NpcEngine';
import { LunarOutpostConfig } from '../lunar-outpost.config';
import type { NpcCommsState, NpcId, OutpostPhase } from '../lunar-outpost.types';
import {
	buildDialogueTurn,
	getInitialDialogueNodeId,
	ROOM_07_AMBIENT_BANTER
} from '../outpost-npc-dialogue';

export interface NpcWorldEnvironment extends SurfaceProvider {
	readonly outpostRoot: THREE.Object3D | null;
	readonly solarDustLayers: THREE.Object3D[];
	readonly workstationPos: THREE.Vector3;
	readonly launchPadPos: THREE.Vector3;
	readonly resupplyDropPos: THREE.Vector3;
	readonly dropOffZones: ReadonlyArray<{ delivered: boolean; position: THREE.Vector3 }>;
	readonly sampleNodes: ReadonlyMap<string, THREE.Object3D>;
}

type OutpostNpcName = 'Commander Maya' | 'Geologist Leo';

export class OutpostNpcSystem {
	private engine = new NpcEngine<NpcId, OutpostNpcName, OutpostNpcName>({
		talkRadius: LunarOutpostConfig.physics.npcTalkRadius,
		ambientRadius: LunarOutpostConfig.physics.npcAmbientRadius,
		maxConversationRadius: 8.5,
		beckonRadius: 11.5,
		walkSpeed: 1.85,
		ambientCycleSec: 6.5
	});

	private env: NpcWorldEnvironment | null = null;
	private onResupplyAssigned?: () => void;

	public get isTalking(): boolean {
		return this.engine.isTalking;
	}

	async init(
		scene: THREE.Scene,
		env: NpcWorldEnvironment,
		onResupplyAssigned?: () => void
	): Promise<void> {
		this.env = env;
		this.onResupplyAssigned = onResupplyAssigned;

		this.engine.setDialogueSource(
			(npcId, nodeId) => buildDialogueTurn(npcId, nodeId),
			ROOM_07_AMBIENT_BANTER
		);

		const anchor = this.resolveRoom07Anchor(env);

		const specs = [
			{
				id: 'maya' as const,
				name: 'Commander Maya' as const,
				role: 'Mission Commander • Room 07',
				offsetX: -1.65,
				offsetZ: -3.2,
				accentHex: 0xdc2626,
				phaseOffset: 0.0
			},
			{
				id: 'leo' as const,
				name: 'Geologist Leo' as const,
				role: 'Planetary Geologist • Room 07',
				offsetX: 1.65,
				offsetZ: -3.35,
				accentHex: 0x0284c7,
				phaseOffset: 1.7
			}
		];

		await this.engine.init(
			scene,
			env,
			specs.map((spec) => {
				const x = anchor.x + spec.offsetX;
				const z = anchor.z + spec.offsetZ;
				return {
					id: spec.id,
					name: spec.name,
					role: spec.role,
					position: new THREE.Vector3(x, 0, z),
					baseYaw: Math.atan2(anchor.x - x, anchor.z - 1.4 - z),
					modelUrl: LunarOutpostConfig.characterModelUrl,
					accentHex: spec.accentHex,
					phaseOffset: spec.phaseOffset
				};
			})
		);
	}

	public reset(): void {
		this.engine.reset();
	}

	public dispose(scene?: THREE.Scene): void {
		this.engine.dispose(scene);
	}

	public tryStartOrAdvanceDialogue(phase: OutpostPhase, dustAlertActive: boolean): boolean {
		const res = this.engine.tryStartOrAdvanceDialogue((npcId) =>
			getInitialDialogueNodeId(npcId, phase, dustAlertActive)
		);
		if (res.startedNpcId === 'maya' && phase === 'briefing') {
			this.onResupplyAssigned?.();
		}
		return res.startedOrAdvanced;
	}

	public selectChoice(choiceId: string): boolean {
		const res = this.engine.selectChoice(choiceId);
		if (res.handled && res.speakerNpcId === 'maya') {
			this.onResupplyAssigned?.();
		}
		return res.handled;
	}

	public selectChoiceByIndex(index: number): boolean {
		const res = this.engine.selectChoiceByIndex(index);
		if (res.handled && res.speakerNpcId === 'maya') {
			this.onResupplyAssigned?.();
		}
		return res.handled;
	}

	public closeDialogue(): void {
		this.engine.closeDialogue();
	}

	public resolvePlayerCollisions(playerPos: THREE.Vector3, playerRadius = 0.44): void {
		this.engine.resolvePlayerCollisions(playerPos, playerRadius);
	}

	public update(
		dt: number,
		playerPos: THREE.Vector3,
		isSeatedInRover: boolean,
		phase: OutpostPhase,
		dustAlertActive: boolean
	): NpcCommsState {
		const pointAtPos = this.resolveActiveObjectivePoint(phase, dustAlertActive);

		const snap = this.engine.update(
			dt,
			playerPos,
			isSeatedInRover,
			(npcId, homePos, baseYaw) =>
				this.resolveDirective(npcId, homePos, baseYaw, phase, dustAlertActive, pointAtPos),
			(npcId) => getInitialDialogueNodeId(npcId, phase, dustAlertActive)
		);

		return {
			activeTurn: snap.activeTurn,
			nearbyNpcName: snap.nearbyNpcName,
			talkPrompt: snap.talkPrompt,
			ambientSpeaker: snap.ambientSpeaker,
			ambientLine: snap.ambientLine
		};
	}

	private resolveRoom07Anchor(env: NpcWorldEnvironment): THREE.Vector3 {
		const matches: THREE.Vector3[] = [];
		env.outpostRoot?.traverse((obj) => {
			if (matches.length > 0) return;
			if (/07|room.?07|bay.?07/i.test(obj.name)) {
				const pos = new THREE.Vector3();
				obj.getWorldPosition(pos);
				if (pos.lengthSq() > 0.1) {
					matches.push(pos);
				}
			}
		});
		return matches[0] ?? new THREE.Vector3(11.5, 0, -24.0);
	}

	private resolveDirective(
		npcId: NpcId,
		homePos: THREE.Vector3,
		baseYaw: number,
		phase: OutpostPhase,
		dustAlertActive: boolean,
		pointAtPos: THREE.Vector3 | null
	): NpcFrameDirective {
		const forceActivity = phase === 'launched' ? ('watching_target' as const) : undefined;

		if (!this.env) {
			return {
				stationPos: homePos,
				lookAtPos: new THREE.Vector3(0, homePos.y, 0),
				pointAtPos,
				forceActivity
			};
		}

		if (npcId === 'leo') {
			if (dustAlertActive && this.env.solarDustLayers.length > 0) {
				const dustTarget =
					this.env.solarDustLayers.find((d) => d.visible) ?? this.env.solarDustLayers[0];
				const wp = new THREE.Vector3();
				dustTarget.getWorldPosition(wp);
				return {
					stationPos: new THREE.Vector3(wp.x - 2.4, 0, wp.z + 2.2),
					lookAtPos: wp,
					pointAtPos,
					forceActivity
				};
			}

			if (phase === 'exploration') {
				const ws = this.env.workstationPos;
				return {
					stationPos: new THREE.Vector3(ws.x - 1.55, 0, ws.z + 1.35),
					lookAtPos: ws,
					pointAtPos,
					forceActivity
				};
			}

			if (phase === 'finale_ready' || phase === 'launched') {
				const pad = this.env.launchPadPos;
				return {
					stationPos: new THREE.Vector3(pad.x - 9.5, 0, pad.z + 7.5),
					lookAtPos: pad,
					pointAtPos,
					forceActivity
				};
			}
		}

		if (npcId === 'maya') {
			if (phase === 'finale_ready' || phase === 'launched') {
				const pad = this.env.launchPadPos;
				return {
					stationPos: new THREE.Vector3(pad.x - 8.2, 0, pad.z + 9.2),
					lookAtPos: pad,
					pointAtPos,
					forceActivity
				};
			}

			if (phase === 'resupply') {
				const pod = this.env.resupplyDropPos;
				return {
					stationPos: new THREE.Vector3(pod.x - 3.2, 0, pod.z - 2.8),
					lookAtPos: pod,
					pointAtPos,
					forceActivity
				};
			}
		}

		return {
			stationPos: homePos,
			lookAtPos: new THREE.Vector3(
				homePos.x + Math.sin(baseYaw) * 4,
				homePos.y,
				homePos.z + Math.cos(baseYaw) * 4
			),
			pointAtPos,
			forceActivity
		};
	}

	private resolveActiveObjectivePoint(
		phase: OutpostPhase,
		dustAlertActive: boolean
	): THREE.Vector3 | null {
		if (!this.env) return null;

		if (dustAlertActive) {
			const dusty = this.env.solarDustLayers.find((d) => d.visible);
			if (dusty) {
				const p = new THREE.Vector3();
				dusty.getWorldPosition(p);
				return p;
			}
		}

		if (phase === 'briefing' || phase === 'resupply') {
			const nextZone = this.env.dropOffZones.find((z) => !z.delivered);
			if (nextZone) return nextZone.position;
		}

		if (phase === 'exploration') {
			for (const node of this.env.sampleNodes.values()) {
				if (node.visible) {
					const p = new THREE.Vector3();
					node.getWorldPosition(p);
					return p;
				}
			}
			return this.env.workstationPos;
		}

		if (phase === 'finale_ready' || phase === 'launched') {
			return this.env.launchPadPos;
		}

		return null;
	}
}
