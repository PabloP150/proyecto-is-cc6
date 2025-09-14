--DROP TABLE dbo.UserGroupRoles;
--DROP TABLE dbo.GroupRoles;
--DROP TABLE dbo.UserGroups;
--DROP TABLE dbo.UserTask;
--DROP TABLE dbo.DeleteTask
--DROP TABLE dbo.Complete
--DROP TABLE dbo.Tasks;
--DROP TABLE dbo.UserTask;
--DROP TABLE dbo.Edges;
--DROP TABLE dbo.Nodes;
--DROP TABLE dbo.Groups		
--DROP TABLE dbo.Users;

--DROP TRIGGER dbo.UpdateTargetNodePercentage

--TRUNCATE TABLE dbo.UserGroupRoles; 
--TRUNCATE TABLE dbo.UserGroups;
--TRUNCATE TABLE dbo.Users;
--TRUNCATE TABLE dbo.Tasks;
--TRUNCATE TABLE dbo.Edges;
--TRUNCATE TABLE dbo.Nodes;
--TRUNCATE TABLE dbo.GroupRoles;
--TRUNCATE TABLE dbo.Groups;		-- NO TRUNCATE!!

CREATE TABLE dbo.Users (
    uid 		UNIQUEIDENTIFIER 	NOT NULL PRIMARY KEY,
    username 	VARCHAR(25)			NOT NULL,
    password 	VARCHAR(60) 		NOT NULL
	CONSTRAINT noDuplicates UNIQUE (username)
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
	list		VARCHAR(25)			NOT NULL,
	datetime	SMALLDATETIME		NOT NULL,
	percentage	INT CHECK(percentage BETWEEN 0 AND 100),
	FOREIGN KEY (gid) REFERENCES dbo.Groups(gid)
);

CREATE TABLE dbo.UserTask(
	utid	UNIQUEIDENTIFIER	NOT NULL,
	uid		UNIQUEIDENTIFIER	NOT NULL,
	tid		UNIQUEIDENTIFIER	NOT NULL,
	completed	BIT				NOT NULL,
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
	percentage	INT CHECK(percentage BETWEEN 0 AND 100),
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

-- =====================================
-- TABLAS PARA ROLES PERSONALIZADOS POR GRUPO
-- =====================================

CREATE TABLE dbo.GroupRoles (
    gr_id       UNIQUEIDENTIFIER    NOT NULL PRIMARY KEY, -- ID único del rol
    gid         UNIQUEIDENTIFIER    NOT NULL,             -- Grupo al que pertenece el rol
    gr_name     VARCHAR(40)         NOT NULL,             -- Nombre del rol (ej: Moderador)
    gr_desc     VARCHAR(255),                              -- Descripción del rol (opcional)
    gr_color    VARCHAR(20),                               -- Color para UI (opcional)
    gr_icon     VARCHAR(20),                               -- Icono para UI (opcional)
    FOREIGN KEY (gid) REFERENCES dbo.Groups(gid)
);

CREATE TABLE dbo.UserGroupRoles (
    ugr_id      UNIQUEIDENTIFIER    NOT NULL PRIMARY KEY, -- ID único de la asignación
    uid         UNIQUEIDENTIFIER    NOT NULL,             -- Usuario
    gid         UNIQUEIDENTIFIER    NOT NULL,             -- Grupo
    gr_id       UNIQUEIDENTIFIER    NOT NULL,             -- Rol asignado
    ugr_assigned_at SMALLDATETIME   NOT NULL DEFAULT GETDATE(), -- Fecha de asignación
    FOREIGN KEY (uid) REFERENCES dbo.Users(uid),
    FOREIGN KEY (gid) REFERENCES dbo.Groups(gid),
    FOREIGN KEY (gr_id) REFERENCES dbo.GroupRoles(gr_id)
);

--INSERT INTO dbo.Groups (gid, adminId, name)
--VALUES ('00000000-0000-0000-0000-000000000001', 
--        'DAD8127A-10FF-4A21-AC73-5E83F5CE0F61', 
--        'Test Group'
--		);

--select * from dbo.Complete;
--select * from dbo.Users;
--select * from dbo.DeleteTask;
--select * from dbo.UserTask;
--select * from dbo.UserGroups;
--select * from dbo.Groups;
--select * from dbo.DeleteTask;
--select * from dbo.Users;
--select * from dbo.Tasks;
--select * from dbo.Nodes;
--select * from dbo.Edges;
--select * from dbo.GroupRoles;
--select * from dbo.UserGroupRoles;


--delete from dbo.Users where uid='F3DB0B3A-23A8-451E-9566-0A018410112C'

--SELECT * FROM dbo.Users WHERE username='admin' AND password=HASHBYTES('SHA2_256','hola')