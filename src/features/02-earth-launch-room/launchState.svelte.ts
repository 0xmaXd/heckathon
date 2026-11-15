export type DockState = 'DOCKED' | 'UNDOCKING' | 'UNDOCKED' | 'DOCKING';

export const launchState = $state({
	dockState: 'DOCKED' as DockState,
	isIgnited: false,
	isLaunched: false,
	boostersDetached: false,
	isBoosterQtePaused: false,
	altitudeKm: 0,
	currentLayer: 'Troposphere',
	isBlackout: false,
	nasaApiKeyConfigured: false,
	issStatusText: 'CHECKING .env...'
});

export function resetLaunchState() {
	launchState.dockState = 'DOCKED';
	launchState.isIgnited = false;
	launchState.isLaunched = false;
	launchState.boostersDetached = false;
	launchState.isBoosterQtePaused = false;
	launchState.altitudeKm = 0;
	launchState.currentLayer = 'Troposphere';
	launchState.isBlackout = false;
}
