import type { OutpostHudSnapshot } from './lunar-outpost.types';

class LunarOutpostStore {
	snapshot = $state<OutpostHudSnapshot | null>(null);

	update(next: OutpostHudSnapshot) {
		this.snapshot = next;
	}

	reset() {
		this.snapshot = null;
	}
}

export const lunarOutpostStore = new LunarOutpostStore();
