// In-memory single-process store with expiry and a hard size cap (oldest entries go first).
class TtlStore {
    constructor({ ttlMs, maxEntries = 10000, now = () => Date.now() }) {
        this.ttlMs = ttlMs;
        this.maxEntries = maxEntries;
        this.now = now;
        this.entries = new Map();
    }

    set(key, value) {
        this.prune();
        while (this.entries.size >= this.maxEntries) {
            this.entries.delete(this.entries.keys().next().value);
        }
        this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    }

    get(key) {
        const entry = this.entries.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= this.now()) {
            this.entries.delete(key);
            return null;
        }
        return entry.value;
    }

    // Single use: the entry is gone after this call whether or not it was valid.
    take(key) {
        const value = this.get(key);
        this.entries.delete(key);
        return value;
    }

    // Puts back an entry taken by take() keeping its original expiry.
    restore(key, value, expiresAt) {
        if (expiresAt > this.now()) this.entries.set(key, { value, expiresAt });
    }

    expiryOf(key) {
        const entry = this.entries.get(key);
        return entry ? entry.expiresAt : 0;
    }

    prune() {
        const now = this.now();
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt <= now) this.entries.delete(key);
        }
    }

    clear() {
        this.entries.clear();
    }

    get size() {
        return this.entries.size;
    }
}

module.exports = { TtlStore };
