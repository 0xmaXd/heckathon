import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface CharacterInstanceOptions {
	modelUrl?: string;
	accentHex?: number;
	hideHeadForFirstPerson?: boolean;
}

export interface CharacterRigRefs {
	pelvis: THREE.Object3D | null;
	head: THREE.Object3D | null;
	spine: THREE.Object3D | null;
	leftUpperArm: THREE.Object3D | null;
	rightUpperArm: THREE.Object3D | null;
	leftForearm: THREE.Object3D | null;
	rightForearm: THREE.Object3D | null;
	leftThigh: THREE.Object3D | null;
	rightThigh: THREE.Object3D | null;
	leftCalf: THREE.Object3D | null;
	rightCalf: THREE.Object3D | null;
	restRotations: Map<THREE.Object3D, THREE.Euler>;
	restPositions: Map<THREE.Object3D, THREE.Vector3>;
}

const CHARACTER_NODE_PATTERN = /^(eva[_\s-]*suit|astronaut|eva[_\s-]*character)/i;

class CharacterModelLoader {
	private loader = new GLTFLoader();
	private embeddedTemplate: THREE.Object3D | null = null;
	private cachedGltfs = new Map<string, GLTF>();
	private loadPromises = new Map<string, Promise<GLTF | null>>();

	public clearEmbeddedTemplate(): void {
		this.embeddedTemplate = null;
	}

	public registerEmbeddedTemplate(sceneRoot: THREE.Object3D | null) {
		this.embeddedTemplate = null;
		if (!sceneRoot) return;

		let bestCandidate: THREE.Object3D | null = null;
		sceneRoot.traverse((obj) => {
			if (bestCandidate) return;
			if (obj.name.startsWith('EVA_Astronaut_')) return;
			if (CHARACTER_NODE_PATTERN.test(obj.name)) {
				bestCandidate = obj;
			}
		});

		if (bestCandidate) {
			this.embeddedTemplate = bestCandidate;
			(bestCandidate as THREE.Object3D).visible = false;
		}
	}

	private loadExternalGltf(preferredUrl?: string): Promise<GLTF | null> {
		const cacheKey = preferredUrl ?? '__default_eva__';
		const existing = this.cachedGltfs.get(cacheKey);
		if (existing) return Promise.resolve(existing);

		const pending = this.loadPromises.get(cacheKey);
		if (pending) return pending;

		const candidateUrls = Array.from(
			new Set(
				[
					preferredUrl,
					'/models/eva_astronaut.glb',
					'/models/eva_suit.glb',
					'/models/astronaut.glb'
				].filter((u): u is string => Boolean(u))
			)
		);

		const promise = (async () => {
			for (const url of candidateUrls) {
				try {
					const gltf = await this.loader.loadAsync(url);
					this.cachedGltfs.set(cacheKey, gltf);
					return gltf;
				} catch {
					// Try next candidate URL
				}
			}
			return null;
		})();

		this.loadPromises.set(cacheKey, promise);
		return promise;
	}

	async createCharacterInstance(options: CharacterInstanceOptions = {}): Promise<THREE.Group> {
		const container = new THREE.Group();

		if (this.embeddedTemplate) {
			const cloned = SkeletonUtils.clone(this.embeddedTemplate) as THREE.Group;
			this.prepareClonedSuit(cloned, options);
			container.userData.rig = this.extractRigRefs(cloned);
			container.add(cloned);
			return container;
		}

		const gltf = await this.loadExternalGltf(options.modelUrl);
		if (gltf) {
			const cloned = SkeletonUtils.clone(gltf.scene) as THREE.Group;
			this.prepareClonedSuit(cloned, options);
			container.userData.rig = this.extractRigRefs(cloned);

			if (gltf.animations && gltf.animations.length > 0) {
				const mixer = new THREE.AnimationMixer(cloned);
				const idleClip =
					gltf.animations.find((a) => /idle|stand|breathe/i.test(a.name)) ?? gltf.animations[0];
				const idleAction = mixer.clipAction(idleClip);
				idleAction.play();
				container.userData.mixer = mixer;
				container.userData.idleAction = idleAction;
			}

			container.add(cloned);
			return container;
		}

		const fallback = this.buildFallbackSuit(options);
		container.userData.rig = this.extractRigRefs(fallback);
		container.add(fallback);
		return container;
	}

	private extractRigRefs(root: THREE.Object3D): CharacterRigRefs {
		const rig: CharacterRigRefs = {
			pelvis: null,
			head: null,
			spine: null,
			leftUpperArm: null,
			rightUpperArm: null,
			leftForearm: null,
			rightForearm: null,
			leftThigh: null,
			rightThigh: null,
			leftCalf: null,
			rightCalf: null,
			restRotations: new Map(),
			restPositions: new Map()
		};

		const isLeft = (n: string) => /(^|[_.\-\s])(l|left)([_.\-\s]|$)|left/i.test(n);
		const isRight = (n: string) => /(^|[_.\-\s])(r|right)([_.\-\s]|$)|right/i.test(n);

		root.traverse((obj) => {
			const n = obj.name;
			if (!n) return;

			if (!rig.pelvis && /(pelvis|hips|root_bone)/i.test(n)) {
				rig.pelvis = obj;
			} else if (!rig.head && /(head|helmet)/i.test(n) && !/visor|light/i.test(n)) {
				rig.head = obj;
			} else if (!rig.spine && /(spine1|spine2|chest|torso|upper_body)/i.test(n)) {
				rig.spine = obj;
			} else if (/(forearm|lower[_\s-]*arm|elbow)/i.test(n)) {
				if (!rig.leftForearm && isLeft(n)) rig.leftForearm = obj;
				else if (!rig.rightForearm && isRight(n)) rig.rightForearm = obj;
			} else if (/(upper[_\s-]*arm|shoulder|bicep|(^|[_.\-\s])arm([_.\-\s]|$))/i.test(n)) {
				if (!rig.leftUpperArm && isLeft(n)) rig.leftUpperArm = obj;
				else if (!rig.rightUpperArm && isRight(n)) rig.rightUpperArm = obj;
			} else if (/(calf|shin|lower[_\s-]*leg|knee)/i.test(n)) {
				if (!rig.leftCalf && isLeft(n)) rig.leftCalf = obj;
				else if (!rig.rightCalf && isRight(n)) rig.rightCalf = obj;
			} else if (/(thigh|upper[_\s-]*leg|hip|upleg)/i.test(n)) {
				if (!rig.leftThigh && isLeft(n)) rig.leftThigh = obj;
				else if (!rig.rightThigh && isRight(n)) rig.rightThigh = obj;
			}
		});

		const joints = [
			rig.pelvis,
			rig.head,
			rig.spine,
			rig.leftUpperArm,
			rig.rightUpperArm,
			rig.leftForearm,
			rig.rightForearm,
			rig.leftThigh,
			rig.rightThigh,
			rig.leftCalf,
			rig.rightCalf
		];
		for (const j of joints) {
			if (j) {
				rig.restRotations.set(j, j.rotation.clone());
				rig.restPositions.set(j, j.position.clone());
			}
		}

		return rig;
	}

	private prepareClonedSuit(cloned: THREE.Object3D, options: CharacterInstanceOptions) {
		cloned.visible = true;
		cloned.position.set(0, 0, 0);
		cloned.rotation.set(0, 0, 0);

		cloned.traverse((obj) => {
			obj.visible = true;
			if (!(obj instanceof THREE.Mesh)) return;

			obj.castShadow = true;
			obj.receiveShadow = true;
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

			if (options.hideHeadForFirstPerson) {
				const isHeadPart =
					/(visor|helmet|head)/i.test(obj.name) ||
					clonedMaterials.some(
						(m) => m.name === 'Suit_Gold_Visor' || /(visor|helmet)/i.test(m.name)
					);
				const isTorsoPart = /(torso|chest|backpack|plss|body)/i.test(obj.name);
				if (isHeadPart && !isTorsoPart) {
					obj.visible = false;
				}
			}
		});

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

	private buildFallbackSuit(options: CharacterInstanceOptions): THREE.Group {
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

		const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.26), jointMat);
		pelvis.name = 'Pelvis_Root';
		pelvis.position.set(0, 0.84, 0);
		pelvis.castShadow = true;
		fallback.add(pelvis);

		for (const side of [-1, 1]) {
			const thighPivot = new THREE.Group();
			thighPivot.name = side < 0 ? 'Thigh_L' : 'Thigh_R';
			thighPivot.position.set(side * 0.13, 0.82, 0);

			const thighMesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.36, 0.18), suitMat);
			thighMesh.position.set(0, -0.18, 0);
			thighMesh.castShadow = true;
			thighPivot.add(thighMesh);

			const calfPivot = new THREE.Group();
			calfPivot.name = side < 0 ? 'Calf_L' : 'Calf_R';
			calfPivot.position.set(0, -0.36, 0);

			const calfMesh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.36, 0.17), suitMat);
			calfMesh.position.set(0, -0.18, 0);
			calfMesh.castShadow = true;
			calfPivot.add(calfMesh);

			const bootMesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.26), jointMat);
			bootMesh.position.set(0, -0.38, 0.03);
			bootMesh.castShadow = true;
			calfPivot.add(bootMesh);

			thighPivot.add(calfPivot);
			fallback.add(thighPivot);
		}

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

		const headPivot = new THREE.Group();
		headPivot.name = 'Head_Helmet';
		headPivot.position.set(0, 0.58, 0);
		spinePivot.add(headPivot);

		if (!options.hideHeadForFirstPerson) {
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
