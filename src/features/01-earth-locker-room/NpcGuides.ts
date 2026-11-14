import { LockerConfig } from './locker.config';

export class NpcGuides {
	// In a full 3D implementation, these would be linked to mesh Raycasters or proximity triggers

	interactWithNpc1(): string {
		return LockerConfig.dialogue.npc1;
	}

	interactWithNpc2(): string {
		return LockerConfig.dialogue.npc2;
	}

	checkInspectionComplete(collectedItems: string[]): boolean {
		return LockerConfig.requiredItems.every((item) => collectedItems.includes(item));
	}
}

export const npcGuides = new NpcGuides();
