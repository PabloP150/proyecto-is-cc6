# Design Document

## Overview

This design adds a basic analytics tracking system to the TaskMate application to enable intelligent task assignment recommendations. The system will track 5 core metrics through minimal database schema changes and provide recommendations via an MCP server agent. The approach prioritizes simplicity and working functionality over complex features.

## Architecture

### Current System Integration
- **Existing Database**: Groups, Tasks, UserGroups, Nodes tables
- **Existing MCP Infrastructure**: MCP recommendations server with HTTP streaming transport
- **ProjectService**: Handles database operations for project creation
- **Existing LLM Integration**: Gemini 2.5 Flash via llm_service module

### New Analytics Components
- **Analytics Tables**: Minimal new tables to track the 5 core metrics
- **Analytics Service**: Simple service to record and calculate metrics
- **Analytics MCP Agent**: A new hybrid agent using analytics + LLM intelligence
- **Analytics API**: Basic endpoints for viewing analytics data

### Hybrid Decision Making Approach
- **Hard-coded Analytics**: Fast, reliable calculations for core metrics (workload, expertise, capacity)
- **LLM Enhancement**: Contextual intelligence for nuanced decisions and natural reasoning
- **Fallback Mechanism**: Graceful degradation to analytics-only when LLM unavailable
- **Best of Both Worlds**: Deterministic reliability + adaptive intelligence

## Components and Interfaces

### Database Schema Changes

**New Analytics Tables:**

```sql
-- Track task assignments and completions
CREATE TABLE TaskAnalytics (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    tid UNIQUEIDENTIFIER NOT NULL,
    uid UNIQUEIDENTIFIER NOT NULL,
    gid UNIQUEIDENTIFIER NOT NULL,
    task_category VARCHAR(50),
    assigned_at DATETIME2 NOT NULL,
    completed_at DATETIME2 NULL,
    success_status VARCHAR(20) DEFAULT 'pending', -- 'completed', 'failed', 'reassigned', 'pending'
    completion_time_hours DECIMAL(10,2) NULL,
    created_at DATETIME2 DEFAULT GETDATE(),
    FOREIGN KEY (tid) REFERENCES Tasks(tid) ON DELETE CASCADE,
    FOREIGN KEY (uid) REFERENCES Users(uid) ON DELETE CASCADE,
    FOREIGN KEY (gid) REFERENCES Groups(gid) ON DELETE CASCADE
);

-- Track user workload and capacity metrics
CREATE TABLE UserMetrics (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    uid UNIQUEIDENTIFIER NOT NULL,
    metric_date DATE NOT NULL,
    active_tasks_count INT DEFAULT 0,
    max_concurrent_tasks INT DEFAULT 0,
    avg_completion_time_hours DECIMAL(10,2) DEFAULT 0,
    success_rate_percentage DECIMAL(5,2) DEFAULT 0,
    updated_at DATETIME2 DEFAULT GETDATE(),
    FOREIGN KEY (uid) REFERENCES Users(uid) ON DELETE CASCADE,
    UNIQUE(uid, metric_date)
);

-- Track expertise scores by category
CREATE TABLE UserExpertise (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    uid UNIQUEIDENTIFIER NOT NULL,
    task_category VARCHAR(50) NOT NULL,
    expertise_score DECIMAL(5,2) DEFAULT 0, -- 0-100 score
    tasks_completed INT DEFAULT 0,
    avg_completion_time_hours DECIMAL(10,2) DEFAULT 0,
    success_rate_percentage DECIMAL(5,2) DEFAULT 0,
    last_updated DATETIME2 DEFAULT GETDATE(),
    FOREIGN KEY (uid) REFERENCES Users(uid) ON DELETE CASCADE,
    UNIQUE(uid, task_category)
);
```

### Analytics Service

**Simple Analytics Service:**
```javascript
class AnalyticsService {
    // Record task assignment
    async recordTaskAssignment(taskId, userId, groupId, category) {
        const query = `INSERT INTO TaskAnalytics (tid, uid, gid, task_category, assigned_at) 
                       VALUES (@tid, @uid, @gid, @category, GETDATE())`;
        // Simple insert operation
    }

    // Record task completion
    async recordTaskCompletion(taskId, success) {
        const completionTime = await this._calculateCompletionTime(taskId);
        const status = success ? 'completed' : 'failed';
        
        const query = `UPDATE TaskAnalytics 
                       SET completed_at = GETDATE(), 
                           success_status = @status,
                           completion_time_hours = @completionTime
                       WHERE tid = @tid AND success_status = 'pending'`;
        // Update completion data
        
        // Update user metrics after completion
        await this._updateUserMetrics(taskId);
    }

    // Get current workload for user
    async getCurrentWorkload(userId) {
        const query = `SELECT COUNT(*) as active_count 
                       FROM TaskAnalytics ta
                       JOIN Tasks t ON ta.tid = t.tid
                       WHERE ta.uid = @uid AND ta.success_status = 'pending'`;
        // Return simple count
    }

    // Get user expertise scores
    async getUserExpertise(userId) {
        const query = `SELECT task_category, expertise_score, success_rate_percentage
                       FROM UserExpertise WHERE uid = @uid`;
        // Return expertise data
    }

    // Calculate historical capacity
    async getHistoricalCapacity(userId) {
        const query = `SELECT MAX(max_concurrent_tasks) as max_capacity
                       FROM UserMetrics WHERE uid = @uid`;
        // Return max concurrent tasks handled
    }
}
```

### Enhanced MCP Agent Integration

**New Analytics Agent (taskmate-api/mcp/agents/analytics_agent.py):**
```python
import json
import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), '../../'))

from services.AnalyticsService import AnalyticsService
from models.userGroup.model import getMembersByGroupId
import llm_service

class AnalyticsAgent:
    def __init__(self):
        self.analytics_service = AnalyticsService()

    async def handle(self, request_type: str, data: dict):
        """Handle analytics-related requests."""
        if request_type == "get_task_assignment_recommendations":
            return await self._get_assignment_recommendations(data)
        elif request_type == "record_task_assignment":
            return await self._record_task_assignment(data)
        elif request_type == "record_task_completion":
            return await self._record_task_completion(data)
        else:
            return {"success": False, "error": f"Unknown request type: {request_type}"}

    async def _get_assignment_recommendations(self, data: dict):
        """Generate task assignment recommendations using hybrid approach: analytics + LLM."""
        try:
            group_id = data.get("group_id")
            task_category = data.get("task_category", "general")
            task_description = data.get("task_description", "")
            
            # Get team members
            team_members = await getMembersByGroupId(group_id)
            if not team_members:
                return {"success": False, "error": "No team members found"}
            
            # Phase 1: Calculate base scores using hard-coded analytics (fast, reliable)
            base_scores = []
            for member in team_members:
                # Get the 5 core metrics
                workload = await self.analytics_service.get_current_workload(member["uid"])
                expertise = await self.analytics_service.get_user_expertise(member["uid"])
                capacity = await self.analytics_service.get_historical_capacity(member["uid"])
                
                # Calculate base score using deterministic algorithm
                base_score = self._calculate_base_score(workload, expertise, capacity, task_category)
                
                base_scores.append({
                    "user_id": member["uid"],
                    "username": member["username"],
                    "base_score": base_score,
                    "metrics": {
                        "workload": workload,
                        "expertise": expertise.get(task_category, {}),
                        "capacity": capacity
                    }
                })
            
            # Phase 2: Enhance with LLM for contextual intelligence (adaptive, nuanced)
            enhanced_recommendations = await self._enhance_with_llm(
                base_scores, task_description, task_category, data
            )
            
            return {
                "success": True,
                "recommendations": enhanced_recommendations[:3],
                "task_category": task_category
            }
            
        except Exception as e:
            # Fallback to base scores if LLM fails
            try:
                fallback_recommendations = sorted(base_scores, key=lambda x: x["base_score"], reverse=True)
                return {
                    "success": True,
                    "recommendations": fallback_recommendations[:3],
                    "task_category": task_category,
                    "note": "Using fallback recommendations due to LLM error"
                }
            except:
                return {"success": False, "error": f"Analytics error: {str(e)}"}

    def _calculate_base_score(self, workload, expertise, capacity, task_category):
        """Calculate base score using deterministic analytics - reliable and fast."""
        base_score = 50
        
        # Expertise bonus (0-30 points)
        expertise_data = expertise.get(task_category, {})
        expertise_score = expertise_data.get("expertise_score", 0)
        expertise_bonus = (expertise_score / 100) * 30
        
        # Workload penalty (0-20 points deduction)
        if capacity > 0:
            workload_ratio = workload / capacity
            workload_penalty = min(workload_ratio * 20, 20)
        else:
            workload_penalty = 10 if workload > 2 else 0
        
        # Success rate bonus (0-20 points)
        success_rate = expertise_data.get("success_rate_percentage", 50)
        success_bonus = (success_rate / 100) * 20
        
        final_score = base_score + expertise_bonus + success_bonus - workload_penalty
        return max(0, min(100, final_score))  # Clamp between 0-100

    async def _enhance_with_llm(self, base_scores, task_description, task_category, context):
        """Use LLM to enhance recommendations with contextual intelligence."""
        try:
            # Prepare data for LLM analysis
            team_data = []
            for score_data in base_scores:
                metrics = score_data["metrics"]
                team_data.append({
                    "username": score_data["username"],
                    "base_score": score_data["base_score"],
                    "current_workload": metrics["workload"],
                    "expertise_score": metrics["expertise"].get("expertise_score", 0),
                    "success_rate": metrics["expertise"].get("success_rate_percentage", 50),
                    "historical_capacity": metrics["capacity"]
                })

            prompt = f"""You are an intelligent task assignment system. Analyze the team data and provide enhanced recommendations for task assignment.

TASK DETAILS:
- Category: {task_category}
- Description: {task_description}
- Context: {context.get('additional_context', 'None provided')}

TEAM ANALYTICS DATA:
{json.dumps(team_data, indent=2)}

INSTRUCTIONS:
1. Consider the base scores calculated from analytics data
2. Factor in task complexity, urgency, and team member context
3. Look for opportunities for skill development vs. efficiency
4. Consider workload balance and team dynamics
5. Provide intelligent reasoning for each recommendation

For each team member, provide:
- adjusted_score (0-100, can modify base_score based on context)
- confidence_level (low/medium/high)
- reasoning (2-3 sentences explaining the recommendation)
- development_opportunity (if this task would help them grow)

Respond with JSON in this format:
{{
  "recommendations": [
    {{
      "username": "member_name",
      "adjusted_score": 85,
      "confidence_level": "high",
      "reasoning": "Strong expertise in {task_category} with manageable workload. Previous success rate indicates reliability for this type of task.",
      "development_opportunity": "Opportunity to mentor others while completing this task"
    }}
  ]
}}"""

            # Generate LLM response
            llm_response = await llm_service.generate(prompt, 
                generation_config_override=genai.types.GenerationConfig(
                    temperature=0.3,
                    response_mime_type='application/json'
                ))
            
            # Parse LLM response
            llm_data = json.loads(llm_response)
            
            # Merge LLM insights with base data
            enhanced_recommendations = []
            for base_item in base_scores:
                # Find corresponding LLM recommendation
                llm_rec = next((r for r in llm_data["recommendations"] 
                              if r["username"] == base_item["username"]), None)
                
                if llm_rec:
                    enhanced_recommendations.append({
                        "user_id": base_item["user_id"],
                        "username": base_item["username"],
                        "score": llm_rec["adjusted_score"],
                        "base_score": base_item["base_score"],
                        "confidence_level": llm_rec["confidence_level"],
                        "reasoning": llm_rec["reasoning"],
                        "development_opportunity": llm_rec.get("development_opportunity"),
                        "metrics": base_item["metrics"]
                    })
                else:
                    # Fallback to base score if LLM didn't process this member
                    enhanced_recommendations.append({
                        "user_id": base_item["user_id"],
                        "username": base_item["username"],
                        "score": base_item["base_score"],
                        "reasoning": "Based on analytics data only",
                        "metrics": base_item["metrics"]
                    })
            
            # Sort by adjusted score
            enhanced_recommendations.sort(key=lambda x: x["score"], reverse=True)
            return enhanced_recommendations
            
        except Exception as e:
            print(f"LLM enhancement failed: {e}")
            # Fallback to base scores with simple reasoning
            fallback_recommendations = []
            for item in base_scores:
                fallback_recommendations.append({
                    "user_id": item["user_id"],
                    "username": item["username"],
                    "score": item["base_score"],
                    "reasoning": self._generate_simple_reasoning(item["metrics"], task_category),
                    "metrics": item["metrics"]
                })
            
            fallback_recommendations.sort(key=lambda x: x["score"], reverse=True)
            return fallback_recommendations

    def _generate_simple_reasoning(self, metrics, task_category):
        """Generate simple reasoning when LLM is unavailable."""
        expertise_data = metrics["expertise"]
        expertise_score = expertise_data.get("expertise_score", 0)
        success_rate = expertise_data.get("success_rate_percentage", 50)
        workload = metrics["workload"]
        capacity = metrics["capacity"]
        
        reasons = []
        
        if expertise_score > 70:
            reasons.append(f"High expertise in {task_category} ({expertise_score}%)")
        elif expertise_score > 40:
            reasons.append(f"Moderate expertise in {task_category} ({expertise_score}%)")
        else:
            reasons.append(f"Learning opportunity in {task_category}")
        
        if workload == 0:
            reasons.append("Currently available")
        elif capacity > 0 and workload < capacity * 0.8:
            reasons.append("Has capacity for more work")
        else:
            reasons.append("Currently at capacity")
        
        if success_rate > 80:
            reasons.append(f"High success rate ({success_rate}%)")
        
        return "; ".join(reasons)

    async def _record_task_assignment(self, data: dict):
        """Record a new task assignment."""
        try:
            await self.analytics_service.record_task_assignment(
                data["task_id"],
                data["user_id"], 
                data["group_id"],
                data.get("task_category", "general")
            )
            return {"success": True, "message": "Task assignment recorded"}
        except Exception as e:
            return {"success": False, "error": f"Failed to record assignment: {str(e)}"}

    async def _record_task_completion(self, data: dict):
        """Record task completion."""
        try:
            await self.analytics_service.record_task_completion(
                data["task_id"],
                data.get("success", True)
            )
            return {"success": True, "message": "Task completion recorded"}
        except Exception as e:
            return {"success": False, "error": f"Failed to record completion: {str(e)}"}
```

**Integration with Existing Orchestrator:**
```python
# Add to orchestrator.py
from agents.analytics_agent import AnalyticsAgent

class OrchestratorAgent:
    def __init__(self):
        self.sessions = {}
        self.recommendations_agent = RecommendationsAgent()
        self.analytics_agent = AnalyticsAgent()  # New analytics agent

    async def handle_message(self, session_id: str, websocket: WebSocket, request: dict):
        # ... existing code ...
        
        # Check if this is an analytics request
        if request.get("type") == "analytics":
            analytics_response = await self.analytics_agent.handle(
                request.get("action"),
                request.get("data", {})
            )
            
            response_data = {
                "event": "analytics_response",
                "sessionId": session_id,
                "data": analytics_response
            }
            await websocket.send_json(response_data)
            return
        
        # ... rest of existing message handling ...
```

## Data Models

### Analytics Data Flow

1. **Task Assignment**: When a task is assigned → Record in TaskAnalytics
2. **Task Completion**: When task status changes → Update TaskAnalytics and recalculate UserMetrics
3. **Daily Metrics Update**: Batch job to update UserMetrics and UserExpertise tables
4. **Recommendation Request**: MCP agent queries analytics data and returns scored recommendations

### Task Categories

Simple predefined categories to start:
- `frontend` - UI/UX related tasks
- `backend` - Server/API related tasks  
- `database` - Database related tasks
- `testing` - QA and testing tasks
- `general` - Uncategorized tasks

### Metric Calculations

**Completion Time**: `completed_at - assigned_at` in hours
**Success Rate**: `(completed_tasks / total_assigned_tasks) * 100`
**Expertise Score**: Weighted combination of success rate and average completion time
**Current Workload**: Count of tasks with `success_status = 'pending'`
**Historical Capacity**: Maximum concurrent tasks handled in any single day

## Error Handling

### Analytics Recording Errors
- If analytics recording fails, don't block the main task operations
- Log errors but continue with task creation/updates
- Use try-catch blocks around all analytics operations

### MCP Recommendation Errors
```python
try:
    recommendations = await generate_recommendations(arguments)
    return success_response(recommendations)
except AnalyticsDataError as e:
    # Return basic recommendations without analytics
    return fallback_recommendations(arguments)
except Exception as e:
    raise JSONRPCError(code=INTERNAL_ERROR, message="Recommendation service unavailable")
```

### Database Constraint Handling
- Handle duplicate entries gracefully (UNIQUE constraints)
- Provide meaningful error messages for foreign key violations
- Implement proper transaction rollback for multi-table operations

## Testing Strategy

### Analytics Service Tests
- Test task assignment recording
- Test task completion recording with different success states
- Test metric calculations with sample data
- Test workload and capacity calculations

### MCP Integration Tests
- Test recommendation generation with mock analytics data
- Test fallback behavior when analytics data is unavailable
- Test scoring algorithm with various user profiles
- Test error handling for invalid requests

### Database Tests
- Test schema creation and constraints
- Test data integrity with cascading deletes
- Test performance with sample analytics data
- Test concurrent access scenarios

## Implementation Phases

### Phase 1: Basic Analytics Infrastructure
- Create analytics database tables
- Implement basic AnalyticsService
- Add analytics recording to existing task operations
- Simple metric calculations

### Phase 2: MCP Agent Enhancement
- Extend MCP server with analytics-based recommendations
- Implement basic scoring algorithm
- Add fallback mechanisms for missing data
- Basic error handling

### Phase 3: Analytics API and Validation
- Create endpoints for viewing analytics data
- Add data validation and cleanup
- Performance optimization if needed
- User privacy controls

This design prioritizes getting a working system quickly while maintaining the flexibility to enhance features later based on real usage patterns.