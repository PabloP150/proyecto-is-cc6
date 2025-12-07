# TaskMate Application Architecture

```mermaid
graph TB
    %% Frontend Layer
    subgraph "Frontend"
        WS_CLIENT[WebSocket Client]
        MUI[Material-UI]
        RF[ReactFlow]
        UI[React SPA]
    end

    %% Backend Layer
    subgraph "Backend (Node.js)"
        EXPRESS[Express.js Server]
        ANALYTICS_API[Analytics API]
        CONTROLLERS[Controllers]
        WS_SERVER[WebSocket Handler]
    end

    %% AI/ML Layer
    subgraph "AI Services (Python)"
        MCP_ORCHESTRATOR[MCP Orchestrator]
        RECS_AGENT[Recommendations Agent]
        ANALYTICS_AGENT[Analytics Agent]
        GEMINI[Google Gemini API]
    end

    %% Data Layer
    subgraph "Database (SQL Server)"
        DB_SCHEMA[(Tables & Triggers)]
    end

    %% External Services
    subgraph "External"
        GOOGLE_AI[Google AI Platform]
    end

    %% Frontend Connections
    UI --> MUI
    UI --> RF
    UI --> WS_CLIENT

    %% Frontend to Backend
    UI --> EXPRESS
    WS_CLIENT --> WS_SERVER

    %% Backend Internal
    EXPRESS --> ANALYTICS_API
    EXPRESS --> CONTROLLERS
    EXPRESS --> WS_SERVER

    %% Backend to AI
    WS_SERVER --> MCP_ORCHESTRATOR

    %% AI TO DB
    ANALYTICS_AGENT --> DB_SCHEMA

    %% AI Internal Connections
    MCP_ORCHESTRATOR --> ANALYTICS_AGENT
    MCP_ORCHESTRATOR --> RECS_AGENT
    RECS_AGENT --> GEMINI
    ANALYTICS_AGENT --> GEMINI
    GEMINI --> GOOGLE_AI

    %% Data Connections
    ANALYTICS_API --> DB_SCHEMA
    CONTROLLERS --> DB_SCHEMA
    

    %% Styling
    classDef frontend fill:#1e3a8a,stroke:#3b82f6,stroke-width:2px,color:#ffffff
    classDef backend fill:#166534,stroke:#22c55e,stroke-width:2px,color:#ffffff
    classDef ai fill:#7c2d12,stroke:#f97316,stroke-width:2px,color:#ffffff
    classDef data fill:#581c87,stroke:#a855f7,stroke-width:2px,color:#ffffff
    classDef external fill:#7f1d1d,stroke:#ef4444,stroke-width:2px,color:#ffffff

    class UI,MUI,RF,CAL,WS_CLIENT frontend
    class EXPRESS,WS_SERVER,CONTROLLERS,ANALYTICS_API backend
    class MCP_ORCHESTRATOR,RECS_AGENT,ANALYTICS_AGENT,GEMINI ai
    class DB_SCHEMA data
    class GOOGLE_AI external
```

## Architecture Components

### Frontend Layer (React 18)
- **React SPA**: Main application with routing and state management
- **Material-UI**: Component library for consistent UI design
- **ReactFlow**: Interactive flowchart and diagram visualization
- **React Big Calendar**: Calendar view for task scheduling
- **WebSocket Client**: Real-time communication with backend

### Backend Layer (Node.js)
- **Express.js Server**: REST API server with CORS and middleware
- **WebSocket Handler**: Integrated WebSocket server for real-time features
- **Controllers**: Business logic for tasks, users, groups, analytics
- **Analytics API**: Dedicated endpoints for analytics and recommendations

### AI Services (Python)
- **MCP Orchestrator**: Multi-agent coordinator managing WebSocket sessions and routing messages between specialized agents
- **Recommendations Agent**: Generates comprehensive project plans with tasks, milestones, and technology recommendations
- **Analytics Agent**: Provides intelligent task assignment recommendations based on team member expertise, workload, and success rates
- **Google Gemini API**: AI model integration for natural language processing and intelligent decision making

### Database (SQL Server)
- **Tables & Triggers**: Core tables (Users, Groups, Tasks, Nodes, Edges), Analytics tables (TaskAnalytics, performance metrics), and automated triggers for data updates

### External Services
- **Google AI Platform**: Cloud-based AI services and Gemini API access