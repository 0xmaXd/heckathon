import type { Snippet } from 'svelte';
import * as THREE from 'three';

export interface HudAction {
	id: string;
	label: string;
	variant?: 'default' | 'danger' | 'success';
	disabled?: boolean | (() => boolean);
	onClick: () => void;
}

export interface InteractionPrompt {
	key: string;
	label: string;
}

export interface InspectableMetadata {
	name: string;
	category?: string;
	description?: string;
	specs?: Record<string, string | number>;
	maxDistance?: number;
}

export interface InspectScreenPlacement {
	x: number;
	y: number;
	anchorX: number;
	anchorY: number;
	visible: boolean;
}

export interface SceneHudConfig {
	location: string;
	objective: string;
	panelTitle?: string | null;
	telemetry?: Record<string, string | number>;
	actions?: HudAction[];
	customWidget?: Snippet | null;
}

type PlacementSide = 'right' | 'left' | 'top' | 'bottom';

export type ScreenProjectFn = (
	worldPos: THREE.Vector3,
	out?: THREE.Vector3
) => { x: number; y: number; z: number; inFront: boolean } | null;

class HudStore {
	// Compulsory game-wide HUD state
	location = $state('EARTH // FACILITY');
	objective = $state('Awaiting mission orders');
	interactionPrompt = $state<InteractionPrompt | null>(null);
	commsMessage = $state<string | null>(null);
	blackout = $state({ active: false, message: '' });

	// Center-reticle inspection state
	canInspectTarget = $state(false);
	inspectedObject = $state<InspectableMetadata | null>(null);
	inspectPlacement = $state<InspectScreenPlacement | null>(null);

	// Scene-tailored HUD state
	panelTitle = $state<string | null>(null);
	telemetry = $state<Record<string, string | number>>({});
	actions = $state<HudAction[]>([]);
	customWidget = $state<Snippet | null>(null);

	// Internal tracking state
	private inspectedTarget: THREE.Object3D | null = null;
	private inspectMaxDistance = 0;
	private lastOnTargetTime = 0;
	private preferredSide: PlacementSide = 'right';
	private tempBox = new THREE.Box3();
	private meshBox = new THREE.Box3();
	private tempPos = new THREE.Vector3();
	private projVec = new THREE.Vector3();
	private cornerVec = new THREE.Vector3();

	configureScene(config: SceneHudConfig) {
		this.location = config.location;
		this.objective = config.objective;
		this.panelTitle = config.panelTitle ?? null;
		this.telemetry = config.telemetry ?? {};
		this.actions = config.actions ?? [];
		this.customWidget = config.customWidget ?? null;
		this.canInspectTarget = false;
		this.clearInspection();
		this.interactionPrompt = null;
		this.commsMessage = null;
		this.blackout = { active: false, message: '' };
	}

	private resolveInspectable(
		hit: THREE.Object3D | null
	): { target: THREE.Object3D; meta: InspectableMetadata } | null {
		let current: THREE.Object3D | null = hit;

		while (current && !(current instanceof THREE.Scene)) {
			if (current.userData?.inspect) {
				return {
					target: current,
					meta: current.userData.inspect as InspectableMetadata
				};
			}

			if (current.name && current.name.trim().length > 0) {
				return {
					target: current,
					meta: {
						name: current.name.replace(/_/g, ' '),
						category: current.userData?.category,
						description: current.userData?.description
					}
				};
			}

			current = current.parent;
		}

		return null;
	}

	private computeVisibleBounds(obj: THREE.Object3D, targetBox: THREE.Box3): THREE.Box3 {
		targetBox.makeEmpty();
		obj.updateWorldMatrix(true, true);

		obj.traverseVisible((child) => {
			if (child instanceof THREE.Mesh && child.geometry) {
				if (!child.geometry.boundingBox) {
					child.geometry.computeBoundingBox();
				}
				if (child.geometry.boundingBox) {
					this.meshBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
					targetBox.union(this.meshBox);
				}
			}
		});

		if (targetBox.isEmpty()) {
			targetBox.setFromObject(obj);
		}

		return targetBox;
	}

	private getDistanceToObject(obj: THREE.Object3D, point: THREE.Vector3): number {
		this.computeVisibleBounds(obj, this.tempBox);
		if (!this.tempBox.isEmpty()) {
			return this.tempBox.distanceToPoint(point);
		}
		obj.getWorldPosition(this.tempPos);
		return this.tempPos.distanceTo(point);
	}

	/**
	 * Updates center dot highlight and closes any open scan when aiming off the inspected object.
	 */
	updateReticleTarget(hit: THREE.Object3D | null) {
		const resolved = this.resolveInspectable(hit);
		this.canInspectTarget = resolved !== null;

		if (this.inspectedTarget) {
			if (resolved?.target === this.inspectedTarget) {
				this.lastOnTargetTime = performance.now();
			} else if (performance.now() - this.lastOnTargetTime > 120) {
				this.clearInspection();
			}
		}
	}

	/**
	 * Explicit Middle-Mouse-Button trigger: opens the scanner card for the aimed object.
	 */
	inspectThreeObject(hit: THREE.Object3D | null, cameraPosition?: THREE.Vector3 | null) {
		const resolved = this.resolveInspectable(hit);
		if (!resolved) {
			this.clearInspection();
			return;
		}

		this.inspectedObject = resolved.meta;
		this.inspectedTarget = resolved.target;
		this.lastOnTargetTime = performance.now();
		this.preferredSide = 'right';
		this.setInspectionThreshold(resolved.target, cameraPosition, resolved.meta.maxDistance);
	}

	private setInspectionThreshold(
		target: THREE.Object3D,
		cameraPosition?: THREE.Vector3 | null,
		explicitMax?: number
	) {
		if (explicitMax !== undefined) {
			this.inspectMaxDistance = explicitMax;
			return;
		}

		if (cameraPosition) {
			const initialDist = this.getDistanceToObject(target, cameraPosition);
			this.inspectMaxDistance = Math.max(initialDist * 1.35, initialDist + 3.0);
		} else {
			this.inspectMaxDistance = Infinity;
		}
	}

	/**
	 * Updates proximity and calculates a clean 2D screen position anchored next to the 3D object.
	 */
	updateInspectionTracking(
		cameraPosition: THREE.Vector3,
		projectFn: ScreenProjectFn,
		panelWidth: number,
		panelHeight: number,
		hasLeftPanel: boolean
	) {
		if (!this.inspectedObject || !this.inspectedTarget) return;

		if (!this.inspectedTarget.parent) {
			this.clearInspection();
			return;
		}

		const currentDistance = this.getDistanceToObject(this.inspectedTarget, cameraPosition);

		if (currentDistance > this.inspectMaxDistance) {
			this.clearInspection();
			return;
		}

		if (this.tempBox.containsPoint(cameraPosition) || currentDistance < 0.75) {
			this.inspectPlacement = { x: 0, y: 0, anchorX: 0, anchorY: 0, visible: false };
			return;
		}

		const { min, max } = this.tempBox;
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		let visibleCorners = 0;

		for (let ix = 0; ix < 2; ix++) {
			for (let iy = 0; iy < 2; iy++) {
				for (let iz = 0; iz < 2; iz++) {
					this.cornerVec.set(
						ix === 0 ? min.x : max.x,
						iy === 0 ? min.y : max.y,
						iz === 0 ? min.z : max.z
					);
					const projected = projectFn(this.cornerVec, this.projVec);
					if (projected && projected.inFront) {
						visibleCorners++;
						minX = Math.min(minX, projected.x);
						maxX = Math.max(maxX, projected.x);
						minY = Math.min(minY, projected.y);
						maxY = Math.max(maxY, projected.y);
					}
				}
			}
		}

		if (visibleCorners === 0) {
			this.inspectPlacement = { x: 0, y: 0, anchorX: 0, anchorY: 0, visible: false };
			return;
		}

		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const margin = 16;
		const topSafe = 86;
		const bottomSafe = vh - margin;
		const gap = 22;

		const clampedMinX = Math.max(0, minX);
		const clampedMaxX = Math.min(vw, maxX);
		const clampedMinY = Math.max(topSafe, minY);
		const clampedMaxY = Math.min(bottomSafe, maxY);

		const objCenterX = (clampedMinX + clampedMaxX) * 0.5;
		const objCenterY = (clampedMinY + clampedMaxY) * 0.5;

		const clampX = (val: number) => Math.max(margin, Math.min(vw - panelWidth - margin, val));
		const clampY = (val: number) => Math.max(topSafe, Math.min(bottomSafe - panelHeight, val));

		const candidates: { side: PlacementSide; x: number; y: number }[] = [
			{
				side: 'right',
				x: clampX(clampedMaxX + gap),
				y: clampY(objCenterY - panelHeight * 0.5)
			},
			{
				side: 'left',
				x: clampX(clampedMinX - gap - panelWidth),
				y: clampY(objCenterY - panelHeight * 0.5)
			},
			{
				side: 'top',
				x: clampX(objCenterX - panelWidth * 0.5),
				y: clampY(clampedMinY - gap - panelHeight)
			},
			{
				side: 'bottom',
				x: clampX(objCenterX - panelWidth * 0.5),
				y: clampY(clampedMaxY + gap)
			}
		];

		let best = candidates[0];
		let bestScore = Infinity;

		for (const c of candidates) {
			const cRight = c.x + panelWidth;
			const cBottom = c.y + panelHeight;

			const overlapW = Math.max(0, Math.min(cRight, clampedMaxX) - Math.max(c.x, clampedMinX));
			const overlapH = Math.max(0, Math.min(cBottom, clampedMaxY) - Math.max(c.y, clampedMinY));
			const objectOverlapPenalty = overlapW * overlapH * 10;

			let hudOverlapPenalty = 0;
			if (hasLeftPanel && c.x < 375 && c.y < 430) {
				hudOverlapPenalty += 250000;
			}

			const reticleX = vw * 0.5;
			const reticleY = vh * 0.5;
			const coversReticle =
				reticleX >= c.x - 20 &&
				reticleX <= cRight + 20 &&
				reticleY >= c.y - 20 &&
				reticleY <= cBottom + 20;
			const reticlePenalty = coversReticle ? 150000 : 0;

			const panelCenterX = c.x + panelWidth * 0.5;
			const panelCenterY = c.y + panelHeight * 0.5;
			const dist = Math.hypot(panelCenterX - objCenterX, panelCenterY - objCenterY);
			const hysteresisBonus = c.side === this.preferredSide ? -35 : 0;

			const score =
				objectOverlapPenalty + hudOverlapPenalty + reticlePenalty + dist + hysteresisBonus;

			if (score < bestScore) {
				bestScore = score;
				best = c;
			}
		}

		this.preferredSide = best.side;

		const anchorX = Math.max(clampedMinX, Math.min(clampedMaxX, best.x + panelWidth * 0.5));
		const anchorY = Math.max(clampedMinY, Math.min(clampedMaxY, best.y + panelHeight * 0.5));

		this.inspectPlacement = {
			x: Math.round(best.x),
			y: Math.round(best.y),
			anchorX: Math.round(anchorX),
			anchorY: Math.round(anchorY),
			visible: true
		};
	}

	clearInspection() {
		this.inspectedObject = null;
		this.inspectedTarget = null;
		this.inspectPlacement = null;
		this.inspectMaxDistance = 0;
		this.lastOnTargetTime = 0;
	}

	setTelemetry(key: string, value: string | number) {
		this.telemetry[key] = value;
	}

	setPrompt(key: string, label: string) {
		this.interactionPrompt = { key, label };
	}

	clearPrompt() {
		this.interactionPrompt = null;
	}

	setComms(message: string | null) {
		this.commsMessage = message;
	}

	triggerBlackout(message = '') {
		this.blackout = { active: true, message };
	}

	reset() {
		this.panelTitle = null;
		this.telemetry = {};
		this.actions = [];
		this.customWidget = null;
		this.interactionPrompt = null;
		this.commsMessage = null;
		this.canInspectTarget = false;
		this.clearInspection();
		this.blackout = { active: false, message: '' };
	}
}

export const hudStore = new HudStore();
