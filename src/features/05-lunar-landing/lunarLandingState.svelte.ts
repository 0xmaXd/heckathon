import sitesData from '#lib/assets/data/nasa/lunar_sites.json';

export type LandingStyleId = 'apollo' | 'artemis';
export type LandingControlMode = 'auto' | 'manual-assisted';
export type LandingOutcome = 'descending' | 'landed' | 'crashed';

export const lunarLandingState = $state({
	siteIndex: 0,
	siteName: sitesData.sites[0].name,
	style: 'artemis' as LandingStyleId,
	controlMode: 'auto' as LandingControlMode,
	isIgnited: false,
	throttlePct: 0,
	fuelPct: 100,
	altitudeM: 15000,
	verticalVelMs: 0,
	horizontalVelMs: 0,
	tiltDeg: 0,
	guidancePhase: 'TRN // Powered Descent',
	outcome: 'descending' as LandingOutcome,
	failureReason: ''
});

export function resetLunarLandingState(
	style: LandingStyleId = lunarLandingState.style,
	siteIndex: number = lunarLandingState.siteIndex
) {
	const site = sitesData.sites[siteIndex] ?? sitesData.sites[0];
	lunarLandingState.siteIndex = siteIndex;
	lunarLandingState.siteName = site.name;
	lunarLandingState.style = style;
	lunarLandingState.controlMode = 'auto';
	lunarLandingState.isIgnited = false;
	lunarLandingState.throttlePct = 0;
	lunarLandingState.fuelPct = 100;
	lunarLandingState.altitudeM = style === 'apollo' ? 15240 : 15000;
	lunarLandingState.verticalVelMs = 0;
	lunarLandingState.horizontalVelMs = style === 'apollo' ? 1695 : 1692;
	lunarLandingState.tiltDeg = 0;
	lunarLandingState.guidancePhase =
		style === 'apollo' ? 'P63 // Braking Phase' : 'TRN // Powered Descent';
	lunarLandingState.outcome = 'descending';
	lunarLandingState.failureReason = '';
}
