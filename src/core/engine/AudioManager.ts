export class AudioManager {
	private isMuted = false;

	playGeigerBeep(intensity: number) {
		if (this.isMuted) return;
		// TODO: Synthesize Web Audio API beep based on intensity parameter
		console.log(`Geiger counter beep at intensity ${intensity}`);
	}

	playAlarm() {
		if (this.isMuted) return;
		console.log('Playing warning alarm audio!');
	}

	toggleMute() {
		this.isMuted = !this.isMuted;
	}
}

export const audioManager = new AudioManager();
