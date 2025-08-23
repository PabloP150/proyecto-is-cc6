# WebSocket Implementation Guide for Tutor AI

This document provides a detailed, step-by-step guide on how the WebSocket communication is implemented in the Tutor AI application. The goal is to enable another LLM or developer to understand and replicate the functionality.

The WebSocket implementation is designed to create an isolated session for each connected user, with a dedicated set of AI agents.

---

### **Core Components**

The WebSocket functionality is primarily managed by three components working together:

1.  **`backend/main.py`**: The main FastAPI application file that handles incoming connections and message routing.
2.  **`SessionManager` class (in `main.py`)**: A manager class that maps active WebSocket connections to user sessions.
3.  **`UserSession` class (in `main.py`)**: A class that represents a single user's isolated environment, containing all the necessary AI agents for that user.
4.  **`OrchestratorAgent` class (in `backend/agents/orchestrator.py`)**: The agent that directly communicates with the user by sending and receiving messages over the WebSocket.

---

### **Step-by-Step Implementation**

To replicate this functionality, follow these steps:

#### **Step 1: Create the WebSocket Endpoint in `main.py`**

The entry point for all WebSocket connections is an endpoint in `main.py` created using a FastAPI decorator.

```python
# In backend/main.py

@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: int):
    # ... connection handling logic ...
```

*   **Action:** Use the `@app.websocket("/ws/{client_id}")` decorator to define the function that will handle WebSocket connections.
*   **Mechanism:** FastAPI automatically upgrades the HTTP connection to a WebSocket connection when a client connects to this endpoint. The `websocket` object is the direct interface to the client.

#### **Step 2: Implement the Session Manager in `main.py`**

A `SessionManager` is used to create, store, and clean up user sessions.

```python
# In backend/main.py

class SessionManager:
    def __init__(self):
        self.active_sessions: Dict[WebSocket, UserSession] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        session = UserSession() # A new set of agents is created here
        self.active_sessions[websocket] = session

    def disconnect(self, websocket: WebSocket):
        session = self.active_sessions.pop(websocket, None)
        if session:
            session.stop() # Clean up the session's resources

    def get_session(self, websocket: WebSocket) -> UserSession:
        return self.active_sessions.get(websocket)

manager = SessionManager()
```

*   **Action:** Create a `SessionManager` class to manage a dictionary (`active_sessions`) where keys are the `WebSocket` objects and values are the corresponding `UserSession` objects.
*   **Mechanism:** When a user connects, the `connect` method is called. It accepts the connection, creates a new `UserSession`, and stores it in the dictionary. The `disconnect` method removes the session and cleans up its resources.

#### **Step 3: Implement the User Session in `main.py`**

The `UserSession` class creates and holds all the agents for a single user.

```python
# In backend/main.py

class UserSession:
    def __init__(self):
        self.mcp_server = MCPServer()
        
        # Create clients and agents for this session
        orchestrator_client = MCPClient("orchestrator", self.mcp_server)
        self.orchestrator = OrchestratorAgent(orchestrator_client)
        # ... other agents are created here ...
        
        # Register agents with the server
        orchestrator_client.connect(self.orchestrator)
        # ... other agents are connected here ...
        
        self.mcp_server.start()
```

*   **Action:** Create a `UserSession` class. In its `__init__` method, instantiate all the required agents (`OrchestratorAgent`, `DocumentAgent`, etc.).
*   **Mechanism:** Each `UserSession` has its own instance of every agent, ensuring that each user's conversation and data are completely isolated.

#### **Step 4: Connect and Route Messages in `websocket_endpoint`**

The `websocket_endpoint` function uses the `SessionManager` to route incoming messages to the correct agent.

```python
# In backend/main.py, inside websocket_endpoint

await manager.connect(websocket)
session = manager.get_session(websocket)

try:
    while True:
        data = await websocket.receive_text()
        # Route the message to the correct user's orchestrator
        await session.orchestrator.handle_message(websocket, data)
        
except WebSocketDisconnect:
    # ... handle disconnection ...
finally:
    manager.disconnect(websocket)
```

*   **Action:** In the `websocket_endpoint`, after connecting the manager, enter a `while True` loop to continuously listen for messages.
*   **Mechanism:** When a message (`data`) is received, it is passed to the `handle_message` method of the `OrchestratorAgent` that belongs to the current user's `session`. **Crucially, the active `websocket` object is passed along with the message data.**

#### **Step 5: Handle the WebSocket in the `OrchestratorAgent`**

The `OrchestratorAgent` does not create the WebSocket; it simply receives a reference to it.

```python
# In backend/agents/orchestrator.py

class OrchestratorAgent:
    def __init__(self, mcp_client: MCPClient):
        # ... other initializations ...
        self.websocket = None # Initialized as None

    async def handle_message(self, websocket: WebSocket, message: str):
        self.websocket = websocket # Store the reference
        # ... process the message ...

    # To send a message back to the user:
    async def send_response(self, text: str):
        if self.websocket:
            await self.websocket.send_text(text)
```

*   **Action:** In the `OrchestratorAgent`, ensure `self.websocket` is initialized to `None`. In the `handle_message` method, the first step is to assign the passed `websocket` object to `self.websocket`.
*   **Mechanism:** This ensures that whenever the agent needs to send a message, it has a direct reference to the correct user's WebSocket connection. It can then simply call `self.websocket.send_text(...)` to communicate back to the client.

---

### **Summary of Data Flow**

1.  A user connects to `/ws/{client_id}`.
2.  `main.py:websocket_endpoint` captures the connection.
3.  `SessionManager` creates a new `UserSession`, which in turn creates a new, unique `OrchestratorAgent` instance.
4.  The user sends a message (e.g., "Hello").
5.  The `while` loop in `websocket_endpoint` receives the message.
6.  The `websocket_endpoint` calls `session.orchestrator.handle_message(websocket, "Hello")`, passing both the message and a reference to the user's specific WebSocket connection.
7.  The `OrchestratorAgent`'s `handle_message` method stores the `websocket` reference and processes the message.
8.  To reply, the `OrchestratorAgent` calls `await self.websocket.send_text("Response from AI")`, sending the data back to the correct user.
