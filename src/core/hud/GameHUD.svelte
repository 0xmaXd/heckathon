<script lang="ts">
	import { missionStore } from '../state/missionStore.svelte';
	import { sceneManager } from '../engine/SceneManager';
	import { hudStore, type HudAction } from './hudStore.svelte';
	import { playerController } from '../player/PlayerController.svelte';

	let inspectPanelWidth = $state(290);
	let inspectPanelHeight = $state(210);
	let showFps = $state(false);
	let currentFps = $state(0);

	function isActionDisabled(action: HudAction): boolean {
		return typeof action.disabled === 'function' ? action.disabled() : Boolean(action.disabled);
	}

	function handleMouseDown(event: MouseEvent) {
		// Only trigger inspection on Middle Mouse Button (button === 1)
		if (event.button !== 1) return;

		if ((event.target as HTMLElement)?.closest('.scene-panel, .inspect-panel, .top-bar')) {
			return;
		}

		// Prevent Linux X11 clipboard paste / browser auto-scroll on middle click
		event.preventDefault();

		// Raycast from the center screen dot (NDC 0, 0)
		const hit = sceneManager.pickObject(0, 0);
		hudStore.inspectThreeObject(hit, sceneManager.getCameraPosition());
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.code === 'Backquote' || event.code === 'F9') {
			event.preventDefault();
			showFps = !showFps;
			if (showFps) currentFps = sceneManager.getFps();
			return;
		}

		if (event.key === 'Escape' && hudStore.inspectedObject) {
			hudStore.clearInspection();
		}
	}

	const telemetryEntries = $derived(Object.entries(hudStore.telemetry));
	const hasScenePanel = $derived(
		Boolean(hudStore.panelTitle) ||
			telemetryEntries.length > 0 ||
			hudStore.actions.length > 0 ||
			Boolean(hudStore.customWidget)
	);

	// Highlight center dot on hover; update tracked screen placement & auto-dismiss if reticle leaves object
	$effect(() => {
		let frameId: number;

		const updateHudTracking = () => {
			const centerHit = sceneManager.pickObject(0, 0);
			hudStore.updateReticleTarget(centerHit);

			if (hudStore.inspectedObject) {
				const camPos = sceneManager.getCameraPosition();
				if (camPos) {
					hudStore.updateInspectionTracking(
						camPos,
						(pos, out) => sceneManager.projectWorldPoint(pos, out),
						inspectPanelWidth,
						inspectPanelHeight,
						hasScenePanel,
						Boolean(hudStore.rightPanel)
					);
				}
			}
			if (showFps) {
				currentFps = sceneManager.getFps();
			}

			frameId = requestAnimationFrame(updateHudTracking);
		};

		frameId = requestAnimationFrame(updateHudTracking);
		return () => cancelAnimationFrame(frameId);
	});

	// Connector line start point on the nearest edge of the inspect card
	const lineStart = $derived.by(() => {
		const p = hudStore.inspectPlacement;
		if (!p || !p.visible) return null;

		const x = Math.max(p.x, Math.min(p.x + inspectPanelWidth, p.anchorX));
		const y = Math.max(p.y, Math.min(p.y + inspectPanelHeight, p.anchorY));
		return { x, y };
	});
</script>

<svelte:window onmousedown={handleMouseDown} onkeydown={handleKeyDown} />

{#if hudStore.blackout.active}
	<div class="blackout-screen">
		{#if hudStore.blackout.message}
			<p class="transition-text">{hudStore.blackout.message}</p>
		{/if}
	</div>
{/if}

<div class="hud-root">
	<!-- COMPULSORY: Top Status Bar -->
	<header class="top-bar">
		<div class="mission-box">
			<span class="phase-tag">PHASE 0{missionStore.currentPhase}</span>
			<div class="mission-meta">
				<strong>{hudStore.location}</strong>
				<span class="objective">{hudStore.objective}</span>
			</div>
		</div>

		<div class="vitals-box">
			<div class="vital">
				<span class="label">H2O</span>
				<span class="value">{missionStore.resources.waterLiters}L</span>
			</div>
			<div class="vital">
				<span class="label">PWR</span>
				<span class="value">{missionStore.resources.powerWatts}W</span>
			</div>
		</div>
	</header>

	{#if showFps}
		<div class="fps-badge">
			FPS: <strong>{currentFps}</strong>
		</div>
	{/if}

	<!-- COMPULSORY: Center Screen Dot (highlights only when aiming at an inspectable object) -->
	<div class="center-reticle">
		<div class="dot" class:locked={hudStore.canInspectTarget}></div>

		{#if hudStore.interactionPrompt}
			<div class="interact-prompt">
				<kbd>{hudStore.interactionPrompt.key}</kbd>
				<span>{hudStore.interactionPrompt.label}</span>
			</div>
		{/if}
	</div>

	<!-- SCENE-SPECIFIC: Left Telemetry & Controls Panel -->
	{#if hasScenePanel}
		<aside class="scene-panel">
			{#if hudStore.panelTitle}
				<h2>{hudStore.panelTitle}</h2>
			{/if}

			{#if telemetryEntries.length > 0}
				<div class="telemetry">
					{#each telemetryEntries as [key, value] (key)}
						<p>
							<span>{key}:</span>
							<strong>{value}</strong>
						</p>
					{/each}
				</div>
			{/if}

			{#if hudStore.customWidget}
				<div class="custom-widget">
					{@render hudStore.customWidget()}
				</div>
			{/if}

			{#if hudStore.actions.length > 0}
				<div class="controls">
					{#each hudStore.actions as action (action.id)}
						<button
							type="button"
							class={action.variant ?? 'default'}
							disabled={isActionDisabled(action)}
							onclick={action.onClick}
						>
							{action.label}
						</button>
					{/each}
				</div>
			{/if}
		</aside>
	{/if}

	{#if hudStore.rightPanel}
		<aside class="right-panel">
			<h2>{hudStore.rightPanel.title}</h2>
			{#if hudStore.rightPanel.subtitle}
				<p class="right-subtitle">{hudStore.rightPanel.subtitle}</p>
			{/if}

			<div class="telemetry">
				{#each Object.entries(hudStore.rightPanel.telemetry) as [key, value] (key)}
					<p>
						<span>{key}:</span>
						<strong>{value}</strong>
					</p>
				{/each}
			</div>
		</aside>
	{/if}

	<!-- COMPULSORY: Tracked Object Scanner Card (triggered by Middle Mouse Button) -->
	{#if hudStore.inspectedObject && hudStore.inspectPlacement?.visible}
		{#if lineStart}
			<svg class="tether-layer" aria-hidden="true">
				<line
					x1={lineStart.x}
					y1={lineStart.y}
					x2={hudStore.inspectPlacement.anchorX}
					y2={hudStore.inspectPlacement.anchorY}
					stroke="rgba(77, 166, 255, 0.7)"
					stroke-width="1.5"
					stroke-dasharray="4 3"
				/>
				<circle
					cx={hudStore.inspectPlacement.anchorX}
					cy={hudStore.inspectPlacement.anchorY}
					r="3.5"
					fill="#4da6ff"
				/>
			</svg>
		{/if}

		<aside
			class="inspect-panel"
			style="left: {hudStore.inspectPlacement.x}px; top: {hudStore.inspectPlacement.y}px;"
			bind:clientWidth={inspectPanelWidth}
			bind:clientHeight={inspectPanelHeight}
		>
			<div class="inspect-header">
				<span class="scan-tag">OBJECT SCAN</span>
				<h3>{hudStore.inspectedObject.name}</h3>
			</div>

			{#if hudStore.inspectedObject.category}
				<p class="category">{hudStore.inspectedObject.category}</p>
			{/if}

			<p class="description">
				{hudStore.inspectedObject.description ?? 'No additional telemetry recorded.'}
			</p>

			{#if hudStore.inspectedObject.specs}
				<div class="telemetry">
					{#each Object.entries(hudStore.inspectedObject.specs) as [key, val] (key)}
						<p>
							<span>{key}:</span>
							<strong>{val}</strong>
						</p>
					{/each}
				</div>
			{/if}

			<p class="dismiss-hint">Look away or press <kbd>ESC</kbd> to close</p>
		</aside>
	{/if}

	<!-- COMPULSORY: Bottom Comms / Subtitle Bar -->
	{#if hudStore.commsMessage}
		<div class="comms-bar">
			<p>{hudStore.commsMessage}</p>
		</div>
	{/if}

	{#if playerController.isActive}
		<div class="fp-hint">
			{#if playerController.debugOrbitMode}
				<span>DEBUG ORBIT CAMERA • <kbd>F2</kbd> First-Person • <kbd>`</kbd> FPS</span>
			{:else if !playerController.isPointerLocked}
				<span
					>Click viewport to look • <kbd>WASD</kbd> Move • <kbd>F2</kbd> Orbit • <kbd>`</kbd> FPS</span
				>
			{:else}
				<span
					><kbd>WASD</kbd> Move • <kbd>Space</kbd> Jump • <kbd>MMB</kbd> Scan • <kbd>`</kbd> FPS •
					<kbd>ESC</kbd> Unlock</span
				>
			{/if}
		</div>
	{/if}
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

	.hud-root {
		position: fixed;
		inset: 0;
		z-index: 10;
		pointer-events: none;
		font-family:
			system-ui,
			-apple-system,
			sans-serif;
		color: #e6f0ff;
	}

	.tether-layer {
		position: fixed;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 15;
	}

	.top-bar {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		padding: 1.25rem 2rem;
	}

	.mission-box,
	.vitals-box {
		background: rgba(10, 15, 30, 0.82);
		border: 1px solid #1f4b8e;
		border-radius: 6px;
		padding: 0.65rem 1rem;
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		gap: 0.85rem;
		pointer-events: auto;
	}

	.phase-tag,
	.scan-tag {
		background: #1f4b8e;
		color: #ffffff;
		font-family: monospace;
		font-weight: bold;
		font-size: 0.7rem;
		padding: 0.2rem 0.45rem;
		border-radius: 4px;
		letter-spacing: 0.5px;
	}

	.mission-meta {
		display: flex;
		flex-direction: column;
		font-size: 0.85rem;
	}

	.objective {
		color: #8fb8ff;
		font-size: 0.8rem;
	}

	.vitals-box {
		font-family: monospace;
		gap: 1.25rem;
	}

	.vital {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
	}

	.vital .label {
		font-size: 0.7rem;
		color: #7da6e8;
	}

	.vital .value {
		font-size: 0.95rem;
		font-weight: bold;
		color: #4da6ff;
	}

	.center-reticle {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
	}

	.dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.65);
		transition:
			transform 0.15s ease,
			background-color 0.15s ease,
			box-shadow 0.15s ease;
	}

	.dot.locked {
		transform: scale(1.75);
		background: #4da6ff;
		box-shadow:
			0 0 0 3px rgba(77, 166, 255, 0.3),
			0 0 10px rgba(77, 166, 255, 0.8);
	}

	.interact-prompt {
		background: rgba(10, 15, 30, 0.9);
		border: 1px solid #4da6ff;
		padding: 0.35rem 0.75rem;
		border-radius: 4px;
		font-size: 0.85rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		white-space: nowrap;
	}

	kbd {
		background: #1f4b8e;
		padding: 0.1rem 0.4rem;
		border-radius: 3px;
		font-family: monospace;
		font-weight: bold;
	}

	.scene-panel {
		position: fixed;
		left: 2rem;
		top: 6rem;
		background: rgba(10, 15, 30, 0.85);
		border: 1px solid #1f4b8e;
		border-radius: 8px;
		padding: 1.25rem;
		width: 330px;
		backdrop-filter: blur(4px);
		pointer-events: auto;
	}

	.inspect-panel {
		position: fixed;
		z-index: 20;
		background: rgba(10, 15, 30, 0.92);
		border: 1px solid #4da6ff;
		border-radius: 8px;
		padding: 1.1rem;
		width: 290px;
		backdrop-filter: blur(6px);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
		pointer-events: auto;
	}

	.inspect-header {
		margin-bottom: 0.5rem;
	}

	h2 {
		margin: 0 0 1rem 0;
		font-size: 1.1rem;
		color: #4da6ff;
	}

	h3 {
		margin: 0.35rem 0 0 0;
		font-size: 1rem;
		color: #ffffff;
	}

	.category {
		font-family: monospace;
		font-size: 0.72rem;
		color: #cca300;
		text-transform: uppercase;
		margin: 0 0 0.45rem 0;
	}

	.description {
		font-size: 0.82rem;
		line-height: 1.4;
		color: #b8d4ff;
		margin: 0 0 0.75rem 0;
	}

	.dismiss-hint {
		margin: 0.6rem 0 0 0;
		font-size: 0.72rem;
		color: #7da6e8;
		text-align: right;
	}

	.telemetry {
		font-family: monospace;
		color: #aaccff;
		background: rgba(0, 0, 0, 0.4);
		padding: 0.65rem 0.75rem;
		border-radius: 4px;
		margin-bottom: 0.75rem;
	}

	.telemetry p {
		display: flex;
		justify-content: space-between;
		margin: 0.25rem 0;
		font-size: 0.8rem;
	}

	.controls {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	button {
		width: 100%;
		background: #1f4b8e;
		color: white;
		border: none;
		padding: 0.65rem 0.75rem;
		border-radius: 4px;
		cursor: pointer;
		font-weight: bold;
		font-size: 0.9rem;
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

	button.danger:not(:disabled) {
		background: #cc3333;
	}

	button.danger:hover:not(:disabled) {
		background: #e63939;
	}

	button.success:not(:disabled) {
		background: #28a745;
	}

	button.success:hover:not(:disabled) {
		background: #34ce57;
	}

	.comms-bar {
		position: fixed;
		bottom: 2rem;
		left: 50%;
		transform: translateX(-50%);
		background: rgba(10, 15, 30, 0.9);
		border-left: 3px solid #cca300;
		padding: 0.75rem 1.25rem;
		border-radius: 4px;
		max-width: 600px;
		font-size: 0.9rem;
		color: #f0d060;
	}

	.fp-hint {
		position: fixed;
		right: 2rem;
		bottom: 1.5rem;
		background: rgba(10, 15, 30, 0.82);
		border: 1px solid #1f4b8e;
		border-radius: 6px;
		padding: 0.45rem 0.85rem;
		font-size: 0.78rem;
		color: #8fb8ff;
		backdrop-filter: blur(4px);
	}

	.comms-bar p {
		margin: 0;
	}

	.right-panel {
		position: fixed;
		right: 2rem;
		top: 6rem;
		background: rgba(10, 15, 30, 0.85);
		border: 1px solid #1f4b8e;
		border-radius: 8px;
		padding: 1.25rem;
		width: 310px;
		backdrop-filter: blur(4px);
		pointer-events: auto;
	}

	.right-subtitle {
		margin: -0.65rem 0 0.85rem 0;
		font-family: monospace;
		font-size: 0.75rem;
		color: #cca300;
	}

	.fps-badge {
		position: fixed;
		right: 15.5rem;
		top: 1.45rem;
		background: rgba(10, 15, 30, 0.85);
		border: 1px solid #1f4b8e;
		border-radius: 4px;
		padding: 0.35rem 0.65rem;
		font-family: monospace;
		font-size: 0.8rem;
		color: #4da6ff;
	}
</style>
