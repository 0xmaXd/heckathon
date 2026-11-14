export const SurvivalConfig = {
	waterTankCapacityLiters: 120,
	consumptionRates: {
		o2DecayPerSecond: 0.15, // Percentage points
		hungerDecayPerMinute: 1.2,
		waterRecycleEfficiency: 0.85 // 85% recovered from outpost closed-loop
	},
	radiation: {
		safeLimitMSv: 50,
		timerThresholds: [
			{ level: 'WARNING', timeSeconds: 300 },
			{ level: 'CRITICAL', timeSeconds: 600 }
		]
	}
};
