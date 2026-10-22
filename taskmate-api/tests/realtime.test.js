const { RealtimeHub, MAX_GROUPS_PER_SOCKET, MEMBERSHIP_TTL_MS } = require('../services/realtime');

const G1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const G2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U1 = '11111111-1111-4111-8111-111111111111';

const setup = ({ members = { [G1]: [U1] } } = {}) => {
    let now = 1000;
    const access = { isGroupMember: jest.fn(async (uid, gid) => (members[gid.toLowerCase()] || []).includes(uid)) };
    const github = { getGroupIdsByRepo: jest.fn(async () => [G1.toUpperCase(), G2]) };
    const hub = new RealtimeHub({ access, github, now: () => now });
    const received = [];
    const client = hub.addClient({ userId: U1, send: (message) => received.push(message) });
    return { hub, client, received, access, github, tick: (ms) => { now += ms; }, members };
};

describe('RealtimeHub', () => {
    test('subscribes only to valid groups the user belongs to (case-insensitive, deduplicated)', async () => {
        const { hub, client, access } = setup();
        const groups = await hub.subscribe(client, [G1.toUpperCase(), G1, G2, 'not-a-uuid', 42, null]);
        expect(groups).toEqual([G1]);
        expect(access.isGroupMember).toHaveBeenCalledTimes(2);
        expect(await hub.subscribe(client, 'nope')).toEqual([]);
    });

    test('caps the groups per socket', async () => {
        const gids = Array.from({ length: 80 }, (_, i) => `${String(i).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`);
        const { hub, client } = setup({ members: Object.fromEntries(gids.map((gid) => [gid, [U1]])) });
        expect(await hub.subscribe(client, gids)).toHaveLength(MAX_GROUPS_PER_SOCKET);
    });

    test('delivers only to sockets subscribed to the group', async () => {
        const { hub, client, received } = setup();
        await hub.subscribe(client, [G1]);
        const other = [];
        hub.addClient({ userId: U1, send: (m) => other.push(m) });
        expect(await hub.publish(G1.toUpperCase(), 'ci_run', { runId: 1 })).toBe(1);
        expect(await hub.publish(G2, 'ci_run', { runId: 2 })).toBe(0);
        expect(received).toEqual([{ type: 'event', event: 'ci_run', gid: G1, data: { runId: 1 }, at: expect.any(String) }]);
        expect(other).toEqual([]);
    });

    test('re-checks membership once the check is old: a removed member stops receiving', async () => {
        const { hub, client, received, access, tick, members } = setup();
        await hub.subscribe(client, [G1]);
        tick(MEMBERSHIP_TTL_MS - 1);
        await hub.publish(G1, 'ci_run', {});
        expect(access.isGroupMember).toHaveBeenCalledTimes(1);
        members[G1] = [];
        tick(2);
        expect(await hub.publish(G1, 'ci_run', {})).toBe(0);
        expect(received).toHaveLength(1);
        expect(client.groups.size).toBe(0);
    });

    test('a failing membership check denies; a throwing socket does not stop the others', async () => {
        const { hub, client, access } = setup();
        access.isGroupMember.mockRejectedValueOnce(new Error('db down'));
        expect(await hub.subscribe(client, [G1])).toEqual([]);
        await hub.subscribe(client, [G1]);
        client.send = () => { throw new Error('closed'); };
        const ok = [];
        const second = hub.addClient({ userId: U1, send: (m) => ok.push(m) });
        await hub.subscribe(second, [G1]);
        expect(await hub.publish(G1, 'x', {})).toBe(1);
        expect(ok).toHaveLength(1);
    });

    test('publishToRepo fans out to every linked group; removeClient stops delivery', async () => {
        const { hub, client, received, github } = setup({ members: { [G1]: [U1], [G2]: [U1] } });
        await hub.subscribe(client, [G1, G2]);
        expect(await hub.publishToRepo(500, 'deployment', { state: 'success' })).toEqual([G1.toUpperCase(), G2]);
        expect(github.getGroupIdsByRepo).toHaveBeenCalledWith(500);
        expect(received.map((m) => m.gid)).toEqual([G1, G2]);
        hub.removeClient(client);
        expect(hub.size).toBe(0);
        expect(await hub.publish(G1, 'x', {})).toBe(0);
    });
});
