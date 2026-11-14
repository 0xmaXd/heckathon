export const NasaEndpoints = {
	// Fallback schemas based on data.nasa.gov structures
	lunarTerrain: 'https://data.nasa.gov/resource/lunar_terrain_fallback.json',
	solarIrradiance: 'https://data.nasa.gov/resource/solar_data.json'
};

export type MineralSchema = {
	id: string;
	name: string;
	type: 'metal' | 'non-metal' | 'isotope';
	abundancePct: number;
};
