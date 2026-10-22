const { RealtimeHub, MAX_GROUPS_PER_SOCKET, MEMBERSHIP_TTL_MS } = require('../services/realtime');

const G1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const G2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

const setup = ({ members = { [G1]: [U1] } } = {}) => {
    let now = 1000;
    const access = { isGroupMember: jest.fn(async (uid, gid) => (members[gid.toLowerCase()] || []).includes(uid)) };
    const github = { getGroupIdsByRepo: jest.fn(async () => [G1.toUpperCase(), G2]) };
    const hub = new RealtimeHub({ access, github, now: () => now });
    const received = [];
    const client = hub.addClient({ userId: U1, send: (message) => received.push(message) });
    return { hub, client, received, access, github, tick: (ms) => { now += ms; }, members };
};

// The next membership query stays in flight until answer(value) is called (an Error rejects it).
const holdNextCheck = (access) => {
    let answer;
    access.isGroupMember.mockImplementationOnce(() => new Promise((resolve, reject) => {
        answer = (value) => (value instanceof Error ? reject(value) : resolve(value));
    }));
    return (value) => answer(value);
};

// Lets settled promises run their callbacks (a finished query leaves `checks` a few ticks later).
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('RealtimeHub', () => {
    test('subscribes only to valid groups the user belongs to (case-insensitive, deduplicated)', async () => {
        const { hub, client, access } = setup();
        const result = await hub.subscribe(client, [G1.toUpperCase(), G1, G2, 'not-a-uuid', 42, null]);
        expect(result).toEqual({ groups: [G1], pending: [] });
        expect(access.isGroupMember).toHaveBeenCalledTimes(2);
        expect(await hub.subscribe(client, 'nope')).toEqual({ groups: [], pending: [] });
    });

    test('caps the groups per socket', async () => {
        const gids = Array.from({ length: 80 }, (_, i) => `${String(i).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`);
        const { hub, client } = setup({ members: Object.fromEntries(gids.map((gid) => [gid, [U1]])) });
        expect((await hub.subscribe(client, gids)).groups).toHaveLength(MAX_GROUPS_PER_SOCKET);
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

    test('a throwing socket does not stop the others', async () => {
        const { hub, client } = setup();
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

    describe('membership check failures (DB errors)', () => {
        test('at subscribe the group stays pending; its next event re-checks it, announces it live and delivers', async () => {
            const { hub, client, received, access } = setup();
            access.isGroupMember.mockRejectedValueOnce(new Error('db down'));
            expect(await hub.subscribe(client, [G1])).toEqual({ groups: [], pending: [G1] });

            access.isGroupMember.mockRejectedValueOnce(new Error('still down'));
            expect(await hub.publish(G1, 'ci_run', { n: 1 })).toBe(0);
            expect([...client.pending]).toEqual([G1]);
            expect(received).toEqual([]);

            expect(await hub.publish(G1, 'ci_run', { n: 2 })).toBe(1);
            // The new `subscribed` comes first: the page resyncs (catching up on n: 1) and stops polling
            expect(received).toEqual([
                { type: 'subscribed', groups: [G1] },
                expect.objectContaining({ type: 'event', data: { n: 2 } }),
            ]);
            expect(client.pending.size).toBe(0);
            expect(client.groups.get(G1)).toBe(1000);
            // Confirmed now: the next event needs no query and is not announced again
            await hub.publish(G1, 'ci_run', { n: 3 });
            expect(access.isGroupMember).toHaveBeenCalledTimes(3);
            expect(received.map((m) => m.type)).toEqual(['subscribed', 'event', 'event']);
        });

        test('the live announcement lists the groups still pending', async () => {
            const { hub, client, received, access } = setup({ members: { [G1]: [U1], [G2]: [U1] } });
            access.isGroupMember.mockRejectedValue(new Error('db down'));
            expect(await hub.subscribe(client, [G1, G2])).toEqual({ groups: [], pending: [G1, G2] });
            access.isGroupMember.mockResolvedValueOnce(true);
            expect(await hub.publish(G1, 'ci_run', {})).toBe(1);
            expect(received[0]).toEqual({ type: 'subscribed', groups: [G1], pending: [G2] });
        });

        test('a pending group is retried by the next subscribe', async () => {
            const { hub, client, access } = setup();
            access.isGroupMember.mockRejectedValueOnce(new Error('db down'));
            await hub.subscribe(client, [G1]);
            expect(await hub.subscribe(client, [G1])).toEqual({ groups: [G1], pending: [] });
        });

        test('a pending group of which the user turns out not to be a member is dropped', async () => {
            const { hub, client, received, access } = setup();
            access.isGroupMember.mockRejectedValueOnce(new Error('db down'));
            expect(await hub.subscribe(client, [G2])).toEqual({ groups: [], pending: [G2] });
            expect(await hub.publish(G2, 'ci_run', {})).toBe(0);
            expect(client.pending.size).toBe(0);
            await hub.publish(G2, 'ci_run', {});
            expect(access.isGroupMember).toHaveBeenCalledTimes(2);
            expect(received).toEqual([]);
        });

        test('a failed TTL re-check skips that event but keeps the member, re-checking on the next one', async () => {
            const { hub, client, received, access, tick } = setup();
            await hub.subscribe(client, [G1]);
            tick(MEMBERSHIP_TTL_MS + 1);
            access.isGroupMember.mockRejectedValueOnce(new Error('db down'));
            expect(await hub.publish(G1, 'ci_run', { n: 1 })).toBe(0);
            expect(client.groups.get(G1)).toBe(1000); // old timestamp: still due for a check
            expect(hub.subscription(client)).toEqual({ groups: [], pending: [G1] });

            expect(await hub.publish(G1, 'ci_run', { n: 2 })).toBe(1);
            // n: 1 was skipped: the `subscribed` before n: 2 makes the page resync to catch up on it
            expect(received).toEqual([
                { type: 'subscribed', groups: [G1] },
                expect.objectContaining({ type: 'event', data: { n: 2 } }),
            ]);
            expect(client.groups.get(G1)).toBe(1000 + MEMBERSHIP_TTL_MS + 1);
            expect(access.isGroupMember).toHaveBeenCalledTimes(3);
        });

        test('a burst while the database is down makes one query, not one per event', async () => {
            const { hub, client, received, access, tick } = setup();
            const other = [];
            const tab2 = hub.addClient({ userId: U1, send: (m) => other.push(m) });
            await hub.subscribe(client, [G1]);
            await hub.subscribe(tab2, [G1]);
            tick(MEMBERSHIP_TTL_MS + 1);

            const answer = holdNextCheck(access);
            const publishes = [1, 2, 3, 4, 5].map((n) => hub.publish(G1, 'ci_job', { n }));
            answer(new Error('db down'));
            expect(await Promise.all(publishes)).toEqual([0, 0, 0, 0, 0]);
            expect(access.isGroupMember).toHaveBeenCalledTimes(3); // 2 subscribes + 1 for the whole burst
            expect(received).toEqual([]);
            expect(other).toEqual([]);
            expect(client.groups.get(G1)).toBe(1000);

            // The next event (database back) checks again and delivers
            expect(await hub.publish(G1, 'ci_job', { n: 6 })).toBe(2);
            expect(access.isGroupMember).toHaveBeenCalledTimes(4);
            expect(received.map((m) => m.data && m.data.n)).toEqual([undefined, 6]);
        });

        test('a subscribe does not trust the timestamp of a group whose re-check failed', async () => {
            const { hub, client, access, tick } = setup();
            await hub.subscribe(client, [G1]);
            tick(MEMBERSHIP_TTL_MS + 1);
            access.isGroupMember.mockRejectedValueOnce(new Error('db down'));
            await hub.publish(G1, 'ci_run', {});
            expect(await hub.subscribe(client, [G1])).toEqual({ groups: [G1], pending: [] });
            expect(access.isGroupMember).toHaveBeenCalledTimes(3);
        });
    });

    test('a burst of events shares one membership query (across tabs too) and keeps its order', async () => {
        const { hub, client, received, access, tick } = setup();
        const other = [];
        const tab2 = hub.addClient({ userId: U1, send: (m) => other.push(m) });
        await hub.subscribe(client, [G1]);
        await hub.subscribe(tab2, [G1]);
        tick(MEMBERSHIP_TTL_MS + 1);

        const answer = holdNextCheck(access);
        const publishes = [1, 2, 3, 4, 5].map((n) => hub.publish(G1, 'ci_job', { n }));
        expect(access.isGroupMember).toHaveBeenCalledTimes(3);
        answer(true);
        expect(await Promise.all(publishes)).toEqual([2, 2, 2, 2, 2]);
        expect(received.map((m) => m.data.n)).toEqual([1, 2, 3, 4, 5]);
        expect(other.map((m) => m.data.n)).toEqual([1, 2, 3, 4, 5]);
        expect(access.isGroupMember).toHaveBeenCalledTimes(3);
    });

    test('a socket with a fresh check gets events without waiting for another socket\'s query', async () => {
        const { hub, client: stale, received: staleReceived, access, tick } = setup({ members: { [G1]: [U1, U2] } });
        await hub.subscribe(stale, [G1]);
        tick(MEMBERSHIP_TTL_MS + 1);
        const fresh = [];
        await hub.subscribe(hub.addClient({ userId: U2, send: (m) => fresh.push(m) }), [G1]);

        const answer = holdNextCheck(access);
        const first = hub.publish(G1, 'ci_run', { n: 1 });
        const second = hub.publish(G1, 'ci_run', { n: 2 });
        expect(fresh.map((m) => m.data.n)).toEqual([1, 2]);
        expect(staleReceived).toEqual([]);
        answer(true);
        await Promise.all([first, second]);
        expect(staleReceived.map((m) => m.data.n)).toEqual([1, 2]);
    });

    test('events of a group keep their order on a socket even when they wait on different checks', async () => {
        // The socket re-subscribes to a stale G1 and a slow G2. G1's check ends first; an event
        // published before G2's does starts a new G1 check, and the subscribe then marks G1 fresh:
        // the next event must still wait behind the first one.
        const { hub, client, received, access, tick } = setup({ members: { [G1]: [U1], [G2]: [U1] } });
        await hub.subscribe(client, [G1]);
        tick(MEMBERSHIP_TTL_MS + 1);
        const answerG1 = holdNextCheck(access);
        const answerG2 = holdNextCheck(access);
        const subscribing = hub.subscribe(client, [G1, G2]);
        answerG1(true);
        await flush();

        const answerRecheck = holdNextCheck(access);
        const first = hub.publish(G1, 'ci_run', { n: 1 });
        expect(access.isGroupMember).toHaveBeenCalledTimes(4); // a new G1 query, held
        answerG2(true);
        expect(await subscribing).toEqual({ groups: [G1, G2], pending: [] });
        const second = hub.publish(G1, 'ci_run', { n: 2 });
        await flush();
        expect(received).toEqual([]); // n: 2 waits behind n: 1

        answerRecheck(true);
        expect(await Promise.all([first, second])).toEqual([1, 1]);
        expect(received.map((m) => m.data.n)).toEqual([1, 2]);
        expect(client.queues.size).toBe(0);
    });

    test('a queue behind a check does not hold other groups or other sockets', async () => {
        const { hub, client, received, access, tick } = setup({ members: { [G1]: [U1], [G2]: [U1] } });
        await hub.subscribe(client, [G1]);
        tick(MEMBERSHIP_TTL_MS + 1);
        await hub.subscribe(client, [G1, G2]); // G1 re-checked now, G2 new
        tick(MEMBERSHIP_TTL_MS + 1);
        const answer = holdNextCheck(access);
        const g1 = hub.publish(G1, 'ci_run', { n: 1 });
        access.isGroupMember.mockResolvedValueOnce(true);
        expect(await hub.publish(G2, 'ci_run', { n: 2 })).toBe(1);
        expect(received.map((m) => m.data.n)).toEqual([2]);
        answer(true);
        expect(await g1).toBe(1);
        expect(received.map((m) => m.data.n)).toEqual([2, 1]);
    });

    test('an event waiting on a check is dropped if the socket re-subscribed without that group', async () => {
        const { hub, client, received, access, tick } = setup();
        await hub.subscribe(client, [G1]);
        tick(MEMBERSHIP_TTL_MS + 1);
        const answer = holdNextCheck(access);
        const publishing = hub.publish(G1, 'ci_run', {});
        expect(await hub.subscribe(client, [])).toEqual({ groups: [], pending: [] });
        answer(true);
        expect(await publishing).toBe(0);
        expect(client.groups.size).toBe(0);
        expect(received).toEqual([]);
    });

    test('an event waiting on a check is dropped if the socket closed meanwhile', async () => {
        const { hub, client, received, access, tick } = setup();
        await hub.subscribe(client, [G1]);
        tick(MEMBERSHIP_TTL_MS + 1);
        const answer = holdNextCheck(access);
        const publishing = hub.publish(G1, 'ci_run', {});
        hub.removeClient(client);
        answer(true);
        expect(await publishing).toBe(0);
        expect(received).toEqual([]);
    });

    test('subscribe reuses a recent check and keeps its time, so it still expires on schedule', async () => {
        const { hub, client, access, tick } = setup({ members: { [G1]: [U1], [G2]: [U1] } });
        await hub.subscribe(client, [G1]);
        tick(1000);
        expect(await hub.subscribe(client, [G1, G2])).toEqual({ groups: [G1, G2], pending: [] });
        expect(access.isGroupMember).toHaveBeenCalledTimes(2); // only G2 was new
        expect(client.groups.get(G1)).toBe(1000);
        tick(MEMBERSHIP_TTL_MS); // G1 is now past the TTL, G2 just at it
        await hub.subscribe(client, [G1, G2]);
        expect(access.isGroupMember).toHaveBeenCalledTimes(3);
        expect(access.isGroupMember).toHaveBeenLastCalledWith(U1, G1);
    });
});
