import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';

export const GroupContext = createContext();

export const GROUP_ID_KEY = 'selectedGroupId';
export const GROUP_NAME_KEY = 'selectedGroupName';

const readStorage = (key) => {
  try {
    const value = localStorage.getItem(key);
    return value && value !== 'null' && value !== 'undefined' ? value : null;
  } catch {
    return null;
  }
};

const writeStorage = (key, value) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Storage unavailable (private mode / quota): the in-memory selection still works.
  }
};

const currentUserId = () => {
  const stored = readStorage('userId');
  if (stored) return stored;
  try {
    return JSON.parse(localStorage.getItem('user') || 'null')?.uid || null;
  } catch {
    return null;
  }
};

export const GroupProvider = ({ children }) => {
  // Lazy initializers restore the selection synchronously so pages that only read the
  // context (Calendar, Analytics, Flow) already have it on the first render after a reload.
  const [selectedGroupId, setSelectedGroupId] = useState(() => readStorage(GROUP_ID_KEY));
  const [selectedGroupName, setSelectedGroupName] = useState(() => readStorage(GROUP_NAME_KEY) || '');
  const [groups, setGroups] = useState([]);

  useEffect(() => writeStorage(GROUP_ID_KEY, selectedGroupId), [selectedGroupId]);
  useEffect(() => writeStorage(GROUP_NAME_KEY, selectedGroupName), [selectedGroupName]);

  // Single place that knows how to (re)load the user's groups; throws ApiError on failure.
  const refreshGroups = useCallback(async ({ signal } = {}) => {
    const uid = currentUserId();
    if (!uid) {
      setGroups([]);
      return [];
    }
    const data = await api.get(`/api/groups/user-groups?uid=${encodeURIComponent(uid)}`, { signal });
    const list = Array.isArray(data?.groups) ? data.groups : [];
    setGroups(list);
    return list;
  }, []);

  const clearGroupState = useCallback(() => {
    setSelectedGroupId(null);
    setSelectedGroupName('');
    setGroups([]);
  }, []);

  const value = useMemo(() => ({
    selectedGroupId,
    setSelectedGroupId,
    selectedGroupName,
    setSelectedGroupName,
    groups,
    setGroups,
    refreshGroups,
    clearGroupState,
  }), [selectedGroupId, selectedGroupName, groups, refreshGroups, clearGroupState]);

  return (
    <GroupContext.Provider value={value}>
      {children}
    </GroupContext.Provider>
  );
};
