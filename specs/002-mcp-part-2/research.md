# Research & Discovery

**Date**: 2025-09-12

## 1. Database Schema Analysis for Calendarization

Re-analyzed `taskmate-api/taskmate_tables.sql` to identify fields suitable for calendarization and task details:

-   **`dbo.Tasks` Table Fields:**
    -   `tid` (UNIQUEIDENTIFIER, PK)
    -   `gid` (UNIQUEIDENTIFIER, FK to `dbo.Groups`)
    -   `name` (VARCHAR)
    -   `description` (VARCHAR)
    -   `list` (VARCHAR) - Can be used for status (e.g., "To Do", "In Progress", "Done")
    -   `datetime` (SMALLDATETIME) - Suitable for due dates or start dates.
    -   `percentage` (INT) - For task progress (0-100).

-   **`dbo.Nodes` Table Fields:**
    -   `nid` (UNIQUEIDENTIFIER, PK)
    -   `gid` (UNIQUEIDENTIFIER, FK to `dbo.Groups`)
    -   `name` (VARCHAR)
    -   `description` (VARCHAR)
    -   `date` (DATE) - Can be used for milestone dates.
    -   `completed` (BIT)
    -   `percentage` (INT)

**Conclusion:** The `Tasks` table's `datetime` field can serve as a due date. For more complex calendarization (e.g., start and end dates for tasks), we might need to consider adding new fields or using the `Nodes` table for milestones. For now, we will focus on populating the existing `datetime` field in `Tasks` and `date` in `Nodes`.

## 2. Enhancing Recommendations Agent

The `RecommendationsAgent` (Python LLM service) needs to be updated to generate tasks with the following structure:

```json
{
  "project_name": "string",
  "tasks": [
    {
      "name": "string",
      "description": "string",
      "due_date": "YYYY-MM-DDTHH:MM:SSZ", // ISO 8601 format for datetime
      "status": "string" // e.g., "To Do", "In Progress", "Done"
    }
  ],
  "milestones": [
    {
      "name": "string",
      "description": "string",
      "date": "YYYY-MM-DD"
    }
  ]
}
```

-   The `due_date` for tasks will map to `dbo.Tasks.datetime`.
-   The `status` for tasks will map to `dbo.Tasks.list`.
-   `milestones` will map to `dbo.Nodes`.

## 3. Orchestrator Agent and MCP Tool

The Orchestrator Agent (Node.js `UserSession`) will need to:

-   Parse the new, richer JSON output from the `RecommendationsAgent`.
-   Present the calendarized tasks and milestones to the user for confirmation.
-   Call the `/mcp/tasks` endpoint with the structured data, ensuring it includes both project details, tasks with `datetime` and `list`, and milestones (nodes).

The `/mcp/tasks` endpoint (Node.js `mcp.controller.js`) will need to be updated to:

-   Handle the new `due_date` and `status` fields for tasks.
-   Insert data into the `dbo.Nodes` table for milestones.

## 4. Ambiguities and Clarifications

-   **Calendarization Granularity**: Is a single `datetime` field sufficient for tasks, or do we need separate `start_date` and `end_date`? (Currently assuming `datetime` is sufficient for a due date).
-   **Task Statuses**: What are the predefined values for `dbo.Tasks.list`? (Currently assuming "To Do", "In Progress", "Done" are acceptable).
-   **Milestone Fields**: Are `name`, `description`, and `date` sufficient for `dbo.Nodes` (milestones), or are other fields like `x_pos`, `y_pos`, `completed`, `percentage`, `connections` also expected from the LLM? (Currently assuming only `name`, `description`, `date` are needed from LLM, others will be defaulted or handled by the system).
