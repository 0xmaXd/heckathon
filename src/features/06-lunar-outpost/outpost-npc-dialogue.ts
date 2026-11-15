import type {
	NpcDialogueChoice,
	NpcDialogueTurn,
	NpcId,
	OutpostPhase
} from './lunar-outpost.types';

export interface AmbientBanterLine {
	speaker: 'Commander Maya' | 'Geologist Leo';
	line: string;
}

export const ROOM_07_AMBIENT_BANTER: AmbientBanterLine[] = [
	{
		speaker: 'Commander Maya',
		line: 'Seals on Room 07 airlock are holding at 101 kPa, Leo—even with the regolith you tracked in.'
	},
	{
		speaker: 'Geologist Leo',
		line: 'Hey, that dust is 40% bound oxygen! Practically gold—though my visor filter disagrees.'
	},
	{
		speaker: 'Commander Maya',
		line: 'Save the geology lecture for our new EVA specialist. They just suited up beside us.'
	},
	{
		speaker: 'Geologist Leo',
		line: 'Copy that, Commander. Fresh Artemis suit looks sharp—ready to test it in one-sixth G!'
	}
];

interface DialogueNodeDefinition {
	speaker: 'Commander Maya' | 'Geologist Leo';
	text: string;
	companionInterjection?: {
		speaker: 'Commander Maya' | 'Geologist Leo';
		text: string;
	};
	choices: NpcDialogueChoice[];
}

const MAYA_NODES: Record<string, DialogueNodeDefinition> = {
	root_briefing: {
		speaker: 'Commander Maya',
		text: 'Welcome to Room 07 Staging at Orion Moon Outpost! Good to have another set of boots on the Shackleton Rim. Ready to get our supply line moving?',
		companionInterjection: {
			speaker: 'Geologist Leo',
			text: 'And once the crates are stowed, I have six crater sites dying for a spectrometer sweep!'
		},
		choices: [
			{ id: 'c1', label: 'Give me the rundown on Orion Outpost.', nextNodeId: 'outpost_tour' },
			{ id: 'c2', label: 'How are you and Leo holding up out here?', nextNodeId: 'crew_banter' },
			{ id: 'c3', label: 'What are my immediate orders?', nextNodeId: 'orders_resupply' },
			{ id: 'c4', label: 'On it—heading out on EVA now.', nextNodeId: null }
		]
	},
	root_exploration: {
		speaker: 'Commander Maya',
		text: 'Solid haul on those supply crates. Now you are cleared for full crater exploration—watch your suit battery and keep an eye on Leo’s scanner telemetry.',
		companionInterjection: {
			speaker: 'Geologist Leo',
			text: 'Focus on the three metals and three non-metals, Specialist. Every sample counts!'
		},
		choices: [
			{ id: 'c1', label: 'Give me the rundown on Orion Outpost.', nextNodeId: 'outpost_tour' },
			{ id: 'c2', label: 'How are you and Leo holding up out here?', nextNodeId: 'crew_banter' },
			{ id: 'c3', label: 'Any rover driving tips for the crater rim?', nextNodeId: 'rover_tips' },
			{ id: 'c4', label: 'Copy, Commander. Back to sampling.', nextNodeId: null }
		]
	},
	root_finale: {
		speaker: 'Commander Maya',
		text: 'All six ISRU samples are verified and sealed in the return canister! Head to the Orion Landing Pad whenever you are ready to trigger launch.',
		companionInterjection: {
			speaker: 'Geologist Leo',
			text: 'Houston is already clearing telemetry bandwidth for our South Pole data packet!'
		},
		choices: [
			{ id: 'c1', label: 'How are you and Leo holding up out here?', nextNodeId: 'crew_banter' },
			{ id: 'c2', label: 'Give me the rundown on Orion Outpost.', nextNodeId: 'outpost_tour' },
			{ id: 'c3', label: 'Heading to the Landing Pad now.', nextNodeId: null }
		]
	},
	outpost_tour: {
		speaker: 'Commander Maya',
		text: 'You are standing outside Room 07—our primary EVA suit-up and airlock bay. West is the Orion LTV Rover and supply drop ring; north is the Geology Lab and Solar Array.',
		companionInterjection: {
			speaker: 'Geologist Leo',
			text: 'Just remember to wipe electrostatic dust off the solar panels with [E] if my scanner dips!'
		},
		choices: [
			{ id: 'c1', label: 'Any rover driving tips for the crater rim?', nextNodeId: 'rover_tips' },
			{ id: 'c2', label: 'How are you and Leo holding up out here?', nextNodeId: 'crew_banter' },
			{ id: 'c3', label: 'Thanks, Commander. Stepping off.', nextNodeId: null }
		]
	},
	rover_tips: {
		speaker: 'Commander Maya',
		text: 'Stick to the Sintered Regolith pads and compacted wheel ruts when hauling crates—loose crater dust cuts top speed by a third and drains battery three times faster.',
		choices: [
			{ id: 'c1', label: 'Give me the rundown on Orion Outpost.', nextNodeId: 'outpost_tour' },
			{ id: 'c2', label: 'Got it. Ready to roll.', nextNodeId: null }
		]
	},
	crew_banter: {
		speaker: 'Commander Maya',
		text: 'Three identical Artemis suits, zero gravity-induced backaches, and Leo trying to name every basalt boulder after a cheese. Honestly, best crew on the Moon.',
		companionInterjection: {
			speaker: 'Geologist Leo',
			text: 'That one ridge genuinely looks like aged Gruyère, Commander, and you know it!'
		},
		choices: [
			{ id: 'c1', label: 'Give me the rundown on Orion Outpost.', nextNodeId: 'outpost_tour' },
			{ id: 'c2', label: 'Haha, back to work you two.', nextNodeId: null }
		]
	},
	orders_resupply: {
		speaker: 'Commander Maya',
		text: 'Board the Orion Rover with [E] or carry crates by hand with [F], and deliver all 6 Supply Crates to the orange drop ring by the Storage Pod.',
		choices: [
			{ id: 'c1', label: 'Any rover driving tips for the crater rim?', nextNodeId: 'rover_tips' },
			{ id: 'c2', label: 'Understood. Moving crates now.', nextNodeId: null }
		]
	}
};

const LEO_NODES: Record<string, DialogueNodeDefinition> = {
	root_default: {
		speaker: 'Geologist Leo',
		text: 'Hey! Good to see someone else wearing the new Mark-III EVA rig. I have been logging Shackleton Rim mineral spectra all morning—want the science brief?',
		companionInterjection: {
			speaker: 'Commander Maya',
			text: 'Keep it under ten minutes, Leo—we still have an orbital launch window to hit.'
		},
		choices: [
			{ id: 'c1', label: 'Tell me about the 6 ISRU samples.', nextNodeId: 'isru_guide' },
			{ id: 'c2', label: 'What were you and Maya just talking about?', nextNodeId: 'dust_talk' },
			{ id: 'c3', label: 'How do the Geology Lab & Scanner work?', nextNodeId: 'lab_tips' },
			{ id: 'c4', label: 'Catch you after my sweep, Leo.', nextNodeId: null }
		]
	},
	root_dust_alert: {
		speaker: 'Geologist Leo',
		text: 'Perfect timing! Static-charged lunar dust just blanketed the Solar Array—my Geology Scanner is losing power. Can you wipe the dusty panels with [E]?',
		companionInterjection: {
			speaker: 'Commander Maya',
			text: 'Priority maintenance, Specialist. Clean panels keep life support and comms nominal.'
		},
		choices: [
			{ id: 'c1', label: 'Tell me about the 6 ISRU samples.', nextNodeId: 'isru_guide' },
			{ id: 'c2', label: 'How do the Geology Lab & Scanner work?', nextNodeId: 'lab_tips' },
			{ id: 'c3', label: 'Heading to the Solar Array right now.', nextNodeId: null }
		]
	},
	isru_guide: {
		speaker: 'Geologist Leo',
		text: 'We need 3 Metals—Titanium ilmenite, meteoritic Iron, and highland Aluminum—plus 3 Non-Metals: oxygen-rich regolith, solar-grade Silicon, and shadowed Water-Ice!',
		companionInterjection: {
			speaker: 'Commander Maya',
			text: 'Everything future Artemis crews need to build and refuel right here on the Moon.'
		},
		choices: [
			{ id: 'c1', label: 'How do the Geology Lab & Scanner work?', nextNodeId: 'lab_tips' },
			{ id: 'c2', label: 'What were you and Maya just talking about?', nextNodeId: 'dust_talk' },
			{ id: 'c3', label: 'I will bring them back for analysis.', nextNodeId: null }
		]
	},
	dust_talk: {
		speaker: 'Geologist Leo',
		text: 'Lunar dust has zero wind erosion, so every microscopic grain is razor-sharp and electrostatically sticky. Maya wants me to brush off before entering Room 07!',
		companionInterjection: {
			speaker: 'Commander Maya',
			text: 'Because replacing titanium bearing seals in a vacuum is not on my schedule today.'
		},
		choices: [
			{ id: 'c1', label: 'Tell me about the 6 ISRU samples.', nextNodeId: 'isru_guide' },
			{ id: 'c2', label: 'Makes sense. Talk soon, Leo.', nextNodeId: null }
		]
	},
	lab_tips: {
		speaker: 'Geologist Leo',
		text: 'Walk up to glowing mineral outcrops across the crater ridges and press [E] to scan them. Once tagged, bring them to the Geology Lab terminal to unlock their NASA ISRU cards!',
		choices: [
			{ id: 'c1', label: 'Tell me about the 6 ISRU samples.', nextNodeId: 'isru_guide' },
			{ id: 'c2', label: 'Got it. Starting the survey!', nextNodeId: null }
		]
	}
};

export function getInitialDialogueNodeId(
	npcId: NpcId,
	phase: OutpostPhase,
	dustAlertActive: boolean
): string {
	if (npcId === 'maya') {
		if (phase === 'finale_ready' || phase === 'launched') return 'root_finale';
		if (phase === 'exploration') return 'root_exploration';
		return 'root_briefing';
	}
	return dustAlertActive ? 'root_dust_alert' : 'root_default';
}

export function buildDialogueTurn(npcId: NpcId, nodeId: string): NpcDialogueTurn | null {
	const table = npcId === 'maya' ? MAYA_NODES : LEO_NODES;
	const node = table[nodeId];
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
