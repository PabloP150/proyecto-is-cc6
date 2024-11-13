--DROP TABLE dbo.UserGroups;
--DROP TABLE dbo.Groups		--NO BOTAR!!!
--DROP TABLE dbo.Users;
--DROP TABLE dbo.DeleteTask
--DROP TABLE dbo.Complete
--DROP TABLE dbo.Tasks;
--DROP TABLE dbo.UserTask;
--DROP TABLE dbo.Edges;
--DROP TABLE dbo.Nodes;

--DROP TRIGGER dbo.UpdateTargetNodePercentage

--TRUNCATE TABLE dbo.Groups;	--NO TRUNCAR!!!
--TRUNCATE TABLE dbo.UserGroups;
--TRUNCATE TABLE dbo.Users;
--TRUNCATE TABLE dbo.Tasks;
--TRUNCATE TABLE dbo.Edges;
--TRUNCATE TABLE dbo.Nodes;

CREATE TABLE dbo.Users (
    uid 		UNIQUEIDENTIFIER 	NOT NULL PRIMARY KEY,
    username 	VARCHAR(25)			NOT NULL,
    password 	VARCHAR(60) 			NOT NULL
);

CREATE TABLE dbo.Groups (
    gid 		UNIQUEIDENTIFIER 	NOT NULL PRIMARY KEY,
	adminId		UNIQUEIDENTIFIER	NOT NULL,
    name 		VARCHAR(25)		 	NOT NULL,
	FOREIGN KEY (adminId) REFERENCES dbo.Users(uid)
);

CREATE TABLE dbo.UserGroups (
    uid 		UNIQUEIDENTIFIER 	NOT NULL,
    gid 		UNIQUEIDENTIFIER 	NOT NULL,
    PRIMARY KEY (uid, gid),
    FOREIGN KEY (uid) REFERENCES dbo.Users(uid),
    FOREIGN KEY (gid) REFERENCES dbo.Groups(gid)
);

CREATE TABLE dbo.Tasks (
	tid			UNIQUEIDENTIFIER	NOT NULL	PRIMARY KEY,
	gid			UNIQUEIDENTIFIER	NOT NULL,
	name		VARCHAR(25)			NOT NULL,
	description	VARCHAR(1000)		NOT NULL,
	list		VARCHAR(25),
	datetime	SMALLDATETIME		NOT NULL
	FOREIGN KEY (gid) REFERENCES dbo.Groups(gid)
);

CREATE TABLE dbo.UserTask(
utid			UNIQUEIDENTIFIER	NOT NULL,
uid				UNIQUEIDENTIFIER	NOT NULL,
tid				UNIQUEIDENTIFIER	NOT NULL,
completed		BIT					NOT NULL,
PRIMARY KEY (uid, tid),
FOREIGN KEY (tid) REFERENCES dbo.Tasks,
FOREIGN KEY (uid) REFERENCES dbo.Users
);

CREATE TABLE dbo.Nodes (
	nid			UNIQUEIDENTIFIER	NOT NULL	PRIMARY KEY,
	gid			UNIQUEIDENTIFIER	NOT NULL,
	name		VARCHAR(25)			NOT NULL,
	description	VARCHAR(1000)		NOT NULL,
	date		DATE				NOT NULL,
	completed	BIT					NOT NULL,
	x_pos		FLOAT				NOT NULL,
	y_pos		FLOAT				NOT NULL,
    percentage	INT					CHECK (percentage BETWEEN 0 AND 100),
	connections INT					DEFAULT 0,
	FOREIGN KEY (gid) REFERENCES dbo.Groups(gid)
);

CREATE TABLE dbo.Edges (
    eid         UNIQUEIDENTIFIER    NOT NULL    PRIMARY KEY,
    gid         UNIQUEIDENTIFIER    NOT NULL,
    sourceId    UNIQUEIDENTIFIER    NOT NULL,
    targetId    UNIQUEIDENTIFIER    NOT NULL,
	prerequisite Bit				DEFAULT 1,
    FOREIGN KEY (gid) REFERENCES dbo.Groups(gid),
    FOREIGN KEY (sourceId) REFERENCES dbo.Nodes(nid),
    FOREIGN KEY (targetId) REFERENCES dbo.Nodes(nid)
);

CREATE TABLE dbo.Complete(
	tid			UNIQUEIDENTIFIER	NOT NULL	PRIMARY KEY,
	gid			UNIQUEIDENTIFIER	NOT NULL,
	name		VARCHAR(25)			NOT NULL,
	description	VARCHAR(1000)		NOT NULL,
	datetime	SMALLDATETIME		NOT NULL
	FOREIGN KEY (gid) REFERENCES dbo.Groups(gid)
);

CREATE TABLE dbo.DeleteTask(
	tid			UNIQUEIDENTIFIER	NOT NULL	PRIMARY KEY,
	gid			UNIQUEIDENTIFIER	NOT NULL,
	name		VARCHAR(25)			NOT NULL,
	description	VARCHAR(1000)		NOT NULL,
	datetime	SMALLDATETIME		NOT NULL
	FOREIGN KEY (gid) REFERENCES dbo.Groups(gid)
);

DROP TRIGGER dbo.UpdateTargetNodePercentage;

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

UPDATE dbo.Nodes 
    SET percentage=0
    WHERE nid='7353E228-CD24-450A-A95A-244CE64EEC94';
select * from dbo.Nodes;

INSERT INTO dbo.Groups (gid, adminId, name)
VALUES ('00000000-0000-0000-0000-000000000001', 
        'DAD8127A-10FF-4A21-AC73-5E83F5CE0F61', 
        'Test Group'
		);

SELECT DISTINCT name, id, date, description
    FROM (
        SELECT name, nid AS id, date, description 
		FROM dbo.Nodes
		WHERE gid='D4978471-AA2F-4E1E-9C64-381AA3069D1C'
        UNION 
	    SELECT name, tid AS id, datetime, description 
		FROM dbo.Tasks
		WHERE gid='D4978471-AA2F-4E1E-9C64-381AA3069D1C'
    ) AS results;

select * from dbo.DeleteTask;
select * from dbo.Complete;
select * from dbo.Users;
select * from dbo.UserGroups;
select * from dbo.Groups;
select * from dbo.DeleteTask;
select * from dbo.Users;
select * from dbo.Tasks;
select * from dbo.Nodes;
select * from dbo.Edges;

--SELECT * FROM dbo.Users WHERE username='admin' AND password=HASHBYTES('SHA2_256','hola')