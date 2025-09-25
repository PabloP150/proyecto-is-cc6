# Research & Discovery

**Date**: 2025-09-12

## 1. Database Schema Analysis

Based on the analysis of the SQL files in the `taskmate-api` directory, the relevant database tables are:

-   **`Groups`**: Represents projects.
    -   `gid` (UNIQUEIDENTIFIER, PK)
    -   `adminId` (UNIQUEIDENTIFIER, FK to Users)
    -   `name` (VARCHAR)
-   **`Tasks`**: Represents tasks within a project.
    -   `tid` (UNIQUEIDENTIFIER, PK)
    -   `gid` (UNIQUEIDENTIFIER, FK to Groups)
    -   `name` (VARCHAR)
    -   `description` (VARCHAR)
    -   `list` (VARCHAR)
    -   `datetime` (SMALLDATETIME)
    -   `percentage` (INT)

## 2. Multi-Agent Communication Protocol (MCP) Research

A review of standardized multi-agent communication protocols was conducted. Key findings:

-   **Established Standards**: FIPA-ACL is a mature and widely adopted standard.
-   **Emerging Protocols**: For generative AI applications, newer protocols like Google's Agent2Agent and IBM's ACP are emerging. These are often based on RESTful principles and JSON.

**Decision**: For this project, we will implement a simplified, RESTful MCP inspired by modern protocols. This will provide a solid foundation that can be extended in the future. The protocol will use streamable HTTP and JSON for message payloads.

## 3. Resolving Ambiguities

-   **Agent Roles**: The user has specified a `Recommendations Agent` that will be responsible for breaking down user ideas into sub-tasks and milestones. The existing chatbot will be the `Orchestrator Agent`.
-   **Database Schema**: The schema for `Tasks` and `Projects` (Groups) has been identified (see section 1).
-   **Concurrent Agents**: The expected number of concurrent agents is currently unknown. For the initial implementation, we will design the system to support a small number of concurrent agents (e.g., up to 10). This should be clarified with the user for future scalability.
