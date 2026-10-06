-- 003_triggers: installs the node-progress triggers (the only definition of them; re-runnable).
-- A target node in "progressor" mode (Edges.prerequisite = 0) shows the average percentage
-- of its source nodes. Cursors are LOCAL so nested firings cannot collide on a global
-- cursor name, and TRIGGER_NESTLEVEL() bounds the recursion.

CREATE OR ALTER TRIGGER dbo.UpdateTargetNodePercentage
ON dbo.Nodes
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL() > 10 RETURN;
    IF NOT UPDATE(percentage) RETURN;

    CREATE TABLE #ProcessedNodes (nid UNIQUEIDENTIFIER PRIMARY KEY);

    DECLARE @sourceId UNIQUEIDENTIFIER;
    DECLARE @targetId UNIQUEIDENTIFIER;
    DECLARE @avgPercentage DECIMAL(5,2);
    DECLARE @newPercentage INT;
    DECLARE @oldPercentage INT;

    DECLARE source_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT i.nid
        FROM inserted i
        INNER JOIN deleted d ON i.nid = d.nid
        WHERE ISNULL(i.percentage, -1) <> ISNULL(d.percentage, -1);

    OPEN source_cursor;
    FETCH NEXT FROM source_cursor INTO @sourceId;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        DECLARE target_cursor CURSOR LOCAL FAST_FORWARD FOR
            SELECT DISTINCT e.targetId
            FROM dbo.Edges e
            WHERE e.sourceId = @sourceId
              AND e.prerequisite = 0
              AND e.targetId NOT IN (SELECT nid FROM #ProcessedNodes);

        OPEN target_cursor;
        FETCH NEXT FROM target_cursor INTO @targetId;

        WHILE @@FETCH_STATUS = 0
        BEGIN
            SELECT @oldPercentage = percentage FROM dbo.Nodes WHERE nid = @targetId;

            SELECT @avgPercentage = AVG(CAST(n.percentage AS DECIMAL(5,2)))
            FROM dbo.Edges e
            INNER JOIN dbo.Nodes n ON e.sourceId = n.nid
            WHERE e.targetId = @targetId AND e.prerequisite = 0;

            SET @newPercentage = ROUND(ISNULL(@avgPercentage, 0), 0);

            IF ISNULL(@oldPercentage, -1) <> @newPercentage
            BEGIN
                INSERT INTO #ProcessedNodes (nid) VALUES (@targetId);
                UPDATE dbo.Nodes SET percentage = @newPercentage WHERE nid = @targetId;
            END

            FETCH NEXT FROM target_cursor INTO @targetId;
        END

        CLOSE target_cursor;
        DEALLOCATE target_cursor;

        FETCH NEXT FROM source_cursor INTO @sourceId;
    END

    CLOSE source_cursor;
    DEALLOCATE source_cursor;
    DROP TABLE #ProcessedNodes;
END;
GO

CREATE OR ALTER TRIGGER dbo.UpdateTargetOnPrerequisiteChange
ON dbo.Edges
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL() > 10 RETURN;
    IF NOT EXISTS (
        SELECT 1 FROM inserted i
        INNER JOIN deleted d ON i.eid = d.eid
        WHERE ISNULL(i.prerequisite, 1) <> ISNULL(d.prerequisite, 1)
    ) RETURN;

    DECLARE @targetId UNIQUEIDENTIFIER;
    DECLARE @avgPercentage DECIMAL(5,2);
    DECLARE @newPercentage INT;
    DECLARE @oldPercentage INT;

    DECLARE edge_target_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT DISTINCT i.targetId
        FROM inserted i
        INNER JOIN deleted d ON i.eid = d.eid
        WHERE ISNULL(i.prerequisite, 1) <> ISNULL(d.prerequisite, 1);

    OPEN edge_target_cursor;
    FETCH NEXT FROM edge_target_cursor INTO @targetId;

    WHILE @@FETCH_STATUS = 0
    BEGIN
        SELECT @oldPercentage = percentage FROM dbo.Nodes WHERE nid = @targetId;

        SELECT @avgPercentage = AVG(CAST(n.percentage AS DECIMAL(5,2)))
        FROM dbo.Edges e
        INNER JOIN dbo.Nodes n ON e.sourceId = n.nid
        WHERE e.targetId = @targetId AND e.prerequisite = 0;

        -- No progressor children left: the target goes back to 0.
        SET @newPercentage = ROUND(ISNULL(@avgPercentage, 0), 0);

        IF ISNULL(@oldPercentage, -1) <> @newPercentage
            UPDATE dbo.Nodes SET percentage = @newPercentage WHERE nid = @targetId;

        FETCH NEXT FROM edge_target_cursor INTO @targetId;
    END

    CLOSE edge_target_cursor;
    DEALLOCATE edge_target_cursor;
END;
GO
