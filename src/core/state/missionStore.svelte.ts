class MissionStore {
	currentPhase = $state(1); // 1 to 7 corresponding to your features

	resources = $state({
		waterLiters: 120,
		oxygenPct: 100,
		hungerPct: 100,
		powerWatts: 5000
	});

	flags = $state({
		suitInspected: false,
		clearedForLaunch: false,
		meteorAlarmActive: false,
		samplesCollected: 0
	});

	advancePhase() {
		if (this.currentPhase < 7) this.currentPhase++;
	}

	consumeO2(amount: number) {
		this.resources.oxygenPct = Math.max(0, this.resources.oxygenPct - amount);
	}
}

export const missionStore = new MissionStore();
