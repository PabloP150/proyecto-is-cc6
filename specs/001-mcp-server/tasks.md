# Task Breakdown

**Date**: 2025-09-12

This document breaks down the implementation of the MCP server into a series of sequential tasks.

## 1. MCP Server Setup

-   [ ] Create a new HTTP endpoint `/mcp` in the `taskmate-api/server.js` file.
-   [ ] The endpoint should handle POST requests.
-   [ ] It should parse the JSON body of the request.

## 2. Agent Registry

-   [ ] Create a simple in-memory registry for agents.
-   [ ] This registry will store the names and endpoints of the available agents.
-   [ ] For now, it will contain the `RecommendationsAgent`.

## 3. Message Routing

-   [ ] Implement the logic to route messages to the correct agent based on the `receiver` field in the message.
-   [ ] The router should look up the agent in the registry and forward the message.

## 4. Recommendations Agent Implementation

-   [ ] Create a new file for the `RecommendationsAgent`.
-   [ ] This agent will have a single method to handle requests.
-   [ ] The method will take an `idea` as input and return a list of tasks.
-   [ ] For the initial implementation, the tasks can be hard-coded.

## 5. Orchestrator Agent Integration

-   [ ] Modify the existing chatbot code to act as the `OrchestratorAgent`.
-   [ ] When the user asks for a new project, the chatbot should send a message to the `RecommendationsAgent` via the MCP server.
-   [ ] The chatbot should then process the response from the `RecommendationsAgent` and converse with the user for approval.
-   [ ] Once the user agrees, the `OrchestratorAgent` will send the final task list to the new database endpoint.

## 6. Database Integration Tool

-   [ ] Create a new endpoint in the MCP server (e.g., `/mcp/tasks`) for submitting tasks to the database.
-   [ ] This endpoint will receive a JSON payload containing the project and task details.
-   [ ] It will then execute the necessary database queries to create the new project (group) and associated tasks.
