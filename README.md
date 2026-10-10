# Steel Front

WW2-themed, isometric browser RTS. **Current milestone: M1 — units & control**: select and maneuver a 20-unit force across the Lowlands (a 200-unit stress scenario is one click away). Economy, base building and combat arrive in later milestones.

Requires Node.js 22.12+ (tested with Node 26) and npm.

```sh
npm install
npm run dev
npm test
npm run build
```

Open the URL printed by Vite. `npm run preview` serves the production build locally.

Controls: left click / drag to select (Shift adds), double-click selects a type, right-click moves, Ctrl+0–9 / 0–9 groups, X stops. WASD / arrows or map-edge scroll to pan, Shift for faster pan, mouse wheel or +/− to zoom, middle mouse drag to pan, minimap click/drag to jump, Home / Space to return to the starting sector, G to toggle tile grid. Controls are also available in the HUD.

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

See PROJECT.md for constraints/milestones, STATUS.md for verification and known limitations, and ASSETS.md for art provenance.
