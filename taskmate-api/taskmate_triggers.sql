-- =====================================
-- TRIGGER FOR NODE PERCENTAGE UPDATES
-- =====================================

CREATE TRIGGER UpdateTargetNodePercentage
ON dbo.Nodes
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    
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
    
    -- Get all updated nodes that might affect other nodes
    DECLARE @sourceId UNIQUEIDENTIFIER;
    DECLARE @targetId UNIQUEIDENTIFIER;
    DECLARE @avgPercentage DECIMAL(5,2);
    DECLARE @newPercentage INT;
    DECLARE @oldPercentage INT;
    
    -- Process each updated node
    DECLARE source_cursor CURSOR FOR
        SELECT i.nid
        FROM inserted i
        INNER JOIN deleted d ON i.nid = d.nid
        WHERE i.percentage != d.percentage; -- Only process nodes where percentage actually changed
    
    OPEN source_cursor;
    FETCH NEXT FROM source_cursor INTO @sourceId;
    
    WHILE @@FETCH_STATUS = 0
    BEGIN
        -- Find all target nodes that depend on this source (progressor mode only)
        DECLARE target_cursor CURSOR FOR
            SELECT DISTINCT e.targetId
            FROM dbo.Edges e
            INNER JOIN dbo.Nodes n ON e.targetId = n.nid
            WHERE e.sourceId = @sourceId 
            AND e.prerequisite = 0  -- Only progressor mode
            AND e.targetId NOT IN (SELECT nid FROM #ProcessedNodes); -- Avoid cycles
        
        OPEN target_cursor;
        FETCH NEXT FROM target_cursor INTO @targetId;
        
        WHILE @@FETCH_STATUS = 0
        BEGIN
            -- Get current percentage before update
            SELECT @oldPercentage = percentage FROM dbo.Nodes WHERE nid = @targetId;
            
            -- Calculate average percentage of all progressor children
            SELECT @avgPercentage = AVG(CAST(n.percentage AS DECIMAL(5,2)))
            FROM dbo.Edges e
            INNER JOIN dbo.Nodes n ON e.sourceId = n.nid
            WHERE e.targetId = @targetId AND e.prerequisite = 0;
            
            -- Convert to integer (round to nearest)
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
                
                PRINT 'Updated node ' + CAST(@targetId AS VARCHAR(50)) + 
                      ' from ' + CAST(@oldPercentage AS VARCHAR(10)) + 
                      '% to ' + CAST(@newPercentage AS VARCHAR(10)) + 
                      '% (avg: ' + CAST(@avgPercentage AS VARCHAR(10)) + ')';
            END
            
            FETCH NEXT FROM target_cursor INTO @targetId;
        END
        
        CLOSE target_cursor;
        DEALLOCATE target_cursor;
        
        FETCH NEXT FROM source_cursor INTO @sourceId;
    END
    
    CLOSE source_cursor;
    DEALLOCATE source_cursor;
    
    -- Clean up
    DROP TABLE #ProcessedNodes;
    
    -- Reset recursion level
    SET @context = CAST(@recursion_level AS VARBINARY(128));
    SET CONTEXT_INFO @context;
END;

-- =====================================
-- TRIGGER FOR EDGE PREREQUISITE CHANGES
-- =====================================

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
    DECLARE edge_target_cursor CURSOR FOR
        SELECT DISTINCT i.targetId
        FROM inserted i
        INNER JOIN deleted d ON i.eid = d.eid
        WHERE i.prerequisite != d.prerequisite;
    
    OPEN edge_target_cursor;
    FETCH NEXT FROM edge_target_cursor INTO @targetId;
    
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
        
        FETCH NEXT FROM edge_target_cursor INTO @targetId;
    END
    
    CLOSE edge_target_cursor;
    DEALLOCATE edge_target_cursor;
    
    -- Clean up
    DROP TABLE #ProcessedNodes;
    
    -- Reset recursion level
    SET @context = CAST(@recursion_level AS VARBINARY(128));
    SET CONTEXT_INFO @context;
END;