import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { LunarOutpostConfig } from '../lunar-outpost.config';

export interface EvaSuitInstanceOptions {
	accentHex?: number;
	hideVisorForFirstPerson?: boolean;
}

export interface EvaSuitRigRefs {
	head: THREE.Object3D | null;
	spine: THREE.Object3D | null;
	leftUpperArm: THREE.Object3D | null;
	rightUpperArm: THREE.Object3D | null;
	leftForearm: THREE.Object3D | null;
	rightForearm: THREE.Object3D | null;
	leftThigh: THREE.Object3D | null;
	rightThigh: THREE.Object3D | null;
	restRotations: Map<THREE.Object3D, THREE.Euler>;
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
				`[LunarOutpost] EVA_Suit model not found in outpost GLB or at "${LunarOutpostConfig.characterModelUrl}". Using articulated fallback EVA suit.`
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
			container.userData.rig = this.extractRigRefs(cloned);
			container.add(cloned);
			return container;
		}

		// 2. Otherwise load from external characterModelUrl
		const gltf = await this.loadExternalGltf();
		if (gltf) {
			const cloned = SkeletonUtils.clone(gltf.scene) as THREE.Group;
			this.prepareClonedSuit(cloned, options);
			container.userData.rig = this.extractRigRefs(cloned);

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

		// 3. Articulated procedural EVA suit fallback
		const fallback = this.buildFallbackSuit(options);
		container.userData.rig = this.extractRigRefs(fallback);
		container.add(fallback);
		return container;
	}

	private extractRigRefs(root: THREE.Object3D): EvaSuitRigRefs {
		const rig: EvaSuitRigRefs = {
			head: null,
			spine: null,
			leftUpperArm: null,
			rightUpperArm: null,
			leftForearm: null,
			rightForearm: null,
			leftThigh: null,
			rightThigh: null,
			restRotations: new Map()
		};

		const isLeft = (n: string) => /(^|[_.\-\s])(l|left)([_.\-\s]|$)|left/i.test(n);
		const isRight = (n: string) => /(^|[_.\-\s])(r|right)([_.\-\s]|$)|right/i.test(n);

		root.traverse((obj) => {
			const n = obj.name;
			if (!n) return;

			if (!rig.head && /(head|helmet)/i.test(n) && !/visor|light/i.test(n)) {
				rig.head = obj;
			} else if (!rig.spine && /(spine1|spine2|chest|torso|upper_body)/i.test(n)) {
				rig.spine = obj;
			} else if (/(forearm|lower[_\s-]*arm|elbow)/i.test(n)) {
				if (!rig.leftForearm && isLeft(n)) rig.leftForearm = obj;
				else if (!rig.rightForearm && isRight(n)) rig.rightForearm = obj;
			} else if (/(upper[_\s-]*arm|shoulder|bicep|(^|[_.\-\s])arm([_.\-\s]|$))/i.test(n)) {
				if (!rig.leftUpperArm && isLeft(n)) rig.leftUpperArm = obj;
				else if (!rig.rightUpperArm && isRight(n)) rig.rightUpperArm = obj;
			} else if (/(thigh|upper[_\s-]*leg|hip|upleg)/i.test(n)) {
				if (!rig.leftThigh && isLeft(n)) rig.leftThigh = obj;
				else if (!rig.rightThigh && isRight(n)) rig.rightThigh = obj;
			}
		});

		const joints = [
			rig.head,
			rig.spine,
			rig.leftUpperArm,
			rig.rightUpperArm,
			rig.leftForearm,
			rig.rightForearm,
			rig.leftThigh,
			rig.rightThigh
		];
		for (const j of joints) {
			if (j) {
				rig.restRotations.set(j, j.rotation.clone());
			}
		}

		return rig;
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
		const jointMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.65 });
		const accentMat = new THREE.MeshStandardMaterial({
			color: options.accentHex ?? 0xe6480d,
			roughness: 0.4
		});
		const visorMat = new THREE.MeshStandardMaterial({
			color: 0xf59e0b,
			metalness: 0.92,
			roughness: 0.12
		});

		// Pelvis / hips
		const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.26), jointMat);
		pelvis.position.set(0, 0.84, 0);
		pelvis.castShadow = true;
		fallback.add(pelvis);

		// Legs (articulated thighs)
		for (const side of [-1, 1]) {
			const thighPivot = new THREE.Group();
			thighPivot.name = side < 0 ? 'Thigh_L' : 'Thigh_R';
			thighPivot.position.set(side * 0.13, 0.82, 0);

			const legMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.72, 0.18), suitMat);
			legMesh.position.set(0, -0.36, 0);
			legMesh.castShadow = true;
			thighPivot.add(legMesh);

			const bootMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.26), jointMat);
			bootMesh.position.set(0, -0.74, 0.03);
			bootMesh.castShadow = true;
			thighPivot.add(bootMesh);

			fallback.add(thighPivot);
		}

		// Upper Spine / Torso
		const spinePivot = new THREE.Group();
		spinePivot.name = 'Spine_Chest';
		spinePivot.position.set(0, 0.94, 0);
		fallback.add(spinePivot);

		const torso = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.56, 0.3), suitMat);
		torso.position.set(0, 0.28, 0);
		torso.castShadow = true;
		spinePivot.add(torso);

		const plssPack = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.48, 0.18), suitMat);
		plssPack.position.set(0, 0.3, -0.22);
		plssPack.castShadow = true;
		spinePivot.add(plssPack);

		const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.32), accentMat);
		stripe.position.set(0, 0.44, 0);
		spinePivot.add(stripe);

		// Articulated Arms (Upper Arm + Forearm pivots)
		for (const side of [-1, 1]) {
			const upperArmPivot = new THREE.Group();
			upperArmPivot.name = side < 0 ? 'UpperArm_L' : 'UpperArm_R';
			upperArmPivot.position.set(side * 0.31, 0.5, 0);

			const upperMesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.14), suitMat);
			upperMesh.position.set(0, -0.14, 0);
			upperMesh.castShadow = true;
			upperArmPivot.add(upperMesh);

			const forearmPivot = new THREE.Group();
			forearmPivot.name = side < 0 ? 'Forearm_L' : 'Forearm_R';
			forearmPivot.position.set(0, -0.29, 0);

			const foreMesh = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.28, 0.13), suitMat);
			foreMesh.position.set(0, -0.13, 0);
			foreMesh.castShadow = true;
			forearmPivot.add(foreMesh);

			const gloveMesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.14), accentMat);
			gloveMesh.position.set(0, -0.29, 0.01);
			forearmPivot.add(gloveMesh);

			upperArmPivot.add(forearmPivot);
			spinePivot.add(upperArmPivot);
		}

		// Head / Helmet pivot
		const headPivot = new THREE.Group();
		headPivot.name = 'Head_Helmet';
		headPivot.position.set(0, 0.58, 0);
		spinePivot.add(headPivot);

		if (!options.hideVisorForFirstPerson) {
			const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), suitMat);
			helmet.position.set(0, 0.16, 0);
			helmet.castShadow = true;
			headPivot.add(helmet);

			const visor = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 12), visorMat);
			visor.position.set(0, 0.16, 0.05);
			headPivot.add(visor);
		}

		return fallback;
	}
}

export const characterModelLoader = new CharacterModelLoader();
