export function mulberry32(a: number) {
	return () => {
		a += 0x6d2b79f5;
		// Added explicit parentheses around bitwise shifts for TS/ESLint strictness
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Example usage: const random = mulberry32(GameConfig.seed);
