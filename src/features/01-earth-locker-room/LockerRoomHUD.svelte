<script lang="ts">
	import { missionStore } from '../../core/state/missionStore.svelte';
	import { LockerConfig } from './locker.config';
	import { npcGuides } from './NpcGuides';

	let itemsCollected = $state<string[]>([]);
	let activeDialogue = $state<string | null>(null);

	function collectItem(item: string) {
		if (!itemsCollected.includes(item)) {
			itemsCollected.push(item);
		}

		// Check if we are cleared for the next phase
		if (npcGuides.checkInspectionComplete(itemsCollected)) {
			missionStore.flags.suitInspected = true;
		}
	}

	function talkTo(npc: 1 | 2) {
		activeDialogue = npc === 1 ? npcGuides.interactWithNpc1() : npcGuides.interactWithNpc2();
	}
</script>

<div class="locker-hud panel">
	<h2>Earth Locker Room</h2>
	<div class="telemetry">
		<p>Water Tank: {missionStore.resources.waterLiters}L</p>
		<p>Power Supply: {missionStore.resources.powerWatts}W</p>
	</div>

	<div class="npc-interaction">
		<button onclick={() => talkTo(1)}>Commander (Ship Stats)</button>
		<button onclick={() => talkTo(2)}>Quartermaster (Suit)</button>

		{#if activeDialogue}
			<p class="dialogue-box">"{activeDialogue}"</p>
		{/if}
	</div>

	<div class="checklist">
		<h3>Suit Inspection</h3>
		<ul>
			<!-- FIX: Removed the unused 'i' variable and used 'item' as the unique key -->
			{#each LockerConfig.requiredItems as item (item)}
				<li>
					<span class="status-indicator" class:ready={itemsCollected.includes(item)}></span>
					{item.replace('_', ' ').toUpperCase()}
					{#if !itemsCollected.includes(item)}
						<button class="sm-btn" onclick={() => collectItem(item)}>Equip</button>
					{/if}
				</li>
			{/each}
		</ul>
	</div>

	{#if missionStore.flags.suitInspected}
		<button class="launch-btn" onclick={() => missionStore.advancePhase()}>
			Proceed to Cockpit Launch
		</button>
	{/if}
</div>

<style>
	.panel {
		background: rgba(10, 15, 30, 0.85);
		border: 1px solid #1f4b8e;
		border-radius: 8px;
		padding: 1.5rem;
		width: 350px;
		margin: 2rem;
		backdrop-filter: blur(4px);
	}

	h2,
	h3 {
		margin-top: 0;
		color: #4da6ff;
	}

	.telemetry {
		font-family: monospace;
		color: #aaccff;
		margin-bottom: 1.5rem;
	}

	.dialogue-box {
		font-style: italic;
		color: #cca300;
		border-left: 2px solid #cca300;
		padding-left: 0.5rem;
		margin-top: 1rem;
	}

	ul {
		list-style: none;
		padding: 0;
	}

	li {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
		font-size: 0.9rem;
	}

	.status-indicator {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #ff4d4d;
	}

	.status-indicator.ready {
		background: #28a745;
	}

	button {
		background: #1f4b8e;
		color: white;
		border: none;
		padding: 0.5rem 1rem;
		border-radius: 4px;
		cursor: pointer;
		margin-right: 0.5rem;
	}

	button:hover {
		background: #3366cc;
	}

	.sm-btn {
		padding: 0.2rem 0.5rem;
		font-size: 0.8rem;
		margin-left: auto;
	}

	.launch-btn {
		width: 100%;
		background: #28a745;
		margin-top: 1.5rem;
		font-weight: bold;
		font-size: 1.1rem;
	}

	.launch-btn:hover {
		background: #34ce57;
	}
</style>
