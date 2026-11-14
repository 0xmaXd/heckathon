export const LunarLandingConfig = {
	spawnOffset: [-18, 42, 0] as [number, number, number],
	initialVelocity: [2.8, -4.2, 0] as [number, number, number],
	cameraOffset: [0, 7, 24] as [number, number, number],
	lander: {
		massKg: 4800,
		halfExtents: [1.35, 1.45, 1.35] as [number, number, number],
		touchdownFootY: 1.45,
		maxThrustLunarGs: 2.6,
		rcsLateralAccelMs2: 3.8,
		manualRateGain: 3.2,
		manualMaxSinkAdjustMs: 5.0
	},
	scale: {
		gateWorldY: 22 // Below 22m world height, telemetry runs at true 1:1 meter scale
	},
	terrain: {
		tileSize: 160,
		tileSegments: 48,
		gridRadius: 1 // 3x3 chunk grid = 480m x 480m rolling around the lander
	},
	hazards: [
		{ dx: -10.5, dz: -1.8, radius: 1.6, height: 1.0 },
		{ dx: -6.2, dz: 2.0, radius: 1.3, height: 0.85 },
		{ dx: 7.0, dz: -1.4, radius: 1.7, height: 1.1 },
		{ dx: 12.2, dz: 1.6, radius: 2.0, height: 1.3 }
	]
};
