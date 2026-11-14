export type DockState = 'DOCKED' | 'UNDOCKING' | 'UNDOCKED' | 'DOCKING';

export const launchState = $state({
	dockState: 'DOCKED' as DockState,
	isIgnited: false,
	isLaunched: false,
	altitudeKm: 0,
	currentLayer: 'Troposphere',
	isBlackout: false
});

export function resetLaunchState() {
	launchState.dockState = 'DOCKED';
	launchState.isIgnited = false;
	launchState.isLaunched = false;
	launchState.altitudeKm = 0;
	launchState.currentLayer = 'Troposphere';
	launchState.isBlackout = false;
}
