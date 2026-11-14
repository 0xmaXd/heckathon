<script lang="ts">
	import { onMount } from 'svelte';
	import { physicsWorld } from '../core/engine/PhysicsWorld';
	import { sceneManager } from '../core/engine/SceneManager';
	import { missionStore } from '../core/state/missionStore.svelte';
	import LaunchRoomHUD from '../features/02-earth-launch-room/LaunchRoomHUD.svelte';
	import LockerRoomHUD from '../features/01-earth-locker-room/LockerRoomHUD.svelte';

	let canvasElement: HTMLCanvasElement;

	// Svelte 5 reactivity fix: directly track the primitive phase value
	$effect(() => {
		const activePhase = missionStore.currentPhase;
		// We use setTimeout to ensure this runs after the sceneManager is fully mounted
		setTimeout(() => {
			sceneManager.switchScene(activePhase);
		}, 0);
	});

	onMount(async () => {
		sceneManager.init(canvasElement);
		await physicsWorld.init();

		const loop = () => {
			physicsWorld.step();
			sceneManager.render();
			requestAnimationFrame(loop);
		};
		loop();
	});
</script>

<canvas id="game-canvas" bind:this={canvasElement}></canvas>

<div id="hud-layer">
	{#if missionStore.currentPhase === 1}
		<LockerRoomHUD />
	{:else if missionStore.currentPhase === 2}
		<LaunchRoomHUD />
	{:else}
		<div class="hud-container">
			<h2>Phase {missionStore.currentPhase}</h2>
		</div>
	{/if}
</div>

<style>
	.hud-container {
		padding: 2rem;
		pointer-events: auto;
	}
</style>
