import * as THREE from 'three';
import { LaunchRoomConfig } from './launch-room.config';
import { launchState } from './launchState.svelte';

export interface InspectableEntry {
	nodeName: string;
	title: string;
	subtitle: string;
	whyThereTitle: string;
	whyThereBody: string;
	whyDetachTitle: string;
	whyDetachBody: string;
	specs: Record<string, string>;
}

export type LaunchActionId =
	'undock' | 'ignite' | 'liftoff' | 'detach_boosters' | 'complete_orbit' | 'reset';

export class LaunchRoomInspector {
	private catalog: Record<string, InspectableEntry>;
	private targets: THREE.Object3D[] = [];
	private raycaster = new THREE.Raycaster();
	private pointerNdc = new THREE.Vector2();
	private onAction: ((action: LaunchActionId) => void) | null = null;

	private overlayRoot: HTMLDivElement | null = null;
	private qteWrapEl: HTMLDivElement | null = null;
	private qteTitleEl: HTMLDivElement | null = null;
	private qteSubEl: HTMLDivElement | null = null;
	private infoCardEl: HTMLDivElement | null = null;
	private keyBannerEl: HTMLDivElement | null = null;

	constructor(inspectables: Record<string, InspectableEntry>) {
		this.catalog = inspectables;
	}

	setActionHandler(handler: (action: LaunchActionId) => void) {
		this.onAction = handler;
	}

	setTargets(objects: THREE.Object3D[]) {
		this.targets = objects;
	}

	mount() {
		this.unmount();

		const root = document.createElement('div');
		root.style.cssText = `
			position: fixed;
			inset: 0;
			pointer-events: none;
			z-index: 40;
			font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		`;

		const styleTag = document.createElement('style');
		styleTag.textContent = `
			@keyframes trQteSpin {
				0% { transform: rotate(0deg); }
				100% { transform: rotate(360deg); }
			}
			@keyframes trQtePulse {
				0%, 100% { transform: scale(0.96); opacity: 0.92; }
				50% { transform: scale(1.08); opacity: 0.45; }
			}
		`;
		root.appendChild(styleTag);

		const keyBanner = document.createElement('div');
		keyBanner.style.cssText = `
			position: absolute;
			bottom: 84px;
			left: 50%;
			transform: translateX(-50%);
			pointer-events: auto;
			background: rgba(10, 15, 28, 0.92);
			border: 1px solid rgba(148, 163, 184, 0.35);
			backdrop-filter: blur(8px);
			color: #f8fafc;
			padding: 8px 16px;
			border-radius: 999px;
			font-size: 13px;
			font-weight: 600;
			letter-spacing: 0.04em;
			box-shadow: 0 10px 25px rgba(0, 0, 0, 0.45);
			display: flex;
			align-items: center;
			gap: 8px;
			white-space: nowrap;
		`;
		keyBanner.addEventListener('mousedown', (e) => e.preventDefault());
		keyBanner.addEventListener('click', (e) => {
			const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-launch-action]');
			const action = btn?.dataset.launchAction as LaunchActionId | undefined;
			if (action && this.onAction) {
				this.onAction(action);
			}
		});
		root.appendChild(keyBanner);
		this.keyBannerEl = keyBanner;

		const qteWrap = document.createElement('div');
		qteWrap.style.cssText = `
			position: absolute;
			left: 50%;
			top: 46%;
			transform: translate(-50%, -50%);
			pointer-events: auto;
			cursor: pointer;
			display: none;
			flex-direction: column;
			align-items: center;
			gap: 10px;
		`;
		qteWrap.addEventListener('mousedown', (e) => e.preventDefault());
		qteWrap.addEventListener('click', () => {
			this.onAction?.('detach_boosters');
		});

		const ringContainer = document.createElement('div');
		ringContainer.style.cssText = `
			position: relative;
			width: 124px;
			height: 124px;
			display: flex;
			align-items: center;
			justify-content: center;
		`;

		const outerPulse = document.createElement('div');
		outerPulse.style.cssText = `
			position: absolute;
			inset: -10px;
			border-radius: 50%;
			border: 3px solid #f59e0b;
			animation: trQtePulse 1.15s ease-in-out infinite;
		`;

		const rotatingArc = document.createElement('div');
		rotatingArc.style.cssText = `
			position: absolute;
			inset: 0;
			border-radius: 50%;
			border: 5px solid rgba(245, 158, 11, 0.25);
			border-top-color: #fbbf24;
			border-right-color: #f97316;
			animation: trQteSpin 1.8s linear infinite;
		`;

		const coreButton = document.createElement('div');
		coreButton.style.cssText = `
			width: 82px;
			height: 82px;
			border-radius: 50%;
			background: radial-gradient(circle at 30% 30%, #1e293b, #090d16);
			border: 3px solid #fbbf24;
			box-shadow: 0 0 28px rgba(245, 158, 11, 0.75);
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			color: #ffffff;
		`;
		coreButton.innerHTML = `
			<span style="font-size: 30px; font-weight: 900; line-height: 1; color: #fbbf24;">B</span>
			<span style="font-size: 9px; font-weight: 700; letter-spacing: 0.1em; margin-top: 2px; color: #e2e8f0;">CLICK / KEY</span>
		`;
		ringContainer.append(outerPulse, rotatingArc, coreButton);

		const qteTitle = document.createElement('div');
		qteTitle.style.cssText = `
			background: rgba(15, 23, 42, 0.92);
			border: 1px solid #f59e0b;
			color: #fef3c7;
			padding: 6px 14px;
			border-radius: 8px;
			font-size: 13px;
			font-weight: 800;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
		`;

		const qteSub = document.createElement('div');
		qteSub.style.cssText = `
			background: rgba(245, 158, 11, 0.92);
			color: #0f172a;
			padding: 3px 10px;
			border-radius: 999px;
			font-size: 11px;
			font-weight: 800;
			letter-spacing: 0.05em;
		`;

		qteWrap.append(ringContainer, qteTitle, qteSub);
		root.appendChild(qteWrap);

		this.qteWrapEl = qteWrap;
		this.qteTitleEl = qteTitle;
		this.qteSubEl = qteSub;

		const infoCard = document.createElement('div');
		infoCard.style.cssText = `
			position: absolute;
			right: 22px;
			top: 50%;
			transform: translateY(-50%);
			pointer-events: auto;
			width: 340px;
			max-width: calc(100vw - 44px);
			background: rgba(10, 16, 30, 0.92);
			border: 1px solid rgba(56, 189, 248, 0.45);
			border-left: 4px solid #38bdf8;
			backdrop-filter: blur(10px);
			border-radius: 14px;
			padding: 18px 20px;
			color: #f1f5f9;
			box-shadow: 0 18px 40px rgba(0, 0, 0, 0.55);
			display: none;
		`;
		infoCard.addEventListener('click', (e) => {
			if ((e.target as HTMLElement).closest('[data-close-card]')) {
				this.hideInfoCard();
			}
		});
		root.appendChild(infoCard);
		this.infoCardEl = infoCard;

		document.body.appendChild(root);
		this.overlayRoot = root;
		this.updateKeyboardBanner();
	}

	unmount() {
		if (this.overlayRoot) {
			this.overlayRoot.remove();
			this.overlayRoot = null;
		}
	}

	reset() {
		if (this.qteWrapEl) this.qteWrapEl.style.display = 'none';
		this.hideInfoCard();
		this.updateKeyboardBanner();
	}

	triggerBoosterQte() {
		if (this.qteWrapEl && this.qteTitleEl && this.qteSubEl) {
			this.qteTitleEl.style.borderColor = '#f59e0b';
			this.qteTitleEl.style.color = '#fef3c7';
			this.qteTitleEl.textContent = 'PRESS [B] OR CLICK TO DETACH BOOSTERS';
			this.qteSubEl.style.background = 'rgba(245, 158, 11, 0.92)';
			this.qteSubEl.textContent = 'TIME PAUSED — READ MISSION BRIEF ON RIGHT';
			this.qteWrapEl.style.display = 'flex';
		}
		this.showCard('boosters', 'BOOSTER SEPARATION STAGE // PRESS [B]');
		this.updateKeyboardBanner();
	}

	completeBoosterQte() {
		if (this.qteTitleEl && this.qteSubEl && this.qteWrapEl) {
			this.qteTitleEl.style.borderColor = '#22c55e';
			this.qteTitleEl.style.color = '#bbf7d0';
			this.qteTitleEl.textContent = 'BOOSTERS DETACHED!';
			this.qteSubEl.style.background = '#22c55e';
			this.qteSubEl.textContent = 'DEAD WEIGHT SHED — ACCELERATING TO 600 KM';
			setTimeout(() => {
				if (this.qteWrapEl) this.qteWrapEl.style.display = 'none';
			}, 1300);
		}
		this.updateKeyboardBanner();
	}

	updateLiveIssSpecs(coords: string, altitudeKm: number, velocityKmh: number) {
		if (this.catalog.iss) {
			this.catalog.iss.specs = {
				Position: coords,
				Altitude: `${altitudeKm.toFixed(0)} km`,
				Speed: `${Math.round(velocityKmh).toLocaleString()} km/h`
			};
		}
	}

	inspectAtPointer(clientX: number, clientY: number, camera: THREE.Camera | null) {
		if (!camera || this.targets.length === 0) return;

		this.pointerNdc.x = (clientX / window.innerWidth) * 2 - 1;
		this.pointerNdc.y = -(clientY / window.innerHeight) * 2 + 1;
		this.raycaster.setFromCamera(this.pointerNdc, camera);

		const hits = this.raycaster.intersectObjects(this.targets, true);
		if (hits.length === 0) return;

		let cur: THREE.Object3D | null = hits[0].object;
		let matchedKey = 'rocket';
		while (cur) {
			for (const [key, entry] of Object.entries(this.catalog)) {
				if (cur.name.includes(entry.nodeName)) {
					matchedKey = key;
					cur = null;
					break;
				}
			}
			if (cur) cur = cur.parent;
		}

		this.showCard(matchedKey, 'MIDDLE-CLICK INSPECTION');
	}

	showCard(key: string, badgeText = 'MIDDLE-CLICK INSPECTION') {
		const info = this.catalog[key] ?? Object.values(this.catalog)[0];
		if (!this.infoCardEl || !info) return;

		const specsHtml = Object.entries(info.specs)
			.map(
				([k, v]) => `
				<div style="background: rgba(30, 41, 59, 0.75); padding: 6px 8px; border-radius: 6px;">
					<div style="font-size: 10px; color: #94a3b8; text-transform: uppercase;">${k}</div>
					<div style="font-size: 12px; font-weight: 700; color: #e2e8f0;">${v}</div>
				</div>`
			)
			.join('');

		this.infoCardEl.innerHTML = `
			<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
				<span style="font-size: 10px; font-weight: 800; letter-spacing: 0.08em; color: #38bdf8; text-transform: uppercase;">${badgeText}</span>
				<button type="button" tabindex="-1" data-close-card="1" style="background:none;border:none;font-size: 11px; color: #94a3b8; cursor:pointer;">[ESC] Close ✕</button>
			</div>
			<div style="font-size: 18px; font-weight: 800; color: #ffffff; line-height: 1.2;">${info.title}</div>
			<div style="font-size: 12px; color: #93c5fd; margin-bottom: 12px;">${info.subtitle}</div>

			<div style="background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(148,163,184,0.2); border-radius: 10px; padding: 10px 12px; margin-bottom: 10px;">
				<div style="font-size: 12px; font-weight: 800; color: #fbbf24; margin-bottom: 4px;">${info.whyThereTitle}</div>
				<div style="font-size: 12.5px; line-height: 1.45; color: #e2e8f0;">${info.whyThereBody}</div>
			</div>

			<div style="background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(148,163,184,0.2); border-radius: 10px; padding: 10px 12px; margin-bottom: 12px;">
				<div style="font-size: 12px; font-weight: 800; color: #34d399; margin-bottom: 4px;">${info.whyDetachTitle}</div>
				<div style="font-size: 12.5px; line-height: 1.45; color: #e2e8f0;">${info.whyDetachBody}</div>
			</div>

			<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;">
				${specsHtml}
			</div>
		`;
		this.infoCardEl.style.display = 'block';
	}

	hideInfoCard() {
		if (this.infoCardEl) {
			this.infoCardEl.style.display = 'none';
		}
	}

	updateKeyboardBanner() {
		if (!this.keyBannerEl) return;

		const stepBtn = (
			action: LaunchActionId,
			keyLabel: string,
			text: string,
			state: 'done' | 'active' | 'locked'
		) => {
			if (state === 'done') {
				return `<button type="button" tabindex="-1" data-launch-action="${action}" style="background:none;border:none;color:#4ade80;font-weight:700;cursor:pointer;font-size:12px;">✓ [${keyLabel}] ${text}</button>`;
			}
			if (state === 'active') {
				return `<button type="button" tabindex="-1" data-launch-action="${action}" style="background:#fbbf24;border:none;color:#0f172a;padding:4px 12px;border-radius:999px;font-weight:900;cursor:pointer;font-size:12px;box-shadow:0 0 14px rgba(251,191,36,0.6);">[${keyLabel}] ${text}</button>`;
			}
			return `<button type="button" tabindex="-1" data-launch-action="${action}" style="background:none;border:none;color:#64748b;font-weight:600;cursor:not-allowed;font-size:12px;">[${keyLabel}] ${text}</button>`;
		};

		const issPill = launchState.nasaApiKeyConfigured
			? `<span style="background:rgba(14,165,233,0.18);border:1px solid rgba(56,189,248,0.45);color:#7dd3fc;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:800;">🛰️ ISS: ${launchState.issStatusText}</span>`
			: `<span style="background:rgba(239,68,68,0.18);border:1px solid rgba(248,113,113,0.5);color:#fca5a5;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:800;">⚠️ NASA API KEY NOT SET IN .env</span>`;

		const s1 =
			launchState.dockState === 'UNDOCKED'
				? 'done'
				: launchState.dockState === 'DOCKED' || launchState.dockState === 'DOCKING'
					? 'active'
					: 'locked';
		const s2 = launchState.isIgnited
			? 'done'
			: launchState.dockState === 'UNDOCKED'
				? 'active'
				: 'locked';
		const s3 = launchState.isLaunched ? 'done' : launchState.isIgnited ? 'active' : 'locked';
		const s4 = launchState.boostersDetached
			? 'done'
			: launchState.isBoosterQtePaused
				? 'active'
				: 'locked';

		if (launchState.altitudeKm >= LaunchRoomConfig.ascent.sceneEndAltitudeKm) {
			this.keyBannerEl.innerHTML = `
				${stepBtn('complete_orbit', 'ENTER', 'END SCENE (600 KM)', 'active')}
				<span style="color:#475569;">|</span>
				${stepBtn('reset', 'R', 'REPLAY', 'done')}
				<span style="color:#475569;">|</span>
				${issPill}
			`;
			return;
		}

		this.keyBannerEl.innerHTML = `
			${stepBtn('undock', 'U', launchState.dockState === 'UNDOCKING' ? 'UNDOCKING...' : 'UNDOCK', s1)}
			<span style="color:#475569;">→</span>
			${stepBtn('ignite', 'I', 'IGNITE', s2)}
			<span style="color:#475569;">→</span>
			${stepBtn('liftoff', 'SPACE', 'LIFTOFF', s3)}
			<span style="color:#475569;">→</span>
			${stepBtn('detach_boosters', 'B', 'DETACH SRBS', s4)}
			<span style="color:#475569;">|</span>
			${stepBtn('reset', 'R', 'RESET', 'done')}
			<span style="color:#475569;">|</span>
			${issPill}
		`;
	}
}
