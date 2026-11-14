import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.js';
import { MSG } from '../public/src/core/Constants.js';
import { BLOCK_IDS } from '../public/src/core/BlockRegistry.js';

function waitForMessage(ws, predicate) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            ws.off('message', onMsg);
            reject(new Error('Timed out waiting for WebSocket message'));
        }, 4000);

        function onMsg(raw) {
            const msg = JSON.parse(raw.toString());
            if (predicate(msg)) {
                clearTimeout(timer);
                ws.off('message', onMsg);
                resolve(msg);
            }
        }
        ws.on('message', onMsg);
    });
}

async function connectClient(port, name) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
    });

    const welcomePromise = waitForMessage(ws, (m) => m.type === MSG.WELCOME);
    ws.send(JSON.stringify({ type: MSG.JOIN, name }));
    const welcome = await welcomePromise;
    return { ws, welcome };
}

test('LAN server serves static ES modules, server-info, and syncs multiplayer state + deltas', async () => {
    const server = await createGameServer({ port: 0, host: '127.0.0.1', seed: 55555 });

    try {
        // 1. Verify HTTP endpoints & Three.js module serving & path traversal protection
        const infoRes = await fetch(`http://127.0.0.1:${server.port}/api/server-info`);
        assert.equal(infoRes.status, 200);
        const info = await infoRes.json();
        assert.equal(info.seed, 55555);
        assert.equal(info.port, server.port);

        const threeRes = await fetch(`http://127.0.0.1:${server.port}/vendor/three/build/three.module.js`);
        assert.equal(threeRes.status, 200);

        const traversalRes = await fetch(`http://127.0.0.1:${server.port}/vendor/three/../../package.json`);
        assert.ok(traversalRes.status === 403 || traversalRes.status === 404);

        // 2. Connect Alice and Bob
        const alice = await connectClient(server.port, 'Alice');
        assert.equal(alice.welcome.seed, 55555);
        assert.equal(alice.welcome.players.length, 1);

        const bobJoinSeenByAlice = waitForMessage(alice.ws, (m) => m.type === MSG.PLAYER_JOIN);
        const bob = await connectClient(server.port, 'Bob');
        const joinEvent = await bobJoinSeenByAlice;
        assert.equal(joinEvent.player.name, 'Bob');
        assert.equal(bob.welcome.players.length, 2);

        // 3. Transform relay: Alice moves -> Bob receives PLAYER_STATE
        const stateSeenByBob = waitForMessage(
            bob.ws,
            (m) => m.type === MSG.PLAYER_STATE && m.playerId === alice.welcome.playerId
        );
        alice.ws.send(
            JSON.stringify({
                type: MSG.PLAYER_STATE,
                x: 12.5,
                y: 65.0,
                z: -8.25,
                yaw: 1.2,
                pitch: -0.3,
                walking: true,
                heldBlock: BLOCK_IDS.GLASS,
            })
        );
        const relayedState = await stateSeenByBob;
        assert.equal(relayedState.x, 12.5);
        assert.equal(relayedState.y, 65.0);
        assert.equal(relayedState.z, -8.25);
        assert.equal(relayedState.walking, true);

        // 4. Block placement broadcast & invalid bedrock rejection
        const blockSeenByBob = waitForMessage(bob.ws, (m) => m.type === MSG.BLOCK_UPDATE);
        alice.ws.send(
            JSON.stringify({
                type: MSG.BLOCK_SET,
                x: 10,
                y: 70,
                z: 10,
                blockId: BLOCK_IDS.WOOD,
            })
        );
        const blockUpdate = await blockSeenByBob;
        assert.equal(blockUpdate.x, 10);
        assert.equal(blockUpdate.y, 70);
        assert.equal(blockUpdate.z, 10);
        assert.equal(blockUpdate.blockId, BLOCK_IDS.WOOD);

        const errPromise = waitForMessage(alice.ws, (m) => m.type === MSG.ERROR);
        alice.ws.send(
            JSON.stringify({
                type: MSG.BLOCK_SET,
                x: 0,
                y: 0,
                z: 0,
                blockId: BLOCK_IDS.AIR,
            })
        );
        const errMsg = await errPromise;
        assert.match(errMsg.message, /Invalid block/);

        // 5. Late-joining client Charlie receives accumulated blockDeltas
        const charlie = await connectClient(server.port, 'Charlie');
        assert.deepEqual(charlie.welcome.blockDeltas, [[10, 70, 10, BLOCK_IDS.WOOD]]);

        // 6. Disconnect leave broadcast
        const leaveSeenByAlice = waitForMessage(alice.ws, (m) => m.type === MSG.PLAYER_LEAVE);
        bob.ws.close();
        const leaveMsg = await leaveSeenByAlice;
        assert.equal(leaveMsg.playerId, bob.welcome.playerId);

        alice.ws.close();
        charlie.ws.close();
    } finally {
        await server.close();
    }
});
