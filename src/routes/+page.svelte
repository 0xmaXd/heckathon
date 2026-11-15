<script lang="ts">
	import { onMount } from 'svelte';
	import { GameConfig } from '../config/game.config';
	import { physicsWorld } from '../core/engine/PhysicsWorld';
	import { sceneManager } from '../core/engine/SceneManager';
	import GameHUD from '../core/hud/GameHUD.svelte';
	import { playerController } from '../core/player/PlayerController.svelte';
	import { missionStore } from '../core/state/missionStore.svelte';

	import { lockerRoomScene } from '../features/01-earth-locker-room/LockerRoomScene';
	import { launchRoomScene } from '../features/02-earth-launch-room/LaunchRoomScene';
	import { lunarLandingScene } from '../features/05-lunar-landing/LunarLandingScene';
	import { lunarOutpostScene } from '../features/06-lunar-outpost/LunarOutpostScene';

	let canvasElement: HTMLCanvasElement;

	sceneManager.registerScene(1, lockerRoomScene);
	sceneManager.registerScene(2, launchRoomScene);
	sceneManager.registerScene(5, lunarLandingScene);
	sceneManager.registerScene(6, lunarOutpostScene);

	function handleDebugKeyDown(event: KeyboardEvent) {
		if (!import.meta.env.DEV || !GameConfig.debug.enablePhaseJump) return;
		if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;

		const target = event.target as HTMLElement | null;
		if (
			target &&
			(target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
		) {
			return;
		}

		const match = /^(?:Digit|Numpad)([1-9])$/.exec(event.code);
		if (!match) return;

		const targetPhase = Number(match[1]);
		if (!sceneManager.hasScene(targetPhase)) return;

		event.preventDefault();

		if (missionStore.currentPhase === targetPhase) {
			sceneManager.switchScene(targetPhase);
		} else {
			missionStore.currentPhase = targetPhase;
		}
	}

	$effect(() => {
		const activePhase = sceneManager.switchScene(missionStore.currentPhase);
		if (activePhase !== missionStore.currentPhase) {
			missionStore.currentPhase = activePhase;
		}
	});

	onMount(() => {
		let frameId: number;

		const start = async () => {
			await physicsWorld.init();
			sceneManager.init(canvasElement);
			playerController.attachCanvas(canvasElement);
			sceneManager.setCameraController(playerController);

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
			playerController.dispose();
			sceneManager.dispose();
		};
	});
</script>

<svelte:window onkeydown={handleDebugKeyDown} />

<canvas id="game-canvas" bind:this={canvasElement}></canvas>
<GameHUD />
