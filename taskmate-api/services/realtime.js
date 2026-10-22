// Live events for the browser over the /events WebSocket (Phase 4): CI/CD runs, jobs, deploys and
// deploy requests, published per group. A socket subscribes to its groups; membership is checked
// when it subscribes and again before a delivery once that check is older than MEMBERSHIP_TTL_MS,
// so someone removed from a group stops receiving its events within minutes.
const accessModel = require('../models/access.model');
const githubModel = require('../models/github.model');

const MAX_GROUPS_PER_SOCKET = 50;
const MEMBERSHIP_TTL_MS = 5 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const key = (gid) => String(gid).toLowerCase();

class RealtimeHub {
    constructor({ access = accessModel, github = githubModel, now = () => Date.now() } = {}) {
        this.access = access;
        this.github = github;
        this.now = now;
        this.clients = new Set();
    }

    // send(message) must never throw for a closed socket (the caller checks readyState).
    addClient({ userId, send }) {
        const client = { userId, send, groups: new Map() };
        this.clients.add(client);
        return client;
    }

    removeClient(client) {
        this.clients.delete(client);
    }

    get size() {
        return this.clients.size;
    }

    /** Replaces the client's groups with those of `gids` it belongs to. → the subscribed gids. */
    async subscribe(client, gids) {
        const wanted = [...new Set((Array.isArray(gids) ? gids : [])
            .filter((gid) => typeof gid === 'string' && UUID_RE.test(gid))
            .map(key))].slice(0, MAX_GROUPS_PER_SOCKET);
        const checks = await Promise.all(wanted.map(async (gid) => [gid, await this.isMember(client.userId, gid)]));
        const at = this.now();
        client.groups = new Map(checks.filter(([, ok]) => ok).map(([gid]) => [gid, at]));
        return [...client.groups.keys()];
    }

    async isMember(userId, gid) {
        try {
            return await this.access.isGroupMember(userId, gid);
        } catch {
            return false;
        }
    }

    /** Sends {type: 'event', event, gid, data} to every socket subscribed to the group. */
    async publish(gid, event, data) {
        const group = key(gid);
        const message = { type: 'event', event, gid: group, data, at: new Date(this.now()).toISOString() };
        let delivered = 0;
        for (const client of [...this.clients]) {
            const checkedAt = client.groups.get(group);
            if (checkedAt === undefined) continue;
            if (this.now() - checkedAt > MEMBERSHIP_TTL_MS) {
                if (!(await this.isMember(client.userId, group))) {
                    client.groups.delete(group);
                    continue;
                }
                client.groups.set(group, this.now());
            }
            try {
                client.send(message);
                delivered += 1;
            } catch {
                // A socket that just closed; its close handler removes it.
            }
        }
        return delivered;
    }

    /** Publishes to every group linked to a repository. → the group ids. */
    async publishToRepo(repoId, event, data) {
        const gids = await this.github.getGroupIdsByRepo(repoId);
        await Promise.all(gids.map((gid) => this.publish(gid, event, data)));
        return gids;
    }
}

const realtime = new RealtimeHub();

module.exports = { RealtimeHub, realtime, MAX_GROUPS_PER_SOCKET, MEMBERSHIP_TTL_MS };
