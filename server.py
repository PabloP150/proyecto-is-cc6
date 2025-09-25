#!/usr/bin/env python3
"""
Standard MCP Server for DocumentAnalyzer - Exposes document analysis tools to Kiro IDE.

This server provides tools for analyzing documents (text and images) to extract
learning insights, key concepts, and learning style preferences.
"""

import asyncio
import json
import base64
import io
import sys
import os
import logging
from typing import Any, Dict, List, Optional, Union
from PIL import Image
import google.generativeai as genai

# MCP imports
from mcp.server.models import InitializationOptions
from mcp.server.stdio import stdio_server
from mcp.server import NotificationOptions, Server
from mcp.types import (
    Tool,
    TextContent,
    LoggingLevel,
    JSONRPCError,
    INTERNAL_ERROR,
    INVALID_PARAMS,
    METHOD_NOT_FOUND
)

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

# Import our DocumentAnalyzer
from agents.document_analyzer import DocumentAnalyzer

# Server metadata
SERVER_NAME = "document-analyzer"
SERVER_VERSION = "1.0.0"
SERVER_DESCRIPTION = "Document analysis server providing AI-powered insights for learning materials"

# Initialize the MCP server
server = Server(SERVER_NAME)

# Global analyzer instance and configuration
analyzer = None
server_config = {
    "gemini_api_configured": False,
    "api_key_source": None,
    "logging_level": "INFO",
    "graceful_degradation": True
}

# Configure logging
def setup_logging(level: str = "INFO"):
    """Set up structured logging for the MCP server."""
    log_level = getattr(logging, level.upper(), logging.INFO)
    
    # Create formatter for structured logs
    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Configure stderr handler for server logs
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(formatter)
    
    # Set up logger
    logger = logging.getLogger("document-analyzer-mcp")
    logger.setLevel(log_level)
    logger.addHandler(handler)
    
    return logger

# Initialize logger
logger = setup_logging()


class ConfigurationManager:
    """Manages server configuration and environment variables."""
    
    @staticmethod
    def load_environment_config():
        """Load configuration from environment variables and .env file."""
        config = {
            "gemini_api_key": None,
            "api_key_source": None,
            "logging_level": "INFO",
            "graceful_degradation": True,
            "debug_mode": False
        }
        
        # Try to load .env file
        try:
            from dotenv import load_dotenv
            # Load from backend directory where .env is located
            env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env')
            if os.path.exists(env_path):
                load_dotenv(env_path)
                logger.info(f"✅ Loaded environment from {env_path}")
            else:
                # Try current working directory as fallback
                cwd_env_path = '.env'
                if os.path.exists(cwd_env_path):
                    load_dotenv(cwd_env_path)
                    logger.info(f"✅ Loaded environment from {cwd_env_path}")
                else:
                    logger.warning(f"⚠️  .env file not found at {env_path} or {cwd_env_path}")
        except ImportError:
            logger.warning("⚠️  python-dotenv not available, using system environment only")
        except Exception as e:
            logger.error(f"❌ Error loading .env file: {e}")
        
        # Load API key from environment (try multiple possible names)
        api_key_vars = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]
        for var_name in api_key_vars:
            api_key = os.getenv(var_name)
            if api_key:
                config["gemini_api_key"] = api_key
                config["api_key_source"] = var_name
                logger.info(f"✅ Found API key in environment variable: {var_name}")
                break
        
        if not config["gemini_api_key"]:
            logger.warning("⚠️  No Gemini API key found in environment variables")
            logger.info(f"💡 Set one of: {', '.join(api_key_vars)}")
        
        # Load other configuration
        config["logging_level"] = os.getenv("MCP_LOG_LEVEL", "INFO").upper()
        config["graceful_degradation"] = os.getenv("MCP_GRACEFUL_DEGRADATION", "true").lower() == "true"
        config["debug_mode"] = os.getenv("MCP_DEBUG", "false").lower() == "true"
        
        return config
    
    @staticmethod
    def configure_gemini_api(api_key: str) -> bool:
        """Configure Gemini API with the provided key."""
        try:
            genai.configure(api_key=api_key)
            # Test the configuration with a simple call
            models = list(genai.list_models())
            logger.info(f"✅ Gemini API configured successfully ({len(models)} models available)")
            return True
        except Exception as e:
            logger.error(f"❌ Gemini API configuration failed: {e}")
            return False
    
    @staticmethod
    def get_degraded_capabilities():
        """Get capabilities when API is not available."""
        return {
            "available_tools": [
                "analyze_note_structure"  # Only non-AI tool available
            ],
            "degraded_tools": [
                "analyze_text_document",
                "analyze_image_document", 
                "analyze_mixed_document",
                "extract_key_concepts",
                "infer_learning_style"
            ],
            "degradation_reason": "Gemini API not configured",
            "suggestion": "Configure GEMINI_API_KEY environment variable to enable AI features"
        }


class MCPErrorHandler:
    """Centralized error handling for MCP server operations."""
    
    @staticmethod
    def create_error(code: int, message: str, data: Optional[Dict[str, Any]] = None) -> JSONRPCError:
        """Create a standard MCP error with proper formatting."""
        return JSONRPCError(
            code=code,
            message=message,
            data=data
        )
    
    @staticmethod
    def handle_configuration_error(error: Exception, context: str = "") -> JSONRPCError:
        """Handle configuration-related errors."""
        return MCPErrorHandler.create_error(
            code=INTERNAL_ERROR,
            message=f"Configuration error: {str(error)}",
            data={
                "error_type": "configuration_error",
                "context": context,
                "details": str(error)
            }
        )
    
    @staticmethod
    def handle_input_validation_error(error: Exception, tool_name: str, arguments: Dict[str, Any]) -> JSONRPCError:
        """Handle input validation errors."""
        return MCPErrorHandler.create_error(
            code=INVALID_PARAMS,
            message=f"Invalid input parameters for tool '{tool_name}': {str(error)}",
            data={
                "error_type": "input_validation_error",
                "tool": tool_name,
                "arguments": arguments,
                "details": str(error)
            }
        )
    
    @staticmethod
    def handle_processing_error(error: Exception, tool_name: str, context: str = "") -> JSONRPCError:
        """Handle processing/execution errors."""
        return MCPErrorHandler.create_error(
            code=INTERNAL_ERROR,
            message=f"Tool execution failed for '{tool_name}': {str(error)}",
            data={
                "error_type": "processing_error",
                "tool": tool_name,
                "context": context,
                "details": str(error)
            }
        )
    
    @staticmethod
    def handle_api_error(error: Exception, api_name: str, context: str = "") -> JSONRPCError:
        """Handle external API errors (e.g., Gemini API)."""
        return MCPErrorHandler.create_error(
            code=INTERNAL_ERROR,
            message=f"External API error ({api_name}): {str(error)}",
            data={
                "error_type": "api_error",
                "api": api_name,
                "context": context,
                "details": str(error),
                "suggestion": "Check API key configuration and network connectivity"
            }
        )
    
    @staticmethod
    def handle_unknown_tool_error(tool_name: str) -> JSONRPCError:
        """Handle requests for unknown tools."""
        return MCPErrorHandler.create_error(
            code=METHOD_NOT_FOUND,
            message=f"Unknown tool: {tool_name}",
            data={
                "error_type": "unknown_tool_error",
                "tool": tool_name,
                "available_tools": [
                    "analyze_text_document",
                    "analyze_image_document", 
                    "analyze_mixed_document",
                    "analyze_note_structure",
                    "extract_key_concepts",
                    "infer_learning_style"
                ]
            }
        )
    
    @staticmethod
    def handle_resource_error(error: Exception, resource_type: str) -> JSONRPCError:
        """Handle resource-related errors (memory, disk, etc.)."""
        return MCPErrorHandler.create_error(
            code=INTERNAL_ERROR,
            message=f"Resource error ({resource_type}): {str(error)}",
            data={
                "error_type": "resource_error",
                "resource_type": resource_type,
                "details": str(error),
                "suggestion": "Check system resources and try again"
            }
        )


@server.list_tools()
async def handle_list_tools() -> List[Tool]:
    """
    List available document analysis tools with comprehensive MCP-compliant definitions.
    
    Returns tools for analyzing text documents, images, mixed content, and extracting
    learning insights including key concepts and learning style preferences.
    """
    return [
        Tool(
            name="analyze_text_document",
            description="Analyze text content to extract learning insights, key concepts, and learning style preferences",
            inputSchema={
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "The text content to analyze"
                    },
                    "document_id": {
                        "type": "string",
                        "description": "Optional identifier for the document",
                        "default": None
                    }
                },
                "required": ["text"]
            }
        ),
        Tool(
            name="analyze_image_document",
            description="Analyze image-based documents (handwritten notes, PDFs, screenshots) using vision AI",
            inputSchema={
                "type": "object",
                "properties": {
                    "image_data": {
                        "type": "string",
                        "description": "Base64 encoded image data"
                    },
                    "document_id": {
                        "type": "string",
                        "description": "Optional identifier for the document",
                        "default": None
                    }
                },
                "required": ["image_data"]
            }
        ),
        Tool(
            name="analyze_mixed_document",
            description="Analyze documents containing both text and images for comprehensive insights",
            inputSchema={
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "Optional text content",
                        "default": None
                    },
                    "image_data": {
                        "type": "string",
                        "description": "Optional base64 encoded image data",
                        "default": None
                    },
                    "document_id": {
                        "type": "string",
                        "description": "Optional identifier for the document",
                        "default": None
                    }
                },
                "anyOf": [
                    {"required": ["text"]},
                    {"required": ["image_data"]}
                ]
            }
        ),
        Tool(
            name="analyze_note_structure",
            description="Analyze the structural characteristics of text-based notes (works without AI)",
            inputSchema={
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "The text content to analyze for structure"
                    }
                },
                "required": ["text"]
            }
        ),
        Tool(
            name="extract_key_concepts",
            description="Extract key concepts from text with importance scoring",
            inputSchema={
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "The text content to extract concepts from"
                    }
                },
                "required": ["text"]
            }
        ),
        Tool(
            name="infer_learning_style",
            description="Infer learning style preferences from document characteristics",
            inputSchema={
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "The text content to analyze for learning style"
                    }
                },
                "required": ["text"]
            }
        )
    ]


@server.list_resources()
async def handle_list_resources():
    """List available resources (none for this server)."""
    return []


@server.list_prompts()
async def handle_list_prompts():
    """List available prompts (none for this server)."""
    return []


def get_server_capabilities():
    """
    Get comprehensive server capabilities for MCP protocol compliance.
    
    Returns capabilities including tools, logging, and experimental features.
    """
    return {
        "tools": {
            "listChanged": True
        },
        "resources": {
            "subscribe": False,
            "listChanged": False
        },
        "prompts": {
            "listChanged": False
        },
        "logging": {
            "level": "info"
        }
    }


def get_server_info():
    """Get server information and metadata."""
    return {
        "name": SERVER_NAME,
        "version": SERVER_VERSION,
        "description": SERVER_DESCRIPTION,
        "author": "DocumentAnalyzer Team",
        "license": "MIT",
        "homepage": "https://github.com/your-org/document-analyzer",
        "capabilities": get_server_capabilities(),
        "tools_count": 6,
        "supported_formats": ["text", "image", "pdf", "mixed"],
        "ai_models": ["gemini-pro", "gemini-pro-vision"],
        "features": [
            "text_analysis",
            "image_analysis", 
            "learning_style_inference",
            "key_concept_extraction",
            "structural_analysis",
            "mixed_document_processing"
        ]
    }


@server.call_tool()
async def handle_call_tool(name: str, arguments: Dict[str, Any]) -> List[TextContent]:
    """Handle tool calls from Kiro with proper MCP error handling and graceful degradation."""
    global analyzer, server_config
    
    logger.debug(f"🔧 Tool call: {name} with args: {list(arguments.keys())}")
    
    # Initialize analyzer if not already done
    if analyzer is None:
        try:
            analyzer = DocumentAnalyzer()
            logger.debug("✅ DocumentAnalyzer initialized")
        except Exception as e:
            logger.error(f"❌ DocumentAnalyzer initialization failed: {e}")
            raise MCPErrorHandler.handle_configuration_error(e, "DocumentAnalyzer initialization")
    
    # Check if graceful degradation is needed
    ai_required_tools = {
        "analyze_text_document",
        "analyze_image_document", 
        "analyze_mixed_document",
        "extract_key_concepts",
        "infer_learning_style"
    }
    
    if name in ai_required_tools and not server_config.get("gemini_api_configured", False):
        if server_config.get("graceful_degradation", True):
            # Provide degraded response with helpful information
            degraded_response = {
                "error": "AI features not available",
                "reason": "Gemini API not configured",
                "tool_requested": name,
                "available_alternative": "analyze_note_structure" if name != "analyze_image_document" else None,
                "configuration_help": {
                    "message": "To enable AI features, configure a Gemini API key",
                    "environment_variables": ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
                    "documentation": "https://ai.google.dev/gemini-api/docs/api-key"
                },
                "degraded_capabilities": ConfigurationManager.get_degraded_capabilities()
            }
            
            logger.warning(f"⚠️  Tool {name} requires AI but API not configured - providing degraded response")
            
            return [TextContent(
                type="text",
                text=json.dumps(degraded_response, indent=2)
            )]
        else:
            # Strict mode - raise error
            raise MCPErrorHandler.handle_configuration_error(
                ValueError("Gemini API not configured"),
                f"Tool '{name}' requires AI capabilities"
            )
    
    # Validate tool name
    valid_tools = {
        "analyze_text_document",
        "analyze_image_document", 
        "analyze_mixed_document",
        "analyze_note_structure",
        "extract_key_concepts",
        "infer_learning_style"
    }
    
    if name not in valid_tools:
        raise MCPErrorHandler.handle_unknown_tool_error(name)
    
    try:
        if name == "analyze_text_document":
            # Validate required parameters
            if "text" not in arguments or not arguments["text"]:
                raise MCPErrorHandler.handle_input_validation_error(
                    ValueError("Missing or empty 'text' parameter"),
                    name,
                    arguments
                )
            
            text = arguments["text"]
            document_id = arguments.get("document_id")
            
            try:
                result = await analyzer.comprehensive_analysis(text, document_id)
            except Exception as e:
                # Check if it's an API-related error
                if "api" in str(e).lower() or "gemini" in str(e).lower():
                    raise MCPErrorHandler.handle_api_error(e, "Gemini", "comprehensive_analysis")
                else:
                    raise MCPErrorHandler.handle_processing_error(e, name, "comprehensive_analysis")
            
            return [TextContent(
                type="text",
                text=json.dumps(result, indent=2, default=str)
            )]
        
        elif name == "analyze_image_document":
            # Validate required parameters
            if "image_data" not in arguments or not arguments["image_data"]:
                raise MCPErrorHandler.handle_input_validation_error(
                    ValueError("Missing or empty 'image_data' parameter"),
                    name,
                    arguments
                )
            
            image_data = arguments["image_data"]
            document_id = arguments.get("document_id")
            
            # Convert base64 to image with proper error handling
            try:
                image_bytes = base64.b64decode(image_data)
                image = Image.open(io.BytesIO(image_bytes))
            except Exception as e:
                raise MCPErrorHandler.handle_input_validation_error(
                    ValueError(f"Invalid image data: {str(e)}"),
                    name,
                    arguments
                )
            
            try:
                result = await analyzer.analyze_image_document(image, document_id)
            except Exception as e:
                # Check if it's an API-related error
                if "api" in str(e).lower() or "gemini" in str(e).lower():
                    raise MCPErrorHandler.handle_api_error(e, "Gemini", "image_analysis")
                else:
                    raise MCPErrorHandler.handle_processing_error(e, name, "image_analysis")
            
            return [TextContent(
                type="text",
                text=json.dumps(result, indent=2, default=str)
            )]
        
        elif name == "analyze_mixed_document":
            text = arguments.get("text")
            image_data = arguments.get("image_data")
            document_id = arguments.get("document_id")
            
            # Validate that at least one input is provided
            if not text and not image_data:
                raise MCPErrorHandler.handle_input_validation_error(
                    ValueError("At least one of 'text' or 'image_data' must be provided"),
                    name,
                    arguments
                )
            
            # Convert image data if provided
            image = None
            if image_data:
                try:
                    image_bytes = base64.b64decode(image_data)
                    image = Image.open(io.BytesIO(image_bytes))
                except Exception as e:
                    raise MCPErrorHandler.handle_input_validation_error(
                        ValueError(f"Invalid image data: {str(e)}"),
                        name,
                        arguments
                    )
            
            try:
                result = await analyzer.analyze_mixed_document(text, image, document_id)
            except Exception as e:
                # Check if it's an API-related error
                if "api" in str(e).lower() or "gemini" in str(e).lower():
                    raise MCPErrorHandler.handle_api_error(e, "Gemini", "mixed_analysis")
                else:
                    raise MCPErrorHandler.handle_processing_error(e, name, "mixed_analysis")
            
            return [TextContent(
                type="text",
                text=json.dumps(result, indent=2, default=str)
            )]
        
        elif name == "analyze_note_structure":
            # Validate required parameters
            if "text" not in arguments or not arguments["text"]:
                raise MCPErrorHandler.handle_input_validation_error(
                    ValueError("Missing or empty 'text' parameter"),
                    name,
                    arguments
                )
            
            text = arguments["text"]
            
            try:
                result = await analyzer.analyze_note_structure(text)
            except Exception as e:
                raise MCPErrorHandler.handle_processing_error(e, name, "structure_analysis")
            
            return [TextContent(
                type="text",
                text=json.dumps(result, indent=2, default=str)
            )]
        
        elif name == "extract_key_concepts":
            # Validate required parameters
            if "text" not in arguments or not arguments["text"]:
                raise MCPErrorHandler.handle_input_validation_error(
                    ValueError("Missing or empty 'text' parameter"),
                    name,
                    arguments
                )
            
            text = arguments["text"]
            
            try:
                result = await analyzer.extract_key_concepts(text)
            except Exception as e:
                # Check if it's an API-related error
                if "api" in str(e).lower() or "gemini" in str(e).lower():
                    raise MCPErrorHandler.handle_api_error(e, "Gemini", "concept_extraction")
                else:
                    raise MCPErrorHandler.handle_processing_error(e, name, "concept_extraction")
            
            return [TextContent(
                type="text",
                text=json.dumps(result, indent=2, default=str)
            )]
        
        elif name == "infer_learning_style":
            # Validate required parameters
            if "text" not in arguments or not arguments["text"]:
                raise MCPErrorHandler.handle_input_validation_error(
                    ValueError("Missing or empty 'text' parameter"),
                    name,
                    arguments
                )
            
            text = arguments["text"]
            
            try:
                result = await analyzer.infer_learning_style(text)
            except Exception as e:
                # Check if it's an API-related error
                if "api" in str(e).lower() or "gemini" in str(e).lower():
                    raise MCPErrorHandler.handle_api_error(e, "Gemini", "learning_style_inference")
                else:
                    raise MCPErrorHandler.handle_processing_error(e, name, "learning_style_inference")
            
            return [TextContent(
                type="text",
                text=json.dumps(result, indent=2, default=str)
            )]
    
    except JSONRPCError:
        # Re-raise MCP errors as-is
        raise
    except MemoryError as e:
        raise MCPErrorHandler.handle_resource_error(e, "memory")
    except OSError as e:
        raise MCPErrorHandler.handle_resource_error(e, "filesystem")
    except Exception as e:
        # Catch-all for unexpected errors
        raise MCPErrorHandler.handle_processing_error(e, name, "unexpected_error")


async def main():
    """Run the MCP server with comprehensive configuration and error handling."""
    global server_config
    
    logger.info("🚀 Initializing Document Analyzer MCP Server")
    
    # Load configuration from environment
    config = ConfigurationManager.load_environment_config()
    
    # Update logging level if specified
    if config["logging_level"] != "INFO":
        setup_logging(config["logging_level"])
        logger.info(f"📝 Logging level set to: {config['logging_level']}")
    
    # Configure Gemini API if available
    if config["gemini_api_key"]:
        api_configured = ConfigurationManager.configure_gemini_api(config["gemini_api_key"])
        server_config["gemini_api_configured"] = api_configured
        server_config["api_key_source"] = config["api_key_source"]
        
        if api_configured:
            logger.info(f"✅ AI features enabled (API key from: {config['api_key_source']})")
        else:
            logger.warning("⚠️  AI features disabled due to API configuration failure")
    else:
        server_config["gemini_api_configured"] = False
        logger.warning("⚠️  AI features disabled - no API key configured")
        
        if config["graceful_degradation"]:
            degraded_caps = ConfigurationManager.get_degraded_capabilities()
            logger.info(f"🔄 Graceful degradation enabled - {len(degraded_caps['available_tools'])} tools available")
            logger.info(f"💡 {degraded_caps['suggestion']}")
        else:
            logger.error("❌ Graceful degradation disabled - server may not function properly")
    
    # Update global server config
    server_config.update({
        "logging_level": config["logging_level"],
        "graceful_degradation": config["graceful_degradation"],
        "debug_mode": config["debug_mode"]
    })
    
    # Print server information
    server_info = get_server_info()
    logger.info(f"📋 Server: {server_info['name']} v{server_info['version']}")
    logger.info(f"🛠️  Tools available: {server_info['tools_count']}")
    logger.info(f"🎯 Features: {', '.join(server_info['features'])}")
    
    if config["debug_mode"]:
        logger.debug(f"🔍 Debug mode enabled")
        logger.debug(f"🔧 Server config: {server_config}")
    
    try:
        # Run the server with proper capabilities
        async with stdio_server() as (read_stream, write_stream):
            logger.info("🌐 MCP server started - waiting for connections")
            
            await server.run(
                read_stream,
                write_stream,
                InitializationOptions(
                    server_name=SERVER_NAME,
                    server_version=SERVER_VERSION,
                    capabilities=server.get_capabilities(
                        notification_options=NotificationOptions(
                            tools_changed=True,
                            resources_changed=False,
                            prompts_changed=False
                        ),
                        experimental_capabilities={}
                    ),
                ),
            )
    except KeyboardInterrupt:
        logger.info("🛑 Server shutdown requested")
    except Exception as e:
        logger.error(f"💥 Server error: {e}")
        raise


if __name__ == "__main__":
    import sys
    asyncio.run(main())