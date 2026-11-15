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
		line: 'Command Control, Electricity, Storage Pod, Geology Lab, and Habitat Airlock all need their supply crates before we start the survey.'
	},
	{
		speaker: 'Geologist Leo',
		line: 'Any crate works for any station—just make sure you actually drop it off inside the glowing ring!'
	},
	{
		speaker: 'Commander Maya',
		line: 'Good thing our new EVA specialist just suited up at Room 07. Talk with me [T] whenever you are ready for orders.'
	},
	{
		speaker: 'Geologist Leo',
		line: 'Once all 5 drop-offs are locked in, I will unlock the spectrometer markers for our 6 South Pole mineral samples!'
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
		text: 'Welcome to Room 07 Staging at Orion Moon Outpost! Your first mission is to pick up supply boxes and drop 1 box at each of our 5 designated stations: Command Control, Electricity, Storage Pod, Geology Lab, and Habitat Airlock.',
		companionInterjection: {
			speaker: 'Geologist Leo',
			text: 'Any box can be taken to any of those 5 pads—just press [F] to drop it off inside each glowing ring!'
		},
		choices: [
			{
				id: 'c1',
				label: 'Accept Mission: Where are the 5 drop-off zones?',
				nextNodeId: 'orders_resupply'
			},
			{ id: 'c2', label: 'Give me the rundown on Orion Outpost.', nextNodeId: 'outpost_tour' },
			{ id: 'c3', label: 'Any rover driving tips for hauling boxes?', nextNodeId: 'rover_tips' },
			{ id: 'c4', label: 'Copy, Commander! Starting the 5 drop-offs now.', nextNodeId: null }
		]
	},
	root_resupply_active: {
		speaker: 'Commander Maya',
		text: 'Your supply mission is active! Check the top-right checklist for remaining stations—Command Control, Electricity, Storage Pod, Geology Lab, and Habitat Airlock. Drop a box [F] inside each remaining ring to complete all 5 drop-offs.',
		companionInterjection: {
			speaker: 'Geologist Leo',
			text: 'You can carry boxes on foot with [F] or load them onto the Orion Rover with [F] after boarding [E].'
		},
		choices: [
			{ id: 'c1', label: 'Remind me how the 5 drop-offs work.', nextNodeId: 'orders_resupply' },
			{ id: 'c2', label: 'Any rover driving tips for hauling boxes?', nextNodeId: 'rover_tips' },
			{ id: 'c3', label: 'Back to delivering boxes!', nextNodeId: null }
		]
	},
	root_exploration: {
		speaker: 'Commander Maya',
		text: 'All 5 drop-off stations are stocked and online! Now you are cleared for full crater exploration—assist Leo with the 6 lunar mineral samples.',
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
		text: 'All 5 supply drop-offs and all 6 ISRU samples are verified and sealed! Head to the Orion Landing Pad whenever you are ready to trigger launch.',
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
	orders_resupply: {
		speaker: 'Commander Maya',
		text: 'Pick up any supply crate with [F] (or load it onto the Orion Rover) and carry it to: (1) Command Control, (2) Electricity / Power Station, (3) Storage Pod, (4) Geology Lab, and (5) Habitat Airlock. Press [F] inside each ring to drop it off—5 drop-offs completes the mission!',
		choices: [
			{ id: 'c1', label: 'Any rover driving tips for hauling boxes?', nextNodeId: 'rover_tips' },
			{ id: 'c2', label: 'Understood. Delivering all 5 boxes now.', nextNodeId: null }
		]
	},
	outpost_tour: {
		speaker: 'Commander Maya',
		text: 'You are standing at Room 07 Habitat Airlock. Nearby are Command Control, the Storage Pod, the Geology Lab, and the Electricity Reactor & Solar Array—all marked with glowing drop-off rings.',
		companionInterjection: {
			speaker: 'Geologist Leo',
			text: 'And remember to wipe electrostatic dust off the solar panels with [E] if my scanner dips!'
		},
		choices: [
			{ id: 'c1', label: 'Any rover driving tips for the crater rim?', nextNodeId: 'rover_tips' },
			{ id: 'c2', label: 'How are you and Leo holding up out here?', nextNodeId: 'crew_banter' },
			{ id: 'c3', label: 'Thanks, Commander. Stepping off.', nextNodeId: null }
		]
	},
	rover_tips: {
		speaker: 'Commander Maya',
		text: 'Board the Orion Rover with [E], drive next to any crate and press [F] to load it onto the cargo rack, then drive to a glowing drop ring and press [F] to unload and deliver it.',
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
	}
};

const LEO_NODES: Record<string, DialogueNodeDefinition> = {
	root_default: {
		speaker: 'Geologist Leo',
		text: 'Hey! Good to see someone else wearing the new Mark-III EVA rig. Talk with Commander Maya right beside me to get your 5 box drop-off locations—once those are delivered, I have 6 lunar samples ready for you!',
		companionInterjection: {
			speaker: 'Commander Maya',
			text: 'Command Control, Electricity, Storage Pod, Geology Lab, and Habitat Airlock are waiting on those crates, Specialist.'
		},
		choices: [
			{ id: 'c1', label: 'Tell me about the 6 ISRU samples.', nextNodeId: 'isru_guide' },
			{ id: 'c2', label: 'What were you and Maya just talking about?', nextNodeId: 'dust_talk' },
			{ id: 'c3', label: 'How do the Geology Lab & Scanner work?', nextNodeId: 'lab_tips' },
			{ id: 'c4', label: 'Catch you after the deliveries, Leo.', nextNodeId: null }
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
		if (phase === 'resupply') return 'root_resupply_active';
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
