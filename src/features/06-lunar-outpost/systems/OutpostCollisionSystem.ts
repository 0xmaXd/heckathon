import * as THREE from 'three';

export interface CylinderCollider {
	kind: 'cylinder';
	name: string;
	x: number;
	z: number;
	radius: number;
	minY: number;
	maxY: number;
	dynamic?: () => boolean;
}

export interface ObbCollider {
	kind: 'obb';
	name: string;
	x: number;
	z: number;
	hx: number;
	hz: number;
	cosYaw: number;
	sinYaw: number;
	minY: number;
	maxY: number;
	dynamic?: () => boolean;
}

export type OutpostCollider = CylinderCollider | ObbCollider;

const CYLINDER_KEYWORDS = [
	'Dome_Habitat_Shell',
	'Cabin_Module_Body',
	'Water_Tank_',
	'Command_Tower_Base',
	'Command_Tower_Shaft',
	'Comm_Dish_Pedestal_',
	'Storage_Pod_Base',
	'Fission_Reactor_Core',
	'Ice_Cryo_Storage_Tank',
	'Ice_Drill_Borehole_Collar',
	'Ice_Drill_Auger',
	'Solar_Mast_',
	'Outpost_Lamp_Pole_',
	'NASA_Flag_Pole'
];

const EXCLUDED_KEYWORDS = [
	'Orion_LOLA_Crater_Terrain',
	'Corridor_',
	'_Pad',
	'_Apron',
	'_Disc',
	'_HazardRing',
	'_NASALogo',
	'_Walkway',
	'_Foundation',
	'_Deck',
	'Terrace_Stair_Step',
	'Label_',
	'Solar_Dust_Layer_',
	'Sample_Metal_',
	'Sample_NonMetal_',
	'Beacon',
	'Ring',
	'Wires_',
	'Hose',
	'Orion_Moon_Rover',
	'Rover_',
	'Supply_Crate_'
];

export class OutpostCollisionSystem {
	private staticColliders: OutpostCollider[] = [];
	private crateColliders: { crate: THREE.Object3D; collider: ObbCollider }[] = [];
	private roverCollider: ObbCollider = {
		kind: 'obb',
		name: 'Orion_Moon_Rover_Body',
		x: 0,
		z: 0,
		hx: 1.12,
		hz: 1.62,
		cosYaw: 1,
		sinYaw: 0,
		minY: -10,
		maxY: 10
	};

	buildFromRoot(root: THREE.Object3D, crates: THREE.Object3D[], isAirlockOpen: () => boolean) {
		this.staticColliders = [];
		this.crateColliders = [];
		root.updateMatrixWorld(true);

		const localBox = new THREE.Box3();
		const corner = new THREE.Vector3();
		const worldPos = new THREE.Vector3();
		const worldQuat = new THREE.Quaternion();
		const worldScale = new THREE.Vector3();
		const euler = new THREE.Euler(0, 0, 0, 'YXZ');

		root.traverse((obj) => {
			if (!(obj instanceof THREE.Mesh) || !obj.geometry) return;
			const name = obj.name;

			if (EXCLUDED_KEYWORDS.some((kw) => name.includes(kw))) return;

			obj.geometry.computeBoundingBox();
			if (!obj.geometry.boundingBox) return;
			localBox.copy(obj.geometry.boundingBox);

			// Compute exact world AABB minY/maxY across all 8 corners
			let minY = Infinity;
			let maxY = -Infinity;
			let minX = Infinity;
			let maxX = -Infinity;
			let minZ = Infinity;
			let maxZ = -Infinity;

			for (let ix = 0; ix <= 1; ix++) {
				for (let iy = 0; iy <= 1; iy++) {
					for (let iz = 0; iz <= 1; iz++) {
						corner.set(
							ix === 0 ? localBox.min.x : localBox.max.x,
							iy === 0 ? localBox.min.y : localBox.max.y,
							iz === 0 ? localBox.min.z : localBox.max.z
						);
						corner.applyMatrix4(obj.matrixWorld);
						if (corner.y < minY) minY = corner.y;
						if (corner.y > maxY) maxY = corner.y;
						if (corner.x < minX) minX = corner.x;
						if (corner.x > maxX) maxX = corner.x;
						if (corner.z < minZ) minZ = corner.z;
						if (corner.z > maxZ) maxZ = corner.z;
					}
				}
			}

			// Skip flat ground plates
			if (maxY - minY < 0.35) return;

			obj.matrixWorld.decompose(worldPos, worldQuat, worldScale);
			euler.setFromQuaternion(worldQuat, 'YXZ');

			const centerX = (minX + maxX) * 0.5;
			const centerZ = (minZ + maxZ) * 0.5;
			const isAirlockDoor = name === 'Airlock_Outer_Door';

			if (CYLINDER_KEYWORDS.some((kw) => name.includes(kw))) {
				const radius = Math.max(maxX - minX, maxZ - minZ) * 0.5;
				if (radius >= 0.05) {
					this.staticColliders.push({
						kind: 'cylinder',
						name,
						x: centerX,
						z: centerZ,
						radius,
						minY,
						maxY
					});
				}
				return;
			}

			// Compute oriented half-extents in XZ plane
			const hx = Math.abs(localBox.max.x - localBox.min.x) * 0.5 * Math.abs(worldScale.x);
			const hz = Math.abs(localBox.max.z - localBox.min.z) * 0.5 * Math.abs(worldScale.z);
			if (hx < 0.05 || hz < 0.05) return;

			this.staticColliders.push({
				kind: 'obb',
				name,
				x: centerX,
				z: centerZ,
				hx,
				hz,
				cosYaw: Math.cos(euler.y),
				sinYaw: Math.sin(euler.y),
				minY,
				maxY,
				dynamic: isAirlockDoor ? () => !isAirlockOpen() : undefined
			});
		});

		// Dynamic colliders for movable Supply Crates
		for (const crate of crates) {
			this.crateColliders.push({
				crate,
				collider: {
					kind: 'obb',
					name: crate.name,
					x: crate.position.x,
					z: crate.position.z,
					hx: 0.48,
					hz: 0.48,
					cosYaw: Math.cos(crate.rotation.y),
					sinYaw: Math.sin(crate.rotation.y),
					minY: crate.position.y - 0.5,
					maxY: crate.position.y + 0.5
				}
			});
		}
	}

	resolveHorizontal(
		pos: THREE.Vector3,
		radius: number,
		entityHeight: number,
		options?: {
			roverObj?: THREE.Object3D | null;
			includeRover?: boolean;
			ignoredCrate?: THREE.Object3D | null;
		}
	) {
		const entMinY = pos.y + 0.18;
		const entMaxY = pos.y + entityHeight;

		// Update dynamic Rover collider when Astronaut is on foot
		let activeRoverCollider: ObbCollider | null = null;
		if (options?.includeRover && options.roverObj) {
			const r = options.roverObj;
			this.roverCollider.x = r.position.x;
			this.roverCollider.z = r.position.z;
			this.roverCollider.cosYaw = Math.cos(r.rotation.y);
			this.roverCollider.sinYaw = Math.sin(r.rotation.y);
			this.roverCollider.minY = r.position.y - 0.6;
			this.roverCollider.maxY = r.position.y + 1.6;
			activeRoverCollider = this.roverCollider;
		}

		// 3 solver iterations ensure smooth wall-sliding in corners
		for (let iter = 0; iter < 3; iter++) {
			for (const col of this.staticColliders) {
				if (col.dynamic && !col.dynamic()) continue;
				if (entMaxY < col.minY || entMinY > col.maxY) continue;
				this.pushOutOfCollider(pos, radius, col);
			}

			for (const entry of this.crateColliders) {
				if (entry.crate === options?.ignoredCrate) continue;
				// Skip crates currently attached to Astronaut or Rover cargo rack
				if (
					entry.crate.parent &&
					entry.crate.parent.name !== 'Scene' &&
					entry.crate.parent.type !== 'Scene'
				) {
					continue;
				}
				const wp = new THREE.Vector3();
				entry.crate.getWorldPosition(wp);
				entry.collider.x = wp.x;
				entry.collider.z = wp.z;
				entry.collider.minY = wp.y - 0.45;
				entry.collider.maxY = wp.y + 0.45;
				if (entMaxY < entry.collider.minY || entMinY > entry.collider.maxY) continue;
				this.pushOutOfCollider(pos, radius, entry.collider);
			}

			if (activeRoverCollider) {
				this.pushOutOfCollider(pos, radius, activeRoverCollider);
			}
		}
	}

	private pushOutOfCollider(pos: THREE.Vector3, radius: number, col: OutpostCollider) {
		if (col.kind === 'cylinder') {
			const dx = pos.x - col.x;
			const dz = pos.z - col.z;
			const minDist = radius + col.radius;
			const distSq = dx * dx + dz * dz;
			if (distSq >= minDist * minDist) return;

			const dist = Math.sqrt(distSq);
			if (dist > 1e-5) {
				const push = minDist - dist;
				pos.x += (dx / dist) * push;
				pos.z += (dz / dist) * push;
			} else {
				pos.x += minDist;
			}
			return;
		}

		// Circle vs. Oriented Bounding Box (OBB)
		const dx = pos.x - col.x;
		const dz = pos.z - col.z;
		const lx = dx * col.cosYaw - dz * col.sinYaw;
		const lz = dx * col.sinYaw + dz * col.cosYaw;

		const clampedX = Math.max(-col.hx, Math.min(col.hx, lx));
		const clampedZ = Math.max(-col.hz, Math.min(col.hz, lz));

		const diffX = lx - clampedX;
		const diffZ = lz - clampedZ;
		const distSq = diffX * diffX + diffZ * diffZ;

		if (distSq >= radius * radius) return;

		let pushLocalX = 0;
		let pushLocalZ = 0;

		if (distSq > 1e-8) {
			const dist = Math.sqrt(distSq);
			const overlap = radius - dist;
			pushLocalX = (diffX / dist) * overlap;
			pushLocalZ = (diffZ / dist) * overlap;
		} else {
			const penX = col.hx - Math.abs(lx);
			const penZ = col.hz - Math.abs(lz);
			if (penX < penZ) {
				pushLocalX = (lx >= 0 ? 1 : -1) * (penX + radius);
			} else {
				pushLocalZ = (lz >= 0 ? 1 : -1) * (penZ + radius);
			}
		}

		pos.x += pushLocalX * col.cosYaw + pushLocalZ * col.sinYaw;
		pos.z += -pushLocalX * col.sinYaw + pushLocalZ * col.cosYaw;
	}
}
