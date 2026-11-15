import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { SurfaceHit, SurfaceProvider } from '../../../core/engine/CollisionWorld';
import { LunarOutpostConfig } from '../lunar-outpost.config';
import type { SurfaceType } from '../lunar-outpost.types';
import type { OutpostMachineryNodes } from './OutpostMachinerySystem';
import type { NpcWorldEnvironment } from './OutpostNpcSystem';

export interface WorldDropOffZoneEntry {
	beaconMesh: THREE.Mesh;
	delivered: boolean;
	position: THREE.Vector3;
}

export class OutpostWorldBuilder
	implements SurfaceProvider, OutpostMachineryNodes, NpcWorldEnvironment
{
	public outpostRoot: THREE.Group | null = null;
	public lampPositions: THREE.Vector3[] = [];

	// NpcWorldEnvironment anchors
	public workstationPos = new THREE.Vector3(6.5, 0, -1.5);
	public launchPadPos = new THREE.Vector3(46, 0, -52);
	public resupplyDropPos = new THREE.Vector3(11.5, 0, -29.5);
	public sampleNodes = new Map<string, THREE.Object3D>();

	// OutpostMachineryNodes & NpcWorldEnvironment shared zones
	public airlockDoor: THREE.Object3D | null = null;
	public iceDrillAuger: THREE.Object3D | null = null;
	public commDishes: THREE.Object3D[] = [];
	public solarDustLayers: THREE.Object3D[] = [];
	public sampleBeacons = new Map<string, THREE.Mesh>();
	public dropOffZones: WorldDropOffZoneEntry[] = [];
	public landerAssembly: THREE.Group | null = null;
	public landerAscentPlume: THREE.Mesh | null = null;

	private loader = new GLTFLoader();
	private terrainMeshes: THREE.Mesh[] = [];
	private raycaster = new THREE.Raycaster();
	private rayOrigin = new THREE.Vector3();
	private downDir = new THREE.Vector3(0, -1, 0);
	private defaultUp = new THREE.Vector3(0, 1, 0);

	// Lighting & Visible Sun Rig
	private lightingGroup: THREE.Group | null = null;
	private sunAnchor: THREE.Group | null = null;
	private sunLight: THREE.DirectionalLight | null = null;
	private hemiLight: THREE.HemisphereLight | null = null;
	private earthshineLight: THREE.DirectionalLight | null = null;
	private lampLights: THREE.PointLight[] = [];
	private lampBulbMaterials: THREE.MeshStandardMaterial[] = [];
	private sunAzimuthRad = THREE.MathUtils.degToRad(38);

	async build(scene: THREE.Scene): Promise<void> {
		this.terrainMeshes = [];
		this.lampPositions = [];
		this.lampLights = [];
		this.lampBulbMaterials = [];
		this.airlockDoor = null;
		this.iceDrillAuger = null;
		this.commDishes = [];
		this.solarDustLayers = [];
		this.sampleNodes.clear();
		this.sampleBeacons.clear();
		this.dropOffZones.length = 0;
		this.landerAssembly = null;
		this.landerAscentPlume = null;

		this.workstationPos.set(6.5, 0, -1.5);
		this.launchPadPos.set(46, 0, -52);
		this.resupplyDropPos.set(11.5, 0, -29.5);

		scene.background = new THREE.Color(0x02040a);
		scene.fog = new THREE.FogExp2(0x03060f, 0.0014);
		scene.environment = this.createLunarEnvironmentTexture();
		scene.environmentIntensity = 0.72;

		const root = new THREE.Group();
		root.name = 'Orion_Lunar_Outpost_Root';

		try {
			const gltf = await this.loader.loadAsync(LunarOutpostConfig.modelUrl);
			root.add(gltf.scene);
		} catch (err) {
			console.warn(
				`[OutpostWorldBuilder] Failed to load ${LunarOutpostConfig.modelUrl}, using fallback lunar pad.`,
				err
			);
			root.add(this.createFallbackOutpost());
		}

		let foundAirlock: THREE.Object3D | null = null;
		let foundDrill: THREE.Object3D | null = null;
		const landerMatches: THREE.Object3D[] = [];
		const lampHeadNodes: THREE.Object3D[] = [];

		root.updateMatrixWorld(true);
		root.traverse((obj) => {
			if (obj instanceof THREE.Mesh) {
				obj.castShadow = true;
				obj.receiveShadow = true;
				if (/(terrain|ground|regolith|crater|pad|floor|trail|rut)/i.test(obj.name)) {
					this.terrainMeshes.push(obj);
				}
			}

			if (/Outpost_Lamp_Head/i.test(obj.name)) {
				lampHeadNodes.push(obj);
			} else if (
				lampHeadNodes.length === 0 &&
				/(lamp_head|light_post|beacon|mast_light)/i.test(obj.name)
			) {
				lampHeadNodes.push(obj);
			}

			if (/^Sample_/i.test(obj.name)) {
				this.sampleNodes.set(obj.name, obj);
			} else if (/Geology_Workstation_Console/i.test(obj.name)) {
				this.getObjectWorldCenter(obj, this.workstationPos);
			} else if (/Orion_Landing_Pad/i.test(obj.name)) {
				this.getObjectWorldCenter(obj, this.launchPadPos);
			} else if (/Airlock_Outer_Door/i.test(obj.name)) {
				if (!foundAirlock) foundAirlock = obj;
				this.getObjectWorldCenter(obj, this.resupplyDropPos);
			} else if (!foundDrill && /Ice_Drill|Auger/i.test(obj.name)) {
				foundDrill = obj;
			} else if (/Comm_Dish|Radar_Dish/i.test(obj.name)) {
				this.commDishes.push(obj);
			} else if (/Solar_Dust_Layer/i.test(obj.name)) {
				this.solarDustLayers.push(obj);
			} else if (/OrionLander|Orion_Lander/i.test(obj.name)) {
				landerMatches.push(obj);
			}
		});

		this.airlockDoor = foundAirlock;
		this.iceDrillAuger = foundDrill;

		// Deduplicate Outpost_Lamp_Head_* fixtures and make their bulb meshes glow
		for (const lampObj of lampHeadNodes) {
			const wp = new THREE.Vector3();
			this.getObjectWorldCenter(lampObj, wp);

			const alreadyRegistered = this.lampPositions.some(
				(existing) => existing.distanceTo(wp) < 0.9
			);
			if (!alreadyRegistered) {
				this.lampPositions.push(wp);
			}

			lampObj.traverse((child) => {
				if (!(child instanceof THREE.Mesh)) return;
				const mats = Array.isArray(child.material) ? child.material : [child.material];
				const glowingMats = mats.map((m) => {
					const clone = m.clone() as THREE.MeshStandardMaterial;
					if ('color' in clone && clone.color instanceof THREE.Color) {
						clone.color.setHex(0xfffbeb);
					}
					if ('emissive' in clone && clone.emissive instanceof THREE.Color) {
						clone.emissive.setHex(0xffdf99);
						clone.emissiveIntensity = 2.6;
					}
					clone.toneMapped = false;
					if (clone instanceof THREE.MeshStandardMaterial) {
						this.lampBulbMaterials.push(clone);
					}
					return clone;
				});
				child.material = Array.isArray(child.material) ? glowingMats : glowingMats[0];
			});
		}

		const landerNode = landerMatches[0] ?? null;
		if (landerNode) {
			if ((landerNode as THREE.Group).isGroup) {
				this.landerAssembly = landerNode as THREE.Group;
			} else {
				const wrapper = new THREE.Group();
				wrapper.name = 'Orion_Lander_Assembly';
				landerNode.parent?.add(wrapper);
				wrapper.attach(landerNode);
				this.landerAssembly = wrapper;
			}
		}

		if (this.terrainMeshes.length === 0) {
			const fallbackGround = this.createFallbackGround();
			root.add(fallbackGround);
			this.terrainMeshes.push(fallbackGround);
		}

		if (this.lampPositions.length === 0) {
			this.lampPositions.push(
				new THREE.Vector3(10, 4.2, -22),
				new THREE.Vector3(-12, 4.2, -14),
				new THREE.Vector3(16, 4.2, 10),
				new THREE.Vector3(-20, 4.2, 12)
			);
		}

		if (this.landerAssembly && !this.landerAscentPlume) {
			const plume = new THREE.Mesh(
				new THREE.ConeGeometry(1.1, 4.2, 16, 1, true),
				new THREE.MeshBasicMaterial({
					color: 0x38bdf8,
					transparent: true,
					opacity: 0.75,
					side: THREE.DoubleSide
				})
			);
			plume.rotation.x = Math.PI;
			plume.position.set(0, -2.1, 0);
			plume.visible = false;
			this.landerAssembly.add(plume);
			this.landerAscentPlume = plume;
		}

		this.outpostRoot = root;
		scene.add(root);

		this.setupOutpostLightingAndSun(scene);
		this.updateLighting(0, new THREE.Vector3(11.5, 0, -24.0), 22, false);
	}

	private setupOutpostLightingAndSun(scene: THREE.Scene): void {
		if (this.lightingGroup) {
			scene.remove(this.lightingGroup);
		}

		const group = new THREE.Group();
		group.name = 'Orion_Outpost_Lighting_And_Sun';

		// 1. Primary Solar Key Light
		const sunLight = new THREE.DirectionalLight(0xfff7e6, 3.2);
		sunLight.castShadow = true;
		sunLight.shadow.mapSize.set(2048, 2048);
		sunLight.shadow.camera.near = 10;
		sunLight.shadow.camera.far = 340;
		sunLight.shadow.camera.left = -95;
		sunLight.shadow.camera.right = 95;
		sunLight.shadow.camera.top = 95;
		sunLight.shadow.camera.bottom = -95;
		sunLight.shadow.bias = -0.00035;
		sunLight.shadow.normalBias = 0.02;
		group.add(sunLight);
		group.add(sunLight.target);
		this.sunLight = sunLight;

		// 2. Earthshine & Regolith Bounce Fill Light (prevents pitch-black vacuum shadows)
		const hemiLight = new THREE.HemisphereLight(0xa5c8ff, 0x475569, 1.05);
		group.add(hemiLight);
		this.hemiLight = hemiLight;

		const earthshine = new THREE.DirectionalLight(0x7dd3fc, 0.65);
		earthshine.position.set(-85, 65, 90);
		group.add(earthshine);
		this.earthshineLight = earthshine;

		// 3. Visible Sun Sphere + Additive Solar Corona in the Sky
		const sunAnchor = new THREE.Group();
		sunAnchor.name = 'Visible_Lunar_Sun';

		const sunDisc = new THREE.Mesh(
			new THREE.SphereGeometry(12, 32, 32),
			new THREE.MeshBasicMaterial({
				color: 0xffffff,
				fog: false,
				toneMapped: false
			})
		);
		sunAnchor.add(sunDisc);

		const coronaTex = this.createSolarCoronaTexture();
		const innerCorona = new THREE.Sprite(
			new THREE.SpriteMaterial({
				map: coronaTex,
				color: 0xfff3c4,
				transparent: true,
				opacity: 0.92,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
				fog: false
			})
		);
		innerCorona.scale.set(78, 78, 1);
		sunAnchor.add(innerCorona);

		const outerCorona = new THREE.Sprite(
			new THREE.SpriteMaterial({
				map: coronaTex,
				color: 0xfde68a,
				transparent: true,
				opacity: 0.48,
				blending: THREE.AdditiveBlending,
				depthWrite: false,
				fog: false
			})
		);
		outerCorona.scale.set(175, 175, 1);
		sunAnchor.add(outerCorona);

		group.add(sunAnchor);
		this.sunAnchor = sunAnchor;

		// 4. Vacuum Starfield Dome
		group.add(this.createStarfieldDome());

		// 5. Real PointLights for every Outpost_Lamp_Head_* bulb
		for (let i = 0; i < this.lampPositions.length; i++) {
			const lp = this.lampPositions[i];
			const pointLight = new THREE.PointLight(0xffe1a6, 22, 36, 1.45);
			pointLight.name = `Outpost_Lamp_PointLight_${i + 1}`;
			pointLight.position.set(lp.x, lp.y - 0.35, lp.z);
			group.add(pointLight);
			this.lampLights.push(pointLight);
		}

		// 6. Dedicated Staging & Lab Work Lights so Room 07 & Geology Console are clearly visible
		const room07Light = new THREE.PointLight(0xe0f2fe, 14, 24, 1.5);
		room07Light.position.set(11.5, 3.4, -24.0);
		group.add(room07Light);

		const labLight = new THREE.PointLight(0xbae6fd, 12, 20, 1.5);
		labLight.position.set(
			this.workstationPos.x,
			this.workstationPos.y + 2.8,
			this.workstationPos.z
		);
		group.add(labLight);

		this.lightingGroup = group;
		scene.add(group);
	}

	public updateLighting(
		dt: number,
		focusPos: THREE.Vector3,
		sunElevationDeg: number,
		isNight: boolean
	): void {
		this.sunAzimuthRad += dt * 0.004;

		// Keep a dramatic lunar South Pole sun angle visible above the crater rim
		const effectiveElevationDeg = isNight
			? Math.max(sunElevationDeg, 3.5)
			: Math.max(sunElevationDeg, 18);
		const elevRad = THREE.MathUtils.degToRad(effectiveElevationDeg);

		const sunDir = new THREE.Vector3(
			Math.cos(elevRad) * Math.sin(this.sunAzimuthRad),
			Math.sin(elevRad),
			Math.cos(elevRad) * Math.cos(this.sunAzimuthRad)
		).normalize();

		if (this.sunAnchor) {
			this.sunAnchor.position.copy(focusPos).addScaledVector(sunDir, 270);
		}

		if (this.sunLight) {
			this.sunLight.position.copy(focusPos).addScaledVector(sunDir, 130);
			this.sunLight.target.position.copy(focusPos);
			this.sunLight.target.updateMatrixWorld();
			this.sunLight.intensity = isNight ? 0.95 : 3.25;
			this.sunLight.color.setHex(effectiveElevationDeg < 12 ? 0xffedd5 : 0xfff8eb);
		}

		if (this.hemiLight) {
			this.hemiLight.intensity = isNight ? 0.65 : 1.1;
		}

		if (this.earthshineLight) {
			this.earthshineLight.intensity = isNight ? 0.9 : 0.6;
		}

		const lampIntensity = isNight ? 30 : 16;
		for (const light of this.lampLights) {
			light.intensity = lampIntensity;
		}

		const bulbEmissive = isNight ? 3.2 : 2.2;
		for (const mat of this.lampBulbMaterials) {
			mat.emissiveIntensity = bulbEmissive;
		}
	}

	private getObjectWorldCenter(obj: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
		obj.updateWorldMatrix(true, false);
		const box = new THREE.Box3().setFromObject(obj);
		if (!box.isEmpty()) {
			return box.getCenter(out);
		}
		return obj.getWorldPosition(out);
	}

	private createSolarCoronaTexture(): THREE.CanvasTexture {
		const size = 256;
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d');
		if (ctx) {
			const half = size / 2;
			const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
			grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
			grad.addColorStop(0.14, 'rgba(255, 248, 220, 0.92)');
			grad.addColorStop(0.38, 'rgba(253, 224, 130, 0.35)');
			grad.addColorStop(0.7, 'rgba(251, 191, 36, 0.08)');
			grad.addColorStop(1.0, 'rgba(251, 191, 36, 0.0)');
			ctx.fillStyle = grad;
			ctx.fillRect(0, 0, size, size);
		}
		const tex = new THREE.CanvasTexture(canvas);
		tex.needsUpdate = true;
		return tex;
	}

	private createLunarEnvironmentTexture(): THREE.DataTexture {
		const width = 64;
		const height = 32;
		const data = new Uint8Array(width * height * 4);

		for (let y = 0; y < height; y++) {
			const v = y / (height - 1); // 0 = bottom (regolith), 1 = top (zenith)
			for (let x = 0; x < width; x++) {
				const idx = (y * width + x) * 4;
				if (v < 0.48) {
					// Lunar regolith ground bounce
					data[idx] = 88;
					data[idx + 1] = 94;
					data[idx + 2] = 106;
					data[idx + 3] = 255;
				} else {
					// Earthshine + solar specular sky
					const isSolarSpot = y > 20 && x > 26 && x < 38;
					data[idx] = isSolarSpot ? 255 : 54;
					data[idx + 1] = isSolarSpot ? 245 : 74;
					data[idx + 2] = isSolarSpot ? 225 : 108;
					data[idx + 3] = 255;
				}
			}
		}

		const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
		tex.mapping = THREE.EquirectangularReflectionMapping;
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.needsUpdate = true;
		return tex;
	}

	private createStarfieldDome(): THREE.Points {
		const count = 2400;
		const positions = new Float32Array(count * 3);
		const colors = new Float32Array(count * 3);
		const radius = 620;

		for (let i = 0; i < count; i++) {
			const u = Math.random();
			const v = Math.random();
			const theta = 2 * Math.PI * u;
			const phi = Math.acos(2 * v - 1);

			positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
			positions[i * 3 + 1] = Math.abs(radius * Math.cos(phi)) - 30;
			positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

			const brightness = 0.65 + Math.random() * 0.35;
			colors[i * 3] = brightness;
			colors[i * 3 + 1] = brightness * (0.94 + Math.random() * 0.06);
			colors[i * 3 + 2] = brightness * (0.9 + Math.random() * 0.1);
		}

		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

		const mat = new THREE.PointsMaterial({
			size: 1.65,
			sizeAttenuation: false,
			vertexColors: true,
			fog: false
		});

		const stars = new THREE.Points(geo, mat);
		stars.name = 'Lunar_Vacuum_Starfield';
		return stars;
	}

	sampleSurfaceAt(x: number, z: number): SurfaceHit {
		if (this.terrainMeshes.length > 0) {
			this.rayOrigin.set(x, 120, z);
			this.raycaster.set(this.rayOrigin, this.downDir);
			const hits = this.raycaster.intersectObjects(this.terrainMeshes, false);
			if (hits.length > 0) {
				const topHit = hits[0];
				const normal = topHit.face
					? topHit.face.normal.clone().transformDirection(topHit.object.matrixWorld).normalize()
					: this.defaultUp.clone();
				return {
					y: topHit.point.y,
					normal,
					surfaceType: this.classifySurface(topHit.object.name, x, z)
				};
			}
		}

		return {
			y: 0,
			normal: this.defaultUp.clone(),
			surfaceType: this.classifySurface('', x, z)
		};
	}

	getGroundHeight(x: number, z: number): number {
		return this.sampleSurfaceAt(x, z).y;
	}

	findObjectByPatterns(patterns: RegExp[]): THREE.Object3D | null {
		if (!this.outpostRoot) return null;
		for (const pattern of patterns) {
			const matches: THREE.Object3D[] = [];
			this.outpostRoot.traverse((obj) => {
				if (matches.length === 0 && pattern.test(obj.name)) {
					matches.push(obj);
				}
			});
			if (matches.length > 0) return matches[0];
		}
		return null;
	}

	private classifySurface(meshName: string, x: number, z: number): SurfaceType {
		if (/(sintered|pad|plaza)/i.test(meshName)) return 'Sintered_Regolith';
		if (/(rut|wheel)/i.test(meshName)) return 'Compacted_Wheel_Ruts';
		if (/(trail|road|path)/i.test(meshName)) return 'Graded_Crater_Trail';

		const distFromPlaza = Math.hypot(x, z + 12);
		if (distFromPlaza < 24) return 'Sintered_Regolith';
		if (distFromPlaza < 55) return 'Compacted_Wheel_Ruts';
		if (distFromPlaza < 95) return 'Graded_Crater_Trail';
		return 'Loose_Regolith';
	}

	private createFallbackGround(): THREE.Mesh {
		const geo = new THREE.PlaneGeometry(500, 500, 64, 64);
		geo.rotateX(-Math.PI / 2);
		const mat = new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.92 });
		const mesh = new THREE.Mesh(geo, mat);
		mesh.name = 'Lunar_Regolith_Terrain';
		mesh.receiveShadow = true;
		return mesh;
	}

	private createFallbackOutpost(): THREE.Group {
		const group = new THREE.Group();
		group.add(this.createFallbackGround());

		const pad = new THREE.Mesh(
			new THREE.CylinderGeometry(8.5, 9.0, 0.25, 32),
			new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7 })
		);
		pad.name = 'Orion_Landing_Pad_NASALogo';
		pad.position.set(46, 0.12, -52);
		group.add(pad);
		return group;
	}
}
