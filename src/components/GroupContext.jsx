import React, { createContext, useState } from 'react';

export const GroupContext = createContext();

export const GroupProvider = ({ children }) => {
  const [selectedGroupId, setSelectedGroupId] = useState(null);

  return (
    <GroupContext.Provider value={{ selectedGroupId, setSelectedGroupId }}>
      {children}
    </GroupContext.Provider>
  );
};
