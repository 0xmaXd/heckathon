import * as THREE from 'three';
import type { SolarCycleState } from '../lunar-outpost.types';

export class LunarSunCycleSystem {
	private readonly cycleDurationSec = 22.0;
	private readonly orbitRadius = 520;

	private sunGroup = new THREE.Group();
	private sunLight!: THREE.DirectionalLight;
	private earthshineBounceLight!: THREE.DirectionalLight;
	private earthshineHemiLight!: THREE.HemisphereLight;
	private sunCoreMat!: THREE.MeshBasicMaterial;
	private sunCoronaMat!: THREE.SpriteMaterial;
	private outpostLampLights: THREE.PointLight[] = [];

	private elapsedSec = 3.2;

	init(scene: THREE.Scene, lampPositions: THREE.Vector3[]) {
		this.buildVisibleSun(scene);
		this.setupLights(scene, lampPositions);
		this.update(0);
	}

	private buildVisibleSun(scene: THREE.Scene) {
		this.sunCoreMat = new THREE.MeshBasicMaterial({
			color: 0xfffdf5,
			fog: false
		});
		const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(20, 24, 24), this.sunCoreMat);
		this.sunGroup.add(sunDisc);

		const canvas = document.createElement('canvas');
		canvas.width = 128;
		canvas.height = 128;
		const ctx = canvas.getContext('2d');
		if (ctx) {
			const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 64);
			grad.addColorStop(0, 'rgba(255, 252, 235, 1.0)');
			grad.addColorStop(0.28, 'rgba(255, 224, 150, 0.70)');
			grad.addColorStop(0.65, 'rgba(255, 180, 90, 0.22)');
			grad.addColorStop(1, 'rgba(255, 160, 60, 0.0)');
			ctx.fillStyle = grad;
			ctx.fillRect(0, 0, 128, 128);
		}

		const coronaTex = new THREE.CanvasTexture(canvas);
		this.sunCoronaMat = new THREE.SpriteMaterial({
			map: coronaTex,
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			fog: false
		});
		const coronaSprite = new THREE.Sprite(this.sunCoronaMat);
		coronaSprite.scale.set(140, 140, 1);
		this.sunGroup.add(coronaSprite);

		this.sunGroup.name = 'Lunar_Sun_Body';
		scene.add(this.sunGroup);
	}

	private setupLights(scene: THREE.Scene, lampPositions: THREE.Vector3[]) {
		// Unfiltered high-contrast solar irradiance on the Moon
		this.sunLight = new THREE.DirectionalLight(0xfffaf0, 5.4);
		this.sunLight.castShadow = true;
		this.sunLight.shadow.mapSize.set(2048, 2048);
		this.sunLight.shadow.camera.near = 180;
		this.sunLight.shadow.camera.far = 840;
		const d = 140;
		this.sunLight.shadow.camera.left = -d;
		this.sunLight.shadow.camera.right = d;
		this.sunLight.shadow.camera.top = d;
		this.sunLight.shadow.camera.bottom = -d;
		this.sunLight.shadow.bias = -0.0005;
		scene.add(this.sunLight);
		scene.add(this.sunLight.target);

		// Secondary Earthshine directional fill so shadows & regolith stay clearly visible
		this.earthshineBounceLight = new THREE.DirectionalLight(0x93c5fd, 1.35);
		this.earthshineBounceLight.position.set(160, 190, 180);
		scene.add(this.earthshineBounceLight);

		// Hemisphere sky-to-regolith bounce light
		this.earthshineHemiLight = new THREE.HemisphereLight(0x93b4e8, 0x3b4252, 1.55);
		scene.add(this.earthshineHemiLight);

		// Outpost walkway lamp point lights (auto-illuminate during twilight & lunar night)
		this.outpostLampLights = [];
		for (const pos of lampPositions) {
			const pt = new THREE.PointLight(0xe0f2fe, 0, 34, 1.3);
			pt.position.set(pos.x, pos.y + 4.4, pos.z);
			scene.add(pt);
			this.outpostLampLights.push(pt);
		}
	}

	update(dt: number, focusTarget?: THREE.Vector3): SolarCycleState {
		this.elapsedSec = (this.elapsedSec + dt) % this.cycleDurationSec;
		const cycleRatio = this.elapsedSec / this.cycleDurationSec;
		const theta = cycleRatio * Math.PI * 2;

		// Tilted South Pole solar arc: ~16s bright Lunar Day, ~6s illuminated Lunar Night
		const sinElev = Math.sin(theta);
		const horizontalCos = Math.cos(theta);
		const sx = horizontalCos * this.orbitRadius;
		const sy = sinElev * (this.orbitRadius * 0.62) + this.orbitRadius * 0.22;
		const sz = Math.sin(theta * 0.5) * (this.orbitRadius * 0.35) - 90;

		this.sunGroup.position.set(sx, sy, sz);
		this.sunLight.position.set(sx, sy, sz);
		if (focusTarget) {
			this.sunLight.target.position.copy(focusTarget);
			this.sunLight.target.updateMatrixWorld();
		}

		const elevationRad = Math.atan2(sy, Math.hypot(sx, sz));
		const elevationDeg = THREE.MathUtils.radToDeg(elevationRad);

		const dayFactor = THREE.MathUtils.smoothstep(elevationDeg, -5, 10);
		const horizonWarmth = 1 - Math.min(1, Math.abs(elevationDeg - 2) / 14);

		this.sunLight.intensity = dayFactor * 5.4;
		this.sunLight.color.setRGB(1.0, 0.97 - horizonWarmth * 0.14, 0.92 - horizonWarmth * 0.24);

		this.sunCoreMat.color.copy(this.sunLight.color);
		this.sunCoronaMat.opacity = THREE.MathUtils.smoothstep(elevationDeg, -8, 4) * 0.95;

		// Keep Earthshine strong so terrain contours are always legible even at night
		this.earthshineHemiLight.intensity = THREE.MathUtils.lerp(1.15, 1.65, dayFactor);
		this.earthshineBounceLight.intensity = THREE.MathUtils.lerp(1.15, 1.45, dayFactor);

		const lampIntensity = (1 - dayFactor) * 32.0;
		for (const lamp of this.outpostLampLights) {
			lamp.intensity = lampIntensity;
		}

		const isNight = elevationDeg < -2;
		const phaseLabel: SolarCycleState['phaseLabel'] =
			elevationDeg > 6 ? 'Lunar Day' : elevationDeg >= -2 ? 'Crater Twilight' : 'Lunar Night';

		return {
			phaseLabel,
			sunElevationDeg: Math.round(elevationDeg),
			cycleProgressPct: Math.round(cycleRatio * 100),
			isNight
		};
	}
}
