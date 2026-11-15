import * as THREE from 'three';

const PLUME_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uThrottle;
  uniform float uTurbulence;
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewPosition;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z
    );
  }

  void main() {
    vUv = uv;
    float distFromNozzle = 1.0 - uv.y;

    vec3 pos = position;
    pos.y *= mix(0.18, 1.0, uThrottle);

    // High-velocity exhaust shear waves
    float n1 = noise(vec3(pos.x * 1.9, pos.y * 0.42 + uTime * 22.0, pos.z * 1.9));
    float n2 = noise(vec3(pos.x * 3.8, pos.y * 0.85 + uTime * 36.0, pos.z * 3.8));
    float wave = (n1 * 0.65 + n2 * 0.35 - 0.5) * 2.0;

    float flare = 1.0 + 0.16 * pow(distFromNozzle, 1.4) * uThrottle;
    pos.x *= flare;
    pos.z *= flare;

    float spread = pow(distFromNozzle, 0.82) * uTurbulence * uThrottle;
    pos.x += normal.x * wave * spread;
    pos.z += normal.z * wave * spread;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    vViewPosition = -mvPosition.xyz;
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const PLUME_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uThrottle;
  uniform vec3 uColorCore;
  uniform vec3 uColorMid;
  uniform vec3 uColorTip;
  uniform float uMachDiamonds;
  uniform float uIntensity;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewPosition;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // 3-octave FBM keeps iGPU fragment cost ultra-light while boosting plasma contrast
  float fbm3(vec2 p) {
    float v = 0.0;
    float amp = 0.55;
    for (int i = 0; i < 3; i++) {
      v += amp * vnoise(p);
      p *= 2.07;
      amp *= 0.48;
    }
    return v;
  }

  void main() {
    if (uThrottle <= 0.01) discard;

    float distFromNozzle = 1.0 - vUv.y;

    vec2 flowUv = vec2(vUv.x * 6.0, distFromNozzle * 6.0 - uTime * 15.0);
    float turb = fbm3(flowUv);
    float detail = fbm3(flowUv * 2.1 + vec2(1.7, -uTime * 9.5));
    float flameNoise = turb * 0.65 + detail * 0.35;

    vec3 viewDir = normalize(vViewPosition);
    float fresnel = abs(dot(normalize(vNormalView), viewDir));
    float edgeSoftness = pow(fresnel, 1.35);

    // Crisp supersonic Mach shock diamonds along centerline
    float machWave = pow(max(0.0, sin(distFromNozzle * 32.0 - uTime * 4.0)), 7.0)
                   * smoothstep(0.65, 0.03, distFromNozzle)
                   * pow(fresnel, 2.2)
                   * uMachDiamonds;

    float hotSpine = pow(fresnel, 2.6) * smoothstep(0.75, 0.0, distFromNozzle);

    vec3 col = mix(uColorCore, uColorMid, smoothstep(0.04, 0.42, distFromNozzle + (flameNoise - 0.5) * 0.24));
    col = mix(col, uColorTip, smoothstep(0.38, 0.94, distFromNozzle));
    col += uColorCore * (machWave * 1.9 + hotSpine * 0.85);

    float lengthFade = smoothstep(1.0, 0.10, distFromNozzle + (1.0 - flameNoise) * 0.24);
    float nozzlePinch = smoothstep(0.0, 0.03, distFromNozzle);
    float alpha = edgeSoftness * lengthFade * nozzlePinch * (0.78 + 0.62 * flameNoise) * uThrottle;

    gl_FragColor = vec4(col * uIntensity, clamp(alpha, 0.0, 1.0));
  }
`;

interface PlumeConfig {
	topRadius: number;
	bottomRadius: number;
	length: number;
	colorCore: string;
	colorMid: string;
	colorTip: string;
	turbulence: number;
	machDiamonds: number;
	intensity: number;
}

export interface ExhaustUpdateOptions {
	coreThrottle?: number;
	srbThrottle?: number;
	padGroundY?: number;
}

export interface SLSExhaustFireController {
	update: (dt: number, options?: ExhaustUpdateOptions) => void;
	dispose: () => void;
}

function createPlumeMesh(
	cfg: PlumeConfig
): THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial> {
	// 20x18 tessellation keeps vertex throughput fast on integrated GPUs
	const geo = new THREE.CylinderGeometry(cfg.topRadius, cfg.bottomRadius, cfg.length, 20, 18, true);
	geo.translate(0, -cfg.length * 0.5, 0);

	const mat = new THREE.ShaderMaterial({
		vertexShader: PLUME_VERTEX_SHADER,
		fragmentShader: PLUME_FRAGMENT_SHADER,
		uniforms: {
			uTime: { value: 0 },
			uThrottle: { value: 0.0 },
			uTurbulence: { value: cfg.turbulence },
			uColorCore: { value: new THREE.Color(cfg.colorCore) },
			uColorMid: { value: new THREE.Color(cfg.colorMid) },
			uColorTip: { value: new THREE.Color(cfg.colorTip) },
			uMachDiamonds: { value: cfg.machDiamonds },
			uIntensity: { value: cfg.intensity }
		},
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide
	});

	const mesh = new THREE.Mesh(geo, mat);
	mesh.frustumCulled = false;
	return mesh;
}

function createSoftParticleTexture(): THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = 128;
	canvas.height = 128;
	const ctx = canvas.getContext('2d');
	if (ctx) {
		const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
		grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
		grad.addColorStop(0.28, 'rgba(255, 232, 165, 0.85)');
		grad.addColorStop(0.62, 'rgba(255, 115, 25, 0.35)');
		grad.addColorStop(1.0, 'rgba(0, 0, 0, 0.0)');
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, 128, 128);
	}
	return new THREE.CanvasTexture(canvas);
}

export function createSLSExhaustFire(rocketRoot: THREE.Object3D): SLSExhaustFireController {
	const srbMaterials: THREE.ShaderMaterial[] = [];
	const coreMaterials: THREE.ShaderMaterial[] = [];
	const createdMeshes: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>[] = [];

	// 1. Twin 5-Segment Solid Rocket Booster Plumes (high-thrust golden-white flame columns)
	for (const srbName of ['SLS_SRB_Left', 'SLS_SRB_Right']) {
		const srbObj = rocketRoot.getObjectByName(srbName);
		if (!srbObj) continue;

		const outerSrb = createPlumeMesh({
			topRadius: 1.75,
			bottomRadius: 5.8,
			length: 38.0,
			colorCore: '#ffffff',
			colorMid: '#ff9d1c',
			colorTip: '#c21800',
			turbulence: 1.55,
			machDiamonds: 0.25,
			intensity: 2.35
		});

		const innerSrb = createPlumeMesh({
			topRadius: 1.2,
			bottomRadius: 2.8,
			length: 23.0,
			colorCore: '#ffffff',
			colorMid: '#ffe680',
			colorTip: '#ff6a00',
			turbulence: 0.85,
			machDiamonds: 0.45,
			intensity: 2.75
		});

		srbObj.add(outerSrb, innerSrb);
		srbMaterials.push(outerSrb.material, innerSrb.material);
		createdMeshes.push(outerSrb, innerSrb);
	}

	// 2. Four RS-25 Core Stage Liquid Hydrogen/Oxygen Plumes (outer flame sheath + inner shock core)
	const coreStage = rocketRoot.getObjectByName('SLS_Core_Stage') ?? rocketRoot;
	for (let i = 0; i < 4; i++) {
		const ang = (2.0 * Math.PI * i) / 4.0 + Math.PI / 4.0;
		const ex = Math.cos(ang) * 1.95;
		const ez = Math.sin(ang) * 1.95;

		const rs25Outer = createPlumeMesh({
			topRadius: 1.25,
			bottomRadius: 3.4,
			length: 26.0,
			colorCore: '#f0f8ff',
			colorMid: '#ff9524',
			colorTip: '#b91c0c',
			turbulence: 0.98,
			machDiamonds: 1.25,
			intensity: 2.15
		});
		rs25Outer.position.set(ex, 0.0, ez);

		const rs25Core = createPlumeMesh({
			topRadius: 0.72,
			bottomRadius: 1.55,
			length: 16.5,
			colorCore: '#ffffff',
			colorMid: '#7dd3fc',
			colorTip: '#fb923c',
			turbulence: 0.45,
			machDiamonds: 1.8,
			intensity: 2.6
		});
		rs25Core.position.set(ex, 0.0, ez);

		coreStage.add(rs25Outer, rs25Core);
		coreMaterials.push(rs25Outer.material, rs25Core.material);
		createdMeshes.push(rs25Outer, rs25Core);
	}

	// 3. High-output Engine Glow Light (no shadow map overhead for iGPU speed)
	const engineLight = new THREE.PointLight('#ff8c24', 0.0, 135.0, 1.35);
	engineLight.position.set(0, -4.0, 0);
	rocketRoot.add(engineLight);

	// 4. Additive Ember & Flame-Trench Blast Particle System (340 particles, 1 draw call)
	const particleCount = 340;
	const positions = new Float32Array(particleCount * 3);
	const velocities = new Float32Array(particleCount * 3);
	const ages = new Float32Array(particleCount);
	const maxAges = new Float32Array(particleCount);

	const emitterOrigins = [
		new THREE.Vector3(-6.32, 0, 0),
		new THREE.Vector3(6.32, 0, 0),
		new THREE.Vector3(0, 0, 0)
	];

	function respawnParticle(idx: number, initialSpread = false) {
		const origin = emitterOrigins[idx % emitterOrigins.length];
		const angle = Math.random() * Math.PI * 2;
		const radius = Math.random() * 1.7;

		positions[idx * 3 + 0] = origin.x + Math.cos(angle) * radius;
		positions[idx * 3 + 1] =
			origin.y - (initialSpread ? Math.random() * 18.0 : Math.random() * 1.6);
		positions[idx * 3 + 2] = origin.z + Math.sin(angle) * radius;

		velocities[idx * 3 + 0] = Math.cos(angle) * (2.2 + Math.random() * 6.5);
		velocities[idx * 3 + 1] = -(19.0 + Math.random() * 24.0);
		velocities[idx * 3 + 2] = Math.sin(angle) * (2.2 + Math.random() * 6.5);

		ages[idx] = initialSpread ? Math.random() : 0.0;
		maxAges[idx] = 0.48 + Math.random() * 0.62;
	}

	for (let i = 0; i < particleCount; i++) {
		respawnParticle(i, true);
	}

	const particleGeo = new THREE.BufferGeometry();
	particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

	const particleTex = createSoftParticleTexture();
	const particleMat = new THREE.PointsMaterial({
		size: 6.8,
		map: particleTex,
		color: new THREE.Color('#ffaa44'),
		transparent: true,
		opacity: 0.0,
		depthWrite: false,
		blending: THREE.AdditiveBlending
	});

	const particles = new THREE.Points(particleGeo, particleMat);
	particles.frustumCulled = false;
	rocketRoot.add(particles);

	let elapsed = 0;

	return {
		update(
			dt: number,
			{ coreThrottle = 1.0, srbThrottle = 1.0, padGroundY = 0.0 }: ExhaustUpdateOptions = {}
		) {
			elapsed += dt;

			for (const mat of srbMaterials) {
				mat.uniforms.uTime.value = elapsed;
				mat.uniforms.uThrottle.value = srbThrottle;
			}
			for (const mat of coreMaterials) {
				mat.uniforms.uTime.value = elapsed;
				mat.uniforms.uThrottle.value = coreThrottle;
			}

			const activeThrottle = Math.max(coreThrottle, srbThrottle);
			const powerBoost = srbThrottle > 0.1 ? 1.35 : 1.0;

			particles.visible = activeThrottle > 0.01;
			engineLight.intensity =
				activeThrottle *
				powerBoost *
				(24.0 + Math.sin(elapsed * 47.0) * 4.5 + Math.cos(elapsed * 71.0) * 2.5);
			particleMat.opacity = Math.min(0.92, activeThrottle * 0.85);
			particleMat.size = 6.2 + Math.sin(elapsed * 31.0) * 0.7;

			if (activeThrottle <= 0.01) return;

			const rocketWorldY = rocketRoot.position.y;
			const posAttr = particleGeo.attributes.position as THREE.BufferAttribute;
			const arr = posAttr.array as Float32Array;

			for (let i = 0; i < particleCount; i++) {
				// Skip SRB particle emitters once SRBs detach
				if (srbThrottle <= 0.05 && i % 3 !== 2) {
					ages[i] = maxAges[i];
					arr[i * 3 + 1] = 0;
					continue;
				}

				ages[i] += dt;
				if (ages[i] >= maxAges[i]) {
					respawnParticle(i, false);
					continue;
				}

				let px = arr[i * 3 + 0] + velocities[i * 3 + 0] * dt;
				let py = arr[i * 3 + 1] + velocities[i * 3 + 1] * dt;
				let pz = arr[i * 3 + 2] + velocities[i * 3 + 2] * dt;

				// Deflect flame plume outward across Pad 39B flame trench during ignition & liftoff
				const worldY = rocketWorldY + py;
				if (worldY < padGroundY + 0.6) {
					py = padGroundY + 0.6 - rocketWorldY;
					const outLen = Math.hypot(px, pz) || 1.0;
					px += (px / outLen) * 28.0 * dt;
					pz += (pz / outLen) * 28.0 * dt;
				}

				arr[i * 3 + 0] = px;
				arr[i * 3 + 1] = py;
				arr[i * 3 + 2] = pz;
			}
			posAttr.needsUpdate = true;
		},

		dispose() {
			for (const mesh of createdMeshes) {
				mesh.removeFromParent();
				mesh.geometry.dispose();
				mesh.material.dispose();
			}
			engineLight.removeFromParent();
			particles.removeFromParent();
			particleGeo.dispose();
			particleMat.dispose();
			particleTex.dispose();
		}
	};
}
