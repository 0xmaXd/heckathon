export type OutpostPhase = 'briefing' | 'resupply' | 'exploration' | 'finale_ready' | 'launched';

export type SampleCategory = 'Metal' | 'Non-Metal';

export type SurfaceType =
	'Sintered_Regolith' | 'Compacted_Wheel_Ruts' | 'Graded_Crater_Trail' | 'Loose_Regolith';

export type NpcId = 'maya' | 'leo';

export interface NpcDialogueChoice {
	id: string;
	label: string;
	nextNodeId: string | null;
}

export interface NpcDialogueTurn {
	npcId: NpcId;
	nodeId: string;
	speaker: 'Commander Maya' | 'Geologist Leo';
	text: string;
	companionInterjection?: {
		speaker: 'Commander Maya' | 'Geologist Leo';
		text: string;
	};
	choices: NpcDialogueChoice[];
}

export interface NpcCommsState {
	activeTurn: NpcDialogueTurn | null;
	nearbyNpcName: 'Commander Maya' | 'Geologist Leo' | null;
	talkPrompt: string | null;
	ambientSpeaker: 'Commander Maya' | 'Geologist Leo' | null;
	ambientLine: string | null;
}

export interface DiscoveryCardData {
	id: string;
	nodeName: string;
	category: SampleCategory;
	title: string;
	formula: string;
	headline: string;
	nasaFact: string;
	artemisUse: string;
	collected: boolean;
	analyzed: boolean;
}

export interface RoverHudState {
	isSeated: boolean;
	canBoard: boolean;
	speedKmh: number;
	headingDeg: number;
	batteryPct: number;
	headlightsOn: boolean;
	surfaceType: SurfaceType;
	loadedCrateName: string | null;
}

export interface SolarCycleState {
	phaseLabel: 'Lunar Day' | 'Crater Twilight' | 'Lunar Night';
	sunElevationDeg: number;
	cycleProgressPct: number;
	isNight: boolean;
}

export interface MaintenanceAlert {
	active: boolean;
	title: string;
	message: string;
	dustyPanelsRemaining: number;
	totalPanels: number;
}

export interface OutpostHudSnapshot {
	phase: OutpostPhase;
	speaker: 'Commander Maya' | 'Geologist Leo' | 'Mission Control';
	dialogue: string;
	actionPrompt: string | null;
	cratesDelivered: number;
	cratesRequired: number;
	carryingCrateName: string | null;
	samplesCollectedCount: number;
	samplesAnalyzedCount: number;
	samples: DiscoveryCardData[];
	activeDiscoveryCard: DiscoveryCardData | null;
	maintenanceAlert: MaintenanceAlert;
	rover: RoverHudState;
	solar: SolarCycleState;
	scannerPowerPct: number;
	isPointerLocked: boolean;
	npcComms?: NpcCommsState;
}
