export interface LandingHazardConfig {
	dx: number;
	dz: number;
	radius: number;
	height: number;
}

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
		gateWorldY: 22
	},
	terrain: {
		tileSize: 160,
		tileSegments: 48,
		gridRadius: 1
	},
	hazards: [] as LandingHazardConfig[]
};
