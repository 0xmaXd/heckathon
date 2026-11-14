import { GameConfig } from '../../config/game.config';

export class PhysicsWorld {
	private isInitialized = false;
	// TODO: Add @dimforge/rapier3d-compact World instance

	async init(gravity = GameConfig.physics.gravityEarth) {
		console.log(`PhysicsWorld initialized with gravity: ${gravity} m/s²`);
		this.isInitialized = true;
	}

	step() {
		if (!this.isInitialized) return;
		// TODO: world.step()
	}

	setGravity(gravity: number) {
		console.log(`Gravity changed to: ${gravity} m/s²`);
		// TODO: Update rapier world gravity
	}
}

export const physicsWorld = new PhysicsWorld();
