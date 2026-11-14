export const LockerConfig = {
	requiredItems: ['helmet', 'oxygen_tank', 'geiger_counter'],
	inspectionTriggers: {
		npc1Distance: 2.0,
		npc2Distance: 2.0,
		terminalDistance: 1.5
	},
	dialogue: {
		npc1: 'Ship telemetry looks green. Check your vitals and grab your gear.',
		npc2: "Don't forget the Geiger counter. Lunar radiation spikes are unpredictable today."
	}
};
