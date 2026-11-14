<script lang="ts">
	import { onMount } from 'svelte';
	import { missionStore } from '../core/state/missionStore.svelte';
	import { sceneManager } from '../core/engine/SceneManager';
	import { physicsWorld } from '../core/engine/PhysicsWorld';
	import GameHUD from '../core/hud/GameHUD.svelte';

	import { lockerRoomScene } from '../features/01-earth-locker-room/LockerRoomScene';
	import { launchRoomScene } from '../features/02-earth-launch-room/LaunchRoomScene';

	let canvasElement: HTMLCanvasElement;

	sceneManager.registerScene(1, lockerRoomScene);
	sceneManager.registerScene(2, launchRoomScene);

	$effect(() => {
		sceneManager.switchScene(missionStore.currentPhase);
	});

	onMount(() => {
		let frameId: number;

		const start = async () => {
			sceneManager.init(canvasElement);
			await physicsWorld.init();

			const loop = () => {
				physicsWorld.step();
				sceneManager.render();
				frameId = requestAnimationFrame(loop);
			};
			frameId = requestAnimationFrame(loop);
		};

		start();

		return () => {
			cancelAnimationFrame(frameId);
			sceneManager.dispose();
		};
	});
</script>

<canvas id="game-canvas" bind:this={canvasElement}></canvas>
<GameHUD />
