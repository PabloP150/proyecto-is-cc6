# Data Model

**Date**: 2025-09-12

## 1. MCP Message Structure

The communication between agents will be done using JSON messages with the following base structure:

```json
{
  "type": "request | response",
  "sender": "<agent_name>",
  "receiver": "<agent_name>",
  "payload": {}
}
```

-   `type`: The type of the message (`request` or `response`).
-   `sender`: The name of the agent sending the message.
-   `receiver`: The name of the agent that should receive the message.
-   `payload`: The content of the message.

## 2. Message Examples

### 2.1. Orchestrator to Recommendations Agent

This message is sent from the Orchestrator Agent to the Recommendations Agent to request the breakdown of an idea into tasks.

```json
{
  "type": "request",
  "sender": "OrchestratorAgent",
  "receiver": "RecommendationsAgent",
  "payload": {
    "idea": "Build a new feature for my app"
  }
}
```

### 2.2. Recommendations Agent to Orchestrator Agent

This message is sent from the Recommendations Agent to the Orchestrator Agent with the breakdown of the idea into tasks.

```json
{
  "type": "response",
  "sender": "RecommendationsAgent",
  "receiver": "OrchestratorAgent",
  "payload": {
    "tasks": [
      {
        "name": "Define feature requirements",
        "description": "Write a detailed specification for the new feature."
      },
      {
        "name": "Create UI/UX mockups",
        "description": "Design the user interface and user experience for the new feature."
      }
    ]
  }
}
```

### 2.3. Orchestrator to MCP Server (Database)

This message is sent from the Orchestrator Agent to the MCP server to save the final list of tasks to the database.

```json
{
  "type": "request",
  "sender": "OrchestratorAgent",
  "receiver": "McpServer",
  "payload": {
    "action": "save_tasks",
    "project_name": "New App Feature",
    "tasks": [
      {
        "name": "Define feature requirements",
        "description": "Write a detailed specification for the new feature."
      },
      {
        "name": "Create UI/UX mockups",
        "description": "Design the user interface and user experience for the new feature."
      }
    ]
  }
}
```