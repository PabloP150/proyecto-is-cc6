# Design Document

## Overview

This design migrates from the current custom HTTP API system to a proper Model Context Protocol (MCP) implementation with HTTP streaming transport. The solution removes the confusing custom "MCP controller" and implements a standards-compliant MCP server for the recommendations agent with integrated database storage.

## Architecture

### Current System (To Be Replaced)
- **Custom HTTP API**: Express.js controller misnamed as "MCP controller" 
- **Python RecommendationsAgent**: Generates project plans via HTTP endpoints
- **ProjectService**: Handles database operations with custom data formats

### New MCP Architecture
- **MCP Recommendations Server**: Standards-compliant MCP server using JSON-RPC 2.0
- **HTTP Streaming Transport**: Uses MCP's HTTP streaming protocol instead of custom REST
- **Integrated Database Storage**: MCP tools directly handle database operations
- **ProjectService**: Updated to work with MCP error handling patterns

## Components and Interfaces

### MCP Server Structure

**MCP Recommendations Server:**
```python
# Based on standard MCP server pattern
from mcp.server import Server
from mcp.server.stdio import stdio_server  # Will use HTTP streaming later
from mcp.types import Tool, TextContent, JSONRPCError

server = Server("recommendations-agent")

@server.list_tools()
async def handle_list_tools() -> List[Tool]:
    return [
        Tool(
            name="generate_project_plan",
            description="Generate a comprehensive project plan with tasks and milestones",
            inputSchema={
                "type": "object",
                "properties": {
                    "idea": {"type": "string", "description": "Project idea or description"},
                    "user_id": {"type": "string", "description": "User ID for database storage"}
                },
                "required": ["idea", "user_id"]
            }
        )
    ]

@server.call_tool()
async def handle_call_tool(name: str, arguments: Dict[str, Any]) -> List[TextContent]:
    # Generate recommendations AND store in database
    # Return success/failure with project details
```

**MCP Tool Response Format:**
```json
{
  "success": true,
  "project_id": "uuid",
  "project_name": "Generated Project Name",
  "tasks_created": 5,
  "milestones_created": 3,
  "recommendations": {
    "project_name": "string",
    "project_description": "string", 
    "tasks": [...],
    "milestones": [...]
  }
}
```

### MCP Integration with Database

**Direct Database Integration:**
The MCP server will directly integrate with the database through the ProjectService:
```python
@server.call_tool()
async def handle_call_tool(name: str, arguments: Dict[str, Any]) -> List[TextContent]:
    if name == "generate_project_plan":
        try:
            # 1. Generate recommendations using LLM
            recommendations = await generate_recommendations(arguments["idea"])
            
            # 2. Store in database using ProjectService
            result = await store_project_in_database(
                recommendations, 
                arguments["user_id"], 
                arguments["idea"]
            )
            
            # 3. Return MCP-compliant response
            return [TextContent(
                type="text",
                text=json.dumps({
                    "success": True,
                    "project_id": result.group_id,
                    "recommendations": recommendations
                })
            )]
        except Exception as e:
            # Return proper MCP error
            raise JSONRPCError(code=INTERNAL_ERROR, message=str(e))
```

**Updated ProjectService:**
- Keep existing `createProjectFromPlan()` method
- Add MCP-specific error handling
- Return structured results for MCP responses

## Data Models

### Database Tables Used
- **Groups**: Store project information
- **UserGroups**: Link users to projects  
- **Tasks**: Store individual tasks
- **Nodes**: Store milestones

### MCP Data Flow
1. Client sends MCP request to generate project plan
2. MCP server generates recommendations using LLM
3. MCP server stores data in database via ProjectService
4. MCP server returns success response with project details
5. Client receives structured MCP response

### Transport Migration Path
- **Phase 1**: Implement MCP server with stdio transport (current MCP standard)
- **Phase 2**: Migrate to HTTP streaming transport (future enhancement)
- **Phase 3**: Remove custom HTTP API controller

## Error Handling

### MCP Error Standards
- Use proper JSONRPCError responses with standard error codes
- INVALID_PARAMS for missing/invalid tool parameters
- INTERNAL_ERROR for database or processing failures
- METHOD_NOT_FOUND for unknown tools

### Database Error Mapping
```python
try:
    result = await project_service.create_project(data)
except ValidationError as e:
    raise JSONRPCError(code=INVALID_PARAMS, message=str(e))
except DatabaseError as e:
    raise JSONRPCError(code=INTERNAL_ERROR, message="Database operation failed")
```

### Error Response Format
```json
{
  "error": {
    "code": -32602,
    "message": "Invalid params",
    "data": {
      "error_type": "validation_error",
      "details": "Missing required field: user_id"
    }
  }
}
```

## Testing Strategy

### MCP Protocol Tests
- Test MCP tool discovery (list_tools)
- Test MCP tool execution with valid parameters
- Test MCP error responses for invalid inputs
- Test JSON-RPC 2.0 compliance

### Integration Tests
- Test full MCP flow from tool call to database storage
- Test database operations through MCP server
- Test error handling and rollback scenarios
- Test MCP client integration

### Migration Tests
- Verify custom HTTP API removal doesn't break other systems
- Test backward compatibility during transition
- Verify MCP server replaces all HTTP API functionality