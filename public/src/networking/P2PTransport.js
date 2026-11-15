/**
 * Serverless WebRTC DataChannel transport for hosting and joining multiplayer
 * directly inside the browser (works on static GitHub Pages without Node.js).
 *
 * Uses compact base64-encoded SDP+ICE tokens so players can connect over school
 * LANs or the internet via copy-paste invite/answer codes.
 */

const ICE_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ],
};

function encodeSignal(obj) {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
        bin += String.fromCharCode(bytes[i]);
    }
    return 'VX1:' + btoa(bin);
}

function decodeSignal(token) {
    const clean = (token || '').trim();
    if (!clean.startsWith('VX1:')) {
        throw new Error('Invalid invite/answer code (must start with VX1:)');
    }
    const bin = atob(clean.slice(4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
    }
    return JSON.parse(new TextDecoder().decode(bytes));
}

function waitForIceGathering(pc, timeoutMs = 2200) {
    if (pc.iceGatheringState === 'complete') {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            pc.removeEventListener('icegatheringstatechange', onState);
            resolve();
        }, timeoutMs);

        function onState() {
            if (pc.iceGatheringState === 'complete') {
                clearTimeout(timer);
                pc.removeEventListener('icegatheringstatechange', onState);
                resolve();
            }
        }
        pc.addEventListener('icegatheringstatechange', onState);
    });
}

export class P2PHostSession {
    /**
     * @param {object} callbacks
     * @param {(peerId: string, channel: RTCDataChannel) => void} callbacks.onPeerOpen
     * @param {(peerId: string, msg: object) => void} callbacks.onPeerMessage
     * @param {(peerId: string) => void} callbacks.onPeerClose
     */
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.nextPeerNum = 2; // Host is p_1
        /** @type {Map<string, { pc: RTCPeerConnection, channel: RTCDataChannel|null }>} */
        this.peers = new Map();
        this.pendingOfferPeerId = null;
    }

    /**
     * Create a new WebRTC offer token for an incoming friend.
     * @returns {Promise<{ peerId: string, inviteCode: string }>}
     */
    async createInvite() {
        // Close any abandoned pending offer before creating a fresh one
        if (this.pendingOfferPeerId) {
            const old = this.peers.get(this.pendingOfferPeerId);
            if (old && (!old.channel || old.channel.readyState !== 'open')) {
                old.pc.close();
                this.peers.delete(this.pendingOfferPeerId);
            }
        }

        const peerId = `p_${this.nextPeerNum++}`;
        const pc = new RTCPeerConnection(ICE_CONFIG);
        const channel = pc.createDataChannel('voxel', { ordered: true });
        const fastChannel = pc.createDataChannel('voxel-fast', { ordered: false, maxRetransmits: 0 });
        const entry = { pc, channel, fastChannel };
        this.peers.set(peerId, entry);
        this.pendingOfferPeerId = peerId;

        this._wireChannel(peerId, pc, channel, fastChannel);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIceGathering(pc);

        const inviteCode = encodeSignal({
            t: 'offer',
            sdp: pc.localDescription.sdp,
        });
        return { peerId, inviteCode };
    }

    /**
     * Accept a friend's answer token to complete the P2P DataChannel handshake.
     * @param {string} answerCode
     */
    async acceptAnswer(answerCode) {
        if (!this.pendingOfferPeerId) {
            throw new Error('Create an Invite first before accepting an Answer.');
        }
        const entry = this.peers.get(this.pendingOfferPeerId);
        if (!entry) {
            throw new Error('Pending invite expired.');
        }
        const payload = decodeSignal(answerCode);
        if (payload.t !== 'answer' || !payload.sdp) {
            throw new Error('Expected an Answer code.');
        }
        await entry.pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp });
        this.pendingOfferPeerId = null;
    }

    _wireChannel(peerId, pc, channel, fastChannel) {
        const handleMessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                this.callbacks.onPeerMessage(peerId, msg);
            } catch {
                // ignore malformed JSON
            }
        };

        channel.addEventListener('open', () => {
            this.callbacks.onPeerOpen(peerId, channel);
        });
        channel.addEventListener('message', handleMessage);
        if (fastChannel) {
            fastChannel.addEventListener('message', handleMessage);
        }
        channel.addEventListener('close', () => {
            this.peers.delete(peerId);
            this.callbacks.onPeerClose(peerId);
        });
        pc.addEventListener('connectionstatechange', () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                if (this.peers.has(peerId)) {
                    this.peers.delete(peerId);
                    this.callbacks.onPeerClose(peerId);
                }
            }
        });
    }

    sendTo(peerId, type, payload = {}, fast = false) {
        const entry = this.peers.get(peerId);
        if (!entry) return;
        const ch = (fast && entry.fastChannel && entry.fastChannel.readyState === 'open')
            ? entry.fastChannel
            : entry.channel;
        if (ch && ch.readyState === 'open') {
            ch.send(JSON.stringify({ type, ...payload }));
        }
    }

    broadcast(excludePeerId, type, payload = {}, fast = false) {
        const raw = JSON.stringify({ type, ...payload });
        for (const [peerId, entry] of this.peers.entries()) {
            if (peerId === excludePeerId) continue;
            const ch = (fast && entry.fastChannel && entry.fastChannel.readyState === 'open')
                ? entry.fastChannel
                : entry.channel;
            if (ch && ch.readyState === 'open') {
                ch.send(raw);
            }
        }
    }

    closeAll() {
        for (const entry of this.peers.values()) {
            try {
                entry.fastChannel?.close();
                entry.channel?.close();
                entry.pc.close();
            } catch {
                // ignore
            }
        }
        this.peers.clear();
        this.pendingOfferPeerId = null;
    }
}

export class P2PGuestSession {
    /**
     * @param {object} callbacks
     * @param {() => void} callbacks.onOpen
     * @param {(msg: object) => void} callbacks.onMessage
     * @param {() => void} callbacks.onClose
     */
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.pc = null;
        this.channel = null;
        this.fastChannel = null;
    }

    /**
     * Process a host's invite token and return the guest's answer token.
     * @param {string} inviteCode
     * @returns {Promise<string>} answerCode
     */
    async acceptInvite(inviteCode) {
        this.close();
        const payload = decodeSignal(inviteCode);
        if (payload.t !== 'offer' || !payload.sdp) {
            throw new Error('Expected a Host Invite code.');
        }

        const pc = new RTCPeerConnection(ICE_CONFIG);
        this.pc = pc;

        pc.addEventListener('datachannel', (event) => {
            const ch = event.channel;
            const handleMessage = (msgEvent) => {
                try {
                    const msg = JSON.parse(msgEvent.data);
                    this.callbacks.onMessage(msg);
                } catch {
                    // ignore
                }
            };

            if (ch.label === 'voxel-fast') {
                this.fastChannel = ch;
                ch.addEventListener('message', handleMessage);
                return;
            }

            this.channel = ch;
            ch.addEventListener('open', () => {
                this.callbacks.onOpen();
            });
            ch.addEventListener('message', handleMessage);
            ch.addEventListener('close', () => {
                this.callbacks.onClose();
            });
        });

        pc.addEventListener('connectionstatechange', () => {
            if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
                this.callbacks.onClose();
            }
        });

        await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitForIceGathering(pc);

        return encodeSignal({
            t: 'answer',
            sdp: pc.localDescription.sdp,
        });
    }

    send(type, payload = {}, fast = false) {
        const ch = (fast && this.fastChannel && this.fastChannel.readyState === 'open')
            ? this.fastChannel
            : this.channel;
        if (ch && ch.readyState === 'open') {
            ch.send(JSON.stringify({ type, ...payload }));
        }
    }

    close() {
        try {
            this.fastChannel?.close();
            this.channel?.close();
            this.pc?.close();
        } catch {
            // ignore
        }
        this.fastChannel = null;
        this.channel = null;
        this.pc = null;
    }
}
