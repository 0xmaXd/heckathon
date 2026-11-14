export type DockState = 'DOCKED' | 'UNDOCKING' | 'UNDOCKED' | 'DOCKING';

export const launchState = $state({
	dockState: 'DOCKED' as DockState,
	isIgnited: false,
	isLaunched: false,
	altitudeKm: 0,
	currentLayer: 'Troposphere',
	isBlackout: false
});
