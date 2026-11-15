import * as THREE from 'three';

export interface PadEnvironmentRefs {
	ground: THREE.Mesh;
	apron: THREE.Mesh;
	trench: THREE.Mesh;
	stars: THREE.Points;
}

export interface OrbitalIssRefs {
	root: THREE.Group;
	pulseRing: THREE.Mesh;
}

export function buildPadEnvironment(scene: THREE.Scene): PadEnvironmentRefs {
	const fadeMaterials: THREE.Material[] = [];
	const regMat = <T extends THREE.Material>(mat: T): T => {
		fadeMaterials.push(mat);
		return mat;
	};

	// 1. Vast Earth Landmass (4800 x 4800)
	const groundMat = regMat(
		new THREE.MeshStandardMaterial({
			color: 0x3f6236,
			roughness: 0.94,
			transparent: true,
			opacity: 1
		})
	);
	const ground = new THREE.Mesh(new THREE.PlaneGeometry(4800, 4800), groundMat);
	ground.rotation.x = -Math.PI / 2;
	scene.add(ground);

	// Counter-rotated child group so all Earth props use standard world (X, Y-up, Z) coordinates
	const earthScape = new THREE.Group();
	earthScape.rotation.x = Math.PI / 2;
	ground.add(earthScape);

	// Sync opacity of all Earth terrain, ocean, trees & clouds when fading into space
	ground.onBeforeRender = () => {
		const op = groundMat.opacity;
		for (let i = 0; i < fadeMaterials.length; i++) {
			fadeMaterials[i].opacity = op;
		}
	};

	// 2. Expanded Concrete Launch Complex Platform (320 x 320) & Inner Blast Apron
	const apron = new THREE.Mesh(
		new THREE.BoxGeometry(320, 0.8, 320),
		regMat(
			new THREE.MeshStandardMaterial({
				color: 0x7b828c,
				roughness: 0.88,
				transparent: true,
				opacity: 1
			})
		)
	);
	apron.position.set(0, 0.4, 0);
	scene.add(apron);

	const innerPadMat = regMat(
		new THREE.MeshStandardMaterial({
			color: 0x949ba6,
			roughness: 0.82,
			transparent: true,
			opacity: 1
		})
	);
	const innerPad = new THREE.Mesh(new THREE.BoxGeometry(145, 0.35, 145), innerPadMat);
	innerPad.position.set(0, 0.95, 0);
	earthScape.add(innerPad);

	// Pad Perimeter Hazard Curb
	const curbMat = regMat(
		new THREE.MeshStandardMaterial({
			color: 0xd97706,
			roughness: 0.55,
			transparent: true,
			opacity: 1
		})
	);
	const curbNorth = new THREE.Mesh(new THREE.BoxGeometry(322, 1.4, 2.2), curbMat);
	curbNorth.position.set(0, 0.7, -160);
	const curbSouth = new THREE.Mesh(new THREE.BoxGeometry(322, 1.4, 2.2), curbMat);
	curbSouth.position.set(0, 0.7, 160);
	const curbWest = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 322), curbMat);
	curbWest.position.set(-160, 0.7, 0);
	const curbEast = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 322), curbMat);
	curbEast.position.set(160, 0.7, 0);
	earthScape.add(curbNorth, curbSouth, curbWest, curbEast);

	// Flame Trench
	const trench = new THREE.Mesh(
		new THREE.BoxGeometry(22, 1.1, 74),
		regMat(
			new THREE.MeshStandardMaterial({
				color: 0x1e2126,
				roughness: 0.96,
				transparent: true,
				opacity: 1
			})
		)
	);
	trench.position.set(0, 0.65, 0);
	scene.add(trench);

	// 3. Dual-Lane Crawlerway Road leading toward the Vehicle Assembly Building
	const roadMat = regMat(
		new THREE.MeshStandardMaterial({
			color: 0x646b75,
			roughness: 0.9,
			transparent: true,
			opacity: 1
		})
	);
	for (const laneX of [-13, 13]) {
		const lane = new THREE.Mesh(new THREE.BoxGeometry(14, 0.45, 920), roadMat);
		lane.position.set(laneX, 0.22, -620);
		earthScape.add(lane);
	}

	// 4. Cape Canaveral Atlantic Coastline: Sandy Beach & Ocean (+X)
	const beachMat = regMat(
		new THREE.MeshStandardMaterial({
			color: 0xe6d3a7,
			roughness: 0.92,
			transparent: true,
			opacity: 1
		})
	);
	const beach = new THREE.Mesh(new THREE.BoxGeometry(75, 0.25, 4800), beachMat);
	beach.position.set(245, 0.12, 0);
	earthScape.add(beach);

	const foamMat = regMat(
		new THREE.MeshStandardMaterial({
			color: 0xe0f2fe,
			roughness: 0.5,
			transparent: true,
			opacity: 1
		})
	);
	const surfFoam = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, 4800), foamMat);
	surfFoam.position.set(282, 0.15, 0);
	earthScape.add(surfFoam);

	const oceanMat = regMat(
		new THREE.MeshStandardMaterial({
			color: 0x1d6fa5,
			roughness: 0.35,
			metalness: 0.15,
			transparent: true,
			opacity: 1
		})
	);
	const ocean = new THREE.Mesh(new THREE.BoxGeometry(2120, 0.22, 4800), oceanMat);
	ocean.position.set(1340, 0.11, 0);
	earthScape.add(ocean);

	// 5. Pad 39B Lightning Protection Towers with Red Aviation Beacons
	const mastMat = regMat(
		new THREE.MeshStandardMaterial({
			color: 0xcbd5e1,
			metalness: 0.6,
			roughness: 0.4,
			transparent: true,
			opacity: 1
		})
	);
	const beaconMat = regMat(
		new THREE.MeshStandardMaterial({
			color: 0xef4444,
			emissive: 0xdc2626,
			emissiveIntensity: 1.4,
			transparent: true,
			opacity: 1
		})
	);
	for (const [tx, tz] of [
		[-88, -88],
		[88, -88],
		[-88, 88],
		[88, 88]
	] as const) {
		const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 1.8, 128, 8), mastMat);
		mast.position.set(tx, 64, tz);
		const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.3, 8, 8), beaconMat);
		beacon.position.set(tx, 129, tz);
		earthScape.add(mast, beacon);
	}

	// 6. Distant KSC Water Tower & Vehicle Assembly Building (VAB) for Earth Horizon Scale
	const waterTower = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 6.5, 22, 14), mastMat);
	waterTower.position.set(-135, 62, -195);
	const waterLeg = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.8, 52, 10), mastMat);
	waterLeg.position.set(-135, 26, -195);
	earthScape.add(waterTower, waterLeg);

	const vabBody = new THREE.Mesh(new THREE.BoxGeometry(115, 135, 95), mastMat);
	vabBody.position.set(-210, 67.5, -760);
	const vabDoorStripe = new THREE.Mesh(
		new THREE.BoxGeometry(28, 118, 97),
		regMat(
			new THREE.MeshStandardMaterial({
				color: 0x1e293b,
				roughness: 0.7,
				transparent: true,
				opacity: 1
			})
		)
	);
	vabDoorStripe.position.set(-210, 59, -760);
	earthScape.add(vabBody, vabDoorStripe);

	// 7. Instanced Coastal Pine/Palm Trees (2 draw calls total, iGPU-friendly)
	const treeCount = 110;
	const trunkGeo = new THREE.CylinderGeometry(0.45, 0.75, 6.5, 6);
	const crownGeo = new THREE.ConeGeometry(3.4, 9.5, 7);
	const trunkMat = regMat(
		new THREE.MeshStandardMaterial({
			color: 0x6b4423,
			roughness: 0.9,
			transparent: true,
			opacity: 1
		})
	);
	const crownMat = regMat(
		new THREE.MeshStandardMaterial({
			color: 0x2d5a27,
			roughness: 0.85,
			transparent: true,
			opacity: 1
		})
	);

	const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
	const crowns = new THREE.InstancedMesh(crownGeo, crownMat, treeCount);
	const dummy = new THREE.Object3D();

	let placed = 0;
	let seed = 17;
	const nextRand = () => {
		seed = (seed * 16807) % 2147483647;
		return (seed - 1) / 2147483646;
	};

	while (placed < treeCount) {
		const x = (nextRand() - 0.5) * 900;
		const z = (nextRand() - 0.5) * 900;
		// Keep clear of the 320x320 concrete pad, the ocean (>205), and the crawlerway
		if (Math.abs(x) < 178 && Math.abs(z) < 178) continue;
		if (x > 202) continue;
		if (Math.abs(x) < 28 && z < -160) continue;

		const s = 0.85 + nextRand() * 0.85;
		dummy.position.set(x, 3.25 * s, z);
		dummy.scale.set(s, s, s);
		dummy.rotation.y = nextRand() * Math.PI * 2;
		dummy.updateMatrix();
		trunks.setMatrixAt(placed, dummy.matrix);

		dummy.position.set(x, 9.5 * s, z);
		dummy.updateMatrix();
		crowns.setMatrixAt(placed, dummy.matrix);
		placed++;
	}
	earthScape.add(trunks, crowns);

	// 8. Low-Poly Puffy Earth Clouds in the Troposphere
	const cloudMat = regMat(
		new THREE.MeshStandardMaterial({
			color: 0xffffff,
			roughness: 0.95,
			flatShading: true,
			transparent: true,
			opacity: 1
		})
	);
	const cloudPuffGeo = new THREE.DodecahedronGeometry(16, 1);
	const cloudCoords: Array<[number, number, number, number]> = [
		[-220, 175, -180, 1.3],
		[260, 195, -240, 1.5],
		[-310, 210, 160, 1.4],
		[340, 185, 220, 1.2],
		[40, 225, -380, 1.6],
		[-120, 200, 340, 1.3]
	];
	for (const [cx, cy, cz, cs] of cloudCoords) {
		const cloud = new THREE.Group();
		cloud.position.set(cx, cy, cz);
		cloud.scale.setScalar(cs);
		for (let p = -1; p <= 1; p++) {
			const puff = new THREE.Mesh(cloudPuffGeo, cloudMat);
			puff.position.set(p * 14, p === 0 ? 4 : 0, (p % 2) * 5);
			puff.scale.set(1.2, 0.65, 0.9);
			cloud.add(puff);
		}
		earthScape.add(cloud);
	}

	// 9. Starfield
	const starCount = 950;
	const starPos = new Float32Array(starCount * 3);
	for (let i = 0; i < starCount; i++) {
		const theta = Math.random() * Math.PI * 2;
		const phi = Math.acos(Math.random() * 0.95);
		const r = 650;
		starPos[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
		starPos[i * 3 + 1] = r * Math.cos(phi) + 80;
		starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
	}
	const starGeo = new THREE.BufferGeometry();
	starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
	const starMat = new THREE.PointsMaterial({
		color: 0xffffff,
		size: 2.3,
		transparent: true,
		opacity: 0.0
	});
	const stars = new THREE.Points(starGeo, starMat);
	scene.add(stars);

	return { ground, apron, trench, stars };
}

export function buildOrbitalIssStation(scene: THREE.Scene): OrbitalIssRefs {
	const root = new THREE.Group();
	root.name = 'ISS_Live_Station';
	root.visible = false;

	const trussMat = new THREE.MeshStandardMaterial({
		color: 0xe2e8f0,
		metalness: 0.75,
		roughness: 0.3
	});
	const moduleMat = new THREE.MeshStandardMaterial({
		color: 0xf8fafc,
		metalness: 0.45,
		roughness: 0.35
	});
	const solarGoldMat = new THREE.MeshStandardMaterial({
		color: 0xd97706,
		emissive: 0x78350f,
		emissiveIntensity: 0.45,
		metalness: 0.85,
		roughness: 0.22
	});

	// Integrated Main Truss
	const mainTruss = new THREE.Mesh(new THREE.BoxGeometry(22.0, 0.75, 0.75), trussMat);
	root.add(mainTruss);

	// Pressurized Modules
	const coreSpine = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 8.8, 12), moduleMat);
	coreSpine.rotation.x = Math.PI / 2;
	root.add(coreSpine);

	const crossNode = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 5.0, 12), moduleMat);
	crossNode.rotation.z = Math.PI / 2;
	crossNode.position.z = 1.4;
	root.add(crossNode);

	// 8 Golden Solar Array Wings
	for (const xOffset of [-8.8, -6.0, 6.0, 8.8]) {
		for (const zDir of [-1, 1]) {
			const wing = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 6.6), solarGoldMat);
			wing.position.set(xOffset, 0, zDir * 3.8);
			root.add(wing);
		}
	}

	// Cyan Live Telemetry Beacon Ring
	const pulseRing = new THREE.Mesh(
		new THREE.RingGeometry(12.5, 14.0, 32),
		new THREE.MeshBasicMaterial({
			color: 0x38bdf8,
			transparent: true,
			opacity: 0.85,
			side: THREE.DoubleSide
		})
	);
	root.add(pulseRing);

	scene.add(root);
	return { root, pulseRing };
}

export function buildFallbackMobileLauncherDock(): THREE.Group {
	const group = new THREE.Group();
	group.name = 'Mobile_Launcher_Root';

	const concreteMat = new THREE.MeshStandardMaterial({ color: 0x565d68, roughness: 0.85 });
	const steelMat = new THREE.MeshStandardMaterial({
		color: 0x9aa3b0,
		metalness: 0.65,
		roughness: 0.4
	});
	const hazardMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.4 });
	const whiteRoomMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.3 });

	const rearDeck = new THREE.Mesh(new THREE.BoxGeometry(34, 8, 14), concreteMat);
	rearDeck.position.set(0, 4, -14);
	const frontDeck = new THREE.Mesh(new THREE.BoxGeometry(34, 8, 14), concreteMat);
	frontDeck.position.set(0, 4, 14);
	const leftDeck = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 14), concreteMat);
	leftDeck.position.set(-13, 4, 0);
	const rightDeck = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 14), concreteMat);
	rightDeck.position.set(13, 4, 0);
	group.add(rearDeck, frontDeck, leftDeck, rightDeck);

	const tower = new THREE.Mesh(new THREE.BoxGeometry(9.6, 108, 9.6), steelMat);
	tower.position.set(0, 62, -16.5);
	group.add(tower);

	const caaPivot = new THREE.Group();
	caaPivot.name = 'Dock_Crew_Access_Arm';
	caaPivot.position.set(0, 91.5, -11.7);
	const caaBridge = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.2, 7.6), steelMat);
	caaBridge.position.set(0, 0, 3.8);
	const whiteRoom = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.8, 2.4), whiteRoomMat);
	whiteRoom.position.set(0, 0, 8.6);
	const collar = new THREE.Mesh(new THREE.BoxGeometry(2.8, 3.0, 0.45), hazardMat);
	collar.position.set(0, 0, 10.0);
	caaPivot.add(caaBridge, whiteRoom, collar);
	group.add(caaPivot);

	const icpsPivot = new THREE.Group();
	icpsPivot.name = 'Dock_ICPS_Umbilical_Arm';
	icpsPivot.position.set(0, 78.0, -11.7);
	const icpsBeam = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.3, 8.4), steelMat);
	icpsBeam.position.set(0, 0, 4.2);
	icpsPivot.add(icpsBeam);
	group.add(icpsPivot);

	const corePivot = new THREE.Group();
	corePivot.name = 'Dock_Core_Intertank_Arm';
	corePivot.position.set(0, 57.0, -11.7);
	const coreBeam = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.4, 7.0), steelMat);
	coreBeam.position.set(0, 0, 3.5);
	corePivot.add(coreBeam);
	group.add(corePivot);

	for (const [side, sx] of [
		['Left', -6.32],
		['Right', 6.32]
	] as const) {
		for (const [end, sz] of [
			['Front', 2.15],
			['Back', -2.15]
		] as const) {
			const clamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.0, 1.0), hazardMat);
			clamp.name = `Dock_HoldDown_${side}_${end}`;
			clamp.position.set(sx, 9.0, sz);
			group.add(clamp);
		}
	}

	return group;
}

export function buildFallbackSlsOrion(): THREE.Group {
	const root = new THREE.Group();
	root.name = 'SLS_Block1_Root';

	const sofiMat = new THREE.MeshStandardMaterial({ color: 0xc85a17, roughness: 0.82 });
	const whiteMat = new THREE.MeshStandardMaterial({ color: 0xeef2f6, roughness: 0.36 });
	const silverMat = new THREE.MeshStandardMaterial({
		color: 0xcbd5e1,
		metalness: 0.82,
		roughness: 0.26
	});
	const nozzleMat = new THREE.MeshStandardMaterial({
		color: 0x22262e,
		metalness: 0.9,
		roughness: 0.25
	});
	const redMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.4 });
	const blackMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.4 });
	const solarMat = new THREE.MeshStandardMaterial({
		color: 0x1e3a8a,
		emissive: 0x0f172a,
		metalness: 0.85,
		roughness: 0.22
	});

	const coreGroup = new THREE.Group();
	coreGroup.name = 'SLS_Core_Stage';
	const aftSkirt = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 3.8, 7.8, 24), whiteMat);
	aftSkirt.position.y = 6.7;
	const mainTank = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 51.6, 24), sofiMat);
	mainTank.position.y = 36.4;
	const fwdSkirt = new THREE.Mesh(new THREE.CylinderGeometry(4.19, 4.2, 2.4, 24), whiteMat);
	fwdSkirt.position.y = 63.4;
	const lvsa = new THREE.Mesh(new THREE.CylinderGeometry(2.515, 4.19, 8.38, 24), whiteMat);
	lvsa.position.y = 68.79;
	coreGroup.add(aftSkirt, mainTank, fwdSkirt, lvsa);

	for (let i = 0; i < 4; i++) {
		const ang = (Math.PI * 2 * i) / 4 + Math.PI / 4;
		const rs25 = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 1.15, 2.85, 14), nozzleMat);
		rs25.position.set(Math.cos(ang) * 1.95, 1.425, Math.sin(ang) * 1.95);
		coreGroup.add(rs25);
	}
	root.add(coreGroup);

	for (const [side, sx] of [
		['Left', -6.32],
		['Right', 6.32]
	] as const) {
		const srb = new THREE.Group();
		srb.name = `SLS_SRB_${side}`;
		srb.position.set(sx, 0, 0);
		const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.55, 1.65, 16), nozzleMat);
		nozzle.position.y = 0.825;
		const body = new THREE.Mesh(new THREE.CylinderGeometry(1.85, 1.95, 45.05, 20), whiteMat);
		body.position.y = 24.175;
		const redStripe = new THREE.Mesh(new THREE.CylinderGeometry(1.87, 1.87, 1.15, 20), redMat);
		redStripe.position.y = 38.2;
		const blackStripe = new THREE.Mesh(new THREE.CylinderGeometry(1.87, 1.87, 1.35, 20), blackMat);
		blackStripe.position.y = 41.6;
		const nose = new THREE.Mesh(new THREE.ConeGeometry(1.85, 7.3, 20), whiteMat);
		nose.position.y = 50.35;
		srb.add(nozzle, body, redStripe, blackStripe, nose);
		root.add(srb);
	}
	const icps = new THREE.Mesh(new THREE.CylinderGeometry(2.54, 2.54, 4.9, 20), sofiMat);
	icps.position.y = 75.43;
	const esmGroup = new THREE.Group();
	esmGroup.name = 'Orion_Service_Module';
	esmGroup.position.y = 80.26;
	const esmBody = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 4.79, 20), whiteMat);
	esmGroup.add(esmBody);
	for (let i = 0; i < 4; i++) {
		const yaw = (Math.PI * 2 * i) / 4 + Math.PI / 4;
		const wingMount = new THREE.Group();
		wingMount.position.set(Math.cos(yaw) * 2.52, -0.4, Math.sin(yaw) * 2.52);
		wingMount.rotation.y = -yaw;
		const wingPivot = new THREE.Group();
		wingPivot.name = `Orion_SolarArray_${i + 1}`;
		const panel = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.14, 1.65), solarMat);
		panel.position.set(3.75, 0, 0);
		const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 8), silverMat);
		strut.rotation.z = Math.PI / 2;
		strut.position.set(0.3, 0, 0);

		wingPivot.add(strut, panel);
		wingMount.add(wingPivot);
		esmGroup.add(wingMount);
	}

	const cm = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 2.5, 2.73, 24), silverMat);
	cm.name = 'Orion_Crew_Module';
	cm.position.y = 84.4;
	root.add(icps, esmGroup, cm);

	const las = new THREE.Group();
	las.name = 'Orion_Launch_Abort_System';
	las.position.y = 83.02;
	const ogive = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 2.6, 5.0, 20), whiteMat);
	ogive.position.y = 2.5;
	const tower = new THREE.Mesh(new THREE.ConeGeometry(0.45, 10.25, 18), whiteMat);
	tower.position.y = 10.125;
	las.add(ogive, tower);
	root.add(las);

	return root;
}
