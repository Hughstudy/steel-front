# Steel Front

WW2-themed, isometric browser RTS. **Current milestone: M7 — AI observer and renewable supplies.** From the main menu, start a skirmish: pick Play vs AI or Watch AI vs AI, Allies or Axis, The Lowlands or The Ardennes, and Recruit / Regular / Veteran difficulty. In Play mode, deploy your MCV, build a base, and destroy the enemy HQ under fog of war; lose your HQ (or your MCV before it deploys) and you are defeated. Supply trucks and oil fund production, and combat uses data-driven weapons and armour. Matches can be saved to three browser slots and continued later. Higher AI difficulties attack harder and also earn more (Recruit 75% income, Veteran 130%; see BALANCE.md).

**Watch AI vs AI:** both armies build and fight autonomously at the selected difficulty. Observe the full battlefield, inspect units and structures, use the two base buttons or minimap to move the camera, and pause/save/load as usual. The AIs retain their own fog of war; the observer cannot command either army. Results name the winning faction, and Watch Again repeats the setup.

**Infinite Supply Yards:** each base on both skirmish maps has a nearby neutral yard marked **∞**. Trucks load, haul to HQ and unload at the usual rates, but the yard never runs out. The other supply dumps still deplete. These sites are available in both Play and Watch modes; development exercises keep their original resources.

Saves require identical game data. The new supply/map data means saves from releases before M7 are incompatible; new matches save and resume normally.

Play the published game at **https://hughstudy.github.io/steel-front/**.

Requires Node.js 22.12+ (tested with Node 26) and npm.

```sh
npm install
npm run dev
npm test
npm run build
```

Open the URL printed by Vite. `npm run preview` serves the production build locally.

Controls: left click / drag to select (Shift adds), double-click selects a type, right-click moves or attacks a visible enemy, Ctrl/⌘+right-click attack-moves, Ctrl+0–9 / 0–9 groups, X stops. WASD / arrows or map-edge scroll to pan, Shift for faster pan, mouse wheel or +/− to zoom, middle mouse drag to pan, minimap click/drag to jump, Home / Space to return to the starting sector, G to toggle tile grid. P / F10 pauses (save, load, settings, quit), M mutes sound. Controls are also available in the HUD and the in-game field guide.

The seeded map contains 16,384 tiles. Terrain generation is deterministic. The renderer caches ground chunks, culls offscreen terrain/scenery, and reuses scenery sprites; simulation ticks at 20 Hz separately from rendering.

`npm run build` produces **dist/**, deployable unchanged to Caddy or any static web server. Vite's relative base supports a URL subdirectory. No application server or external runtime service is required.

GitHub Pages serves the compiled files from the `gh-pages` branch; the TypeScript source stays on `main`. The deployment includes `.nojekyll`, and relative asset URLs work under `/steel-front/`. Rebuild and republish `dist/` after source updates; source pushes alone do not rebuild the published branch.

Copy the contents of `dist/` to the server. Example Caddy site at a domain root (replace domain/path for your host):

```caddyfile
steel-front.example.com {
    root * /srv/steel-front/dist
    encode zstd gzip
    file_server
}
```

Or under a subdirectory of an existing site, e.g. `https://example.com/games/steel-front/` (M6 verified this path layout with a plain static server; the Caddy config itself was not run in this workspace):

```caddyfile
example.com {
    redir /games/steel-front /games/steel-front/
    handle_path /games/steel-front/* {
        root * /srv/steel-front/dist
        encode zstd gzip
        file_server
    }
    # ... the rest of the site
}
```

The game is a single page with hashed assets, so no rewrite/SPA fallback is needed. Saves and settings live in the player's browser `localStorage` (per origin). The trailing-slash redirect matters: without it, relative asset URLs resolve against `/games/`.

See BALANCE.md for combat numbers and their Spring: 1944 sources, PROJECT.md for constraints/milestones, STATUS.md for verification and known limitations, and ASSETS.md for art provenance.
