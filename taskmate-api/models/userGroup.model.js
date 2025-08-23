// models/userGroup.model.js
const mockDatabase = require('../helpers/mockDatabase');

const addUserToGroup = async (userGroupData) => {
  const { uid, gid } = userGroupData;
  
  // Check if the relationship already exists
  const existingRelation = mockDatabase.userGroups.find(
    ug => ug.uid === uid && ug.gid === gid
  );
  
  if (existingRelation) {
    return { success: false, message: 'User already in group' };
  }
  
  // Add the user-group relationship
  mockDatabase.userGroups.push({ uid, gid });
  return { success: true, message: 'User added to group successfully' };
};

const getMembersByGroupId = (gid) => {
  // Get user IDs in the group
  const usersInGroup = mockDatabase.userGroups
    .filter(ug => ug.gid === gid)
    .map(ug => ug.uid);
  
  // Get user details for those IDs
  const members = mockDatabase.users
    .filter(user => usersInGroup.includes(user.uid))
    .map(user => ({
      uid: user.uid,
      username: user.username
    }));
  
  return Promise.resolve(members);
};

const removeMemberFromGroup = (uid, gid) => {
  const relationIndex = mockDatabase.userGroups.findIndex(
    ug => ug.uid === uid && ug.gid === gid
  );
  
  if (relationIndex !== -1) {
    mockDatabase.userGroups.splice(relationIndex, 1);
    return Promise.resolve({ success: true, message: 'User removed from group' });
  }
  
  return Promise.resolve({ success: false, message: 'User not found in group' });
};

const leaveGroup = (uid, gid) => {
  const relationIndex = mockDatabase.userGroups.findIndex(
    ug => ug.uid === uid && ug.gid === gid
  );
  
  if (relationIndex !== -1) {
    mockDatabase.userGroups.splice(relationIndex, 1);
    return Promise.resolve({ success: true, message: 'Left group successfully' });
  }
  
  return Promise.resolve({ success: false, message: 'User not found in group' });
};

module.exports = {
  addUserToGroup,
  getMembersByGroupId,
  removeMemberFromGroup,
  leaveGroup,
};
