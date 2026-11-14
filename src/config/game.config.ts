export const GameConfig = {
	seed: 42, // Deterministic seed for anomalies and meteors
	transitDurationDays: 3,
	meteorDefense: {
		maxStrikes: 2,
		warningTimeSeconds: 5
	},
	physics: {
		gravityEarth: 9.81,
		gravityMoon: 1.62,
		fixedTimeStep: 1 / 60
	}
};
