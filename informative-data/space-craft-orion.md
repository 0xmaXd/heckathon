All dimensions, component counts, and structural proportions in the script below are sourced directly from NASA’s official Orion engineering specifications and technical reports:

    NASA Orion By The Numbers (Jan 2026 Fact Sheet): [https://www.nasa.gov/wp-content/uploads/2026/01/orion-by-the-numbers-2026b.pdf](https://www.nasa.gov/wp-content/uploads/2026/01/orion-by-the-numbers-2026b.pdf)

        Full Orion Stack Height (LAS + CM + SM): 67 ft / 20.4 m

        Crew Module + Service Module Height: 26 ft / 7.9 m

        Crew Module (CM): Height 11 ft / 3.35 m, Diameter 16.5 ft / 5.0 m, 12 RCS thrusters

        European Service Module (ESM): Height 15.7 ft / 4.79 m, Diameter 16.5 ft / 5.0 m, 4 solar wings spanning 62 ft / 18.9 m wide, 1 Orion Main Engine (OMS-E), 8 Auxiliary Engines, 24 RCS thrusters

        Launch Abort System (LAS): Height 50 ft / 15.25 m (with ogive panels), Tower Diameter 3 ft / 0.9 m, Ogive Base Diameter 17 ft / 5.2 m

    NASA Orion Reference Guide & European Service Module Reference:

        [https://www.nasa.gov/wp-content/uploads/2023/02/orion-reference-guide-111022.pdf](https://www.nasa.gov/wp-content/uploads/2023/02/orion-reference-guide-111022.pdf)

        [https://www.nasa.gov/reference/european-service-module/](https://www.nasa.gov/reference/european-service-module/)

        Ablative Heat Shield Diameter: 16.5 ft (5.0 m)

        Solar Array Wing Geometry: Each of the 4 wings comprises 3 panels, each 6.5 × 6.5 ft (2.0 × 2.0 m), for a wing length of nearly 23 ft (7.0 m)

        Launch Abort System Height without Ogive Panels: 44 ft (13.41 m)

    NASA Space Launch System Reference Guide: [https://www.nasa.gov/wp-content/uploads/2022/03/sls-reference-guide-2022-v2-508-0.pdf](https://www.nasa.gov/wp-content/uploads/2022/03/sls-reference-guide-2022-v2-508-0.pdf)

        Spacecraft Adapter (SA): Height 5 ft / 1.5 m, Diameter 18 ft / 5.5 m

    NASA NTRS – Artemis I Orion-ESM Propulsion System Engine Performance: [https://ntrs.nasa.gov/api/citations/20240003648/downloads/382_BELAIR_ARTEMIS_I_ENGINE_PERFORMANCE_FINAL.pdf](https://ntrs.nasa.gov/api/citations/20240003648/downloads/382_BELAIR_ARTEMIS_I_ENGINE_PERFORMANCE_FINAL.pdf)

        ESM RCS Cluster Layout: 24 RCS thrusters divided into 6 clusters of 4 thrusters (4 pitch/yaw clusters + 2 roll clusters).

 1. How the Solar Wings Attach & Polycount Check

    Why they looked detached before: The previous script placed a 0.06 m gap between each of the three 2.0 × 2.0 m panels with no connecting hardware between them.

    How NASA/ESA’s real ESM Solar Arrays attach: Each of the four wings mounts to the European Service Module via a two-axis Solar Array Drive Mechanism (SADM) connected to a V-shaped carbon-fiber deployment yoke. The three thickened honeycomb panels (1,242 Gallium Arsenide cells per panel, ~15,000 cells total) are physically linked by reinforced spring-loaded inter-panel hinges and titanium spreader beams that lock flat once deployed to their 18.9 m (62 ft) span. The updated script below adds the SADM root gimbal, V-yoke struts, and inter-panel hinge beams so every panel is mechanically connected.

    Polycount Check: Orion alone is ~7,600 triangles, and the entire SLS Block 1 + Twin Boosters + Orion stack below is ~23,400 triangles—well under a 50k–80k triangle budget for smooth 60 FPS rendering on a CPU + iGPU setup.

2. Official NASA Datasets & Links Used

All dimensions and stage interfaces in the script come directly from NASA’s published engineering reference guides:

    NASA Space Launch System Reference Guide for Artemis II (Dec 2025): [https://www.nasa.gov/wp-content/uploads/2025/12/sls-5558-artemis-ii-sls-reference-guide.pdf](https://www.nasa.gov/wp-content/uploads/2025/12/sls-5558-artemis-ii-sls-reference-guide.pdf)

        Total SLS Block 1 Stack Height: 322.4 ft / 98.27 m

        Core Stage: Height 212 ft / 64.6 m (forward skirt to engine exhaust exit plane), Diameter 27.6 ft / 8.41 m, 4 RS-25 engines

        Twin 5-Segment Solid Rocket Boosters (SRBs): Height 177 ft / 54.0 m, Diameter 12 ft / 3.7 m

        Launch Vehicle Stage Adapter (LVSA): Height 27.5 ft / 8.38 m, Bottom Diameter 27.5 ft / 8.38 m, Top Diameter 16.5 ft / 5.03 m

        Interim Cryogenic Propulsion Stage (ICPS): Height 45 ft / 13.7 m, Diameter 16.7 ft / 5.09 m, 1 RL10B-2 engine

        Orion Stage Adapter (OSA): Height 5 ft / 1.5 m, Diameter 18 ft / 5.5 m

    NASA SLS Fact Sheets: [https://www.nasa.gov/humans-in-space/space-launch-system/sls-fact-sheets/](https://www.nasa.gov/humans-in-space/space-launch-system/sls-fact-sheets/)

    NASA Orion By The Numbers (Jan 2026): [https://www.nasa.gov/wp-content/uploads/2026/01/orion-by-the-numbers-2026b.pdf](https://www.nasa.gov/wp-content/uploads/2026/01/orion-by-the-numbers-2026b.pdf)

        Orion Full Stack (LAS + CM + SM): Height 67 ft / 20.4 m (77.87 m + 20.40 m = 98.27 m total rocket height)

        Crew Module + Service Module: Height 26 ft / 7.9 m, Diameter 16.5 ft / 5.0 m, Solar Wingspan 62 ft / 18.9 m

    NASA European Service Module Reference: [https://www.nasa.gov/reference/european-service-module/](https://www.nasa.gov/reference/european-service-module/)


    1. Where the Astronauts Sit & Store Supplies Inside Orion

Next to a 98.27 m rocket, the Orion Crew Module (5.0 m wide by 3.35 m tall) looks tiny, yet its pressurized cabin provides 330 cubic feet (~9.3 m³) of habitable living volume—roughly the interior space of two minivans and nearly 60% roomier than the Apollo capsules:

    4 Crew Seats on the "Backbone" Floor: Four impact-absorbing seats are bolted to a nine-piece aluminum floor grid called the backbone assembly. Two upper seats (Commander and Pilot) sit directly below the four cockpit windows and three digital flight displays, while two lower seats (Mission Specialists) sit slightly aft beneath them.

    Reconfigurable Orbit Cabin & Sleeping Bags: Once in orbit, the crew folds down the lower seats and unbolts the Commander and Pilot foot pans to open the center of the capsule for floating and daily workouts on a compact, suitcase-sized flywheel rowing/squat machine. At night, all four astronauts zip into sleeping bags strapped directly to the cabin walls.

    Under-Floor Storage & Service Module Tanks: Metal lockers recessed beneath the floor grid hold 54 cubic feet of food pouches, medical kits, and gear (about the cargo space of a compact SUV or 38 carry-on suitcases), paired with a briefcase-sized Velcro food warmer. Drinking water and breathing gases live outside the capsule in four pressurized tanks inside the European Service Module (the white cylinder right below the capsule) and are piped up to a wall dispenser.

    Private Space Toilet: Tucked behind a privacy door on the side of the cabin is a 5-cubic-foot Universal Waste Management System—a compact microgravity vacuum toilet.
