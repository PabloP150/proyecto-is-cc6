# Requirements Document

## Introduction

This feature migrates the current custom HTTP API system to use the standard Model Context Protocol (MCP) with HTTP streaming transport. The current system uses a custom "MCP controller" that is actually just HTTP REST, which creates confusion and doesn't follow MCP standards. We need to implement a proper MCP server for the recommendations agent and integrate it with database storage capabilities.

## Requirements

### Requirement 1

**User Story:** As a backend developer, I want to use the standard MCP protocol, so that the system follows established standards and avoids confusion with custom implementations.

#### Acceptance Criteria

1. WHEN implementing agent communication THEN the system SHALL use the official MCP JSON-RPC 2.0 protocol
2. WHEN creating MCP servers THEN they SHALL follow the standard MCP server structure with proper tool definitions
3. WHEN handling MCP requests THEN the system SHALL use proper MCP error handling and response formats
4. IF the current custom HTTP API exists THEN it SHALL be removed to avoid confusion

### Requirement 2

**User Story:** As a system administrator, I want the MCP recommendations server to successfully store projects in the database, so that users can access their generated project plans.

#### Acceptance Criteria

1. WHEN the MCP recommendations server generates a project plan THEN the system SHALL create a new group in the database
2. WHEN a project is created THEN the system SHALL add all generated tasks to the Tasks table with proper relationships
3. WHEN milestones are included THEN the system SHALL store them in the Nodes table with appropriate metadata
4. IF database operations fail THEN the system SHALL rollback all changes and return proper MCP error responses

### Requirement 3

**User Story:** As a developer, I want to create a proper MCP server for recommendations, so that the system uses standard protocols instead of custom HTTP APIs.

#### Acceptance Criteria

1. WHEN creating the recommendations MCP server THEN it SHALL implement proper MCP tools for project generation
2. WHEN the MCP server generates recommendations THEN it SHALL include database storage as part of the tool execution
3. WHEN integrating with the database THEN it SHALL use the existing ProjectService with proper MCP error handling
4. WHEN the MCP server is complete THEN the custom HTTP API controller SHALL be removed

### Requirement 4

**User Story:** As a system user, I want proper MCP error handling, so that failed operations provide standardized feedback.

#### Acceptance Criteria

1. WHEN MCP tool operations fail THEN the system SHALL return proper JSONRPCError responses with appropriate error codes
2. WHEN database operations fail THEN the system SHALL log the error and return MCP-compliant error messages
3. IF tool parameters are missing or invalid THEN the system SHALL return INVALID_PARAMS errors with detailed information
4. WHEN the system encounters internal errors THEN it SHALL return INTERNAL_ERROR responses with helpful context