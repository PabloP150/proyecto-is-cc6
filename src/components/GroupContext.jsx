import React, { createContext, useState } from 'react';

export const GroupContext = createContext();

export const GroupProvider = ({ children }) => {
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [selectedGroupName, setSelectedGroupName] = useState('');

  return (
    <GroupContext.Provider value={{ selectedGroupId, setSelectedGroupId, selectedGroupName, setSelectedGroupName }}>
      {children}
    </GroupContext.Provider>
  );
};
