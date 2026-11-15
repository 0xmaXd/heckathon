export const LaunchRoomConfig = {
	platformRadius: 10,
	rocketHeight: 15,
	status: 'Awaiting boarding',
	ascent: {
		srbSeparationAltitudeKm: 45.0,
		lasJettisonAltitudeKm: 88.0,
		solarDeployAltitudeKm: 102.0,
		sceneEndAltitudeKm: 600.0,
		targetAltitudeKm: 600.0
	},
	atmosphereLayers: [
		{ name: 'Troposphere', maxKm: 12 },
		{ name: 'Stratosphere', maxKm: 50 },
		{ name: 'Mesosphere', maxKm: 85 },
		{ name: 'Thermosphere', maxKm: 500 },
		{ name: 'Exosphere', maxKm: Infinity }
	],
	iss: {
		pollIntervalMs: 10000,
		noradId: 25544,
		endpoint: 'https://api.wheretheiss.at/v1/satellites/25544'
	}
} as const;
