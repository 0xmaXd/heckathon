Cislunar transit does **not** require a capsule interior—it works naturally as an **exterior third-person spacecraft view** (reusing your `OrbitControls` camera from Phase 2) across the 3-day coast (`transitDurationDays: 3`). You can skip both Phase 3 and Phase 4 for now, build the Moon scenes first, and add exterior/interior spacecraft scenes later without refactoring your core architecture.

---

### What Happens in Cislunar Transit (NASA Profile)

Between exiting Earth's atmosphere at `600 km` and arriving at the Moon, a NASA spacecraft executes four exterior flight events that fit an orbital camera view:

- **Trans-Lunar Injection (TLI) & 3-Day Coast:** Reaching `600 km` only puts the rocket in Low Earth Orbit. A prograde TLI burn accelerates the craft to ~10.8 km/s to cross the ~384,400 km cislunar corridor over `3` days.

- **Mid-Course Corrections (MCC) & Passive Thermal Control:** Small RCS thruster pulses keep the trajectory aligned with the lunar arrival corridor while maintaining a slow "barbecue roll" so sunlight does not overheat one side of the hull.
- **Van Allen Belts & Solar Radiation Anomalies:** Early in transit, the craft crosses Earth's trapped radiation belts and encounters deterministic space weather or debris anomalies (`seed: 42`)—giving a direct gameplay payoff to the **Geiger Counter** equipped in Phase 1.

- **Sphere of Influence (SOI) & Lunar Orbit Insertion (LOI):** At ~62,000 km from the Moon, lunar gravity (`1.62 m/s²`) overtakes Earth's pull, followed by a retrograde braking burn to capture into lunar orbit rather than flying past into deep space.

---

### NASA Flight-to-Moon Completeness Check

Your 8-phase roadmap (`01` Locker Suit-Up → `02` Pad 39A Launch → `03` Cockpit → `04` Cislunar Transit → `05` Lunar Landing → `06` Lunar Outpost → `07` EVA Samples → `08` Meteor Defense) already covers the complete NASA Artemis Base Camp mission structure. Keep three orbital-mechanics details in mind so nothing feels skipped when you connect the phases later:

1. **Include a TLI Burn Step:** Because Phase 2 ends at `600 km` (Exosphere / LEO), make sure either the end of Phase 3 or the start of Phase 4 includes the TLI burn that sends the craft out of Earth orbit.

2. **Include Lunar Orbit Insertion (LOI) & Far-Side Radio Blackout:** NASA missions brake into a ~100 km lunar orbit on the far side of the Moon—causing a temporary Loss of Signal (LOS) comms blackout—before beginning powered descent (`05-lunar-landing`).
3. **Intentional Surface End-State:** Apollo missions ended with Trans-Earth Injection (TEI) and ocean splashdown, whereas your arc ends with establishing and defending a lunar outpost (`06`–`08`). That is completely consistent with NASA's long-duration Artemis surface mission profile.

---

### Jumping Straight to the Moon

Because `SceneManager` registers scenes by phase number and `missionStore` controls transitions, we can point Phase 2's completion straight to your first Moon phase right now and slot Phases 3 and 4 back in whenever you are ready.

Would you like to build **Phase 5 (`05-lunar-landing`)** with Rapier `1.62 m/s²` descent thruster physics first, or jump straight to **Phase 6 (`06-lunar-outpost`)** to walk on the lunar surface with your `lunarLowG` first-person controller?
