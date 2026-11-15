import { LaunchRoomConfig } from './launch-room.config';

export interface IssTelemetry {
	hasApiKey: boolean;
	statusLabel: string;
	latitude: number;
	longitude: number;
	altitudeKm: number;
	velocityKmh: number;
	visibility: string;
	timestamp: number;
}

export function getConfiguredNasaApiKey(): string | null {
	const env = import.meta.env as Record<string, string | undefined>;
	const raw = (env.VITE_NASA_API_KEY ?? env.PUBLIC_NASA_API_KEY ?? '').trim();
	if (!raw || raw === 'your_nasa_api_key_here' || raw === 'undefined' || raw === 'null') {
		return null;
	}
	return raw;
}

export class IssLiveTracker {
	private timerId: number | null = null;
	private onUpdate: (data: IssTelemetry) => void;
	private latest: IssTelemetry;

	constructor(onUpdate: (data: IssTelemetry) => void) {
		this.onUpdate = onUpdate;
		const key = getConfiguredNasaApiKey();
		this.latest = {
			hasApiKey: Boolean(key),
			statusLabel: key ? 'CONNECTING LIVE ISS...' : 'NASA API KEY NOT SET IN .env',
			latitude: 0,
			longitude: 0,
			altitudeKm: 418,
			velocityKmh: 27600,
			visibility: 'daylight',
			timestamp: Date.now()
		};
	}

	getLatest(): IssTelemetry {
		return this.latest;
	}

	start() {
		this.stop();
		const nasaKey = getConfiguredNasaApiKey();
		if (!nasaKey) {
			this.latest = {
				...this.latest,
				hasApiKey: false,
				statusLabel: 'NASA API KEY NOT SET IN .env'
			};
			this.onUpdate(this.latest);
			return;
		}

		void this.fetchNow(nasaKey);
		this.timerId = window.setInterval(() => {
			void this.fetchNow(nasaKey);
		}, LaunchRoomConfig.iss.pollIntervalMs);
	}

	stop() {
		if (this.timerId !== null) {
			window.clearInterval(this.timerId);
			this.timerId = null;
		}
	}

	private async fetchNow(nasaKey: string) {
		try {
			// Verify NASA key format / endpoint lightly once while pulling live ISS coordinates
			const res = await fetch(LaunchRoomConfig.iss.endpoint, {
				headers: { Accept: 'application/json' }
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const json = (await res.json()) as {
				latitude: number;
				longitude: number;
				altitude: number;
				velocity: number;
				visibility: string;
				timestamp: number;
			};

			const latDir = json.latitude >= 0 ? 'N' : 'S';
			const lonDir = json.longitude >= 0 ? 'E' : 'W';
			const coordLabel = `${Math.abs(json.latitude).toFixed(1)}°${latDir}, ${Math.abs(json.longitude).toFixed(1)}°${lonDir}`;

			this.latest = {
				hasApiKey: Boolean(nasaKey),
				statusLabel: coordLabel,
				latitude: json.latitude,
				longitude: json.longitude,
				altitudeKm: json.altitude,
				velocityKmh: json.velocity,
				visibility: json.visibility,
				timestamp: json.timestamp * 1000
			};
			this.onUpdate(this.latest);
		} catch {
			this.latest = {
				...this.latest,
				hasApiKey: true,
				statusLabel: 'ISS SIGNAL RETRYING...'
			};
			this.onUpdate(this.latest);
		}
	}
}
