-- 011_ai_reviews: the AI server's review of a task's pull request, one per head commit.
--
-- Claimed as 'pending' before the review runs: the unique key makes a repeated webhook for the
-- same commit (GitHub retries, synchronize + ready_for_review) a no-op instead of a second review.

IF OBJECT_ID(N'dbo.AiReviews', N'U') IS NULL
    CREATE TABLE dbo.AiReviews (
        id              BIGINT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_AiReviews PRIMARY KEY,
        tid             UNIQUEIDENTIFIER    NOT NULL
            CONSTRAINT FK_AiReviews_Tasks REFERENCES dbo.Tasks (tid) ON DELETE CASCADE,
        pr_number       INT                 NOT NULL,
        head_sha        CHAR(40)            NOT NULL
            CONSTRAINT CK_AiReviews_HeadSha CHECK (head_sha NOT LIKE '%[^0-9a-fA-F]%'),
        status          VARCHAR(12)         NOT NULL
            CONSTRAINT CK_AiReviews_Status CHECK (status IN ('pending', 'done', 'failed')),
        verdict         VARCHAR(4)          NULL
            CONSTRAINT CK_AiReviews_Verdict CHECK (verdict IS NULL OR verdict IN ('pass', 'warn', 'fail')),
        -- Whether it reached GitHub: posted | no_permission (App lacks pull_requests: write) | failed.
        posted          VARCHAR(14)         NULL
            CONSTRAINT CK_AiReviews_Posted CHECK (posted IS NULL OR posted IN ('posted', 'no_permission', 'failed')),
        review_url      NVARCHAR(400)       NULL,
        result_json     NVARCHAR(MAX)       NULL,
        error_code      VARCHAR(40)         NULL,
        created_at      DATETIMEOFFSET(0)   NOT NULL CONSTRAINT DF_AiReviews_CreatedAt DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT UQ_AiReviews_TaskSha UNIQUE (tid, head_sha)
    );
GO

-- The task view asks for the newest review of a task.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_AiReviews_Task' AND object_id = OBJECT_ID(N'dbo.AiReviews'))
    CREATE INDEX IX_AiReviews_Task ON dbo.AiReviews (tid, created_at DESC);
GO
