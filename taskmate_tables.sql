<<<<<<< HEAD
--DROP TABLE dbo.Groups;	--NO BOTAR!!!
--DROP TABLE dbo.UserGroups;
--DROP TABLE dbo.Users;
=======
--DROP TABLE dbo.UserGroups;
--DROP TABLE dbo.Groups;
--DROP TABLE dbo.Users;
--DROP TABLE dbo.DeleteTask
--DROP TABLE dbo.Complete
>>>>>>> refs/remotes/origin/master
--DROP TABLE dbo.Tasks;
--DROP TABLE dbo.Edges;
--DROP TABLE dbo.Nodes;

--TRUNCATE TABLE dbo.Groups;	--NO TRUNCAR!!!
--TRUNCATE TABLE dbo.UserGroups;
--TRUNCATE TABLE dbo.Users;
--TRUNCATE TABLE dbo.Tasks;
--TRUNCATE TABLE dbo.Edges;
--TRUNCATE TABLE dbo.Nodes;

CREATE TABLE dbo.Users (
    uid 		UNIQUEIDENTIFIER 	NOT NULL PRIMARY KEY,
    username 	VARCHAR(25)			NOT NULL,
    password 	CHAR(25) 			NOT NULL
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

CREATE TABLE dbo.Nodes (
	nid			UNIQUEIDENTIFIER	NOT NULL	PRIMARY KEY,
	gid			UNIQUEIDENTIFIER	NOT NULL,
	name		VARCHAR(25)			NOT NULL,
	description	VARCHAR(1000)		NOT NULL,
	date		DATE				NOT NULL,
	completed	BIT					NOT NULL,
	x_pos		FLOAT				NOT NULL,
	y_pos		FLOAT				NOT NULL,
	FOREIGN KEY (gid) REFERENCES dbo.Groups(gid)
);

CREATE TABLE dbo.Edges (
    eid         UNIQUEIDENTIFIER    NOT NULL    PRIMARY KEY,
    gid         UNIQUEIDENTIFIER    NOT NULL,
    sourceId    UNIQUEIDENTIFIER    NOT NULL,
    targetId    UNIQUEIDENTIFIER    NOT NULL,
    FOREIGN KEY (gid) REFERENCES dbo.Groups(gid),
    FOREIGN KEY (sourceId) REFERENCES dbo.Nodes(nid),
    FOREIGN KEY (targetId) REFERENCES dbo.Nodes(nid)
);

<<<<<<< HEAD
INSERT INTO dbo.Groups (gid, adminId, name)
VALUES ('00000000-0000-0000-0000-000000000001', 
        'AAC12A42-25C8-4E18-9E4E-92F4E7094CDD', 
        'Test Group');

select * from dbo.Users;
select * from dbo.Tasks;
select * from dbo.Nodes;
select * from dbo.Edges;
select * from dbo.Groups;
=======
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

select * from dbo.Complete;
select * from dbo.UserGroups;
select * from dbo.Groups;
select * from dbo.DeleteTask;
select * from dbo.Tasks;
select * from dbo.Users;
select * from dbo.Nodes;
select * from dbo.Edges;


INSERT INTO dbo.Groups (gid, adminId, name)
VALUES ('00000000-0000-0000-0000-000000000001', 
        'DAD8127A-10FF-4A21-AC73-5E83F5CE0F61', 
        'Test Group');





>>>>>>> refs/remotes/origin/master
