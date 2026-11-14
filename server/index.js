/**
 * Node.js HTTP static server & WebSocket LAN multiplayer relay.
 * Serves Vanilla ES modules, maps /vendor/three/ to local node_modules/three/,
 * exposes LAN IP discovery via /api/server-info, and syncs multiplayer sessions.
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { DEFAULT_PORT, DEFAULT_SEED, MSG } from '../public/src/core/Constants.js';
import { WorldState } from './WorldState.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const THREE_DIR = path.join(ROOT_DIR, 'node_modules', 'three');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

export function getLanIPv4Addresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const entries of Object.values(interfaces)) {
        if (!entries) continue;
        for (const info of entries) {
            if (info.family === 'IPv4' && !info.internal) {
                addresses.push(info.address);
            }
        }
    }
    return addresses;
}

async function serveFileSafe(baseDir, relPath, res) {
    const cleanRel = relPath.replace(/^\/+/, '');
    const resolved = path.resolve(baseDir, cleanRel);
    if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }

    try {
        const stat = await fs.stat(resolved);
        const targetFile = stat.isDirectory() ? path.join(resolved, 'index.html') : resolved;
        const data = await fs.readFile(targetFile);
        const ext = path.extname(targetFile).toLowerCase();
        res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
            'Cache-Control': 'no-cache',
        });
        res.end(data);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
}

function sendJson(ws, type, payload = {}) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, ...payload }));
    }
}

function broadcast(wss, excludeWs, type, payload = {}) {
    const raw = JSON.stringify({ type, ...payload });
    for (const client of wss.clients) {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN && client.playerId) {
            client.send(raw);
        }
    }
}

/**
 * Create and start the HTTP + WebSocket game server.
 * @param {object} [opts]
 * @param {number} [opts.port]
 * @param {string} [opts.host]
 * @param {number} [opts.seed]
 */
export async function createGameServer(opts = {}) {
    const requestedPort = opts.port ?? DEFAULT_PORT;
    const host = opts.host ?? '0.0.0.0';
    const seed = opts.seed ?? DEFAULT_SEED;
    const worldState = new WorldState(seed);

    const httpServer = http.createServer(async (req, res) => {
        const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const pathname = decodeURIComponent(reqUrl.pathname);

        if (pathname === '/api/server-info') {
            const addr = httpServer.address();
            const actualPort = typeof addr === 'object' && addr ? addr.port : requestedPort;
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*',
            });
            res.end(
                JSON.stringify({
                    port: actualPort,
                    addresses: getLanIPv4Addresses(),
                    playerCount: worldState.players.size,
                    seed: worldState.seed,
                })
            );
            return;
        }

        if (pathname.startsWith('/vendor/three/')) {
            const rel = pathname.slice('/vendor/three/'.length);
            await serveFileSafe(THREE_DIR, rel, res);
            return;
        }

        const targetPath = pathname === '/' ? 'index.html' : pathname;
        await serveFileSafe(PUBLIC_DIR, targetPath, res);
    });

    const wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws) => {
        ws.playerId = null;

        ws.on('message', (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw.toString());
            } catch {
                sendJson(ws, MSG.ERROR, { message: 'Malformed JSON payload' });
                return;
            }

            if (msg.type === MSG.JOIN) {
                if (ws.playerId) return;
                const player = worldState.addPlayer(msg.name);
                ws.playerId = player.id;

                sendJson(ws, MSG.WELCOME, {
                    playerId: player.id,
                    seed: worldState.seed,
                    spawn: worldState.spawn,
                    players: worldState.getPlayerList(),
                    blockDeltas: worldState.getSerializedDeltas(),
                });

                broadcast(wss, ws, MSG.PLAYER_JOIN, { player });
                return;
            }

            if (msg.type === MSG.PING) {
                sendJson(ws, MSG.PONG, { t: msg.t });
                return;
            }

            if (!ws.playerId) {
                sendJson(ws, MSG.ERROR, { message: 'Must send JOIN before gameplay messages' });
                return;
            }

            if (msg.type === MSG.PLAYER_STATE) {
                const updated = worldState.updatePlayerState(ws.playerId, msg);
                if (updated) {
                    broadcast(wss, ws, MSG.PLAYER_STATE, {
                        playerId: updated.id,
                        x: updated.x,
                        y: updated.y,
                        z: updated.z,
                        yaw: updated.yaw,
                        pitch: updated.pitch,
                        walking: updated.walking,
                        heldBlock: updated.heldBlock,
                    });
                }
                return;
            }

            if (msg.type === MSG.BLOCK_SET) {
                const edit = worldState.setBlock(msg.x, msg.y, msg.z, msg.blockId);
                if (!edit) {
                    sendJson(ws, MSG.ERROR, { message: 'Invalid block edit coordinates or block ID' });
                    return;
                }
                broadcast(wss, ws, MSG.BLOCK_UPDATE, {
                    playerId: ws.playerId,
                    x: edit.x,
                    y: edit.y,
                    z: edit.z,
                    blockId: edit.blockId,
                });
            }
        });

        ws.on('close', () => {
            if (ws.playerId) {
                const leftId = ws.playerId;
                worldState.removePlayer(leftId);
                broadcast(wss, ws, MSG.PLAYER_LEAVE, { playerId: leftId });
            }
        });
    });

    await new Promise((resolve) => {
        httpServer.listen(requestedPort, host, resolve);
    });

    const addressInfo = httpServer.address();
    const activePort = typeof addressInfo === 'object' && addressInfo ? addressInfo.port : requestedPort;

    return {
        httpServer,
        wss,
        worldState,
        port: activePort,
        async close() {
            for (const client of wss.clients) {
                client.terminate();
            }
            await new Promise((resolve) => wss.close(resolve));
            await new Promise((resolve) => httpServer.close(resolve));
        },
    };
}

function parseCliArgs(argv) {
    let port = Number(process.env.PORT) || DEFAULT_PORT;
    let seed = process.env.WORLD_SEED ? Number(process.env.WORLD_SEED) : DEFAULT_SEED;

    for (let i = 0; i < argv.length; i++) {
        if ((argv[i] === '--port' || argv[i] === '-p') && argv[i + 1]) {
            port = Number(argv[++i]) || port;
        } else if (argv[i] === '--seed' && argv[i + 1]) {
            seed = Number(argv[++i]) || seed;
        }
    }
    return { port, seed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const { port, seed } = parseCliArgs(process.argv.slice(2));
    const server = await createGameServer({ port, seed });
    const ips = getLanIPv4Addresses();

    console.log('\n=== Voxel Sandbox LAN Server Running ===');
    console.log(`Local:   http://localhost:${server.port}`);
    for (const ip of ips) {
        console.log(`LAN:     http://${ip}:${server.port}`);
    }
    console.log(`Seed:    ${server.worldState.seed}`);
    console.log('Share any LAN IP:Port with players on the same network.\n');
}
