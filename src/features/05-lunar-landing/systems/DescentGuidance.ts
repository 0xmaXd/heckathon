import * as THREE from 'three';
import { LunarLandingConfig } from '../lunar-landing.config';
import type { LandingControlMode, LandingStyleId } from '../lunarLandingState.svelte';

// Physical constants (IAU / NIST)
const MU_MOON_M3_S2 = 4.9048695e12;
const R_MOON_M = 1_737_400;
const G_MOON_MS2 = 1.622;
const G0_EARTH_MS2 = 9.80665;

export interface OrionDescentProfile {
	id: LandingStyleId;
	label: string;
	vehicle: string;
	crewModuleMassKg: number;
	serviceModuleDryMassKg: number;
	dryMassKg: number;
	propellantMassKg: number;
	maxThrustN: number;
	specificImpulseS: number;
	dimensions: string;
	pdiAltitudeM: number;
	pdiHorizontalVelMs: number;
	highGateAltitudeM: number;
	lowGateAltitudeM: number;
	lowGateHorizontalVelMs: number;
	targetTouchdownVelMs: number;
	maxTiltDeg: number;
	hasHazardAvoidance: boolean;
	guidancePhases: { minAltitudeM: number; name: string }[];
	touchdownLimits: {
		maxVerticalSpeedMs: number;
		maxHorizontalSpeedMs: number;
		maxTiltDeg: number;
		maxPadOffsetM: number;
	};
}

/**
 * Real NASA Orion MPCV (Crew Module + European Service Module) engineering figures:
 * - CM Nominal Landed Dry Mass: 9,299 kg (20,500 lb)
 * - ESM Dry Mass: 6,184 kg (13,635 lb) -> Combined Dry Mass: 15,483 kg (34,135 lb)
 * - ESM Usable Propellant (MON-3 / MMH): 8,618 kg (19,000 lb) -> Total Initial Mass: 24,101 kg
 * - Propulsion: AJ10-190 OMS (26.69 kN) + 8x R-4D Aux (3.92 kN) + Descent Thruster Pack (28.19 kN) = 58.8 kN
 * - Vacuum Specific Impulse (Isp): 316 s (hypergolic MON-3 / MMH)
 * - Dimensions: 7.9 m height (CM 3.35 m + ESM 4.79 m) x 5.03 m diameter (18.9 m solar array span)
 */
const ORION_PROFILES: Record<LandingStyleId, OrionDescentProfile> = {
	'orion-trn': {
		id: 'orion-trn',
		label: 'ORION PRECISION TRN',
		vehicle: 'Orion MPCV (CM + ESM)',
		crewModuleMassKg: 9299,
		serviceModuleDryMassKg: 6184,
		dryMassKg: 15483,
		propellantMassKg: 8618,
		maxThrustN: 58800,
		specificImpulseS: 316,
		dimensions: '7.9 m H × 5.03 m Ø (18.9 m span)',
		pdiAltitudeM: 15000,
		pdiHorizontalVelMs: Number(Math.sqrt(MU_MOON_M3_S2 / (R_MOON_M + 15000)).toFixed(1)), // 1673.0 m/s
		highGateAltitudeM: 2200,
		lowGateAltitudeM: 150,
		lowGateHorizontalVelMs: 18.0,
		targetTouchdownVelMs: -0.75,
		maxTiltDeg: 6.0,
		hasHazardAvoidance: true,
		guidancePhases: [
			{ minAltitudeM: 2200, name: 'PDI // Orion Orbital Braking' },
			{ minAltitudeM: 150, name: 'TRN // Optical Approach Gate' },
			{ minAltitudeM: 25, name: 'HDA // LiDAR Pad Alignment' },
			{ minAltitudeM: 0, name: 'TVD // Orion Terminal Descent' }
		],
		touchdownLimits: {
			maxVerticalSpeedMs: 2.0,
			maxHorizontalSpeedMs: 0.6,
			maxTiltDeg: 5.0,
			maxPadOffsetM: 7.5
		}
	},
	orion: {
		id: 'orion',
		label: 'ORION NOMINAL GNC',
		vehicle: 'Orion MPCV (CM + ESM)',
		crewModuleMassKg: 9299,
		serviceModuleDryMassKg: 6184,
		dryMassKg: 15483,
		propellantMassKg: 8618,
		maxThrustN: 58800,
		specificImpulseS: 316,
		dimensions: '7.9 m H × 5.03 m Ø (18.9 m span)',
		pdiAltitudeM: 15000,
		pdiHorizontalVelMs: Number(Math.sqrt(MU_MOON_M3_S2 / (R_MOON_M + 15000)).toFixed(1)), // 1673.0 m/s
		highGateAltitudeM: 2400,
		lowGateAltitudeM: 160,
		lowGateHorizontalVelMs: 22.0,
		targetTouchdownVelMs: -0.9,
		maxTiltDeg: 7.5,
		hasHazardAvoidance: false,
		guidancePhases: [
			{ minAltitudeM: 2400, name: 'PDI // Orion Braking Burn' },
			{ minAltitudeM: 160, name: 'APP // Orion Pitch-Over Gate' },
			{ minAltitudeM: 0, name: 'TVD // Orion Vertical Touchdown' }
		],
		touchdownLimits: {
			maxVerticalSpeedMs: 2.2,
			maxHorizontalSpeedMs: 0.75,
			maxTiltDeg: 6.0,
			maxPadOffsetM: 8.5
		}
	}
};

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
	deltaVRemainingMs: number;
	massFlowKgs: number;
}

export interface TouchdownResult {
	success: boolean;
	failures: string[];
}

export class DescentGuidance {
	getProfile(style: LandingStyleId): OrionDescentProfile {
		return ORION_PROFILES[style] ?? ORION_PROFILES['orion-trn'];
	}

	computeMassStats(style: LandingStyleId, fuelPct: number) {
		const profile = this.getProfile(style);
		const clampedPct = THREE.MathUtils.clamp(fuelPct, 0, 100);
		const propellantRemainingKg = profile.propellantMassKg * (clampedPct / 100);
		const currentMassKg = profile.dryMassKg + propellantRemainingKg;
		const lunarWeightN = currentMassKg * G_MOON_MS2;
		const lunarTwr = profile.maxThrustN / lunarWeightN;

		// Tsiolkovsky Rocket Equation: Δv = Isp * g0 * ln(m_total / m_dry)
		const effectiveExhaustVelMs = profile.specificImpulseS * G0_EARTH_MS2;
		const deltaVRemainingMs =
			currentMassKg > profile.dryMassKg
				? effectiveExhaustVelMs * Math.log(currentMassKg / profile.dryMassKg)
				: 0;

		return {
			dryMassKg: profile.dryMassKg,
			propellantRemainingKg,
			currentMassKg,
			lunarTwr,
			deltaVRemainingMs
		};
	}

	computeMassFlowKgs(style: LandingStyleId, activeThrustN: number): number {
		if (activeThrustN <= 0) return 0;
		const profile = this.getProfile(style);
		// Rocket mass flow equation: m_dot = F / (Isp * g0)
		return activeThrustN / (profile.specificImpulseS * G0_EARTH_MS2);
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
		const rapierBodyMassKg = LunarLandingConfig.lander.massKg;
		const { rcsLateralAccelMs2, manualRateGain, manualMaxSinkAdjustMs } = LunarLandingConfig.lander;

		const { currentMassKg, propellantRemainingKg, lunarTwr, deltaVRemainingMs } =
			this.computeMassStats(input.style, input.fuelPct);

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

			verticalAccelCmd = G_MOON_MS2 + (targetSinkRate - input.velY) * 2.1;

			const errX = input.targetPadX - input.posX;
			const errZ = input.targetPadZ - input.posZ;
			const maxHorizSpeed = input.footHeight < 10 && profile.id === 'orion-trn' ? 1.8 : 4.8;

			const desiredVx = THREE.MathUtils.clamp(errX * 0.65, -maxHorizSpeed, maxHorizSpeed);
			const desiredVz = THREE.MathUtils.clamp(errZ * 0.65, -maxHorizSpeed, maxHorizSpeed);

			lateralAccelX = THREE.MathUtils.clamp((desiredVx - input.velX) * 1.6, -3.4, 3.4);
			lateralAccelZ = THREE.MathUtils.clamp((desiredVz - input.velZ) * 1.6, -3.4, 3.4);

			desiredRollRad = THREE.MathUtils.clamp(-lateralAccelX * 0.08, -maxTiltRad, maxTiltRad);
			desiredPitchRad = THREE.MathUtils.clamp(lateralAccelZ * 0.08, -maxTiltRad, maxTiltRad);
		} else {
			const baselineSinkRate = input.footHeight > 10 ? -2.0 : profile.targetTouchdownVelMs;
			const commandedSinkRate = baselineSinkRate + input.throttleInput * manualMaxSinkAdjustMs;
			verticalAccelCmd = G_MOON_MS2 + (commandedSinkRate - input.velY) * manualRateGain;

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
		let massFlowKgs = 0;

		if (input.isIgnited && input.fuelPct > 0) {
			const maxUpwardAccel = profile.maxThrustN / currentMassKg;
			const minUpwardAccel = Math.min(0.1 * maxUpwardAccel, 0.25 * G_MOON_MS2);
			const clampedUpAccel = THREE.MathUtils.clamp(
				verticalAccelCmd,
				minUpwardAccel,
				maxUpwardAccel
			);

			throttleRatio = clampedUpAccel / maxUpwardAccel;
			const activeThrustN = throttleRatio * profile.maxThrustN;
			activeThrustKn = activeThrustN / 1000;
			massFlowKgs = this.computeMassFlowKgs(input.style, activeThrustN);

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
			lunarTwr,
			deltaVRemainingMs,
			massFlowKgs
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
