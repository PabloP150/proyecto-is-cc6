// Live events for the browser over the /events WebSocket (Phase 4): CI/CD runs, jobs, deploys and
// deploy requests, published per group. A socket subscribes to its groups; membership is checked
// when it subscribes and again before a delivery once that check is older than MEMBERSHIP_TTL_MS,
// so someone removed from a group stops receiving its events within minutes.
// A check that fails (DB error) is not a "no": the group is kept (pending) and checked again on the
// next event, so a database hiccup never unsubscribes a real member. When such a check succeeds
// the socket gets a new {type: 'subscribed'} so the page catches up on the events it skipped.
const accessModel = require('../models/access.model');
const githubModel = require('../models/github.model');

const MAX_GROUPS_PER_SOCKET = 50;
const MEMBERSHIP_TTL_MS = 5 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const key = (gid) => String(gid).toLowerCase();

/** The {type: 'subscribed'} message for a subscription ({groups, pending}); `pending` only when not empty. */
const subscribedMessage = ({ groups, pending }) => (pending.length > 0
    ? { type: 'subscribed', groups, pending }
    : { type: 'subscribed', groups });

class RealtimeHub {
    constructor({ access = accessModel, github = githubModel, now = () => Date.now() } = {}) {
        this.access = access;
        this.github = github;
        this.now = now;
        this.clients = new Set();
        // userId|gid → the membership query in flight: a burst of events (a run sends one per job
        // and step) or several tabs of the same user share one query instead of one each.
        this.checks = new Map();
    }

    // send(message) must never throw for a closed socket (the caller checks readyState).
    // groups: gid → time of its last successful membership check. pending: gids whose last check
    // failed; their events are skipped until a check succeeds (a group whose re-check failed is in
    // both, with its old timestamp). queues: gid → the last delivery waiting on a check, see deliver.
    addClient({ userId, send }) {
        const client = { userId, send, groups: new Map(), pending: new Set(), queues: new Map() };
        this.clients.add(client);
        return client;
    }

    removeClient(client) {
        this.clients.delete(client);
    }

    get size() {
        return this.clients.size;
    }

    /**
     * Replaces the client's groups with those of `gids` it belongs to. Groups whose check failed
     * stay pending and are checked again on their next event (or the next subscribe). Callers run
     * one subscribe per client at a time (the /events handler serializes them). → {groups, pending}.
     */
    async subscribe(client, gids) {
        const wanted = [...new Set((Array.isArray(gids) ? gids : [])
            .filter((gid) => typeof gid === 'string' && UUID_RE.test(gid))
            .map(key))].slice(0, MAX_GROUPS_PER_SOCKET);
        const started = this.now();
        const checks = await Promise.all(wanted.map(async (gid) => {
            const checkedAt = client.groups.get(gid);
            // A recent check is as good as a new one: publish trusts it for the same TTL.
            if (checkedAt !== undefined && !client.pending.has(gid) && started - checkedAt <= MEMBERSHIP_TTL_MS) {
                return [gid, true, checkedAt];
            }
            return [gid, await this.checkMembership(client.userId, gid), null];
        }));
        const at = this.now();
        client.groups = new Map(checks.filter(([, ok]) => ok === true).map(([gid, , checkedAt]) => [gid, checkedAt ?? at]));
        client.pending = new Set(checks.filter(([, ok]) => ok === null).map(([gid]) => gid));
        return this.subscription(client);
    }

    /** → {groups, pending}: the groups the client receives now, and those waiting for a membership check. */
    subscription(client) {
        return {
            groups: [...client.groups.keys()].filter((gid) => !client.pending.has(gid)),
            pending: [...client.pending],
        };
    }

    /** → true (member), false (not a member) or null (the check itself failed; ask again later). */
    checkMembership(userId, gid) {
        const id = `${key(userId)}|${key(gid)}`;
        let check = this.checks.get(id);
        if (!check) {
            check = new Promise((resolve) => resolve(this.access.isGroupMember(userId, gid)))
                .then((ok) => Boolean(ok), () => null)
                .finally(() => this.checks.delete(id));
            this.checks.set(id, check);
        }
        return check;
    }

    /** Sends {type: 'event', event, gid, data} to every socket subscribed to the group. → how many got it. */
    async publish(gid, event, data) {
        const group = key(gid);
        const message = { type: 'event', event, gid: group, data, at: new Date(this.now()).toISOString() };
        // In parallel: sockets with a fresh check get the event right away instead of waiting
        // behind another socket's membership query.
        const sent = await Promise.all([...this.clients].map((client) => this.deliver(client, group, message)));
        return sent.reduce((total, n) => total + n, 0);
    }

    // A socket gets a group's events in publish order: while one of them waits on a membership
    // check, the later ones queue behind it (even if a subscribe confirms the group meanwhile).
    // → a promise of 1 if the message was sent to this client, 0 otherwise.
    deliver(client, group, message) {
        const queued = client.queues.get(group);
        if (!queued && !this.checkDue(client, group)) return Promise.resolve(this.send(client, group, message));
        const run = queued
            ? queued.then((checkFailed) => this.deliverNow(client, group, message, checkFailed))
            : this.deliverNow(client, group, message, false);
        // The next delivery learns whether this one's check failed, so a burst shares one query.
        const tail = run.then((sent) => sent === null, () => false);
        client.queues.set(group, tail);
        tail.then(() => {
            if (client.queues.get(group) === tail) client.queues.delete(group);
        });
        return run.then((sent) => sent || 0, () => 0);
    }

    checkDue(client, group) {
        if (client.pending.has(group)) return true;
        const checkedAt = client.groups.get(group);
        return checkedAt !== undefined && this.now() - checkedAt > MEMBERSHIP_TTL_MS;
    }

    // → 1 (sent), 0 (not sent) or null (skipped because the membership check failed).
    async deliverNow(client, group, message, previousCheckFailed) {
        if (!this.clients.has(client)) return 0;
        if (this.checkDue(client, group)) {
            // Queued behind an event whose check just failed: same answer, no second query.
            if (previousCheckFailed) return null;
            const ok = await this.checkMembership(client.userId, group);
            // The socket may have closed or re-subscribed without this group meanwhile.
            if (!this.clients.has(client) || (!client.groups.has(group) && !client.pending.has(group))) return 0;
            if (ok === null) {
                // Skip this event but keep the group (old timestamp) to re-check on the next one.
                client.pending.add(group);
                return null;
            }
            if (!ok) {
                client.groups.delete(group);
                client.pending.delete(group);
                return 0;
            }
            client.groups.set(group, this.now());
            // Live again (or for the first time): a new `subscribed` makes the page resync, which
            // also catches up on the events skipped while the check was failing.
            if (client.pending.delete(group)) this.trySend(client, subscribedMessage(this.subscription(client)));
        }
        return this.send(client, group, message);
    }

    send(client, group, message) {
        return client.groups.has(group) && this.trySend(client, message) ? 1 : 0;
    }

    trySend(client, message) {
        try {
            client.send(message);
            return true;
        } catch {
            // A socket that just closed; its close handler removes it.
            return false;
        }
    }

    /** Publishes to every group linked to a repository. → the group ids. */
    async publishToRepo(repoId, event, data) {
        const gids = await this.github.getGroupIdsByRepo(repoId);
        await Promise.all(gids.map((gid) => this.publish(gid, event, data)));
        return gids;
    }
}

const realtime = new RealtimeHub();

module.exports = { RealtimeHub, realtime, subscribedMessage, MAX_GROUPS_PER_SOCKET, MEMBERSHIP_TTL_MS };
