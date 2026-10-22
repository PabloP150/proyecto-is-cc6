import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getAuthToken } from '../../api/client';
import { WS_BASE } from '../../config';
import useWebSocket from '../../hooks/useWebSocket';
import { GroupContext } from '../GroupContext';
import { sameId } from '../../utils/ids';

// A subscribe the API refused (too many in a minute) or could not apply is sent again later.
const SUBSCRIBE_RETRY_MS = 1100;
const SUBSCRIBE_FAILED_RETRY_MS = 10 * 1000;
const MAX_SUBSCRIBE_RETRY_MS = 60 * 1000;
// No socket open or opening (Reconnecting = waiting for a backoff timer, which the browser throttles
// in a hidden tab): coming back to the tab reconnects at once.
const isIdleStatus = (status) => status === 'Failed' || status === 'Disconnected' || /^Reconnecting/.test(String(status || ''));

/**
 * Live CI/CD events (Phase 4) from the /events WebSocket: one connection per logged-in user,
 * subscribed to all of their groups. Screens listen with useGroupEvents; `connected` is true only
 * once the server confirmed the subscription (before that, or after it failed, they fall back to
 * polling). `epoch` grows with every subscription the server confirms (each (re)connection), so
 * screens can catch up on events lost meanwhile.
 */
export const RealtimeContext = createContext({ connected: false, epoch: 0, subscribe: () => () => {} });

export function RealtimeProvider({ user, children }) {
  const { groups, refreshGroups } = useContext(GroupContext) || {};
  const token = user ? user.token || getAuthToken() : null;
  const listeners = useRef(new Set());
  const [epoch, setEpoch] = useState(0);
  const [subscribed, setSubscribed] = useState(false);
  const lastSubscribe = useRef(null);
  const retryTimer = useRef(null);
  const sendRef = useRef(null);

  // Sends the latest group list again: a refused or failed subscribe would leave new groups (or
  // all of them) silent until the next reconnection.
  const retrySubscribe = useCallback((delayMs) => {
    clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => {
      if (lastSubscribe.current && sendRef.current) sendRef.current(lastSubscribe.current);
    }, Math.min(Math.max(delayMs, SUBSCRIBE_RETRY_MS), MAX_SUBSCRIBE_RETRY_MS));
  }, []);

  const onMessage = useCallback((message) => {
    if (!message) return;
    if (message.type === 'subscribed') {
      setSubscribed(true);
      setEpoch((value) => value + 1);
      return;
    }
    if (message.type === 'error' && message.code === 'RATE_LIMITED') {
      // The previous subscription (if any) still holds; only the newest list waits.
      retrySubscribe(Number(message.retryAfterMs) || 0);
      return;
    }
    if (message.type === 'error' && message.code === 'SUBSCRIBE_FAILED') {
      // Nothing is being delivered: screens must poll until a subscribe goes through.
      setSubscribed(false);
      retrySubscribe(SUBSCRIBE_FAILED_RETRY_MS);
      return;
    }
    if (message.type !== 'event') return;
    listeners.current.forEach((listener) => {
      try {
        listener(message);
      } catch {
        // One broken listener must not stop the others.
      }
    });
  }, [retrySubscribe]);

  // Reconnect forever (the backoff is capped at 30 s): giving up would silently turn the
  // notifications off until a reload.
  const { isConnected, connectionStatus, sendMessage, disconnect, reconnect } = useWebSocket(
    token ? `${WS_BASE}/events` : null,
    token,
    { onMessage, autoConnect: Boolean(token), maxReconnectAttempts: Infinity }
  );

  useEffect(() => {
    sendRef.current = sendMessage;
  }, [sendMessage]);

  useEffect(() => {
    if (!token) disconnect();
  }, [token, disconnect]);

  useEffect(() => () => clearTimeout(retryTimer.current), []);

  // Back online, the old socket may be dead without knowing it: start a fresh one. Back on the
  // tab, reconnect at once instead of waiting for a throttled backoff timer.
  const statusRef = useRef(connectionStatus);
  useEffect(() => {
    statusRef.current = connectionStatus;
  }, [connectionStatus]);
  useEffect(() => {
    if (!token || typeof reconnect !== 'function') return undefined;
    const onOnline = () => reconnect();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && isIdleStatus(statusRef.current)) reconnect();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [token, reconnect]);

  // After a reload the group list is empty until some page asks for it, and without it the socket
  // subscribes to nothing: load it once per login when the socket is up (a failed load is tried
  // again on the next connection; an empty answer is final).
  const noGroups = !Array.isArray(groups) || groups.length === 0;
  const groupsLoadedFor = useRef(null);
  useEffect(() => {
    if (!token || !isConnected || !noGroups || typeof refreshGroups !== 'function') return undefined;
    if (groupsLoadedFor.current === token) return undefined;
    groupsLoadedFor.current = token;
    const controller = new AbortController();
    let settled = false;
    Promise.resolve(refreshGroups({ signal: controller.signal }))
      .catch(() => {
        if (groupsLoadedFor.current === token) groupsLoadedFor.current = null;
      })
      .finally(() => {
        settled = true;
      });
    return () => {
      if (!settled && groupsLoadedFor.current === token) groupsLoadedFor.current = null;
      controller.abort();
    };
  }, [token, isConnected, noGroups, refreshGroups]);

  const gids = useMemo(
    () =>
      (Array.isArray(groups) ? groups : [])
        .map((group) => group && group.gid)
        .filter(Boolean)
        .map(String)
        .sort()
        .join(','),
    [groups]
  );

  // Subscribe again on every (re)connection and whenever the user's groups change. A fresh socket
  // sends no empty list (the groups are still loading, and it would only use up a subscribe the API
  // rate-limits); a socket subscribed to some groups does, when the user has none left (they left
  // or deleted the last one), or the server would keep sending that group's events.
  useEffect(() => {
    if (!isConnected) return;
    if (!gids) {
      if (lastSubscribe.current && lastSubscribe.current.groups.length > 0) {
        const message = { type: 'subscribe', groups: [] };
        lastSubscribe.current = message;
        sendMessage(message);
      }
      return;
    }
    const message = { type: 'subscribe', groups: gids.split(',') };
    lastSubscribe.current = message;
    sendMessage(message);
  }, [isConnected, gids, sendMessage]);

  // A new socket starts with no subscription until the server confirms one.
  useEffect(() => {
    if (isConnected) return;
    setSubscribed(false);
    lastSubscribe.current = null;
    clearTimeout(retryTimer.current);
  }, [isConnected]);

  const subscribe = useCallback((listener) => {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  }, []);

  const connected = isConnected && subscribed;
  const value = useMemo(() => ({ connected, epoch, subscribe }), [connected, epoch, subscribe]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);

/**
 * Calls onEvent(data, message) for events of `gid` whose name is in `events`.
 * - `filter(data, message)`: only matching events count; it runs before the debounce, so another
 *   run's event cannot replace (and drop) the one this screen waits for.
 * - `debounceMs`: a burst of events (a run sends one per job and step) triggers a single call
 *   with the last one.
 * Each time the server confirms a subscription again (a reconnection, not the first one) it also
 * calls onEvent(null, {type: 'resync'}): events sent while the socket was down are lost, so the
 * screen reloads once.
 */
export function useGroupEvents(gid, events, onEvent, { debounceMs = 0, filter } = {}) {
  const { subscribe, epoch = 0 } = useRealtime();
  const handler = useRef(onEvent);
  const accept = useRef(filter);
  useEffect(() => {
    handler.current = onEvent;
    accept.current = filter;
  }, [onEvent, filter]);
  const names = Array.isArray(events) ? events.join(',') : '';

  useEffect(() => {
    if (!gid || !names) return undefined;
    const wanted = new Set(names.split(','));
    let timer = null;
    const unsubscribe = subscribe((message) => {
      if (!wanted.has(message.event) || !sameId(String(message.gid), String(gid))) return;
      if (accept.current && !accept.current(message.data, message)) return;
      if (!debounceMs) {
        handler.current(message.data, message);
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => handler.current(message.data, message), debounceMs);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [gid, names, subscribe, debounceMs]);

  // The first subscription (epoch 0 → 1) comes right after the screen loaded its data; later ones
  // are reconnections that may have missed events.
  const seenEpoch = useRef(epoch);
  useEffect(() => {
    if (epoch === seenEpoch.current) return;
    const previous = seenEpoch.current;
    seenEpoch.current = epoch;
    if (previous > 0 && gid && names) handler.current(null, { type: 'resync', epoch });
  }, [epoch, gid, names]);
}
