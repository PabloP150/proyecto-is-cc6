-- 004_repair_group_admins: one-time data fix that used to run on every getGroupsByUserId call.
-- A group whose admin is no longer a member gets a remaining member as admin (ordered by uid:
-- never by username, which users choose; 005 repeats this with the join date). Idempotent.
UPDATE g
SET g.adminId = (
    SELECT TOP 1 ug2.uid
    FROM dbo.UserGroups ug2
    WHERE ug2.gid = g.gid
    ORDER BY ug2.uid
)
FROM dbo.Groups g
WHERE NOT EXISTS (SELECT 1 FROM dbo.UserGroups ug WHERE ug.uid = g.adminId AND ug.gid = g.gid)
  AND EXISTS (SELECT 1 FROM dbo.UserGroups ug WHERE ug.gid = g.gid);
GO
