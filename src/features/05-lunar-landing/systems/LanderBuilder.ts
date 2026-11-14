import * as THREE from 'three';
import { LunarLandingConfig } from '../lunar-landing.config';
import hudMeta from '../lunar-landing.hud.json';

export class LanderBuilder {
	public readonly rootGroup = new THREE.Group();
	public readonly attitudePivot = new THREE.Group();
	public readonly padGroup = new THREE.Group();
	public readonly radarRing: THREE.Mesh;

	private mainPlume!: THREE.Mesh;
	private dustRing!: THREE.Mesh;
	private rcsLeftPlume!: THREE.Mesh;
	private rcsRightPlume!: THREE.Mesh;
	private hazardRings: THREE.Mesh[] = [];
	private hazardMeshes: THREE.Mesh[] = [];

	constructor() {
		this.radarRing = new THREE.Mesh(
			new THREE.RingGeometry(1.1, 1.35, 32),
			new THREE.MeshBasicMaterial({
				color: 0x4da6ff,
				side: THREE.DoubleSide,
				transparent: true,
				opacity: 0.75
			})
		);
		this.radarRing.rotation.x = -Math.PI / 2;

		this.dustRing = new THREE.Mesh(
			new THREE.RingGeometry(1.4, 3.6, 32),
			new THREE.MeshBasicMaterial({
				color: 0xcfd4dc,
				side: THREE.DoubleSide,
				transparent: true,
				opacity: 0.0
			})
		);
		this.dustRing.rotation.x = -Math.PI / 2;
	}

	init(scene: THREE.Scene) {
		this.buildLander(scene);
		this.buildLandingPadAndHazards(scene);
		scene.add(this.radarRing);
		scene.add(this.dustRing);
	}

	private buildLander(scene: THREE.Scene) {
		this.rootGroup.add(this.attitudePivot);

		// Gold Kapton thermal foil descent stage
		const descentStage = new THREE.Mesh(
			new THREE.CylinderGeometry(1.15, 1.25, 1.1, 8),
			new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.75, roughness: 0.3 })
		);
		descentStage.position.y = -0.15;
		this.attitudePivot.add(descentStage);

		// Pressurized crew ascent cabin
		const cabin = new THREE.Mesh(
			new THREE.CylinderGeometry(0.85, 1.05, 1.05, 8),
			new THREE.MeshStandardMaterial({ color: 0xdce3ec, metalness: 0.35, roughness: 0.45 })
		);
		cabin.position.y = 0.85;
		this.attitudePivot.add(cabin);

		// 4 Landing Legs + Footpads (bottom at local y = -1.45)
		const legMat = new THREE.MeshStandardMaterial({ color: 0x8892a0, metalness: 0.6 });
		const padMat = new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.7 });

		for (let i = 0; i < 4; i++) {
			const angle = (i * Math.PI) / 2 + Math.PI / 4;
			const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.25, 8), legMat);
			leg.position.set(Math.cos(angle) * 1.15, -0.85, Math.sin(angle) * 1.15);
			leg.rotation.z = -Math.cos(angle) * 0.42;
			leg.rotation.x = Math.sin(angle) * 0.42;
			this.attitudePivot.add(leg);

			const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.08, 12), padMat);
			foot.position.set(Math.cos(angle) * 1.42, -1.41, Math.sin(angle) * 1.42);
			this.attitudePivot.add(foot);
		}

		// Main Descent Engine Nozzle + Plume
		const nozzle = new THREE.Mesh(
			new THREE.ConeGeometry(0.45, 0.65, 16, 1, true),
			new THREE.MeshStandardMaterial({
				color: 0x22252a,
				metalness: 0.85,
				side: THREE.DoubleSide
			})
		);
		nozzle.position.y = -0.85;
		this.attitudePivot.add(nozzle);

		this.mainPlume = new THREE.Mesh(
			new THREE.ConeGeometry(0.55, 3.4, 16),
			new THREE.MeshBasicMaterial({ color: 0x7cc8ff, transparent: true, opacity: 0.85 })
		);
		this.mainPlume.position.y = -2.7;
		this.mainPlume.rotation.x = Math.PI;
		this.mainPlume.visible = false;
		this.attitudePivot.add(this.mainPlume);

		// Lateral RCS Thruster Plumes
		const rcsGeo = new THREE.ConeGeometry(0.14, 0.9, 10);
		const rcsMat = new THREE.MeshBasicMaterial({
			color: 0xffffff,
			transparent: true,
			opacity: 0.85
		});

		this.rcsLeftPlume = new THREE.Mesh(rcsGeo, rcsMat);
		this.rcsLeftPlume.position.set(-1.45, 0.75, 0);
		this.rcsLeftPlume.rotation.z = Math.PI / 2;
		this.rcsLeftPlume.visible = false;
		this.attitudePivot.add(this.rcsLeftPlume);

		this.rcsRightPlume = new THREE.Mesh(rcsGeo, rcsMat);
		this.rcsRightPlume.position.set(1.45, 0.75, 0);
		this.rcsRightPlume.rotation.z = -Math.PI / 2;
		this.rcsRightPlume.visible = false;
		this.attitudePivot.add(this.rcsRightPlume);

		const { nodeName, ...inspectMeta } = hudMeta.inspectables.lander;
		this.rootGroup.name = nodeName;
		this.rootGroup.userData.inspect = inspectMeta;
		scene.add(this.rootGroup);
	}

	private buildLandingPadAndHazards(scene: THREE.Scene) {
		const padDisc = new THREE.Mesh(
			new THREE.CylinderGeometry(4.8, 5.2, 0.14, 32),
			new THREE.MeshStandardMaterial({ color: 0x263244, roughness: 0.7 })
		);
		padDisc.position.y = 0.07;
		this.padGroup.add(padDisc);

		const padRing = new THREE.Mesh(
			new THREE.RingGeometry(4.3, 4.7, 32),
			new THREE.MeshBasicMaterial({ color: 0x34ce57, side: THREE.DoubleSide })
		);
		padRing.rotation.x = -Math.PI / 2;
		padRing.position.y = 0.16;
		this.padGroup.add(padRing);

		const { nodeName: padNodeName, ...padInspect } = hudMeta.inspectables.landingPad;
		this.padGroup.name = padNodeName;
		this.padGroup.userData.inspect = padInspect;
		scene.add(this.padGroup);

		const boulderMat = new THREE.MeshStandardMaterial({ color: 0x4b4d52, roughness: 1.0 });
		const hazardRingMat = new THREE.MeshBasicMaterial({
			color: 0xff4d4d,
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 0.85
		});

		for (const h of LunarLandingConfig.hazards) {
			const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(h.radius, 1), boulderMat);
			rock.scale.set(1, h.height / h.radius, 1);
			this.hazardMeshes.push(rock);
			scene.add(rock);

			const ring = new THREE.Mesh(
				new THREE.RingGeometry(h.radius + 0.3, h.radius + 0.65, 24),
				hazardRingMat
			);
			ring.rotation.x = -Math.PI / 2;
			ring.visible = false;
			this.hazardRings.push(ring);
			scene.add(ring);
		}
	}

	positionSiteFixtures(padX: number, padZ: number) {
		this.padGroup.position.set(padX, 0, padZ);

		for (let i = 0; i < LunarLandingConfig.hazards.length; i++) {
			const h = LunarLandingConfig.hazards[i];
			const hx = padX + h.dx;
			const hz = padZ + h.dz;
			this.hazardMeshes[i]?.position.set(hx, h.height * 0.45, hz);
			if (this.hazardRings[i]) {
				this.hazardRings[i].position.set(hx, 0.14, hz);
				this.hazardRings[i].visible = false;
			}
		}
	}

	setHazardRingsVisible(visible: boolean) {
		for (const ring of this.hazardRings) {
			ring.visible = visible;
		}
	}

	updateVisuals(params: {
		x: number;
		z: number;
		terrainY: number;
		footHeight: number;
		rollRad: number;
		pitchRad: number;
		isIgnited: boolean;
		throttleRatio: number;
		forceX: number;
	}) {
		this.attitudePivot.rotation.set(params.pitchRad, 0, params.rollRad);

		// Ground radar target reticle directly beneath the lander
		this.radarRing.position.set(params.x, params.terrainY + 0.18, params.z);
		const ringScale = 1 + Math.min(2.5, params.footHeight * 0.04);
		this.radarRing.scale.set(ringScale, ringScale, 1);

		if (params.isIgnited && params.throttleRatio > 0) {
			this.mainPlume.visible = true;
			this.mainPlume.scale.set(
				0.8 + params.throttleRatio * 0.4,
				0.45 + params.throttleRatio * 1.15 + Math.random() * 0.15,
				0.8 + params.throttleRatio * 0.4
			);
			this.rcsLeftPlume.visible = params.forceX > 1500;
			this.rcsRightPlume.visible = params.forceX < -1500;

			// Regolith exhaust dust kickup within 14m of lunar surface
			const dustFactor = Math.max(0, 1 - params.footHeight / 14) * params.throttleRatio;
			const dustMat = this.dustRing.material as THREE.MeshBasicMaterial;
			dustMat.opacity = dustFactor * 0.42;
			this.dustRing.position.set(params.x, params.terrainY + 0.12, params.z);
			const dustScale = 1 + (1 - Math.min(1, params.footHeight / 14)) * 2.2;
			this.dustRing.scale.set(dustScale, dustScale, 1);
		} else {
			this.mainPlume.visible = false;
			this.rcsLeftPlume.visible = false;
			this.rcsRightPlume.visible = false;
			(this.dustRing.material as THREE.MeshBasicMaterial).opacity = 0;
		}
	}
}
