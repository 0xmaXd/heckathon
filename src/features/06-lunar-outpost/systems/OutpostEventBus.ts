import { EventBus } from '../../../core/engine/EventBus';
import type { DropOffZoneId, OutpostPhase } from '../lunar-outpost.types';

export interface OutpostEventMap extends Record<string, unknown> {
	'mission:phaseChanged': { phase: OutpostPhase };
	'crate:delivered': { zoneId: DropOffZoneId; crateName: string; deliveredCount: number };
	'sample:collected': { nodeName: string; title: string };
	'sample:analyzed': { nodeName: string; title: string; analyzedCount: number };
	'dust:stormTriggered': { panelCount: number };
	'lander:launched': { launchPadPos: [number, number, number] };
}

export const outpostEventBus = new EventBus<OutpostEventMap>();
