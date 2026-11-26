-- Reverts 011_ai_reviews.
IF OBJECT_ID(N'dbo.AiReviews', N'U') IS NOT NULL DROP TABLE dbo.AiReviews;
GO
