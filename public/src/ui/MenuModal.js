/**
 * Start/Pause & Multiplayer modal controller.
 * Supports both Browser WebRTC P2P (for GitHub Pages / static hosting) and
 * Node.js WebSocket LAN Server (IP:Port) when running locally.
 */

export class MenuModal {
    /**
     * @param {object} opts
     * @param {import('../core/EventBus.js').EventBus} opts.bus
     * @param {import('../world/WorldManager.js').WorldManager} opts.world
     * @param {import('../physics/PlayerController.js').PlayerController} opts.player
     * @param {import('../networking/NetworkClient.js').NetworkClient} opts.network
     * @param {import('./HUD.js').HUD} opts.hud
     */
    constructor({ bus, world, player, network, hud }) {
        this.bus = bus;
        this.world = world;
        this.player = player;
        this.network = network;
        this.hud = hud;

        this.visible = true;

        this.modalEl = document.getElementById('menu-modal');
        this.playBtn = document.getElementById('play-btn');
        this.seedInput = document.getElementById('seed-input');
        this.newWorldBtn = document.getElementById('new-world-btn');
        this.exportWorldBtn = document.getElementById('export-world-btn');
        this.importWorldInput = document.getElementById('import-world-input');
        this.renderDistSlider = document.getElementById('render-dist-slider');
        this.renderDistVal = document.getElementById('render-dist-val');
        this.sensitivitySlider = document.getElementById('sensitivity-slider');
        this.sensitivityVal = document.getElementById('sensitivity-val');
        this.debugChk = document.getElementById('debug-toggle-chk');

        this.netBadge = document.getElementById('net-badge');
        this.playerNameInput = document.getElementById('player-name-input');
        this.disconnectBtn = document.getElementById('disconnect-btn');
        this.netFeedback = document.getElementById('net-feedback');
        this.playersList = document.getElementById('players-list');

        // Tabs
        this.tabP2PBtn = document.getElementById('tab-p2p-btn');
        this.tabLanBtn = document.getElementById('tab-lan-btn');
        this.panelP2P = document.getElementById('mp-panel-p2p');
        this.panelLan = document.getElementById('mp-panel-lan');

        // P2P controls
        this.p2pCreateInviteBtn = document.getElementById('p2p-create-invite-btn');
        this.p2pInviteOut = document.getElementById('p2p-invite-out');
        this.p2pCopyInviteBtn = document.getElementById('p2p-copy-invite-btn');
        this.p2pAnswerIn = document.getElementById('p2p-answer-in');
        this.p2pAcceptAnswerBtn = document.getElementById('p2p-accept-answer-btn');

        this.p2pInviteIn = document.getElementById('p2p-invite-in');
        this.p2pJoinInviteBtn = document.getElementById('p2p-join-invite-btn');
        this.p2pAnswerOut = document.getElementById('p2p-answer-out');
        this.p2pCopyAnswerBtn = document.getElementById('p2p-copy-answer-btn');

        // LAN Server controls
        this.lanAddrDisplay = document.getElementById('lan-address-display');
        this.copyLanBtn = document.getElementById('copy-lan-btn');
        this.serverAddrInput = document.getElementById('server-addr-input');
        this.connectBtn = document.getElementById('connect-btn');

        this._bindEvents();
        this._fetchServerInfo();
    }

    _switchTab(tab) {
        const isP2P = tab === 'p2p';
        this.tabP2PBtn.classList.toggle('active', isP2P);
        this.tabLanBtn.classList.toggle('active', !isP2P);
        this.tabP2PBtn.setAttribute('aria-selected', String(isP2P));
        this.tabLanBtn.setAttribute('aria-selected', String(!isP2P));
        this.panelP2P.classList.toggle('hidden', !isP2P);
        this.panelLan.classList.toggle('hidden', isP2P);
    }

    async _copyText(text, btn, inputEl = null) {
        if (!text) return;
        let copied = false;
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                copied = true;
            }
        } catch {
            copied = false;
        }
        if (!copied && inputEl) {
            inputEl.select();
            copied = document.execCommand?.('copy') || false;
        }
        const prev = btn.textContent;
        btn.textContent = copied ? 'Copied!' : 'Selected';
        setTimeout(() => {
            btn.textContent = prev;
        }, 1500);
    }

    _bindEvents() {
        this.playBtn.addEventListener('click', () => {
            this.hide();
            this.player.requestPointerLock();
        });

        this.newWorldBtn.addEventListener('click', () => {
            if (this.network.connected && this.network.mode !== 'p2p-host') {
                this.netFeedback.textContent = 'Disconnect from multiplayer session before creating a Solo world.';
                return;
            }
            const parsedSeed = Number(this.seedInput.value);
            const seed = Number.isFinite(parsedSeed) ? (parsedSeed | 0) : Math.floor(Math.random() * 999999);
            this.seedInput.value = String(seed);
            this.bus.emit('world:newSoloSeed', seed);
            this.hide();
            this.player.requestPointerLock();
        });

        this.exportWorldBtn?.addEventListener('click', () => {
            this.bus.emit('world:exportRequested');
        });

        this.importWorldInput?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const json = JSON.parse(evt.target.result);
                    this.bus.emit('world:importRequested', json);
                    this.hide();
                    this.player.requestPointerLock();
                } catch (err) {
                    alert('Failed to parse world file: ' + err.message);
                }
            };
            reader.readAsText(file);
            // Reset input so same file can be selected again
            e.target.value = '';
        });

        this.renderDistSlider.addEventListener('input', () => {
            const val = Number(this.renderDistSlider.value);
            this.renderDistVal.textContent = String(val);
            this.world.setRenderDistance(val);
        });

        this.sensitivitySlider.addEventListener('input', () => {
            const mult = Number(this.sensitivitySlider.value);
            this.sensitivityVal.textContent = `${mult.toFixed(1)}x`;
            this.player.setSensitivity(0.0022 * mult);
        });

        this.debugChk.addEventListener('change', () => {
            this.hud.setDebugVisible(this.debugChk.checked);
        });

        this.bus.on('hud:debugChanged', (val) => {
            this.debugChk.checked = val;
        });

        // Multiplayer tabs
        this.tabP2PBtn.addEventListener('click', () => this._switchTab('p2p'));
        this.tabLanBtn.addEventListener('click', () => this._switchTab('lan'));

        // P2P Host controls
        this.p2pCreateInviteBtn.addEventListener('click', async () => {
            const name = this.playerNameInput.value.trim() || 'Host';
            this.p2pCreateInviteBtn.disabled = true;
            this.netFeedback.textContent = 'Generating WebRTC P2P invite...';
            try {
                const { inviteCode } = await this.network.createP2PInvite(name);
                this.p2pInviteOut.value = inviteCode;
                this.netFeedback.textContent = 'Invite ready! Send it to your friend, then paste their Answer below.';
            } catch (err) {
                this.netFeedback.textContent = err.message || 'Failed to create P2P invite.';
            } finally {
                this.p2pCreateInviteBtn.disabled = false;
            }
        });

        this.p2pCopyInviteBtn.addEventListener('click', () => {
            this._copyText(this.p2pInviteOut.value, this.p2pCopyInviteBtn, this.p2pInviteOut);
        });

        this.p2pAcceptAnswerBtn.addEventListener('click', async () => {
            const answer = this.p2pAnswerIn.value.trim();
            if (!answer) {
                this.netFeedback.textContent = 'Paste your friend’s Answer code first.';
                return;
            }
            try {
                await this.network.acceptP2PAnswer(answer);
                this.p2pAnswerIn.value = '';
                this.p2pInviteOut.value = '';
                this.netFeedback.textContent = 'Connecting P2P DataChannel...';
            } catch (err) {
                this.netFeedback.textContent = err.message || 'Invalid Answer code.';
            }
        });

        // P2P Guest controls
        this.p2pJoinInviteBtn.addEventListener('click', async () => {
            const invite = this.p2pInviteIn.value.trim();
            const name = this.playerNameInput.value.trim() || 'Guest';
            if (!invite) {
                this.netFeedback.textContent = 'Paste the Host Invite code first.';
                return;
            }
            this.p2pJoinInviteBtn.disabled = true;
            this.netFeedback.textContent = 'Generating P2P Answer...';
            try {
                const answerCode = await this.network.joinP2PInvite(invite, name);
                this.p2pAnswerOut.value = answerCode;
                this.netFeedback.textContent = 'Answer ready! Copy and send it back to the Host.';
            } catch (err) {
                this.netFeedback.textContent = err.message || 'Invalid Invite code.';
            } finally {
                this.p2pJoinInviteBtn.disabled = false;
            }
        });

        this.p2pCopyAnswerBtn.addEventListener('click', () => {
            this._copyText(this.p2pAnswerOut.value, this.p2pCopyAnswerBtn, this.p2pAnswerOut);
        });

        // LAN Server controls
        this.copyLanBtn.addEventListener('click', () => {
            const text = this.lanAddrDisplay.textContent;
            if (!text || text.includes('Static') || text.includes('Detecting')) return;
            this.serverAddrInput.value = text;
            this._copyText(text, this.copyLanBtn, this.serverAddrInput);
        });

        this.connectBtn.addEventListener('click', () => {
            const addr = this.serverAddrInput.value.trim() || window.location.host;
            const name = this.playerNameInput.value.trim() || 'Builder';
            this.network.connect(addr, name);
        });

        this.disconnectBtn.addEventListener('click', () => {
            this.network.disconnect();
            this.p2pInviteOut.value = '';
            this.p2pAnswerOut.value = '';
        });

        this.bus.on('net:status', (info) => this._updateNetStatus(info));
        this.bus.on('net:players', (players) => this._renderPlayers(players));
        this.bus.on('net:welcome', ({ seed }) => {
            this.seedInput.value = String(seed);
        });
    }

    async _fetchServerInfo() {
        const defaultHost = window.location.host || 'localhost:3000';

        try {
            const res = await fetch('./api/server-info');
            if (!res.ok) throw new Error('Static host');
            const data = await res.json();
            const lanHost = data.addresses && data.addresses.length > 0
                ? `${data.addresses[0]}:${data.port}`
                : defaultHost;
            this.lanAddrDisplay.textContent = lanHost;
            this.serverAddrInput.value = lanHost;
            if (data.seed !== undefined && !this.network.connected) {
                this.seedInput.value = String(data.seed);
            }
            // Local Node.js server detected -> default to LAN Server tab
            this._switchTab('lan');
        } catch {
            // Static GitHub Pages or file server -> default to Browser P2P tab
            this.lanAddrDisplay.textContent = 'Static Host (run npm start for LAN IP)';
            this.serverAddrInput.value = '';
            this._switchTab('p2p');
        }
    }

    _updateNetStatus(info) {
        this.netBadge.className = 'status-badge';
        if (info.status === 'connecting') {
            this.netBadge.classList.add('status-connecting');
            this.netBadge.textContent = 'Connecting...';
            this.netFeedback.textContent = `Connecting to ${info.address}...`;
            this.disconnectBtn.classList.add('hidden');
        } else if (info.status === 'connected') {
            this.netBadge.classList.add('status-connected');
            this.netBadge.textContent = info.mode === 'p2p-host'
                ? 'P2P Hosting'
                : info.mode === 'p2p-guest'
                    ? 'P2P Connected'
                    : 'LAN Connected';
            if (info.mode === 'ws') {
                this.netFeedback.textContent = `Connected to ${info.address}`;
            }
            this.disconnectBtn.classList.remove('hidden');
            this.newWorldBtn.disabled = info.mode !== 'p2p-host';
        } else if (info.status === 'error') {
            this.netBadge.classList.add('status-error');
            this.netBadge.textContent = 'Connection Error';
            this.netFeedback.textContent = info.error || 'Could not connect.';
            this.disconnectBtn.classList.add('hidden');
            this.newWorldBtn.disabled = false;
        } else {
            this.netBadge.classList.add('status-solo');
            this.netBadge.textContent = 'Solo Mode';
            this.netFeedback.textContent = info.reason || '';
            this.disconnectBtn.classList.add('hidden');
            this.newWorldBtn.disabled = false;
        }
    }

    _renderPlayers(players) {
        this.playersList.innerHTML = '';
        if (!players || players.length === 0) {
            const li = document.createElement('li');
            li.className = 'players-empty';
            li.textContent = 'Not connected to a multiplayer session';
            this.playersList.appendChild(li);
            return;
        }

        for (const p of players) {
            const li = document.createElement('li');
            const dot = document.createElement('span');
            dot.className = 'player-dot';
            dot.style.background = p.color || '#3fb950';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = p.name;

            li.append(dot, nameSpan);
            this.playersList.appendChild(li);
        }
    }

    show() {
        this.visible = true;
        this.modalEl.classList.remove('hidden');
    }

    hide() {
        this.visible = false;
        this.modalEl.classList.add('hidden');
    }
}
