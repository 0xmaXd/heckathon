<script lang="ts">
	import { launchRoomScene } from './LaunchRoomScene';
	import { launchState } from './launchState.svelte';
</script>

{#if launchState.isBlackout}
	<div class="blackout-screen">
		<p class="transition-text">ATMOSPHERIC EXIT COMPLETE — ENTERING ORBIT...</p>
	</div>
{/if}

<div class="panel">
	<h2>Launch Control</h2>

	<div class="telemetry">
		<p>GANTRY DOCK: <strong>{launchState.dockState}</strong></p>
		<p>ALTITUDE: <strong>{launchState.altitudeKm} km</strong></p>
		<p>ATMOSPHERE: <strong>{launchState.currentLayer.toUpperCase()}</strong></p>
	</div>

	<div class="controls">
		<div class="dock-row">
			<button
				type="button"
				onclick={() => launchRoomScene.undockGantry()}
				disabled={launchState.isIgnited ||
					launchState.dockState === 'UNDOCKED' ||
					launchState.dockState === 'UNDOCKING'}
			>
				Undock Gantry
			</button>

			<button
				type="button"
				onclick={() => launchRoomScene.dockGantry()}
				disabled={launchState.isIgnited ||
					launchState.dockState === 'DOCKED' ||
					launchState.dockState === 'DOCKING'}
			>
				Re-Dock
			</button>
		</div>

		<button
			type="button"
			onclick={() => launchRoomScene.igniteEngines()}
			disabled={launchState.dockState !== 'UNDOCKED' || launchState.isIgnited}
		>
			2. Ignite Main Engines
		</button>

		<button
			type="button"
			class="liftoff-btn"
			onclick={() => launchRoomScene.releaseClampsAndLaunch()}
			disabled={!launchState.isIgnited || launchState.isLaunched}
		>
			3. Release Clamps & Liftoff
		</button>
	</div>
</div>

<style>
	.blackout-screen {
		position: fixed;
		inset: 0;
		background: #000000;
		z-index: 50;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: auto;
	}

	.transition-text {
		color: #4da6ff;
		font-family: monospace;
		font-size: 1.2rem;
		letter-spacing: 2px;
	}

	.panel {
		position: relative;
		z-index: 20;
		background: rgba(10, 15, 30, 0.85);
		border: 1px solid #1f4b8e;
		border-radius: 8px;
		padding: 1.5rem;
		width: 350px;
		margin: 2rem;
		backdrop-filter: blur(4px);
		pointer-events: auto;
	}

	h2 {
		margin-top: 0;
		color: #4da6ff;
	}

	.telemetry {
		font-family: monospace;
		color: #aaccff;
		background: rgba(0, 0, 0, 0.4);
		padding: 0.75rem;
		border-radius: 4px;
		margin-bottom: 1.5rem;
	}

	.telemetry p {
		margin: 0.35rem 0;
	}

	.controls {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.dock-row {
		display: flex;
		gap: 0.5rem;
	}

	button {
		width: 100%;
		background: #1f4b8e;
		color: white;
		border: none;
		padding: 0.75rem;
		border-radius: 4px;
		cursor: pointer;
		font-weight: bold;
		font-size: 0.95rem;
		transition: background 0.2s;
	}

	button:hover:not(:disabled) {
		background: #3366cc;
	}

	button:disabled {
		background: #2a2f3a;
		color: #666;
		cursor: not-allowed;
	}

	.liftoff-btn:not(:disabled) {
		background: #cc3333;
	}

	.liftoff-btn:hover:not(:disabled) {
		background: #e63939;
	}
</style>
