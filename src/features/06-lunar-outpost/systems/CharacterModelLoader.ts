import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { LunarOutpostConfig } from '../lunar-outpost.config';

export interface EvaSuitInstanceOptions {
	accentHex?: number;
	hideVisorForFirstPerson?: boolean;
}

const EVA_NODE_PATTERN = /^(eva[_\s-]*suit|astronaut|eva[_\s-]*character)/i;

class CharacterModelLoader {
	private loader = new GLTFLoader();
	private outpostTemplate: THREE.Object3D | null = null;
	private cachedGltf: GLTF | null = null;
	private loadPromise: Promise<GLTF | null> | null = null;

	/**
	 * Checks the loaded outpost GLB (moon_outpost.glb) for an embedded EVA_Suit model
	 * so it can be cloned 3x (Player + Maya + Leo) without needing a second GLB file.
	 */
	public registerOutpostScene(outpostRoot: THREE.Object3D | null) {
		this.outpostTemplate = null;
		if (!outpostRoot) return;

		let bestCandidate: THREE.Object3D | null = null;
		outpostRoot.traverse((obj) => {
			if (bestCandidate) return;
			if (obj.name.startsWith('EVA_Astronaut_')) return;
			if (EVA_NODE_PATTERN.test(obj.name)) {
				bestCandidate = obj;
			}
		});

		if (bestCandidate) {
			this.outpostTemplate = bestCandidate;
			// Hide the raw static template node inside moon_outpost.glb so it doesn't duplicate at spawn
			(bestCandidate as THREE.Object3D).visible = false;
		}
	}

	private loadExternalGltf(): Promise<GLTF | null> {
		if (this.cachedGltf) return Promise.resolve(this.cachedGltf);
		if (this.loadPromise) return this.loadPromise;

		const candidateUrls = Array.from(
			new Set([
				LunarOutpostConfig.characterModelUrl,
				'/models/eva_suit.glb',
				'/models/astronaut.glb'
			])
		);

		this.loadPromise = (async () => {
			for (const url of candidateUrls) {
				if (!url) continue;
				try {
					const gltf = await this.loader.loadAsync(url);
					this.cachedGltf = gltf;
					return gltf;
				} catch {
					// Try next candidate URL
				}
			}
			console.warn(
				`[LunarOutpost] EVA_Suit model not found in outpost GLB or at "${LunarOutpostConfig.characterModelUrl}". Using fallback EVA suit.`
			);
			return null;
		})();

		return this.loadPromise;
	}

	async createEvaSuitInstance(options: EvaSuitInstanceOptions = {}): Promise<THREE.Group> {
		const container = new THREE.Group();

		// 1. Prefer the EVA_Suit model embedded in your loaded GLB file
		if (this.outpostTemplate) {
			const cloned = SkeletonUtils.clone(this.outpostTemplate) as THREE.Group;
			this.prepareClonedSuit(cloned, options);
			container.add(cloned);
			return container;
		}

		// 2. Otherwise load from external characterModelUrl
		const gltf = await this.loadExternalGltf();
		if (gltf) {
			const cloned = SkeletonUtils.clone(gltf.scene) as THREE.Group;
			this.prepareClonedSuit(cloned, options);

			if (gltf.animations && gltf.animations.length > 0) {
				const mixer = new THREE.AnimationMixer(cloned);
				const idleClip =
					gltf.animations.find((a) => /idle|stand|breathe/i.test(a.name)) ?? gltf.animations[0];
				mixer.clipAction(idleClip).play();
				container.userData.mixer = mixer;
			}

			container.add(cloned);
			return container;
		}

		// 3. Fallback procedural EVA suit
		container.add(this.buildFallbackSuit(options));
		return container;
	}

	private prepareClonedSuit(cloned: THREE.Object3D, options: EvaSuitInstanceOptions) {
		cloned.visible = true;
		cloned.position.set(0, 0, 0);
		cloned.rotation.set(0, 0, 0);

		cloned.traverse((obj) => {
			obj.visible = true;
			if (!(obj instanceof THREE.Mesh)) return;

			obj.castShadow = true;
			obj.receiveShadow = true;
			// Prevent Three.js from frustum-culling cloned SkinnedMeshes (EVA_Suit_Rig)
			obj.frustumCulled = false;

			const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
			const clonedMaterials = materials.map((mat) => {
				const copy = mat.clone();
				if (
					options.accentHex !== undefined &&
					(copy.name === 'Suit_Accent_Stripe' || /accent|stripe/i.test(copy.name))
				) {
					if ('color' in copy && copy.color instanceof THREE.Color) {
						copy.color.setHex(options.accentHex);
					}
				}
				return copy;
			});

			obj.material = Array.isArray(obj.material) ? clonedMaterials : clonedMaterials[0];

			if (options.hideVisorForFirstPerson) {
				const isVisor =
					/visor/i.test(obj.name) ||
					clonedMaterials.some((m) => m.name === 'Suit_Gold_Visor' || /visor/i.test(m.name));
				if (isVisor) {
					obj.visible = false;
				}
			}
		});

		// Normalize scale if exported in cm/mm and ground the soles of the boots to y = 0
		cloned.updateMatrixWorld(true);
		const box = new THREE.Box3().setFromObject(cloned);
		if (!box.isEmpty()) {
			const height = box.max.y - box.min.y;
			if (height > 0.001 && (height < 0.5 || height > 3.5)) {
				const scaleFactor = 1.78 / height;
				cloned.scale.multiplyScalar(scaleFactor);
				cloned.updateMatrixWorld(true);
				box.setFromObject(cloned);
			}
			const centerX = (box.min.x + box.max.x) * 0.5;
			const centerZ = (box.min.z + box.max.z) * 0.5;
			cloned.position.set(-centerX, -box.min.y, -centerZ);
		}
	}

	private buildFallbackSuit(options: EvaSuitInstanceOptions): THREE.Group {
		const fallback = new THREE.Group();
		const suitMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.42 });
		const accentMat = new THREE.MeshStandardMaterial({
			color: options.accentHex ?? 0xe6480d,
			roughness: 0.4
		});
		const visorMat = new THREE.MeshStandardMaterial({
			color: 0xf59e0b,
			metalness: 0.92,
			roughness: 0.12
		});

		const torso = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.68, 0.3), suitMat);
		torso.position.set(0, 1.12, 0);
		torso.castShadow = true;
		fallback.add(torso);

		const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.32), accentMat);
		stripe.position.set(0, 1.38, 0);
		fallback.add(stripe);

		if (!options.hideVisorForFirstPerson) {
			const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), suitMat);
			helmet.position.set(0, 1.66, 0);
			fallback.add(helmet);

			const visor = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 12), visorMat);
			visor.position.set(0, 1.66, 0.05);
			fallback.add(visor);
		}

		return fallback;
	}
}

export const characterModelLoader = new CharacterModelLoader();
