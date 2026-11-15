import type { DiscoveryCardData, DropOffZoneDefinition, SurfaceType } from './lunar-outpost.types';

export const LunarOutpostConfig = {
	modelUrl: '/models/moon_outpost.glb',
	// Place your EVA_Suit .glb file from room 07 at static/models/eva_astronaut.glb (or update path here)
	characterModelUrl: '/models/eva_astronaut.glb',

	physics: {
		lunarGravity: 1.62,
		evaWalkSpeed: 4.8,
		evaSprintSpeed: 7.4,
		evaJumpVelocity: 3.6,
		interactionRadius: 4.6,
		npcTalkRadius: 4.6,
		npcAmbientRadius: 7.8,
		crateDeliverRadius: 6.2,
		workstationRadius: 5.5,
		launchPadRadius: 9.0
	},

	rover: {
		defaultMaxSpeedKmh: 18.0,
		defaultMaxSlopeDeg: 20.0,
		defaultWheelbaseM: 2.3,
		wheelRadiusM: 0.42,
		surfaceSpeedMultipliers: {
			Sintered_Regolith: 1.0,
			Compacted_Wheel_Ruts: 0.92,
			Graded_Crater_Trail: 0.85,
			Loose_Regolith: 0.68
		} satisfies Record<SurfaceType, number>,
		surfaceDrainMultipliers: {
			Sintered_Regolith: 0.04,
			Compacted_Wheel_Ruts: 0.06,
			Graded_Crater_Trail: 0.08,
			Loose_Regolith: 0.12
		} satisfies Record<SurfaceType, number>
	},

	resupplyRequiredCount: 5,

	dropOffZoneDefinitions: [
		{
			id: 'command_control',
			label: 'Command Control',
			shortHint: 'Command Tower Plaza',
			fallbackPos: [-12, 0, -16],
			nodePatterns: [/Command_Tower_Base/i, /Command_Tower_Shaft/i, /Command_Tower/i],
			offsetDistance: 3.6
		},
		{
			id: 'electricity',
			label: 'Electricity (Power Station)',
			shortHint: 'Reactor & Solar Array',
			fallbackPos: [18, 0, 12],
			nodePatterns: [/Fission_Reactor_Core/i, /Solar_Mast_01/i, /Solar_Dust_Layer_01/i],
			offsetDistance: 3.8
		},
		{
			id: 'storage_pod',
			label: 'Storage Pod',
			shortHint: 'Cargo Depot Ring',
			fallbackPos: [-22, 0, 14],
			nodePatterns: [/Storage_Pod_Base/i, /Storage_Pod/i],
			offsetDistance: 3.6
		},
		{
			id: 'geology_lab',
			label: 'Geology Lab',
			shortHint: 'Science Workstation',
			fallbackPos: [6.5, 0, -1.5],
			nodePatterns: [/Geology_Workstation_Console/i, /Geology/i],
			offsetDistance: 3.4
		},
		{
			id: 'airlock',
			label: 'Habitat Airlock',
			shortHint: 'Room 07 Staging Bay',
			fallbackPos: [11.5, 0, -29.5],
			nodePatterns: [/Airlock_Outer_Door/i, /Dome_Habitat_Shell/i],
			offsetDistance: 3.4
		}
	] satisfies DropOffZoneDefinition[],

	discoveryCards: [
		{
			id: 'titanium',
			nodeName: 'Sample_Metal_01_Titanium',
			category: 'Metal',
			title: 'Titanium (Ilmenite)',
			formula: 'FeTiO₃',
			headline: 'NASA’s #1 Aerospace Structural Metal!',
			nasaFact:
				'Dark, metallic-black ilmenite crystals lock together iron, titanium, and oxygen—and also trap solar-wind hydrogen!',
			artemisUse:
				'Refined into lightweight, ultra-strong spacecraft parts while releasing breathable oxygen as a bonus.',
			collected: false,
			analyzed: false
		},
		{
			id: 'iron',
			nodeName: 'Sample_Metal_02_Iron',
			category: 'Metal',
			title: 'Native Meteoritic Iron',
			formula: 'Fe',
			headline: 'Magnetic Moon Dust for 3D Printing!',
			nasaFact:
				'Billions of years of meteorite impacts left tiny pure iron grains mixed directly into lunar dust.',
			artemisUse:
				'Collected with magnetic sweepers and melted by lasers to 3D-print tools, wrenches, and landing pad tiles.',
			collected: false,
			analyzed: false
		},
		{
			id: 'aluminum',
			nodeName: 'Sample_Metal_03_Aluminum',
			category: 'Metal',
			title: 'Aluminum (Highland Anorthite)',
			formula: 'CaAl₂Si₂O₈',
			headline: 'Bright White Highland Rock!',
			nasaFact:
				'The bright white-gray highlands around lunar craters are rich in calcium-aluminum silicate rock.',
			artemisUse:
				'Extracted via Molten Regolith Electrolysis (MRE) to build habitat frames, power cables, and rocket fuel powder.',
			collected: false,
			analyzed: false
		},
		{
			id: 'oxygen',
			nodeName: 'Sample_NonMetal_01_OxygenRegolith',
			category: 'Non-Metal',
			title: 'Oxygen-Rich Regolith',
			formula: 'O₂ (40%+ by mass)',
			headline: 'Did you know? Over 40% of Moon rock is trapped oxygen!',
			nasaFact:
				'Even though the Moon has no breathable atmosphere, lunar soil is more than 40% oxygen by weight bound inside mineral oxides.',
			artemisUse:
				'Heated in solar furnaces to supply breathable air for astronauts and Liquid Oxygen (LOX) rocket propellant.',
			collected: false,
			analyzed: false
		},
		{
			id: 'silicon',
			nodeName: 'Sample_NonMetal_02_Silicon',
			category: 'Non-Metal',
			title: 'Lunar Silicon',
			formula: 'SiO₂ (~45% of soil)',
			headline: 'Building Solar Panels Straight From Moon Dirt!',
			nasaFact:
				'Silicon makes up roughly 45% of lunar regolith—the exact same element used in computer chips and solar cells on Earth.',
			artemisUse:
				'Purified on the lunar surface to manufacture new photovoltaic solar arrays without launching heavy glass from Earth.',
			collected: false,
			analyzed: false
		},
		{
			id: 'water_ice',
			nodeName: 'Sample_NonMetal_03_WaterIce',
			category: 'Non-Metal',
			title: 'Cryogenic South Pole Water-Ice',
			formula: 'H₂O + H₂',
			headline: 'Ancient Ice Preserved in Permanent Crater Shadows!',
			nasaFact:
				'Inside permanently shadowed South Pole crater alcoves where temperatures drop below −180 °C, ancient water-ice has survived for billions of years.',
			artemisUse:
				'Filtered into astronaut drinking water and split with electricity into hydrogen and oxygen rocket fuel.',
			collected: false,
			analyzed: false
		}
	] satisfies DiscoveryCardData[]
};
