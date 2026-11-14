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
		fixedTimeStep: 1 / 60,
		movementProfiles: {
			earthWalk: {
				walkSpeed: 3.4,
				sprintMultiplier: 1.55,
				groundAccel: 18.0,
				groundDecel: 16.0,
				jumpVelocity: 3.2, // ~0.52m vertical jump under 9.81 m/s²
				jumpFatiguePerJump: 0.18,
				staminaRecoveryRate: 0.22,
				minJumpMultiplier: 0.45,
				airBrakeDecel: 2.2,
				zeroG: false
			},
			lunarLowG: {
				walkSpeed: 2.8,
				sprintMultiplier: 1.45,
				groundAccel: 7.5,
				groundDecel: 6.5,
				jumpVelocity: 1.85, // ~1.05m Apollo suited bound under 1.62 m/s²
				jumpFatiguePerJump: 0.05,
				staminaRecoveryRate: 0.25,
				minJumpMultiplier: 0.65,
				airBrakeDecel: 1.1,
				zeroG: false
			},
			zeroGEva: {
				walkSpeed: 2.5,
				sprintMultiplier: 1.6,
				groundAccel: 3.5,
				groundDecel: 1.2,
				jumpVelocity: 0,
				jumpFatiguePerJump: 0,
				staminaRecoveryRate: 1.0,
				minJumpMultiplier: 1.0,
				airBrakeDecel: 3.5,
				zeroG: true
			}
		}
	}
};

export type MovementProfileName = keyof typeof GameConfig.physics.movementProfiles;
export type MovementProfile = (typeof GameConfig.physics.movementProfiles)[MovementProfileName];
