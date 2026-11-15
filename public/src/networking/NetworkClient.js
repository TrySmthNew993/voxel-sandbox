/**
 * Unified Multiplayer Client supporting both:
 * 1) Node.js WebSocket LAN relay (ws://<ip>:<port>)
 * 2) Serverless WebRTC DataChannel P2P Host / Guest (for static GitHub Pages)
 */

import { MSG, NET_TICK_MS } from '../core/Constants.js';
import { RemotePlayerMesh } from '../renderer/RemotePlayerMesh.js';
import { P2PHostSession, P2PGuestSession } from './P2PTransport.js';

const P2P_COLORS = ['#ef4444', '#10b981', '#f59e0b', '#06b6d4', '#ec4899', '#84cc16', '#f97316'];

export class NetworkClient {
    /**
     * @param {object} opts
     * @param {import('../renderer/Renderer.js').Renderer} opts.renderer
     * @param {import('../world/WorldManager.js').WorldManager} opts.world
     * @param {import('../physics/PlayerController.js').PlayerController} opts.player
     * @param {import('../core/EventBus.js').EventBus} opts.bus
     * @param {import('../core/DayNightCycle.js').DayNightCycle} [opts.dayNight]
     */
    constructor({ renderer, world, player, bus, dayNight = null }) {
        this.renderer = renderer;
        this.world = world;
        this.player = player;
        this.bus = bus;
        this.dayNight = dayNight;

        this.mode = 'solo'; // 'solo' | 'ws' | 'p2p-host' | 'p2p-guest'
        this.ws = null;
        this.p2pHost = null;
        this.p2pGuest = null;

        this.connected = false;
        this.connecting = false;
        this.playerId = null;
        this.playerName = 'Builder';
        this.serverAddress = '';
        this.pingMs = null;

        /** @type {Map<string, { meta: object, avatar: RemotePlayerMesh }>} */
        this.remotePlayers = new Map();
        this._p2pColorIdx = 0;

        this._lastSyncTime = 0;
        this._lastPingTime = 0;
        this._lastTimeSync = 0;
        this._lastSentState = null;

        this.bus.on('world:blockChanged', ({ x, y, z, blockId }) => {
            this.sendBlockUpdate(x, y, z, blockId);
        });
    }

    /**
     * Normalize user-supplied IP:Port (e.g. "192.168.1.42:3000" or "ws://localhost:3000") into WebSocket URL.
     */
    static normalizeUrl(address) {
        const trimmed = (address || '').trim();
        if (!trimmed) {
            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            return `${proto}//${window.location.host}`;
        }
        if (trimmed.startsWith('ws://') || trimmed.startsWith('wss://')) {
            return trimmed;
        }
        if (trimmed.startsWith('http://')) {
            return `ws://${trimmed.slice(7)}`;
        }
        if (trimmed.startsWith('https://')) {
            return `wss://${trimmed.slice(8)}`;
        }
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const withPort = trimmed.includes(':') ? trimmed : `${trimmed}:${window.location.port || 3000}`;
        return `${proto}//${withPort}`;
    }

    /* ==================== WebSocket LAN Mode ==================== */

    connect(address, playerName = 'Builder') {
        this.disconnect();

        const url = NetworkClient.normalizeUrl(address);
        this.mode = 'ws';
        this.serverAddress = url;
        this.playerName = (playerName || 'Builder').trim().slice(0, 18) || 'Builder';
        this.connecting = true;
        this.bus.emit('net:status', { status: 'connecting', mode: 'ws', address: url });

        let ws;
        try {
            ws = new WebSocket(url);
        } catch (err) {
            this.connecting = false;
            this.mode = 'solo';
            this.bus.emit('net:status', { status: 'error', error: err.message });
            return;
        }

        this.ws = ws;

        ws.addEventListener('open', () => {
            if (this.ws !== ws) return;
            this.connecting = false;
            this.connected = true;
            this._send(MSG.JOIN, { name: this.playerName });
            this.bus.emit('net:status', { status: 'connected', mode: 'ws', address: url });
        });

        ws.addEventListener('message', (event) => {
            if (this.ws !== ws) return;
            let msg;
            try {
                msg = JSON.parse(event.data);
            } catch {
                return;
            }
            this._handleMessage(msg);
        });

        ws.addEventListener('close', () => {
            if (this.ws !== ws) return;
            const wasConnected = this.connected;
            this.cleanupConnection();
            this.bus.emit('net:status', {
                status: 'disconnected',
                reason: wasConnected ? 'Disconnected from server' : 'Unable to reach server',
            });
        });

        ws.addEventListener('error', () => {
            if (this.ws !== ws) return;
            this.bus.emit('net:status', {
                status: 'error',
                error: `Connection failed (${url})`,
            });
        });
    }

    /* ==================== Browser WebRTC P2P Mode ==================== */

    /**
     * Start hosting a P2P world directly from this browser tab and generate an invite code.
     */
    async createP2PInvite(playerName = 'Host') {
        this.playerName = (playerName || 'Host').trim().slice(0, 18) || 'Host';

        if (this.mode !== 'p2p-host') {
            this.disconnect();
            this.mode = 'p2p-host';
            this.connected = true;
            this.playerId = 'p_1';

            this.p2pHost = new P2PHostSession({
                onPeerOpen: () => {
                    // Wait for guest's JOIN message before sending WELCOME
                },
                onPeerMessage: (peerId, msg) => this._handleHostPeerMessage(peerId, msg),
                onPeerClose: (peerId) => {
                    if (this.remotePlayers.has(peerId)) {
                        this._removeRemotePlayer(peerId);
                        this.p2pHost?.broadcast(peerId, MSG.PLAYER_LEAVE, { playerId: peerId });
                        this._emitPlayerList();
                    }
                },
            });

            this._emitPlayerList();
            this.bus.emit('net:status', {
                status: 'connected',
                mode: 'p2p-host',
                address: 'Browser P2P Host',
            });
        }

        return this.p2pHost.createInvite();
    }

    async acceptP2PAnswer(answerCode) {
        if (this.mode !== 'p2p-host' || !this.p2pHost) {
            throw new Error('Start hosting P2P first by clicking Create Invite.');
        }
        await this.p2pHost.acceptAnswer(answerCode);
    }

    /**
     * Join a friend's P2P host using their Invite code, returning an Answer code to send back.
     */
    async joinP2PInvite(inviteCode, playerName = 'Guest') {
        this.disconnect();
        this.mode = 'p2p-guest';
        this.playerName = (playerName || 'Guest').trim().slice(0, 18) || 'Guest';
        this.connecting = true;
        this.bus.emit('net:status', { status: 'connecting', mode: 'p2p-guest', address: 'WebRTC P2P' });

        const guest = new P2PGuestSession({
            onOpen: () => {
                if (this.p2pGuest !== guest) return;
                this.connecting = false;
                this.connected = true;
                this._send(MSG.JOIN, { name: this.playerName });
                this.bus.emit('net:status', {
                    status: 'connected',
                    mode: 'p2p-guest',
                    address: 'Browser P2P',
                });
            },
            onMessage: (msg) => {
                if (this.p2pGuest !== guest) return;
                this._handleMessage(msg);
            },
            onClose: () => {
                if (this.p2pGuest !== guest) return;
                this.cleanupConnection();
                this.bus.emit('net:status', {
                    status: 'disconnected',
                    reason: 'P2P host disconnected',
                });
            },
        });

        this.p2pGuest = guest;
        return guest.acceptInvite(inviteCode);
    }

    _handleHostPeerMessage(peerId, msg) {
        if (!this.p2pHost) return;

        if (msg.type === MSG.JOIN) {
            const p = this.player.position;
            const hostMeta = {
                id: 'p_1',
                name: this.playerName,
                color: '#3b82f6',
                x: p.x,
                y: p.y,
                z: p.z,
                yaw: this.player.yaw,
                pitch: this.player.pitch,
                walking: false,
            };

            const guestMeta = {
                id: peerId,
                name: String(msg.name || 'Player').trim().slice(0, 18) || 'Player',
                color: P2P_COLORS[this._p2pColorIdx++ % P2P_COLORS.length],
                x: p.x + 1.5,
                y: p.y + 0.5,
                z: p.z,
                yaw: this.player.yaw,
                pitch: 0,
                walking: false,
            };

            const players = [hostMeta];
            for (const entry of this.remotePlayers.values()) {
                players.push(entry.meta);
            }
            players.push(guestMeta);

            this._addRemotePlayer(guestMeta);
            this._emitPlayerList();

            this.p2pHost.sendTo(peerId, MSG.WELCOME, {
                playerId: peerId,
                seed: this.world.seed,
                spawn: { x: guestMeta.x, y: guestMeta.y, z: guestMeta.z },
                players,
                blockDeltas: this.world.getSerializedDeltas(),
                dayNight: this.dayNight ? {
                    timeOfDay: this.dayNight.timeOfDay,
                    dayCount: this.dayNight.dayCount,
                } : null,
            });

            this.p2pHost.broadcast(peerId, MSG.PLAYER_JOIN, { player: guestMeta });
            return;
        }

        if (msg.type === MSG.PING) {
            this.p2pHost.sendTo(peerId, MSG.PONG, { t: msg.t }, true);
            return;
        }

        if (msg.type === MSG.PLAYER_STATE) {
            const entry = this.remotePlayers.get(peerId);
            if (entry) {
                entry.avatar.applySnapshot(msg);
                entry.meta.x = msg.x;
                entry.meta.y = msg.y;
                entry.meta.z = msg.z;
            }
            this.p2pHost.broadcast(peerId, MSG.PLAYER_STATE, {
                playerId: peerId,
                x: msg.x,
                y: msg.y,
                z: msg.z,
                vx: msg.vx || 0,
                vy: msg.vy || 0,
                vz: msg.vz || 0,
                yaw: msg.yaw,
                pitch: msg.pitch,
                walking: msg.walking,
                heldBlock: msg.heldBlock,
            }, true);
            return;
        }

        if (msg.type === MSG.BLOCK_SET) {
            this.world.setBlockWorld(msg.x, msg.y, msg.z, msg.blockId, true);
            this.p2pHost.broadcast(peerId, MSG.BLOCK_UPDATE, {
                playerId: peerId,
                x: msg.x,
                y: msg.y,
                z: msg.z,
                blockId: msg.blockId,
            });
        }
    }

    /* ==================== Shared Lifecycle & Messaging ==================== */

    disconnect() {
        if (this.ws) {
            const ws = this.ws;
            this.ws = null;
            try {
                ws.close();
            } catch {
                // ignore
            }
        }
        if (this.p2pHost) {
            this.p2pHost.closeAll();
            this.p2pHost = null;
        }
        if (this.p2pGuest) {
            this.p2pGuest.close();
            this.p2pGuest = null;
        }
        this.cleanupConnection();
        this.bus.emit('net:status', { status: 'disconnected' });
    }

    cleanupConnection() {
        this.mode = 'solo';
        this.connected = false;
        this.connecting = false;
        this.playerId = null;
        this.pingMs = null;
        this._lastSentState = null;

        for (const entry of this.remotePlayers.values()) {
            this.renderer.scene.remove(entry.avatar.group);
            entry.avatar.dispose();
        }
        this.remotePlayers.clear();
        this._emitPlayerList();
    }

    _send(type, payload = {}, fast = false) {
        if (this.mode === 'ws') {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
            this.ws.send(JSON.stringify({ type, ...payload }));
        } else if (this.mode === 'p2p-guest') {
            this.p2pGuest?.send(type, payload, fast);
        } else if (this.mode === 'p2p-host') {
            if (type === MSG.PLAYER_STATE) {
                this.p2pHost?.broadcast(null, MSG.PLAYER_STATE, {
                    playerId: this.playerId,
                    ...payload,
                }, true);
            } else if (type === MSG.BLOCK_SET) {
                this.p2pHost?.broadcast(null, MSG.BLOCK_UPDATE, {
                    playerId: this.playerId,
                    ...payload,
                }, false);
            } else if (type === MSG.TIME_SYNC) {
                this.p2pHost?.broadcast(null, MSG.TIME_SYNC, payload, false);
            }
        }
    }

    syncWorldTime() {
        if (this.mode !== 'p2p-host' || !this.connected || !this.dayNight) return;
        this._send(MSG.TIME_SYNC, {
            timeOfDay: this.dayNight.timeOfDay,
            dayCount: this.dayNight.dayCount,
        });
    }

    _applyTimeSync(data) {
        if (!this.dayNight || !data || typeof data.timeOfDay !== 'number') return;
        const oneWaySec = (this.pingMs || 0) * 0.5 / 1000;
        const latencyOffset = oneWaySec / (this.dayNight.dayLengthSeconds || 600);
        let syncedTime = data.timeOfDay + latencyOffset;
        let syncedDay = typeof data.dayCount === 'number' ? data.dayCount : this.dayNight.dayCount;
        if (syncedTime >= 1) {
            syncedTime -= Math.floor(syncedTime);
            syncedDay += 1;
        }
        this.dayNight.timeOfDay = syncedTime;
        this.dayNight.dayCount = syncedDay;
    }

    _handleMessage(msg) {
        switch (msg.type) {
            case MSG.WELCOME: {
                this.playerId = msg.playerId;
                this.world.resetWorld(msg.seed, msg.blockDeltas || []);
                if (msg.dayNight) {
                    this._applyTimeSync(msg.dayNight);
                }

                const spawn = msg.spawn || this.world.findSafeSpawn(0, 0);
                this.world.ensureChunkSync(Math.floor(spawn.x / 16), Math.floor(spawn.z / 16));
                this.player.setPosition(spawn.x, spawn.y, spawn.z);

                for (const p of msg.players || []) {
                    if (p.id !== this.playerId) {
                        this._addRemotePlayer(p);
                    }
                }
                this._emitPlayerList();
                this.bus.emit('net:welcome', { seed: msg.seed, playerId: msg.playerId });
                break;
            }

            case MSG.PLAYER_JOIN: {
                if (msg.player && msg.player.id !== this.playerId) {
                    this._addRemotePlayer(msg.player);
                    this._emitPlayerList();
                }
                break;
            }

            case MSG.PLAYER_LEAVE: {
                if (msg.playerId) {
                    this._removeRemotePlayer(msg.playerId);
                    this._emitPlayerList();
                }
                break;
            }

            case MSG.PLAYER_STATE: {
                const entry = this.remotePlayers.get(msg.playerId);
                if (entry) {
                    entry.avatar.applySnapshot(msg);
                    entry.meta.x = msg.x;
                    entry.meta.y = msg.y;
                    entry.meta.z = msg.z;
                }
                break;
            }

            case MSG.BLOCK_UPDATE: {
                if (msg.playerId !== this.playerId) {
                    this.world.setBlockWorld(msg.x, msg.y, msg.z, msg.blockId, true);
                }
                break;
            }

            case MSG.TIME_SYNC: {
                if (this.mode !== 'p2p-host') {
                    this._applyTimeSync(msg);
                }
                break;
            }

            case MSG.PONG: {
                if (typeof msg.t === 'number') {
                    this.pingMs = Math.max(1, Math.round(performance.now() - msg.t));
                }
                break;
            }

            case MSG.ERROR: {
                this.bus.emit('net:status', { status: 'error', error: msg.message || 'Server error' });
                break;
            }
        }
    }

    _addRemotePlayer(p) {
        if (this.remotePlayers.has(p.id)) return;
        const avatar = new RemotePlayerMesh(p);
        this.renderer.scene.add(avatar.group);
        this.remotePlayers.set(p.id, { meta: p, avatar });
    }

    _removeRemotePlayer(id) {
        const entry = this.remotePlayers.get(id);
        if (!entry) return;
        this.renderer.scene.remove(entry.avatar.group);
        entry.avatar.dispose();
        this.remotePlayers.delete(id);
    }

    _emitPlayerList() {
        const list = [];
        if (this.connected) {
            const suffix = this.mode === 'p2p-host' ? ' (Host)' : ' (You)';
            list.push({ id: this.playerId || 'self', name: `${this.playerName}${suffix}`, self: true });
        }
        for (const entry of this.remotePlayers.values()) {
            list.push({ id: entry.meta.id, name: entry.meta.name, color: entry.meta.color, self: false });
        }
        this.bus.emit('net:players', list);
    }

    sendBlockUpdate(x, y, z, blockId) {
        if (!this.connected) return;
        this._send(MSG.BLOCK_SET, { x, y, z, blockId });
    }

    /**
     * Called each frame to animate remote avatars and emit throttled 20Hz state snapshots.
     */
    update(dt, nowMs, selectedBlockId) {
        for (const entry of this.remotePlayers.values()) {
            entry.avatar.update(dt);
        }

        if (!this.connected) return;

        if (nowMs - this._lastSyncTime >= NET_TICK_MS) {
            this._lastSyncTime = nowMs;
            const p = this.player.position;
            const v = this.player.velocity;
            const yaw = Number(this.player.yaw.toFixed(3));
            const pitch = Number(this.player.pitch.toFixed(3));
            const x = Number(p.x.toFixed(3));
            const y = Number(p.y.toFixed(3));
            const z = Number(p.z.toFixed(3));
            const vx = Number(v.x.toFixed(2));
            const vy = Number(v.y.toFixed(2));
            const vz = Number(v.z.toFixed(2));
            const walking = this.player.isMovingHorizontally();

            const prev = this._lastSentState;
            const changed =
                !prev ||
                Math.abs(prev.x - x) > 0.002 ||
                Math.abs(prev.y - y) > 0.002 ||
                Math.abs(prev.z - z) > 0.002 ||
                Math.abs(prev.vx - vx) > 0.05 ||
                Math.abs(prev.vy - vy) > 0.05 ||
                Math.abs(prev.vz - vz) > 0.05 ||
                Math.abs(prev.yaw - yaw) > 0.003 ||
                Math.abs(prev.pitch - pitch) > 0.003 ||
                prev.walking !== walking ||
                prev.heldBlock !== selectedBlockId;

            if (changed) {
                this._lastSentState = { x, y, z, vx, vy, vz, yaw, pitch, walking, heldBlock: selectedBlockId };
                this._send(MSG.PLAYER_STATE, this._lastSentState, true);
            }
        }

        if (this.mode === 'p2p-host' && this.dayNight && nowMs - this._lastTimeSync >= 2000) {
            this._lastTimeSync = nowMs;
            this.syncWorldTime();
        }

        if (this.mode !== 'p2p-host' && nowMs - this._lastPingTime >= 2000) {
            this._lastPingTime = nowMs;
            this._send(MSG.PING, { t: Math.round(nowMs) }, true);
        }
    }

    getRemotePlayerCount() {
        return this.remotePlayers.size;
    }

    dispose() {
        this.disconnect();
    }
}
