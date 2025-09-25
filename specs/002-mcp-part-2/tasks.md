# Task Breakdown

**Date**: 2025-09-12

This document breaks down the implementation of the enhanced Recommendations Agent and database upload.

## 1. Enhance Recommendations Agent (Python)

-   [x] Modify the prompt in `taskmate-api/python_llm_service/llm_service.py` to instruct the LLM to generate a structured JSON response with the following keys:
    -   `project_name` (string)
    -   `project_description` (string, optional)
    -   `tasks` (array of objects, each with `name`, `description`, `due_date` (ISO 8601), `status`)
    -   `milestones` (array of objects, each with `name`, `description`, `date` (YYYY-MM-DD))
-   [x] Ensure the LLM generates realistic and valid `due_date` and `date` values.
-   [x] Ensure the LLM generates appropriate `status` values (e.g., "To Do", "In Progress", "Done").

## 2. Update Node.js MCP Controller

-   [x] Modify the `/mcp/tasks` endpoint in `taskmate-api/controllers/mcp.controller.js`.
-   [x] Update the task insertion logic to correctly map `due_date` from the incoming JSON to `dbo.Tasks.datetime`.
-   [x] Update the task insertion logic to correctly map `status` from the incoming JSON to `dbo.Tasks.list`.
-   [x] Implement logic to insert `milestones` from the incoming JSON into the `dbo.Nodes` table.
    -   [x] Generate `nid` (UNIQUEIDENTIFIER).
    -   [x] Map `gid` from the newly created group.
    -   [x] Map `name`, `description`, `date`.
    -   [x] Default `completed` to `0` (false).
    -   [x] Default `x_pos`, `y_pos` to `0` (or suitable defaults).
    -   [x] Default `percentage` to `0`.
    -   [x] Default `connections` to `0`.

## 3. Update Node.js Orchestrator Agent

-   [x] Modify `taskmate-api/services/UserSession.js`.
-   [x] Update the `handleAffirmativeResponse` method to parse the new, richer structured JSON output from the Python LLM service.
-   [x] Present the detailed plan (including tasks with dates and milestones) to the user in a readable format.
-   [x] When the user confirms to save, ensure the complete structured data (project, tasks, milestones) is sent to the `/mcp/tasks` endpoint.