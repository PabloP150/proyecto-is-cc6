CREATE TRIGGER UpdateTargetNodePercentage
ON dbo.Nodes
AFTER UPDATE
AS
BEGIN
    DECLARE @sourceId UNIQUEIDENTIFIER;
    DECLARE @targetId UNIQUEIDENTIFIER;
    DECLARE @childCount INT;
    DECLARE @completedCount INT;

    SELECT @sourceId = i.nid
    FROM inserted i;

    DECLARE target_cursor CURSOR FOR
        SELECT DISTINCT targetId
        FROM dbo.Edges INNER JOIN dbo.Nodes ON targetId = nid
        WHERE sourceId = @sourceId AND prerequisite=0;

    OPEN target_cursor;

    FETCH NEXT FROM target_cursor INTO @targetId;

	WHILE @@FETCH_STATUS = 0
	BEGIN
		WHILE @@FETCH_STATUS = 0
		BEGIN
			PRINT 'Processing target node: ' + CAST(@targetId AS VARCHAR(50));

			-- Count the total number of child nodes
			SELECT @childCount = COUNT(*)
			FROM dbo.Edges
			WHERE targetId = @targetId;

			-- Count the number of completed child nodes
			SELECT @completedCount = COUNT(*)
			FROM dbo.Edges e
			INNER JOIN dbo.Nodes n ON e.sourceId = n.nid
			WHERE e.targetId = @targetId AND n.percentage = 100;

			-- Calculate the percentage and update the target node
			UPDATE dbo.Nodes
			SET percentage = (@completedCount * 100) / @childCount
			WHERE nid = @targetId;

			PRINT 'Completed: ' + CAST(@completedCount AS VARCHAR(50)) + ', children: ' + CAST(@childCount AS VARCHAR(50));
			PRINT 'Updated target node: ' + CAST(@targetId AS VARCHAR(50)) + ', new percentage: ' + CAST((@completedCount * 100) / @childCount AS VARCHAR(10));

			FETCH NEXT FROM target_cursor INTO @targetId;
		END;
		CLOSE target_cursor;
		DEALLOCATE target_cursor;

		DECLARE target_cursor CURSOR FOR
        SELECT DISTINCT targetId
        FROM dbo.Edges INNER JOIN dbo.Nodes ON targetId = nid
        WHERE sourceId = @targetId;

		OPEN target_cursor;
		FETCH NEXT FROM target_cursor INTO @targetId;
	END

    CLOSE target_cursor;
    DEALLOCATE target_cursor;
END;