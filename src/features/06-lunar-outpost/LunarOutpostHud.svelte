<script lang="ts">
	import { lunarOutpostScene } from './LunarOutpostScene';
	import hudCopy from './lunar-outpost.hud.json';
	import { lunarOutpostStore } from './lunarOutpostStore.svelte';

	const hud = $derived(lunarOutpostStore.snapshot);
</script>

{#if hud}
	<div class="pointer-events-none fixed inset-0 z-20 font-sans text-slate-100 select-none">
		<!-- Center First-Person Visor Reticle -->
		<div
			class="fixed top-1/2 left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-300/75 bg-sky-400/30"
		></div>

		<!-- Top Header & Mission Comms -->
		<div class="absolute top-4 right-4 left-4 flex flex-wrap items-start justify-between gap-4">
			<div
				class="max-w-xl rounded-xl border border-sky-400/30 bg-slate-900/85 p-4 shadow-xl backdrop-blur-md"
			>
				<div class="mb-1 flex flex-wrap items-center justify-between gap-2">
					<span class="text-xs font-bold tracking-widest text-sky-400 uppercase">
						{hudCopy.outpostName} • {hudCopy.locationLabel}
					</span>
					<div class="flex items-center gap-2">
						<span class="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-xs text-amber-200">
							☀ {hud.solar.phaseLabel} ({hud.solar.sunElevationDeg}°)
						</span>
						<span class="rounded bg-sky-500/20 px-2 py-0.5 font-mono text-xs text-sky-300">
							Scanner: {hud.scannerPowerPct}%
						</span>
					</div>
				</div>
				<div class="mb-1 text-sm font-semibold text-amber-300">{hud.speaker}</div>
				<p class="text-sm leading-relaxed text-slate-200">{hud.dialogue}</p>
			</div>

			<!-- Resupply & 6-Sample ISRU Checklist -->
			<div
				class="min-w-[270px] rounded-xl border border-slate-700/80 bg-slate-900/85 p-4 shadow-xl backdrop-blur-md"
			>
				<div class="mb-2 text-xs font-bold tracking-wider text-slate-400 uppercase">
					{#if hud.phase === 'resupply'}
						Challenge 1: Base Resupply ({hud.cratesDelivered}/{hud.cratesRequired})
					{:else}
						Lunar ISRU Samples ({hud.samplesAnalyzedCount}/6 Verified)
					{/if}
				</div>

				{#if hud.phase === 'resupply'}
					<div class="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
						<div
							class="h-full bg-amber-400 transition-all duration-300"
							style="width: {(hud.cratesDelivered / hud.cratesRequired) * 100}%"
						></div>
					</div>
					<p class="mt-2 text-xs text-slate-300">
						Haul crates via Orion Rover [E] or carry [F] to the orange drop ring near Storage Pod.
					</p>
				{:else}
					<div class="space-y-1.5 text-xs">
						{#each hud.samples as s}
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
		</div>

		<!-- Leo Solar Dust Maintenance Alert -->
		{#if hud.maintenanceAlert.active}
			<div
				class="absolute top-44 left-1/2 max-w-md -translate-x-1/2 rounded-xl border border-amber-400 bg-amber-950/90 px-4 py-2.5 text-center text-xs text-amber-100 shadow-lg"
			>
				<div class="font-bold text-amber-300">{hud.maintenanceAlert.title}</div>
				<div>Dusty Solar Panels Remaining: {hud.maintenanceAlert.dustyPanelsRemaining}</div>
			</div>
		{/if}

		<!-- Contextual Action Prompt -->
		{#if hud.actionPrompt}
			<div
				class="absolute bottom-20 left-1/2 -translate-x-1/2 rounded-full border border-sky-400/70 bg-sky-950/90 px-5 py-2.5 text-sm font-medium text-sky-100 shadow-lg"
			>
				{hud.actionPrompt}
			</div>
		{/if}

		<!-- Bottom Telemetry & Controls Bar -->
		<div class="absolute right-4 bottom-4 left-4 flex items-center justify-between gap-4">
			<div
				class="flex items-center gap-5 rounded-xl border border-slate-700/80 bg-slate-900/85 px-4 py-2.5 text-xs backdrop-blur-md"
			>
				<div>
					<span class="text-slate-400">Mode:</span>
					<strong>{hud.rover.isSeated ? 'Orion LTV Rover' : 'EVA Astronaut'}</strong>
				</div>
				<div>
					<span class="text-slate-400">Terrain:</span>
					<strong>{hud.rover.surfaceType.replaceAll('_', ' ')}</strong>
				</div>
				{#if hud.rover.isSeated}
					<div>
						<span class="text-slate-400">Speed:</span>
						<strong>{hud.rover.speedKmh.toFixed(1)} km/h</strong>
					</div>
					<div>
						<span class="text-slate-400">Battery:</span>
						<strong>{hud.rover.batteryPct}%</strong>
					</div>
				{/if}
			</div>

			<div
				class="rounded-xl border border-slate-700/80 bg-slate-900/85 px-4 py-2.5 text-xs text-slate-300 backdrop-blur-md"
			>
				<strong>WASD</strong> Move •
				<strong>{hud.isPointerLocked ? 'Mouse' : 'Click / Drag'}</strong>
				Look • <strong>[E]</strong> Interact / Drive Rover • <strong>[F]</strong> Carry / Load Crate
			</div>
		</div>

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
						{#each hud.samples as s}
							<div class="text-emerald-400">✓ {s.title}</div>
						{/each}
					</div>
				</div>
			</div>
		{/if}
	</div>
{/if}
