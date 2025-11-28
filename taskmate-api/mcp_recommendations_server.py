#!/usr/bin/env python3
"""
MCP Server for Project Recommendations - Generates project plans and stores them in database.
"""

import asyncio
import json
import sys
import os
from typing import Any, Dict, List

# MCP imports
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent, JSONRPCError, INTERNAL_ERROR, INVALID_PARAMS

# Add current directory to path for imports
sys.path.append(os.path.dirname(__file__))

# Import existing components
from mcp.agents.recommendations_agent import RecommendationsAgent

# Server setup
SERVER_NAME = "recommendations-agent"
server = Server(SERVER_NAME)

# Initialize components
recommendations_agent = RecommendationsAgent()

@server.list_tools()
async def handle_list_tools() -> List[Tool]:
    """List available tools for project recommendations."""
    return [
        Tool(
            name="generate_project_plan",
            description="Generate a comprehensive project plan with tasks and milestones",
            inputSchema={
                "type": "object",
                "properties": {
                    "idea": {
                        "type": "string",
                        "description": "The project idea or description to generate a plan for"
                    },
                },
                "required": ["idea"]
            }
        )
    ]

@server.call_tool()
async def handle_call_tool(name: str, arguments: Dict[str, Any]) -> List[TextContent]:
    """Handle tool calls for project recommendations."""
    
    if name == "generate_project_plan":
        # Validate required parameters
        if "idea" not in arguments or not arguments["idea"]:
            raise JSONRPCError(
                code=INVALID_PARAMS,
                message="Missing required parameter: idea"
            )
        
        try:
            # Generate recommendations using existing agent
            recommendations_response = await recommendations_agent.handle(
                arguments["idea"], 
                phase='final_plan'
            )
            
            # Parse the response (it should be JSON)
            if isinstance(recommendations_response, str):
                try:
                    recommendations_data = json.loads(recommendations_response)
                except json.JSONDecodeError:
                    raise JSONRPCError(
                        code=INTERNAL_ERROR,
                        message="Failed to parse recommendations response"
                    )
            else:
                recommendations_data = recommendations_response
            
            # Return the recommendations
            return [TextContent(
                type="text",
                text=json.dumps(recommendations_data, indent=2)
            )]
            
        except JSONRPCError:
            # Re-raise MCP errors
            raise
        except Exception as e:
            # Convert other errors to MCP errors
            raise JSONRPCError(
                code=INTERNAL_ERROR,
                message=f"Tool execution failed: {str(e)}"
            )
    
    else:
        raise JSONRPCError(
            code=INVALID_PARAMS,
            message=f"Unknown tool: {name}"
        )

async def main():
    """Run the MCP server."""
    print("Starting MCP Recommendations Server...", file=sys.stderr)
    
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream)

if __name__ == "__main__":
    asyncio.run(main())