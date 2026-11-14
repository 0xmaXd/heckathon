import * as THREE from 'three';
import descentData from '#lib/assets/data/nasa/lunar_descent_profiles.json';
import { LunarLandingConfig } from '../lunar-landing.config';
import type { LandingControlMode, LandingStyleId } from '../lunarLandingState.svelte';

export interface GuidanceInput {
	style: LandingStyleId;
	controlMode: LandingControlMode;
	isIgnited: boolean;
	fuelPct: number;
	posX: number;
	posZ: number;
	velX: number;
	velY: number;
	velZ: number;
	footHeight: number;
	targetPadX: number;
	targetPadZ: number;
	throttleInput: number;
	lateralInputX: number;
	lateralInputZ: number;
}

export interface GuidanceOutput {
	shouldAutoIgnite: boolean;
	forceX: number;
	forceY: number;
	forceZ: number;
	throttleRatio: number;
	desiredRollRad: number;
	desiredPitchRad: number;
	guidancePhaseName: string;
	realAltitudeM: number;
	realVerticalVelMs: number;
	realHorizontalVelMs: number;
	triggerHdaScan: boolean;
	currentMassKg: number;
	propellantRemainingKg: number;
	activeThrustKn: number;
	lunarTwr: number;
}

export interface TouchdownResult {
	success: boolean;
	failures: string[];
}

export class DescentGuidance {
	getProfile(style: LandingStyleId) {
		return descentData.profiles[style];
	}

	computeMassStats(style: LandingStyleId, fuelPct: number) {
		const profile = this.getProfile(style);
		const gMoon = descentData.lunarGravityMs2;
		const propellantRemainingKg = profile.propellantMassKg * (Math.max(0, fuelPct) / 100);
		const currentMassKg = profile.dryMassKg + propellantRemainingKg;
		const lunarWeightN = currentMassKg * gMoon;
		const lunarTwr = profile.maxThrustN / lunarWeightN;

		return {
			dryMassKg: profile.dryMassKg,
			propellantRemainingKg,
			currentMassKg,
			lunarTwr
		};
	}

	computeRealAltitudeM(footHeightWorld: number, style: LandingStyleId): number {
		const profile = this.getProfile(style);
		const gateWorldY = LunarLandingConfig.scale.gateWorldY;
		const startWorldY =
			LunarLandingConfig.spawnOffset[1] - LunarLandingConfig.lander.touchdownFootY;

		if (footHeightWorld <= 0) return 0;
		if (footHeightWorld <= gateWorldY) {
			return (footHeightWorld / gateWorldY) * profile.lowGateAltitudeM;
		}

		const t = Math.min(1, (footHeightWorld - gateWorldY) / (startWorldY - gateWorldY));
		return profile.lowGateAltitudeM + (profile.pdiAltitudeM - profile.lowGateAltitudeM) * (t * t);
	}

	step(input: GuidanceInput): GuidanceOutput {
		const profile = this.getProfile(input.style);
		const gMoon = descentData.lunarGravityMs2;
		const rapierBodyMassKg = LunarLandingConfig.lander.massKg;
		const { rcsLateralAccelMs2, manualRateGain, manualMaxSinkAdjustMs } = LunarLandingConfig.lander;

		const { currentMassKg, propellantRemainingKg, lunarTwr } = this.computeMassStats(
			input.style,
			input.fuelPct
		);

		const realAltitudeM = this.computeRealAltitudeM(input.footHeight, input.style);

		const activePhase =
			profile.guidancePhases.find((p) => realAltitudeM >= p.minAltitudeM) ??
			profile.guidancePhases[profile.guidancePhases.length - 1];

		const shouldAutoIgnite =
			input.controlMode === 'auto' && !input.isIgnited && input.footHeight <= 39;

		const triggerHdaScan = profile.hasHazardAvoidance && realAltitudeM <= profile.highGateAltitudeM;

		let verticalAccelCmd: number;
		let lateralAccelX: number;
		let lateralAccelZ: number;
		let desiredRollRad = 0;
		let desiredPitchRad = 0;

		const maxTiltRad = THREE.MathUtils.degToRad(profile.maxTiltDeg);

		if (input.controlMode === 'auto') {
			const targetSinkRate =
				input.footHeight > 16 ? -5.2 : input.footHeight > 5 ? -2.2 : profile.targetTouchdownVelMs;

			verticalAccelCmd = gMoon + (targetSinkRate - input.velY) * 2.1;

			const errX = input.targetPadX - input.posX;
			const errZ = input.targetPadZ - input.posZ;
			const maxHorizSpeed = input.footHeight < 10 && profile.id === 'artemis' ? 1.8 : 4.8;

			const desiredVx = THREE.MathUtils.clamp(errX * 0.65, -maxHorizSpeed, maxHorizSpeed);
			const desiredVz = THREE.MathUtils.clamp(errZ * 0.65, -maxHorizSpeed, maxHorizSpeed);

			lateralAccelX = THREE.MathUtils.clamp((desiredVx - input.velX) * 1.6, -3.4, 3.4);
			lateralAccelZ = THREE.MathUtils.clamp((desiredVz - input.velZ) * 1.6, -3.4, 3.4);

			desiredRollRad = THREE.MathUtils.clamp(-lateralAccelX * 0.08, -maxTiltRad, maxTiltRad);
			desiredPitchRad = THREE.MathUtils.clamp(lateralAccelZ * 0.08, -maxTiltRad, maxTiltRad);
		} else {
			const baselineSinkRate = input.footHeight > 10 ? -2.0 : profile.targetTouchdownVelMs;
			const commandedSinkRate = baselineSinkRate + input.throttleInput * manualMaxSinkAdjustMs;
			verticalAccelCmd = gMoon + (commandedSinkRate - input.velY) * manualRateGain;

			if (input.lateralInputX !== 0) {
				lateralAccelX = input.lateralInputX * rcsLateralAccelMs2;
				desiredRollRad = -input.lateralInputX * maxTiltRad * 0.7;
			} else {
				lateralAccelX = THREE.MathUtils.clamp(-input.velX * 0.85, -1.5, 1.5);
			}

			if (input.lateralInputZ !== 0) {
				lateralAccelZ = input.lateralInputZ * rcsLateralAccelMs2;
				desiredPitchRad = input.lateralInputZ * maxTiltRad * 0.7;
			} else {
				lateralAccelZ = THREE.MathUtils.clamp(-input.velZ * 0.85, -1.5, 1.5);
			}
		}

		let forceX = 0;
		let forceY = 0;
		let forceZ = 0;
		let throttleRatio = 0;
		let activeThrustKn = 0;

		if (input.isIgnited && input.fuelPct > 0) {
			// Real upward acceleration ceiling decreases with higher vehicle mass and rises as fuel burns
			const maxUpwardAccel = profile.maxThrustN / currentMassKg;
			const minUpwardAccel = Math.min(0.1 * maxUpwardAccel, 0.25 * gMoon);
			const clampedUpAccel = THREE.MathUtils.clamp(
				verticalAccelCmd,
				minUpwardAccel,
				maxUpwardAccel
			);

			throttleRatio = clampedUpAccel / maxUpwardAccel;
			activeThrustKn = (throttleRatio * profile.maxThrustN) / 1000;

			// Apply exact real acceleration a = F_real / m(t) to the Rapier rigid body
			forceX = lateralAccelX * rapierBodyMassKg;
			forceY = clampedUpAccel * rapierBodyMassKg;
			forceZ = lateralAccelZ * rapierBodyMassKg;
		}

		const gateWorldY = LunarLandingConfig.scale.gateWorldY;
		const startWorldY =
			LunarLandingConfig.spawnOffset[1] - LunarLandingConfig.lander.touchdownFootY;
		const highRatio =
			input.footHeight <= gateWorldY
				? 0
				: Math.min(1, (input.footHeight - gateWorldY) / (startWorldY - gateWorldY));

		const worldHorizSpeed = Math.hypot(input.velX, input.velZ);
		const realHorizontalVelMs =
			worldHorizSpeed +
			highRatio * highRatio * (profile.pdiHorizontalVelMs - profile.lowGateHorizontalVelMs);
		const realVerticalVelMs = input.velY * (1 + highRatio * 4.5);

		return {
			shouldAutoIgnite,
			forceX,
			forceY,
			forceZ,
			throttleRatio,
			desiredRollRad,
			desiredPitchRad,
			guidancePhaseName: activePhase.name,
			realAltitudeM,
			realVerticalVelMs,
			realHorizontalVelMs,
			triggerHdaScan,
			currentMassKg,
			propellantRemainingKg,
			activeThrustKn,
			lunarTwr
		};
	}

	evaluateTouchdown(
		style: LandingStyleId,
		padOffsetM: number,
		impactVertSpeed: number,
		impactHorizSpeed: number,
		tiltDeg: number
	): TouchdownResult {
		const limits = this.getProfile(style).touchdownLimits;
		const failures: string[] = [];

		if (impactVertSpeed > limits.maxVerticalSpeedMs) {
			failures.push(`Sink ${impactVertSpeed.toFixed(1)} > ${limits.maxVerticalSpeedMs} m/s`);
		}
		if (impactHorizSpeed > limits.maxHorizontalSpeedMs) {
			failures.push(`Drift ${impactHorizSpeed.toFixed(1)} > ${limits.maxHorizontalSpeedMs} m/s`);
		}
		if (tiltDeg > limits.maxTiltDeg) {
			failures.push(`Tilt ${tiltDeg.toFixed(1)}° > ${limits.maxTiltDeg}°`);
		}
		if (padOffsetM > limits.maxPadOffsetM) {
			failures.push(`Off-pad ${padOffsetM.toFixed(1)} > ${limits.maxPadOffsetM} m`);
		}

		return { success: failures.length === 0, failures };
	}
}

export const descentGuidance = new DescentGuidance();
