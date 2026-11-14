import * as THREE from 'three';
// import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class LockerRoomScene {
	public scene: THREE.Scene;

	constructor() {
		this.scene = new THREE.Scene();
		// Industrial dark grey background
		this.scene.background = new THREE.Color(0x111111);
		// Optional fog to hide the edges of the room
		this.scene.fog = new THREE.Fog(0x111111, 2, 15);
	}

	init() {
		// 1. Lighting (Essential for MeshStandardMaterial)
		const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
		this.scene.add(ambientLight);

		const ceilingLight = new THREE.PointLight(0xaaccff, 1, 10);
		ceilingLight.position.set(0, 4, 0);
		this.scene.add(ceilingLight);

		// 2. Procedural Placeholder Room (Until you get a .glb)

		// Floor
		const floorGeo = new THREE.PlaneGeometry(10, 10);
		const floorMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 });
		const floor = new THREE.Mesh(floorGeo, floorMat);
		floor.rotation.x = -Math.PI / 2;
		this.scene.add(floor);

		// Spacesuit Rack / Lockers (Blue boxes)
		const lockerGeo = new THREE.BoxGeometry(0.8, 2, 0.8);
		const lockerMat = new THREE.MeshStandardMaterial({ color: 0x1f4b8e });

		const locker1 = new THREE.Mesh(lockerGeo, lockerMat);
		locker1.position.set(-2, 1, -3);
		this.scene.add(locker1);

		const locker2 = locker1.clone();
		locker2.position.set(-1, 1, -3);
		this.scene.add(locker2);

		// Terminal / Utility Crate (Yellow box)
		const terminalGeo = new THREE.BoxGeometry(1.5, 1, 1);
		const terminalMat = new THREE.MeshStandardMaterial({ color: 0xcca300 });
		const terminal = new THREE.Mesh(terminalGeo, terminalMat);
		terminal.position.set(2, 0.5, -2);
		this.scene.add(terminal);

		// 3. GLTF Loader Setup (Uncomment when you have your file)
		/*
    const loader = new GLTFLoader();
    loader.load('/assets/models/locker_room.glb', (gltf) => {
      this.scene.add(gltf.scene);

      // Remove or hide the placeholder primitives once the model loads
      floor.visible = false;
      locker1.visible = false;
      locker2.visible = false;
      terminal.visible = false;
    }, undefined, (error) => {
      console.error('Error loading locker room model:', error);
    });
    */
	}
}

export const lockerRoomScene = new LockerRoomScene();
