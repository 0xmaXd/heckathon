<script lang="ts">
	import { lunarOutpostScene } from './LunarOutpostScene';
	import hudCopy from './lunar-outpost.hud.json';
	import { lunarOutpostStore } from './lunarOutpostStore.svelte';

	const hud = $derived(lunarOutpostStore.snapshot);
</script>

{#if hud}
	<div class="pointer-events-none fixed inset-0 z-20 font-sans text-slate-100 select-none">
		<!-- Top-Right Outpost Mission Checklist (positioned below GameHUD H2O/PWR bar) -->
		<div
			class="absolute top-24 right-4 w-[310px] rounded-xl border border-slate-700/80 bg-slate-900/85 p-4 shadow-xl backdrop-blur-md"
		>
			<div class="mb-2 flex items-center justify-between gap-2 text-[11px] text-slate-400">
				<span class="font-mono text-amber-300">
					☀ {hud.solar.phaseLabel} ({hud.solar.sunElevationDeg}°)
				</span>
				<span class="font-mono text-sky-300">Scanner: {hud.scannerPowerPct}%</span>
			</div>

			<div
				class="mb-2 flex items-center justify-between gap-2 text-xs font-bold tracking-wider text-slate-300 uppercase"
			>
				{#if hud.phase === 'briefing' || hud.phase === 'resupply'}
					<span>Supply Drop-Offs ({hud.cratesDelivered}/{hud.cratesRequired})</span>
					<span class="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[11px] text-amber-300">
						{hud.carryingCrateName ? 'BOX READY' : 'ANY BOX'}
					</span>
				{:else}
					<span>ISRU Samples ({hud.samplesAnalyzedCount}/6 Verified)</span>
				{/if}
			</div>

			{#if hud.phase === 'briefing' || hud.phase === 'resupply'}
				<div class="mb-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-800">
					<div
						class="h-full bg-amber-400 transition-all duration-300"
						style="width: {(hud.cratesDelivered / hud.cratesRequired) * 100}%"
					></div>
				</div>

				<div class="space-y-1.5 text-xs">
					{#each hud.dropOffZones as zone (zone.id)}
						<div class="flex items-center justify-between gap-3">
							<div>
								<span
									class={zone.delivered
										? 'font-medium text-emerald-400 line-through'
										: 'font-medium text-slate-100'}
								>
									{zone.label}
								</span>
								<span class="ml-1.5 text-[11px] text-slate-400">• {zone.shortHint}</span>
							</div>
							<span
								class={zone.delivered
									? 'rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300'
									: 'rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[11px] text-amber-300'}
							>
								{zone.delivered ? 'DELIVERED ✓' : 'DROP OFF'}
							</span>
						</div>
					{/each}
				</div>

				<p class="mt-2.5 border-t border-slate-800 pt-2 text-[11px] leading-snug text-slate-300">
					{#if hud.carryingCrateName}
						Carrying <strong class="text-amber-300">{hud.carryingCrateName}</strong> — go to any
						<span class="text-amber-300">DROP OFF</span> ring & press <strong>[F]</strong>.
					{:else}
						Pick up any box (<strong>[F]</strong>) and drop it inside all 5 rings.
					{/if}
				</p>
			{:else}
				<div class="space-y-1.5 text-xs">
					{#each hud.samples as s (s.id)}
						<div class="flex items-center justify-between gap-2">
							<span
								class={s.analyzed
									? 'text-emerald-400 line-through'
									: s.collected
										? 'text-amber-300'
										: 'text-slate-300'}
							>
								{s.title}
							</span>
							<span class="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[11px]">
								{s.analyzed ? 'VERIFIED' : s.collected ? 'AT LAB' : s.category}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Leo Solar Dust Maintenance Alert -->
		{#if hud.maintenanceAlert.active}
			<div
				class="absolute top-24 left-1/2 max-w-md -translate-x-1/2 rounded-xl border border-amber-400 bg-amber-950/90 px-4 py-2.5 text-center text-xs text-amber-100 shadow-lg"
			>
				<div class="font-bold text-amber-300">{hud.maintenanceAlert.title}</div>
				<div>Dusty Solar Panels Remaining: {hud.maintenanceAlert.dustyPanelsRemaining}</div>
			</div>
		{/if}

		<!-- Interactive Suit-to-Suit NPC Conversation Modal -->
		{#if hud.npcComms?.activeTurn}
			{@const turn = hud.npcComms.activeTurn}
			<div class="pointer-events-auto fixed inset-x-0 bottom-16 z-30 flex justify-center px-4">
				<div
					class="w-full max-w-2xl rounded-2xl border-2 border-cyan-400/80 bg-slate-900/95 p-5 shadow-2xl backdrop-blur-md"
				>
					<div class="mb-2 flex items-center justify-between">
						<span class="text-xs font-bold tracking-widest text-cyan-400 uppercase">
							Suit-to-Suit Comms • Room 07 Channel
						</span>
						<button
							type="button"
							onclick={() => lunarOutpostScene.closeNpcDialogue()}
							class="cursor-pointer rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700"
						>
							[ESC] Close
						</button>
					</div>

					<div class="mb-1 text-base font-bold text-amber-300">{turn.speaker}</div>
					<p class="mb-3 text-sm leading-relaxed text-slate-100">"{turn.text}"</p>

					{#if turn.companionInterjection}
						<div
							class="mb-4 rounded-lg border border-slate-700/80 bg-slate-800/80 px-3 py-2 text-xs"
						>
							<span class="font-bold text-sky-300">{turn.companionInterjection.speaker}:</span>
							<span class="text-slate-200"> "{turn.companionInterjection.text}"</span>
						</div>
					{/if}

					<div class="space-y-2">
						{#each turn.choices as choice, idx (choice.id)}
							<button
								type="button"
								onclick={() => lunarOutpostScene.selectNpcDialogueChoice(choice.id)}
								class="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-slate-700 bg-slate-800/90 px-4 py-2.5 text-left text-xs font-medium text-slate-100 transition hover:border-cyan-400 hover:bg-slate-800"
							>
								<span class="rounded bg-cyan-500/20 px-2 py-0.5 font-mono text-cyan-300">
									{idx + 1}
								</span>
								<span>{choice.label}</span>
							</button>
						{/each}
					</div>
				</div>
			</div>
		{/if}

		<!-- NASA Discovery Card Modal -->
		{#if hud.activeDiscoveryCard}
			<div
				class="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
			>
				<div
					class="w-full max-w-lg rounded-2xl border-2 border-sky-400 bg-slate-900 p-6 shadow-2xl"
				>
					<div class="mb-1 text-xs font-bold tracking-widest text-sky-400 uppercase">
						NASA ISRU Discovery Card • {hud.activeDiscoveryCard.category} ({hud.activeDiscoveryCard
							.formula})
					</div>
					<h2 class="mb-2 text-2xl font-bold text-white">{hud.activeDiscoveryCard.title}</h2>
					<div class="mb-3 text-sm font-semibold text-amber-300">
						{hud.activeDiscoveryCard.headline}
					</div>
					<p class="mb-3 text-sm leading-relaxed text-slate-200">
						{hud.activeDiscoveryCard.nasaFact}
					</p>
					<div class="mb-5 rounded-lg bg-slate-800/90 p-3 text-xs text-sky-200">
						<strong>Artemis Moon Base Use:</strong>
						{hud.activeDiscoveryCard.artemisUse}
					</div>
					<button
						type="button"
						onclick={() => lunarOutpostScene.dismissDiscoveryCard()}
						class="w-full cursor-pointer rounded-xl bg-sky-500 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-sky-400"
					>
						Continue Exploration
					</button>
				</div>
			</div>
		{/if}

		<!-- Finale NASA Junior Planetary Geologist Certificate -->
		{#if hud.phase === 'launched'}
			<div
				class="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md"
			>
				<div
					class="w-full max-w-xl rounded-2xl border-2 border-amber-400 bg-gradient-to-b from-slate-900 to-slate-950 p-8 text-center shadow-2xl"
				>
					<div class="mb-2 text-xs font-bold tracking-[0.25em] text-amber-400 uppercase">
						Official Mission Commendation
					</div>
					<h1 class="mb-2 text-3xl font-extrabold text-white">{hudCopy.certificate.title}</h1>
					<div class="mb-4 text-sm text-sky-300">{hudCopy.certificate.subtitle}</div>
					<p class="mb-6 text-sm leading-relaxed text-slate-200">{hudCopy.certificate.citation}</p>
					<div
						class="grid grid-cols-2 gap-2 rounded-xl border border-slate-700 bg-slate-900/90 p-4 text-left text-xs"
					>
						{#each hud.samples as s (s.id)}
							<div class="text-emerald-400">✓ {s.title}</div>
						{/each}
					</div>
					<button
						type="button"
						onclick={() => lunarOutpostScene.restartMission()}
						class="mt-6 w-full cursor-pointer rounded-xl bg-amber-400 py-3 text-sm font-extrabold tracking-wide text-slate-950 uppercase transition hover:bg-amber-300"
					>
						Restart Mission at Orion Outpost
					</button>
				</div>
			</div>
		{/if}
	</div>
{/if}
