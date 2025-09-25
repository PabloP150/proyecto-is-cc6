# Quickstart

**Date**: 2025-09-12

This guide provides a quick overview of how to use the MCP server.

## 1. Start the MCP Server

To start the MCP server, run the following command:

```bash
node taskmate-api/server.js
```

The server will start on port 3001.

## 2. Send a Message to an Agent

To send a message to an agent, you need to send a POST request to the `/mcp` endpoint.

The body of the request should be a JSON object with the following structure:

```json
{
  "type": "request",
  "sender": "<agent_name>",
  "receiver": "<agent_name>",
  "payload": {}
}
```

## 3. Example: Interact with the Recommendations Agent

To get task recommendations for an idea, send the following request to the MCP server:

```bash
cURL -X POST http://localhost:3001/mcp \
-H "Content-Type: application/json" \
-d '{
  "type": "request",
  "sender": "OrchestratorAgent",
  "receiver": "RecommendationsAgent",
  "payload": {
    "idea": "Build a new feature for my app"
  }
}'
```

The server will route the message to the Recommendations Agent, which will process the request and send a response back to the Orchestrator Agent.

## 4. Save Project, Tasks, and Milestones to the Database

After the user has approved the recommendations, the Orchestrator Agent can save the entire project, including tasks and milestones, to the database by sending a POST request to the `/mcp/tasks` endpoint.

```bash
cURL -X POST http://localhost:3001/mcp/tasks \
-H "Content-Type: application/json" \
-d '{
  "project_name": "New App Feature",
  "project_description": "A new application to track calories.",
  "tasks": [
    {
      "name": "Define feature requirements",
      "description": "Write a detailed specification for the new feature.",
      "due_date": "2025-12-31T23:59:59Z",
      "status": "To Do"
    },
    {
      "name": "Create UI/UX mockups",
      "description": "Design the user interface and user experience for the new feature.",
      "due_date": "2026-01-15T23:59:59Z",
      "status": "To Do"
    }
  ],
  "milestones": [
    {
      "name": "Project Kick-off",
      "description": "Initial meeting and project scope definition.",
      "date": "2025-10-01"
    },
    {
      "name": "Feature Complete",
      "description": "All core features implemented.",
      "date": "2026-02-28"
    }
  ]
}'
```
