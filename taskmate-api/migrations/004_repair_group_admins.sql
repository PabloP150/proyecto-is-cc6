-- 004_repair_group_admins: one-time data fix that used to run on every getGroupsByUserId call.
-- A group whose admin is no longer a member gets its first remaining member (by username) as
-- admin. Idempotent: afterwards no such group exists.
UPDATE g
SET g.adminId = (
    SELECT TOP 1 ug2.uid
    FROM dbo.UserGroups ug2
    INNER JOIN dbo.Users u2 ON u2.uid = ug2.uid
    WHERE ug2.gid = g.gid
    ORDER BY u2.username
)
FROM dbo.Groups g
WHERE NOT EXISTS (SELECT 1 FROM dbo.UserGroups ug WHERE ug.uid = g.adminId AND ug.gid = g.gid)
  AND EXISTS (SELECT 1 FROM dbo.UserGroups ug WHERE ug.gid = g.gid);
GO
