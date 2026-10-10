# Steel Front

WW2-themed, isometric browser RTS. **Current milestone: M4 — combat & fog**. Command a mixed WWII battle group against an entrenched Axis force under fog of war. Supply trucks and oil fund production (M2), and an MCV deploys into a base with a tech tree (M3). Pick scenarios from the top-right selector. Computer opponents arrive in M5.

Requires Node.js 22.12+ (tested with Node 26) and npm.

```sh
npm install
npm run dev
npm test
npm run build
```

Open the URL printed by Vite. `npm run preview` serves the production build locally.

Controls: left click / drag to select (Shift adds), double-click selects a type, right-click moves or attacks a visible enemy, Ctrl+0–9 / 0–9 groups, X stops. WASD / arrows or map-edge scroll to pan, Shift for faster pan, mouse wheel or +/− to zoom, middle mouse drag to pan, minimap click/drag to jump, Home / Space to return to the starting sector, G to toggle tile grid. Controls are also available in the HUD.

The seeded map contains 16,384 tiles. Terrain generation is deterministic. The renderer caches ground chunks, culls offscreen terrain/scenery, and reuses scenery sprites; simulation ticks at 20 Hz separately from rendering.

`npm run build` produces **dist/**, deployable unchanged to Caddy or any static web server. Vite's relative base supports a URL subdirectory. No application server or external runtime service is required.

Example Caddy site (replace domain/path for your host):

```caddyfile
steel-front.example.com {
    root * /srv/steel-front/dist
    file_server
    encode zstd gzip
}
```

See BALANCE.md for combat numbers and their Spring: 1944 sources, PROJECT.md for constraints/milestones, STATUS.md for verification and known limitations, and ASSETS.md for art provenance.
