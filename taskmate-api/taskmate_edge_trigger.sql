CREATE TRIGGER UpdateTargetOnPrerequisiteChange
ON dbo.Edges
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    
    -- Only process if prerequisite field actually changed
    IF NOT EXISTS (
        SELECT 1 FROM inserted i
        INNER JOIN deleted d ON i.eid = d.eid
        WHERE i.prerequisite != d.prerequisite
    )
    BEGIN
        RETURN; -- Exit if prerequisite didn't change
    END
    
    -- Prevent infinite recursion by tracking processing depth
    DECLARE @recursion_level INT = ISNULL(CONTEXT_INFO(), 0);
    IF @recursion_level > 10
    BEGIN
        RETURN; -- Exit if we've gone too deep
    END
    
    -- Set recursion level
    DECLARE @context VARBINARY(128) = CAST(@recursion_level + 1 AS VARBINARY(128));
    SET CONTEXT_INFO @context;
    
    -- Create temp table to track processed nodes (prevent cycles)
    CREATE TABLE #ProcessedNodes (
        nid UNIQUEIDENTIFIER PRIMARY KEY,
        processed_at DATETIME DEFAULT GETDATE()
    );
    
    DECLARE @targetId UNIQUEIDENTIFIER;
    DECLARE @avgPercentage DECIMAL(5,2);
    DECLARE @newPercentage INT;
    DECLARE @oldPercentage INT;
    
    -- Get all target nodes that were affected by prerequisite changes
    DECLARE target_cursor CURSOR FOR
        SELECT DISTINCT i.targetId
        FROM inserted i
        INNER JOIN deleted d ON i.eid = d.eid
        WHERE i.prerequisite != d.prerequisite;
    
    OPEN target_cursor;
    FETCH NEXT FROM target_cursor INTO @targetId;
    
    WHILE @@FETCH_STATUS = 0
    BEGIN
        -- Skip if already processed (avoid cycles)
        IF NOT EXISTS (SELECT 1 FROM #ProcessedNodes WHERE nid = @targetId)
        BEGIN
            -- Get current percentage before update
            SELECT @oldPercentage = percentage FROM dbo.Nodes WHERE nid = @targetId;
            
            -- Calculate average percentage of all progressor children (prerequisite = 0)
            SELECT @avgPercentage = AVG(CAST(n.percentage AS DECIMAL(5,2)))
            FROM dbo.Edges e
            INNER JOIN dbo.Nodes n ON e.sourceId = n.nid
            WHERE e.targetId = @targetId AND e.prerequisite = 0;
            
            -- If no progressor children, set to 0
            IF @avgPercentage IS NULL
                SET @newPercentage = 0;
            ELSE
                SET @newPercentage = ROUND(@avgPercentage, 0);
            
            -- Only update if percentage actually changed
            IF @newPercentage != @oldPercentage
            BEGIN
                -- Mark as processed to prevent cycles
                INSERT INTO #ProcessedNodes (nid) VALUES (@targetId);
                
                -- Update the target node
                UPDATE dbo.Nodes
                SET percentage = @newPercentage
                WHERE nid = @targetId;
                
                PRINT 'Edge prerequisite change: Updated node ' + CAST(@targetId AS VARCHAR(50)) + 
                      ' from ' + CAST(@oldPercentage AS VARCHAR(10)) + 
                      '% to ' + CAST(@newPercentage AS VARCHAR(10)) + 
                      '% (avg: ' + CAST(ISNULL(@avgPercentage, 0) AS VARCHAR(10)) + ')';
            END
        END
        
        FETCH NEXT FROM target_cursor INTO @targetId;
    END
    
    CLOSE target_cursor;
    DEALLOCATE target_cursor;
    
    -- Clean up
    DROP TABLE #ProcessedNodes;
    
    -- Reset recursion level
    SET @context = CAST(@recursion_level AS VARBINARY(128));
    SET CONTEXT_INFO @context;
END;