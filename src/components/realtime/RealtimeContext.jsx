import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { getAuthToken } from '../../api/client';
import { WS_BASE } from '../../config';
import useWebSocket from '../../hooks/useWebSocket';
import { GroupContext } from '../GroupContext';
import { sameId } from '../../utils/ids';

/**
 * Live CI/CD events (Phase 4) from the /events WebSocket: one connection per logged-in user,
 * subscribed to all of their groups. Screens listen with useGroupEvents; without a connection
 * `connected` is false and they fall back to polling.
 */
export const RealtimeContext = createContext({ connected: false, subscribe: () => () => {} });

export function RealtimeProvider({ user, children }) {
  const { groups } = useContext(GroupContext) || {};
  const token = user ? user.token || getAuthToken() : null;
  const listeners = useRef(new Set());

  const onMessage = useCallback((message) => {
    if (!message || message.type !== 'event') return;
    listeners.current.forEach((listener) => {
      try {
        listener(message);
      } catch {
        // One broken listener must not stop the others.
      }
    });
  }, []);

  const { isConnected, sendMessage, disconnect } = useWebSocket(token ? `${WS_BASE}/events` : null, token, {
    onMessage,
    autoConnect: Boolean(token),
    maxReconnectAttempts: 10,
  });

  useEffect(() => {
    if (!token) disconnect();
  }, [token, disconnect]);

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

  // Subscribe again on every (re)connection and whenever the user's groups change.
  useEffect(() => {
    if (isConnected) sendMessage({ type: 'subscribe', groups: gids ? gids.split(',') : [] });
  }, [isConnected, gids, sendMessage]);

  const subscribe = useCallback((listener) => {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  }, []);

  const value = useMemo(() => ({ connected: isConnected, subscribe }), [isConnected, subscribe]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);

/**
 * Calls onEvent(data, message) for events of `gid` whose name is in `events`. With `debounceMs`,
 * a burst of events (a run sends one per job and step) triggers a single call with the last one.
 */
export function useGroupEvents(gid, events, onEvent, { debounceMs = 0 } = {}) {
  const { subscribe } = useRealtime();
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);
  const names = Array.isArray(events) ? events.join(',') : '';

  useEffect(() => {
    if (!gid || !names) return undefined;
    const wanted = new Set(names.split(','));
    let timer = null;
    const unsubscribe = subscribe((message) => {
      if (!wanted.has(message.event) || !sameId(String(message.gid), String(gid))) return;
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
}
