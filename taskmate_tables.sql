--DROP TABLE dbo.Users;
--DROP TABLE dbo.Groups;	NO BOTAR!!!
--DROP TABLE dbo.UserGroups;
--DROP TABLE dbo.Tasks;
--DROP TABLE dbo.Edges;
--DROP TABLE dbo.Nodes;

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
	date		DATE		NOT NULL
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

select * from dbo.Tasks;
select * from dbo.Users;
select * from dbo.Nodes;
select * from dbo.Edges;

INSERT INTO dbo.Groups (gid, adminId, name)
VALUES ('00000000-0000-0000-0000-000000000001', 
        'AAC12A42-25C8-4E18-9E4E-92F4E7094CDD', 
        'Test Group');