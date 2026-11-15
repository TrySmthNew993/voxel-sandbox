# Voxel Sandbox

A modular, 60 FPS browser-based 3D Voxel Sandbox built with **Vanilla JavaScript (ES Modules)**, **Three.js**, **Web Workers**, **WebRTC DataChannels**, and a **Node.js WebSocket LAN server**.

## Play Online (GitHub Pages)

Once GitHub Pages is enabled (**Settings → Pages → Source: GitHub Actions**), you can open and play directly in any modern browser (including Chromebooks and school networks—Three.js is vendored locally in the repository with zero external CDN dependencies):

```text
https://trysmthnew993.github.io/voxel-sandbox/
```

## Features

- **Procedural Infinite World**: Streaming `16 × 128 × 16` chunks generated asynchronously in a Web Worker pool using 2D & 3D Simplex noise (Plains, Forest, Desert, and Alpine Mountain biomes, water basins, 3D subterranean caves, and cross-chunk-safe procedural trees).
- **60 FPS Voxel Meshing**: Neighbor-aware hidden-face culling, per-vertex voxel Ambient Occlusion (AO), multi-pass rendering (`opaque`, alpha-tested `cutout` leaves, `translucent` glass & water), procedural 16×16 pixel-art `TextureAtlas`, and throttled GPU geometry uploads.
- **Voxel Mechanics & Progressive Mining**: Amanatides–Woo 3D DDA raycasting for block targeting, progressive tool-accelerated block breaking (`LMB`) with a 10-stage procedural crack overlay, block placement & food consumption (`RMB`), pick-block (`MMB`), and a 3D voxel-extruded first-person held item/instrument viewmodel.
- **Day/Night Cycle & Dynamic Lighting (`DayNightCycle`, `Renderer`)**:
  - 10-minute celestial cycle with rotating Sun, Moon, twilight/starfield sky transitions, and pooled dynamic `PointLight` illumination from placeable **Ember Torches**.
- **Underground Ores & Zero-Starter Progression**:
  - Players begin with empty hands and must gather Wood, Cobblestone, **Coal Ore**, **Iron Ore**, and **Gold Ore** veins underground to smelt ingots and craft every tool tier from scratch.
- **Collectible 3D Block Drops & Inventory (`InventoryManager`, `DropManager`)**:
  - Breaking blocks or defeating mobs spawns rotating, bobbing 3D item drops on the ground that magnetically fly toward the player when close (`< 3.5` blocks) and add into the player's inventory.
  - 9-slot bottom Hotbar + 27-slot Backpack Inventory storing item types, stack counts (`x64`), and tool/weapon badges (`2.6x`, `4.2x`, `6.5x`, `6ATK`, `+6HP`), with click-to-swap/merge and `Shift+Click` quick-transfer.
- **Crafting System & Instruments (`CraftingSystem`, `ItemRegistry`)**:
  - Toggleable via `E`, `C`, or the HUD button, featuring recipes for **Oak Planks**, **Wooden Sticks**, **Ember Torches**, **Iron/Gold Ingots**, **Roasted Porkchop**, and full **Wooden**, **Stone**, and **Iron** tool tiers (**Pickaxe**, **Axe**, **Sword**, **Shovel**).
  - Tools significantly accelerate mining speed on matching block categories (Pickaxes on Stone/Ores/Glass, Axes on Wood/Planks/Leaves, Shovels on Dirt/Grass/Sand/Snow) and Swords boost melee combat damage.
- **Survival Mechanics, Hunger, Oxygen & Respawn**:
  - 20 HP (10-heart) health bar, 20-point Hunger bar (sprint exhaustion, starvation, natural regen when well-fed, food restoration), 10-bubble underwater Oxygen meter with drowning damage, height-based fall damage, and a Death & Respawn overlay (`YOU DIED` → `Respawn in World`).
- **3D Mobs & Night-Only Zombies (`MobManager`)**:
  - Articulated 3D passive animals (**Wild Pig** that wanders, climbs 1-block steps, panics when hit, and drops `Porkchop`) and hostile mobs (**Zombie** with outstretched arms that spawn only at night, burn in daytime sunlight, detect the player within `18` blocks, and deal melee touch damage).
  - Mobs take weapon damage on `LMB`, flash bright red on hit, experience knockback, and drop collectible 3D items upon death.
- **Procedural Web Audio (`AudioSystem`)**:
  - Zero-dependency synthesized sound effects for footsteps, mining taps, block breaks/placements, pickups, combat hits, eating, and crafting (toggleable with `M` or the top-right Sound button).
- **First-Person Physics**: PointerLock mouse look, fixed-timestep `1/60 s` axis-separated AABB collision detection, gravity, jumping, sprinting (`Shift`), swimming buoyancy, and creative fly toggle (`F`).
- **Two Multiplayer Modes**:
  1. **Browser P2P (WebRTC DataChannels — No Server Needed)**: Host and join directly from the browser on GitHub Pages using compact `VX1:` Invite/Answer codes.
  2. **LAN Server (`npm start`)**: Built-in Node.js HTTP & WebSocket relay (`0.0.0.0:3000`) syncing world seed, full block edit history, 20 Hz player movement/rotation, and articulated 3D avatars.

## Multiplayer Quick Start

### Option A: Browser P2P (On GitHub Pages)
1. Open the game and select the **Browser P2P (No Server)** tab in the Multiplayer menu.
2. **Host**: Click **Create Invite**, copy the `VX1:...` Invite code, and send it to your friend.
3. **Friend**: Paste the Invite code into **Join a Friend's World**, click **Accept**, and send the generated `VX1:...` Answer code back to the Host.
4. **Host**: Paste the Answer code and click **Connect** to open the P2P DataChannel.

### Option B: Self-Host on Your Own IP (Node.js LAN Server)
```bash
npm install
npm start
```
The server prints your local and LAN URLs (for example `http://192.168.1.42:3000`).
- **Host / Local Player**: Open `http://localhost:3000`, set your nickname, and click **Join**.
- **LAN Players**: On another device on the same network, open `http://<host-ip>:3000` (or enter `<host-ip>:3000` under **LAN Server (IP:Port)**).

## Controls

| Input | Action |
| :--- | :--- |
| `W A S D` | Move |
| `Space` | Jump / Swim up |
| `Shift` | Sprint |
| `F` | Toggle Fly mode |
| `LMB` | Break block |
| `RMB` | Place block |
| `MMB` | Pick targeted block |
| `1–9` / Scroll | Select hotbar slot |
| `E` | Open Block Palette |
| `F3` | Toggle FPS & telemetry HUD |
| `Esc` | Pause / Multiplayer menu |

## Running Automated Tests

```bash
npm test
```

## Architecture

- `.github/workflows/pages.yml` — Automated GitHub Pages deployment for `public/`.
- `server/` — Node.js HTTP static/vendor server (`index.js`) and authoritative seed + block delta registry (`WorldState.js`).
- `public/vendor/three/` — Vendored Three.js ES module build for offline/GitHub Pages compatibility.
- `public/src/core/` — Shared constants, `BlockRegistry`, `SimplexNoise` & spatial math, and `EventBus`.
- `public/src/world/` — `Chunk`, `TerrainGenerator`, `ChunkWorker`, `WorldManager`, and `Raycaster`.
- `public/src/renderer/` — `TextureAtlas`, `ChunkMeshBuilder`, `Renderer`, and `RemotePlayerMesh`.
- `public/src/physics/` — `AABB` and `PlayerController`.
- `public/src/networking/` — `NetworkClient` and `P2PTransport` (WebRTC DataChannels).
- `public/src/ui/` — `HUD` and `MenuModal`.
