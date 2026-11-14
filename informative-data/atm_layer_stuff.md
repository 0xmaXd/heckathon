`PhysicsWorld.ts` and `SceneManager.ts` are clean and ready to commit—neither needs changes.

In `LaunchRoomScene.ts`, the atmospheric layers flashed by in under 3 seconds because a flat linear multiplier (`position.y * 2.5`) compressed the entire lower atmosphere (`0–85 km`, covering Troposphere, Stratosphere, and Mesosphere) into the first `34` world units—meaning the rocket hadn't even cleared its `22`-unit launch tower before the HUD claimed you were in the Thermosphere.

Replacing that linear formula with a **Tsiolkovsky-style thrust-to-weight ascent curve** (heavy, gradual liftoff off the pad that accelerates as fuel burns off) and darkening the sky at the **Kármán line (`100–120 km`)** instead of `600 km` paces the ascent over ~25 seconds:

- **Troposphere (`0–12 km`):** `0.0s → 5.1s` (rocket clears the red tower right as it exits the lower atmosphere)
- **Stratosphere (`12–50 km`):** `5.1s → 9.3s` (sky shifts from daylight blue to deep cobalt)
- **Mesosphere (`50–85 km`):** `9.3s → 11.7s` (sky darkens to space black across the Kármán line)
- **Thermosphere → Exosphere (`85–600 km`):** `11.7s → 25.2s` (high-velocity orbital insertion burn)
