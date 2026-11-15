import * as THREE from 'three';

export interface SurfaceHit {
	y: number;
	normal: THREE.Vector3;
	surfaceType?: string;
}

export interface SurfaceProvider {
	sampleSurfaceAt(x: number, z: number): SurfaceHit;
}

export class FlatSurfaceProvider implements SurfaceProvider {
	private readonly floorY: number;
	private readonly up = new THREE.Vector3(0, 1, 0);

	constructor(floorY = 0) {
		this.floorY = floorY;
	}

	sampleSurfaceAt(_x: number, _z: number): SurfaceHit {
		return {
			y: this.floorY,
			normal: this.up,
			surfaceType: 'Standard_Floor'
		};
	}
}

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

export type WorldCollider = CylinderCollider | ObbCollider;

export interface DynamicPropCollider {
	object: THREE.Object3D;
	collider: ObbCollider;
	halfHeight: number;
}

export interface CollisionMeshFilter {
	cylinderKeywords?: string[];
	excludedKeywords?: string[];
	dynamicPredicates?: Record<string, () => boolean>;
	minHeightThreshold?: number;
}

export interface CollisionQueryOptions {
	vehicleObj?: THREE.Object3D | null;
	includeVehicle?: boolean;
	ignoredObject?: THREE.Object3D | null;
}

export class CollisionWorld {
	protected staticColliders: WorldCollider[] = [];
	protected propColliders: DynamicPropCollider[] = [];
	private scratchPropPos = new THREE.Vector3();

	private vehicleCollider: ObbCollider = {
		kind: 'obb',
		name: 'Active_Vehicle_Body',
		x: 0,
		z: 0,
		hx: 1.12,
		hz: 1.62,
		cosYaw: 1,
		sinYaw: 0,
		minY: -10,
		maxY: 10
	};

	clear() {
		this.staticColliders = [];
		this.propColliders = [];
	}

	addStaticCollider(collider: WorldCollider) {
		this.staticColliders.push(collider);
	}

	registerDynamicProps(objects: THREE.Object3D[], halfExtent = 0.48, halfHeight = 0.45) {
		this.propColliders = objects.map((obj) => ({
			object: obj,
			halfHeight,
			collider: {
				kind: 'obb',
				name: obj.name,
				x: obj.position.x,
				z: obj.position.z,
				hx: halfExtent,
				hz: halfExtent,
				cosYaw: Math.cos(obj.rotation.y),
				sinYaw: Math.sin(obj.rotation.y),
				minY: obj.position.y - halfHeight,
				maxY: obj.position.y + halfHeight
			}
		}));
	}

	buildFromSceneRoot(root: THREE.Object3D, filter: CollisionMeshFilter = {}) {
		this.staticColliders = [];
		root.updateMatrixWorld(true);

		const cylinderKeywords = filter.cylinderKeywords ?? [];
		const excludedKeywords = filter.excludedKeywords ?? [];
		const dynamicPredicates = filter.dynamicPredicates ?? {};
		const minHeightThreshold = filter.minHeightThreshold ?? 0.35;

		const localBox = new THREE.Box3();
		const corner = new THREE.Vector3();
		const worldPos = new THREE.Vector3();
		const worldQuat = new THREE.Quaternion();
		const worldScale = new THREE.Vector3();
		const euler = new THREE.Euler(0, 0, 0, 'YXZ');

		root.traverse((obj) => {
			if (!(obj instanceof THREE.Mesh) || !obj.geometry) return;
			const name = obj.name;

			if (excludedKeywords.some((kw) => name.includes(kw))) return;

			obj.geometry.computeBoundingBox();
			if (!obj.geometry.boundingBox) return;
			localBox.copy(obj.geometry.boundingBox);

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

			if (maxY - minY < minHeightThreshold) return;

			obj.matrixWorld.decompose(worldPos, worldQuat, worldScale);
			euler.setFromQuaternion(worldQuat, 'YXZ');

			const centerX = (minX + maxX) * 0.5;
			const centerZ = (minZ + maxZ) * 0.5;
			const dynamicFn = dynamicPredicates[name];

			if (cylinderKeywords.some((kw) => name.includes(kw))) {
				const radius = Math.max(maxX - minX, maxZ - minZ) * 0.5;
				if (radius >= 0.05) {
					this.staticColliders.push({
						kind: 'cylinder',
						name,
						x: centerX,
						z: centerZ,
						radius,
						minY,
						maxY,
						dynamic: dynamicFn
					});
				}
				return;
			}

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
				dynamic: dynamicFn
			});
		});
	}

	resolveHorizontal(
		pos: THREE.Vector3,
		radius: number,
		entityHeight: number,
		options?: CollisionQueryOptions
	) {
		const entMinY = pos.y + 0.18;
		const entMaxY = pos.y + entityHeight;

		let activeVehicleCollider: ObbCollider | null = null;
		if (options?.includeVehicle && options.vehicleObj) {
			const v = options.vehicleObj;
			this.vehicleCollider.x = v.position.x;
			this.vehicleCollider.z = v.position.z;
			this.vehicleCollider.cosYaw = Math.cos(v.rotation.y);
			this.vehicleCollider.sinYaw = Math.sin(v.rotation.y);
			this.vehicleCollider.minY = v.position.y - 0.6;
			this.vehicleCollider.maxY = v.position.y + 1.6;
			activeVehicleCollider = this.vehicleCollider;
		}

		for (let iter = 0; iter < 3; iter++) {
			for (const col of this.staticColliders) {
				if (col.dynamic && !col.dynamic()) continue;
				if (entMaxY < col.minY || entMinY > col.maxY) continue;
				this.pushOutOfCollider(pos, radius, col);
			}

			for (const entry of this.propColliders) {
				if (entry.object === options?.ignoredObject) continue;
				if (
					entry.object.parent &&
					entry.object.parent.name !== 'Scene' &&
					entry.object.parent.type !== 'Scene'
				) {
					continue;
				}
				entry.object.getWorldPosition(this.scratchPropPos);
				entry.collider.x = this.scratchPropPos.x;
				entry.collider.z = this.scratchPropPos.z;
				entry.collider.minY = this.scratchPropPos.y - entry.halfHeight;
				entry.collider.maxY = this.scratchPropPos.y + entry.halfHeight;
				if (entMaxY < entry.collider.minY || entMinY > entry.collider.maxY) continue;
				this.pushOutOfCollider(pos, radius, entry.collider);
			}

			if (activeVehicleCollider) {
				this.pushOutOfCollider(pos, radius, activeVehicleCollider);
			}
		}
	}

	private pushOutOfCollider(pos: THREE.Vector3, radius: number, col: WorldCollider) {
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
