-- 006_bfs_progress_triggers: installs the set-based breadth-first version of the node-progress
-- triggers that the development database was already running (it was never committed).
-- 003 installed the cursor version, which only updates the direct targets of a changed node:
-- deeper levels would need RECURSIVE_TRIGGERS ON. This version walks the whole chain of
-- "progressor" edges (prerequisite = 0) in one firing, keeps a visited set so cycles terminate,
-- and stops after 20 levels. Re-runnable (CREATE OR ALTER).

CREATE OR ALTER TRIGGER dbo.UpdateTargetNodePercentage
ON dbo.Nodes
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL() > 10 RETURN;
    IF NOT UPDATE(percentage) RETURN;
    IF NOT EXISTS (
        SELECT 1 FROM inserted i INNER JOIN deleted d ON i.nid = d.nid
        WHERE i.percentage != d.percentage
    ) RETURN;

    DECLARE @vis TABLE (nid UNIQUEIDENTIFIER PRIMARY KEY);
    DECLARE @cur TABLE (nid UNIQUEIDENTIFIER PRIMARY KEY);
    DECLARE @nxt TABLE (nid UNIQUEIDENTIFIER PRIMARY KEY);

    INSERT INTO @vis
    SELECT DISTINCT i.nid FROM inserted i INNER JOIN deleted d ON i.nid = d.nid
    WHERE i.percentage != d.percentage;

    INSERT INTO @cur (nid)
    SELECT DISTINCT e.targetId FROM dbo.Edges e
    INNER JOIN @vis v ON e.sourceId = v.nid
    WHERE e.prerequisite = 0
      AND e.targetId NOT IN (SELECT nid FROM @vis);

    INSERT INTO @vis (nid) SELECT nid FROM @cur WHERE nid NOT IN (SELECT nid FROM @vis);

    DECLARE @iter INT = 0;
    WHILE EXISTS (SELECT 1 FROM @cur) AND @iter < 20
    BEGIN
        SET @iter = @iter + 1;

        UPDATE n SET n.percentage = sub.avgPct
        FROM dbo.Nodes n
        INNER JOIN (
            SELECT e.targetId,
                   CAST(ROUND(AVG(CAST(src.percentage AS DECIMAL(5,2))), 0) AS INT) AS avgPct
            FROM dbo.Edges e
            INNER JOIN dbo.Nodes src ON e.sourceId = src.nid
            INNER JOIN @cur c ON e.targetId = c.nid
            WHERE e.prerequisite = 0
            GROUP BY e.targetId
        ) sub ON n.nid = sub.targetId
        WHERE n.percentage != sub.avgPct;

        DELETE FROM @nxt;
        INSERT INTO @nxt (nid)
        SELECT DISTINCT e.targetId FROM dbo.Edges e
        INNER JOIN @cur c ON e.sourceId = c.nid
        WHERE e.prerequisite = 0
          AND e.targetId NOT IN (SELECT nid FROM @vis);

        INSERT INTO @vis (nid) SELECT nid FROM @nxt WHERE nid NOT IN (SELECT nid FROM @vis);
        DELETE FROM @cur;
        INSERT INTO @cur SELECT nid FROM @nxt;
    END
END
GO

CREATE OR ALTER TRIGGER dbo.UpdateTargetOnPrerequisiteChange
ON dbo.Edges
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL() > 10 RETURN;
    IF NOT UPDATE(prerequisite) RETURN;
    IF NOT EXISTS (
        SELECT 1 FROM inserted i INNER JOIN deleted d ON i.eid = d.eid
        WHERE i.prerequisite != d.prerequisite
    ) RETURN;

    DECLARE @vis TABLE (nid UNIQUEIDENTIFIER PRIMARY KEY);
    DECLARE @cur TABLE (nid UNIQUEIDENTIFIER PRIMARY KEY);
    DECLARE @nxt TABLE (nid UNIQUEIDENTIFIER PRIMARY KEY);

    INSERT INTO @cur (nid)
    SELECT DISTINCT i.targetId FROM inserted i INNER JOIN deleted d ON i.eid = d.eid
    WHERE i.prerequisite != d.prerequisite;

    INSERT INTO @vis SELECT nid FROM @cur;

    DECLARE @iter INT = 0;
    WHILE EXISTS (SELECT 1 FROM @cur) AND @iter < 20
    BEGIN
        SET @iter = @iter + 1;

        -- A target with no progressor sources left goes back to 0.
        UPDATE n SET n.percentage = ISNULL(sub.avgPct, 0)
        FROM dbo.Nodes n
        INNER JOIN @cur c ON n.nid = c.nid
        LEFT JOIN (
            SELECT e.targetId,
                   CAST(ROUND(AVG(CAST(src.percentage AS DECIMAL(5,2))), 0) AS INT) AS avgPct
            FROM dbo.Edges e
            INNER JOIN dbo.Nodes src ON e.sourceId = src.nid
            INNER JOIN @cur cc ON e.targetId = cc.nid
            WHERE e.prerequisite = 0
            GROUP BY e.targetId
        ) sub ON n.nid = sub.targetId
        WHERE n.percentage != ISNULL(sub.avgPct, 0);

        DELETE FROM @nxt;
        INSERT INTO @nxt (nid)
        SELECT DISTINCT e.targetId FROM dbo.Edges e
        INNER JOIN @cur c ON e.sourceId = c.nid
        WHERE e.prerequisite = 0
          AND e.targetId NOT IN (SELECT nid FROM @vis);

        INSERT INTO @vis (nid) SELECT nid FROM @nxt WHERE nid NOT IN (SELECT nid FROM @vis);
        DELETE FROM @cur;
        INSERT INTO @cur SELECT nid FROM @nxt;
    END
END
GO
