# Data Model

**Date**: 2025-09-12

## 1. Recommendations Agent Output Structure

The `RecommendationsAgent` will now return a more comprehensive JSON structure, including project details, tasks with calendarization, and milestones. This structure is designed to directly map to the `dbo.Groups`, `dbo.Tasks`, and `dbo.Nodes` tables.

```json
{
  "project_name": "string",
  "project_description": "string", // Optional: for Group description
  "tasks": [
    {
      "name": "string",
      "description": "string",
      "due_date": "YYYY-MM-DDTHH:MM:SSZ", // ISO 8601 format for dbo.Tasks.datetime
      "status": "string" // Maps to dbo.Tasks.list (e.g., "To Do", "In Progress", "Done")
    }
  ],
  "milestones": [
    {
      "name": "string",
      "description": "string",
      "date": "YYYY-MM-DD" // Maps to dbo.Nodes.date
    }
  ]
}
```

## 2. MCP Message Structure (Orchestrator to Recommendations Agent)

This remains largely the same, with the `idea` in the payload:

```json
{
  "type": "request",
  "sender": "OrchestratorAgent",
  "receiver": "RecommendationsAgent",
  "payload": {
    "idea": "string" // The user's initial idea for a project
  }
}
```

## 3. MCP Message Structure (Recommendations Agent to Orchestrator Agent)

This message will contain the new structured output in its payload:

```json
{
  "type": "response",
  "sender": "RecommendationsAgent",
  "receiver": "OrchestratorAgent",
  "payload": {
    "recommendations": {
      "project_name": "string",
      "project_description": "string",
      "tasks": [
        {
          "name": "string",
          "description": "string",
          "due_date": "YYYY-MM-DDTHH:MM:SSZ",
          "status": "string"
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
  }
}
```

## 4. MCP Message Structure (Orchestrator Agent to MCP Server for Database Upload)

This message will be sent to the `/mcp/tasks` endpoint and will contain the full structured data for insertion:

```json
{
  "project_name": "string",
  "project_description": "string",
  "tasks": [
    {
      "name": "string",
      "description": "string",
      "due_date": "YYYY-MM-DDTHH:MM:SSZ",
      "status": "string"
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
