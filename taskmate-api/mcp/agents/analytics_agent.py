import json
import sys
import os
import asyncio
import subprocess
import google.generativeai as genai

# Add the parent directory to path to import services
sys.path.append(os.path.join(os.path.dirname(__file__), '../../'))

import llm_service

class AnalyticsAgent:
    def __init__(self):
        self.analytics_service = None
        self.use_real_analytics = False  # Temporarily disabled to use diverse mock data
        self._initialize_analytics_service()
    
    def _initialize_analytics_service(self):
        """Initialize the real AnalyticsService from Node.js"""
        try:
            # For now, we'll use a hybrid approach - real service calls when possible
            # This will be enhanced when we integrate with the Node.js service
            print("Analytics Agent initialized with hybrid analytics support")
        except Exception as e:
            print(f"Warning: Could not initialize real AnalyticsService: {e}")
            self.use_real_analytics = False

    async def _get_team_members(self, group_id):
        """Get team members for a group - integrates with real database when possible"""
        try:
            if self.use_real_analytics:
                # Call Node.js service to get real team members
                result = await self._call_node_service('getTeamMembers', {'group_id': group_id})
                if result and result.get('success'):
                    return result.get('team_members', [])
        except Exception as e:
            print(f"Failed to get real team members: {e}")
        
        # Fallback to mock data - updated to match frontend teams
        if group_id == "test-group-456":  # Development Team
            mock_team_members = [
                {"uid": "dev_user1", "username": "Sarah Chen"},
                {"uid": "dev_user2", "username": "Marcus Johnson"},
                {"uid": "dev_user3", "username": "Elena Rodriguez"},
                {"uid": "dev_user4", "username": "David Kim"},
                {"uid": "dev_user5", "username": "Alex Thompson"},
                {"uid": "dev_user6", "username": "Pedro Silva"},
                {"uid": "dev_user7", "username": "Oscar Martinez"},
                {"uid": "dev_user8", "username": "Maria Garcia"}
            ]
        elif group_id == "test-group-789":  # Design Team
            mock_team_members = [
                {"uid": "design_user1", "username": "Maya Patel"},
                {"uid": "design_user2", "username": "James Wilson"},
                {"uid": "design_user3", "username": "Zoe Martinez"},
                {"uid": "design_user4", "username": "Ryan Foster"},
                {"uid": "design_user5", "username": "Ana Rodriguez"},
                {"uid": "design_user6", "username": "Luis Chen"},
                {"uid": "design_user7", "username": "Sofia Kim"}
            ]
        elif group_id == "test-group-123":  # QA Team
            mock_team_members = [
                {"uid": "qa_user1", "username": "Lisa Wang"},
                {"uid": "qa_user2", "username": "Tom Anderson"},
                {"uid": "qa_user3", "username": "Priya Sharma"},
                {"uid": "qa_user4", "username": "Jake Miller"},
                {"uid": "qa_user5", "username": "Nina Kowalski"},
                {"uid": "qa_user6", "username": "Carlos Mendez"},
                {"uid": "qa_user7", "username": "Alex Johnson"},
                {"uid": "qa_user8", "username": "Diana Lopez"},
                {"uid": "qa_user9", "username": "Kevin Park"}
            ]
        else:
            # Default fallback
            mock_team_members = [
                {"uid": "test_user1", "username": "Sarah Chen"},
                {"uid": "test_user2", "username": "Marcus Johnson"},
                {"uid": "test_user3", "username": "Elena Rodriguez"},
                {"uid": "test_user4", "username": "David Kim"},
                {"uid": "test_user5", "username": "Alex Thompson"}
            ]
        
        print(f"Using mock team members for group {group_id}")
        return mock_team_members
    
    async def _call_node_service(self, method, params):
        """Call Node.js AnalyticsService methods via subprocess"""
        try:
            # Create a simple Node.js script call
            script_path = os.path.join(os.path.dirname(__file__), '../../analytics_bridge.js')
            if not os.path.exists(script_path):
                return None
                
            cmd = ['node', script_path, method, json.dumps(params)]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            
            if result.returncode == 0:
                return json.loads(result.stdout)
            else:
                print(f"Node service error: {result.stderr}")
                return None
        except Exception as e:
            print(f"Error calling Node service: {e}")
            return None
    
    async def _get_real_analytics_data(self, user_id):
        """Get real analytics data from AnalyticsService"""
        try:
            if self.use_real_analytics:
                result = await self._call_node_service('getUserAnalyticsSummary', {'user_id': user_id})
                if result and result.get('success'):
                    analytics = result.get('analytics', {})
                    return (
                        analytics.get('current_workload', 0),
                        analytics.get('expertise_by_category', {}),
                        analytics.get('historical_capacity', 3)
                    )
        except Exception as e:
            print(f"Failed to get real analytics for user {user_id}: {e}")
        
        return None

    def _get_mock_analytics_data(self, user_id):
        mock_data = {
            # Development Team
            "dev_user1": {  # Sarah Chen
                "workload": 4,
                "capacity": 5,
                "expertise": {
                    "frontend": {"expertise_score": 94, "success_rate_percentage": 96},
                    "backend": {"expertise_score": 45, "success_rate_percentage": 75},
                    "testing": {"expertise_score": 72, "success_rate_percentage": 87},
                    "database": {"expertise_score": 38, "success_rate_percentage": 68},
                    "general": {"expertise_score": 78, "success_rate_percentage": 90}
                }
            },
            "dev_user2": {  # Marcus Johnson
                "workload": 3,
                "capacity": 5,
                "expertise": {
                    "frontend": {"expertise_score": 52, "success_rate_percentage": 83},
                    "backend": {"expertise_score": 96, "success_rate_percentage": 98},
                    "testing": {"expertise_score": 68, "success_rate_percentage": 89},
                    "database": {"expertise_score": 91, "success_rate_percentage": 94},
                    "general": {"expertise_score": 82, "success_rate_percentage": 92}
                }
            },
            "dev_user3": {  # Elena Rodriguez
                "workload": 5,
                "capacity": 6,
                "expertise": {
                    "frontend": {"expertise_score": 85, "success_rate_percentage": 91},
                    "backend": {"expertise_score": 88, "success_rate_percentage": 93},
                    "testing": {"expertise_score": 71, "success_rate_percentage": 85},
                    "database": {"expertise_score": 76, "success_rate_percentage": 86},
                    "general": {"expertise_score": 80, "success_rate_percentage": 89}
                }
            },
            "dev_user4": {  # David Kim
                "workload": 2,
                "capacity": 4,
                "expertise": {
                    "frontend": {"expertise_score": 38, "success_rate_percentage": 60},
                    "backend": {"expertise_score": 82, "success_rate_percentage": 88},
                    "testing": {"expertise_score": 91, "success_rate_percentage": 97},
                    "database": {"expertise_score": 89, "success_rate_percentage": 95},
                    "general": {"expertise_score": 75, "success_rate_percentage": 86}
                }
            },
            "dev_user5": {  # Alex Thompson
                "workload": 3,
                "capacity": 5,
                "expertise": {
                    "frontend": {"expertise_score": 65, "success_rate_percentage": 75},
                    "backend": {"expertise_score": 58, "success_rate_percentage": 70},
                    "testing": {"expertise_score": 45, "success_rate_percentage": 62},
                    "database": {"expertise_score": 35, "success_rate_percentage": 55},
                    "general": {"expertise_score": 56, "success_rate_percentage": 69}
                }
            },
            "dev_user6": {  # Pedro Silva
                "workload": 4,
                "capacity": 6,
                "expertise": {
                    "frontend": {"expertise_score": 78, "success_rate_percentage": 85},
                    "backend": {"expertise_score": 84, "success_rate_percentage": 90},
                    "testing": {"expertise_score": 62, "success_rate_percentage": 78},
                    "database": {"expertise_score": 71, "success_rate_percentage": 82},
                    "general": {"expertise_score": 74, "success_rate_percentage": 84}
                }
            },
            "dev_user7": {  # Oscar Martinez
                "workload": 2,
                "capacity": 4,
                "expertise": {
                    "frontend": {"expertise_score": 55, "success_rate_percentage": 72},
                    "backend": {"expertise_score": 75, "success_rate_percentage": 85},
                    "testing": {"expertise_score": 68, "success_rate_percentage": 80},
                    "database": {"expertise_score": 58, "success_rate_percentage": 75},
                    "general": {"expertise_score": 64, "success_rate_percentage": 78}
                }
            },
            "dev_user8": {  # Maria Garcia
                "workload": 3,
                "capacity": 5,
                "expertise": {
                    "frontend": {"expertise_score": 72, "success_rate_percentage": 82},
                    "backend": {"expertise_score": 68, "success_rate_percentage": 79},
                    "testing": {"expertise_score": 58, "success_rate_percentage": 74},
                    "database": {"expertise_score": 45, "success_rate_percentage": 68},
                    "general": {"expertise_score": 61, "success_rate_percentage": 76}
                }
            },
            # Design Team
            "design_user1": {  # Maya Patel
                "workload": 3,
                "capacity": 4,
                "expertise": {
                    "frontend": {"expertise_score": 89, "success_rate_percentage": 92},
                    "backend": {"expertise_score": 25, "success_rate_percentage": 55},
                    "testing": {"expertise_score": 35, "success_rate_percentage": 62},
                    "database": {"expertise_score": 15, "success_rate_percentage": 45},
                    "general": {"expertise_score": 94, "success_rate_percentage": 96}
                }
            },
            "design_user2": {  # James Wilson
                "workload": 2,
                "capacity": 5,
                "expertise": {
                    "frontend": {"expertise_score": 62, "success_rate_percentage": 80},
                    "backend": {"expertise_score": 20, "success_rate_percentage": 50},
                    "testing": {"expertise_score": 45, "success_rate_percentage": 68},
                    "database": {"expertise_score": 18, "success_rate_percentage": 48},
                    "general": {"expertise_score": 88, "success_rate_percentage": 93}
                }
            },
            "design_user3": {  # Zoe Martinez
                "workload": 4,
                "capacity": 5,
                "expertise": {
                    "frontend": {"expertise_score": 78, "success_rate_percentage": 85},
                    "backend": {"expertise_score": 22, "success_rate_percentage": 52},
                    "testing": {"expertise_score": 38, "success_rate_percentage": 65},
                    "database": {"expertise_score": 16, "success_rate_percentage": 47},
                    "general": {"expertise_score": 92, "success_rate_percentage": 94}
                }
            },
            "design_user4": {  # Ryan Foster
                "workload": 1,
                "capacity": 3,
                "expertise": {
                    "frontend": {"expertise_score": 71, "success_rate_percentage": 83},
                    "backend": {"expertise_score": 18, "success_rate_percentage": 48},
                    "testing": {"expertise_score": 32, "success_rate_percentage": 60},
                    "database": {"expertise_score": 14, "success_rate_percentage": 44},
                    "general": {"expertise_score": 85, "success_rate_percentage": 89}
                }
            },
            "design_user5": {  # Ana Rodriguez
                "workload": 3,
                "capacity": 4,
                "expertise": {
                    "frontend": {"expertise_score": 82, "success_rate_percentage": 88},
                    "backend": {"expertise_score": 24, "success_rate_percentage": 54},
                    "testing": {"expertise_score": 41, "success_rate_percentage": 67},
                    "database": {"expertise_score": 19, "success_rate_percentage": 49},
                    "general": {"expertise_score": 87, "success_rate_percentage": 91}
                }
            },
            "design_user6": {  # Luis Chen
                "workload": 2,
                "capacity": 5,
                "expertise": {
                    "frontend": {"expertise_score": 68, "success_rate_percentage": 81},
                    "backend": {"expertise_score": 21, "success_rate_percentage": 51},
                    "testing": {"expertise_score": 36, "success_rate_percentage": 63},
                    "database": {"expertise_score": 17, "success_rate_percentage": 46},
                    "general": {"expertise_score": 83, "success_rate_percentage": 87}
                }
            },
            "design_user7": {  # Sofia Kim
                "workload": 3,
                "capacity": 4,
                "expertise": {
                    "frontend": {"expertise_score": 86, "success_rate_percentage": 90},
                    "backend": {"expertise_score": 26, "success_rate_percentage": 56},
                    "testing": {"expertise_score": 43, "success_rate_percentage": 69},
                    "database": {"expertise_score": 20, "success_rate_percentage": 50},
                    "general": {"expertise_score": 91, "success_rate_percentage": 95}
                }
            },
            # QA Team
            "qa_user1": {  # Lisa Wang
                "workload": 4,
                "capacity": 5,
                "expertise": {
                    "frontend": {"expertise_score": 68, "success_rate_percentage": 80},
                    "backend": {"expertise_score": 72, "success_rate_percentage": 83},
                    "testing": {"expertise_score": 96, "success_rate_percentage": 98},
                    "database": {"expertise_score": 58, "success_rate_percentage": 75},
                    "general": {"expertise_score": 79, "success_rate_percentage": 87}
                }
            },
            "qa_user2": {  # Tom Anderson
                "workload": 3,
                "capacity": 4,
                "expertise": {
                    "frontend": {"expertise_score": 55, "success_rate_percentage": 75},
                    "backend": {"expertise_score": 48, "success_rate_percentage": 70},
                    "testing": {"expertise_score": 89, "success_rate_percentage": 92},
                    "database": {"expertise_score": 42, "success_rate_percentage": 68},
                    "general": {"expertise_score": 64, "success_rate_percentage": 78}
                }
            },
            "qa_user3": {  # Priya Sharma
                "workload": 5,
                "capacity": 6,
                "expertise": {
                    "frontend": {"expertise_score": 61, "success_rate_percentage": 78},
                    "backend": {"expertise_score": 84, "success_rate_percentage": 88},
                    "testing": {"expertise_score": 93, "success_rate_percentage": 95},
                    "database": {"expertise_score": 87, "success_rate_percentage": 91},
                    "general": {"expertise_score": 81, "success_rate_percentage": 86}
                }
            },
            "qa_user4": {  # Jake Miller
                "workload": 2,
                "capacity": 5,
                "expertise": {
                    "frontend": {"expertise_score": 48, "success_rate_percentage": 72},
                    "backend": {"expertise_score": 78, "success_rate_percentage": 85},
                    "testing": {"expertise_score": 88, "success_rate_percentage": 90},
                    "database": {"expertise_score": 82, "success_rate_percentage": 88},
                    "general": {"expertise_score": 76, "success_rate_percentage": 82}
                }
            },
            "qa_user5": {  # Nina Kowalski
                "workload": 3,
                "capacity": 4,
                "expertise": {
                    "frontend": {"expertise_score": 52, "success_rate_percentage": 70},
                    "backend": {"expertise_score": 45, "success_rate_percentage": 62},
                    "testing": {"expertise_score": 82, "success_rate_percentage": 86},
                    "database": {"expertise_score": 38, "success_rate_percentage": 65},
                    "general": {"expertise_score": 60, "success_rate_percentage": 73}
                }
            },
            "qa_user6": {  # Carlos Mendez
                "workload": 4,
                "capacity": 5,
                "expertise": {
                    "frontend": {"expertise_score": 58, "success_rate_percentage": 76},
                    "backend": {"expertise_score": 75, "success_rate_percentage": 84},
                    "testing": {"expertise_score": 85, "success_rate_percentage": 89},
                    "database": {"expertise_score": 71, "success_rate_percentage": 81},
                    "general": {"expertise_score": 72, "success_rate_percentage": 82}
                }
            },
            "qa_user7": {  # Alex Johnson
                "workload": 3,
                "capacity": 5,
                "expertise": {
                    "frontend": {"expertise_score": 54, "success_rate_percentage": 74},
                    "backend": {"expertise_score": 62, "success_rate_percentage": 78},
                    "testing": {"expertise_score": 79, "success_rate_percentage": 85},
                    "database": {"expertise_score": 48, "success_rate_percentage": 71},
                    "general": {"expertise_score": 61, "success_rate_percentage": 77}
                }
            },
            "qa_user8": {  # Diana Lopez
                "workload": 2,
                "capacity": 4,
                "expertise": {
                    "frontend": {"expertise_score": 46, "success_rate_percentage": 68},
                    "backend": {"expertise_score": 52, "success_rate_percentage": 73},
                    "testing": {"expertise_score": 74, "success_rate_percentage": 82},
                    "database": {"expertise_score": 41, "success_rate_percentage": 66},
                    "general": {"expertise_score": 53, "success_rate_percentage": 72}
                }
            },
            "qa_user9": {  # Kevin Park
                "workload": 4,
                "capacity": 6,
                "expertise": {
                    "frontend": {"expertise_score": 63, "success_rate_percentage": 79},
                    "backend": {"expertise_score": 81, "success_rate_percentage": 87},
                    "testing": {"expertise_score": 91, "success_rate_percentage": 94},
                    "database": {"expertise_score": 76, "success_rate_percentage": 84},
                    "general": {"expertise_score": 78, "success_rate_percentage": 86}
                }
            }
        }
        
        user_data = mock_data.get(user_id, {
            "workload": 0,
            "capacity": 3,
            "expertise": {"general": {"expertise_score": 50, "success_rate_percentage": 50}}
        })
        
        return user_data["workload"], user_data["expertise"], user_data["capacity"]

    async def handle(self, request_type: str, data: dict):
        if request_type == "get_task_assignment_recommendations":
            return await self._get_assignment_recommendations(data)
        elif request_type == "record_task_assignment":
            return await self._record_task_assignment(data)
        elif request_type == "record_task_completion":
            return await self._record_task_completion(data)
        elif request_type == "get_user_analytics":
            return await self._get_user_analytics(data)
        elif request_type == "test_recommendations":
            return await self._test_recommendations(data)
        elif request_type == "get_team_analytics":
            return await self._get_team_analytics(data)
        elif request_type == "get_workload_distribution":
            return await self._get_workload_distribution(data)
        elif request_type == "get_expertise_rankings":
            return await self._get_expertise_rankings(data)
        else:
            return {"success": False, "error": f"Unknown request type: {request_type}"}

    async def _get_assignment_recommendations(self, data: dict):
        try:
            group_id = data.get("group_id")
            task_category = data.get("task_category", "general")
            task_description = data.get("task_description", "")
            
            if not group_id:
                return {"success": False, "error": "group_id is required"}
        
            try:
                team_members = await self._get_team_members(group_id)
            except Exception as e:
                return {"success": False, "error": f"Failed to get team members: {str(e)}"}
            
            if not team_members:
                return {"success": False, "error": "No team members found"}
            
            # Phase 1: Calculate base scores using deterministic analytics (fast, reliable)
            base_scores = []
            for member in team_members:
                try:
                    # Try to get real analytics data first
                    real_data = await self._get_real_analytics_data(member["uid"])
                    if real_data:
                        workload, expertise, capacity = real_data
                        print(f"Using real analytics for {member['username']}")
                    else:
                        # Fallback to mock data
                        workload, expertise, capacity = self._get_mock_analytics_data(member["uid"])
                        print(f"Using mock analytics for {member['username']}")
                    
                    # Calculate deterministic base score using the 5 core metrics
                    base_score = self._calculate_base_score(workload, expertise, capacity, task_category)
                    
                    base_scores.append({
                        "user_id": member["uid"],
                        "username": member["username"],
                        "base_score": base_score,
                        "metrics": {
                            "workload": workload,
                            "expertise": expertise.get(task_category, {}),
                            "capacity": capacity,
                            "data_source": "real" if real_data else "mock"
                        }
                    })
                except Exception as e:
                    print(f"Analytics failed for user {member.get('username', 'unknown')}: {e}")
                    # Fallback to safe defaults
                    base_scores.append({
                        "user_id": member["uid"],
                        "username": member["username"],
                        "base_score": 50,  # Neutral default score
                        "metrics": {
                            "workload": 0,
                            "expertise": {},
                            "capacity": 3,
                            "data_source": "default"
                        }
                    })
            
            # Phase 2: Enhance with LLM for contextual intelligence (adaptive, nuanced)
            try:
                enhanced_recommendations, suggested_plan = await self._enhance_with_llm(
                    base_scores, task_description, task_category, data
                )
                print("Successfully enhanced recommendations with LLM")
            except Exception as e:
                print(f"LLM enhancement failed, using fallback: {e}")
                # Graceful fallback to deterministic recommendations
                enhanced_recommendations = self._create_fallback_recommendations(base_scores, task_category)
                suggested_plan = {
                    "primary_assignee": enhanced_recommendations[0]["username"] if enhanced_recommendations else "N/A",
                    "plan_type": "solo",
                    "rationale": "Analytics-based assignment (LLM unavailable). Assigned to team member with highest expertise and capacity.",
                    "fallback_used": True
                }
            
            return {
                "success": True,
                "recommendations": enhanced_recommendations[:3],
                "suggested_plan": suggested_plan,
                "task_category": task_category,
                "base_scores": [{"username": item["username"], "base_score": item["base_score"]} for item in base_scores]
            }
            
        except Exception as e:
            print(f"Analytics recommendation error: {e}")
            return {"success": False, "error": f"Analytics error: {str(e)}"}

    def _calculate_base_score(self, workload, expertise, capacity, task_category):
        """
        Calculate base score using deterministic analytics - implements the 5 core metrics:
        1. Task completion time (via expertise score)
        2. Task success rate 
        3. Current workload
        4. Task category expertise
        5. Historical capacity
        """
        base_score = 50  # Neutral starting point
        
        # Metric 1 & 4: Task category expertise (0-35 points)
        expertise_data = expertise.get(task_category, {})
        expertise_score = expertise_data.get("expertise_score", 0)
        
        # Higher expertise = better completion time and category fit
        expertise_bonus = (expertise_score / 100) * 35
        
        # Metric 2: Success rate bonus (0-25 points)
        success_rate = expertise_data.get("success_rate_percentage", 50)
        success_bonus = (success_rate / 100) * 25
        
        # Metric 3 & 5: Workload vs Capacity analysis (0-20 points penalty)
        if capacity > 0:
            workload_ratio = workload / capacity
            
            # Optimal workload is 60-80% of capacity
            if workload_ratio <= 0.6:
                # Under-utilized, good availability
                workload_adjustment = 0
            elif workload_ratio <= 0.8:
                # Optimal utilization
                workload_adjustment = 5  # Small bonus for being in sweet spot
            elif workload_ratio <= 1.0:
                # At capacity, some penalty
                workload_adjustment = -10
            else:
                # Over capacity, significant penalty
                workload_adjustment = -20
        else:
            # No historical capacity data
            workload_adjustment = -5 if workload > 2 else 0
        
        # Additional considerations for task assignment
        
        # Availability bonus: completely free users get a small boost
        availability_bonus = 10 if workload == 0 else 0
        
        # Experience penalty: very low expertise in category
        experience_penalty = -10 if expertise_score < 20 else 0
        
        # Calculate final score
        final_score = (base_score + 
                      expertise_bonus + 
                      success_bonus + 
                      workload_adjustment + 
                      availability_bonus + 
                      experience_penalty)
        
        # Clamp between 0-100 and round to 1 decimal place
        return round(max(0, min(100, final_score)), 1)

    async def _enhance_with_llm(self, base_scores, task_description, task_category, context):
        """Use LLM to enhance recommendations with contextual intelligence."""
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

        prompt = f"""You are an intelligent task assignment system with access to comprehensive team analytics. Your role is to enhance data-driven recommendations with contextual intelligence and strategic thinking.

TASK DETAILS:
- Category: {task_category}
- Description: {task_description}
- Priority: {context.get('priority', 'normal')}
- Deadline: {context.get('deadline', 'flexible')}
- Additional Context: {context.get('additional_context', 'None provided')}

TEAM ANALYTICS DATA (with base scores calculated from 5 core metrics):
{json.dumps(team_data, indent=2)}

ANALYTICS METHODOLOGY:
The base scores are calculated using:
1. Task completion time patterns (via expertise scores)
2. Historical success rates in this category
3. Current workload vs capacity analysis
4. Category-specific expertise levels
5. Historical capacity and performance data

YOUR ENHANCEMENT ROLE:
1. **Contextual Intelligence**: Consider task complexity, urgency, and strategic value
2. **Team Dynamics**: Factor in collaboration patterns, mentoring opportunities
3. **Skill Development**: Balance efficiency vs growth opportunities
4. **Risk Assessment**: Consider reliability needs vs development potential
5. **Workload Optimization**: Ensure sustainable team performance

DECISION FACTORS TO CONSIDER:
- Task complexity vs team member experience level
- Opportunity for skill development vs need for reliable delivery
- Team workload distribution and burnout prevention
- Cross-training and knowledge sharing opportunities
- Strategic team capability building

For each team member, provide:
- adjusted_score (0-100): Can modify base_score based on contextual factors
- confidence_level (low/medium/high): Your confidence in this recommendation
- reasoning (2-3 sentences): Clear explanation of your scoring rationale
- development_opportunity (optional): How this task could help them grow
- risk_factors (optional): Any concerns about this assignment

After analyzing all members, provide a strategic assignment plan:

Respond with JSON in this exact format:
{{
  "recommendations": [
    {{
      "username": "member_name",
      "adjusted_score": 85,
      "confidence_level": "high",
      "reasoning": "Strong expertise in {task_category} with manageable workload. Analytics show 92% success rate and optimal capacity utilization.",
      "development_opportunity": "Opportunity to mentor junior team members while delivering reliably",
      "risk_factors": "None identified - strong track record in this category"
    }}
  ],
  "suggested_plan": {{
    "primary_assignee": "member_name",
    "plan_type": "solo",
    "rationale": "Analytics indicate this member has optimal expertise-to-workload ratio for reliable delivery. Their high success rate in {task_category} minimizes project risk.",
    "alternative_approach": "Could pair with junior member for knowledge transfer if timeline allows",
    "strategic_value": "Maintains team velocity while building category expertise"
  }}
}}"""

        # Generate LLM response
        llm_response = await llm_service.generate(prompt, 
            generation_config_override=genai.types.GenerationConfig(
                temperature=0.3,
                response_mime_type='application/json'
            ))
        
        # Parse LLM response
        try:
            llm_data = json.loads(llm_response)
        except json.JSONDecodeError as e:
            print(f"LLM JSON parsing failed: {e}")
            print(f"Raw response: {llm_response}")
            raise Exception("LLM returned invalid JSON")
        
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
                    "base_score": base_item["base_score"],
                    "reasoning": "Based on analytics data only",
                    "metrics": base_item["metrics"]
                })
        
        # Sort by adjusted score
        enhanced_recommendations.sort(key=lambda x: x["score"], reverse=True)
        
        # Add suggested plan from LLM
        suggested_plan = llm_data.get("suggested_plan", {
            "primary_assignee": enhanced_recommendations[0]["username"] if enhanced_recommendations else "N/A",
            "plan_type": "solo",
            "rationale": "Default assignment to highest scoring team member"
        })
        
        return enhanced_recommendations, suggested_plan

    def _create_fallback_recommendations(self, base_scores, task_category):
        """Generate simple recommendations when LLM is unavailable."""
        fallback_recommendations = []
        for item in base_scores:
            fallback_recommendations.append({
                "user_id": item["user_id"],
                "username": item["username"],
                "score": item["base_score"],
                "base_score": item["base_score"],
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
        """Record a new task assignment using real AnalyticsService when available."""
        try:
            task_id = data.get("task_id")
            user_id = data.get("user_id")
            group_id = data.get("group_id")
            task_category = data.get("task_category", "general")
            
            if not all([task_id, user_id, group_id]):
                return {"success": False, "error": "task_id, user_id, and group_id are required"}
            
            # Try to use real AnalyticsService
            if self.use_real_analytics:
                result = await self._call_node_service('recordTaskAssignment', {
                    'task_id': task_id,
                    'user_id': user_id,
                    'group_id': group_id,
                    'category': task_category
                })
                
                if result and result.get('success'):
                    print(f"Real: Recorded task assignment - Task: {task_id}, User: {user_id}, Category: {task_category}")
                    return {"success": True, "message": "Task assignment recorded", "method": "real"}
            
            # Fallback to mock recording
            print(f"Mock: Recording task assignment - Task: {task_id}, User: {user_id}, Category: {task_category}")
            return {"success": True, "message": "Task assignment recorded (mock)", "method": "mock"}
            
        except Exception as e:
            return {"success": False, "error": f"Failed to record assignment: {str(e)}"}

    async def _record_task_completion(self, data: dict):
        """Record task completion using real AnalyticsService when available."""
        try:
            task_id = data.get("task_id")
            success = data.get("success", True)
            
            if not task_id:
                return {"success": False, "error": "task_id is required"}
            
            # Try to use real AnalyticsService
            if self.use_real_analytics:
                result = await self._call_node_service('recordTaskCompletion', {
                    'task_id': task_id,
                    'success': success
                })
                
                if result and result.get('success'):
                    print(f"Real: Recorded task completion - Task: {task_id}, Success: {success}")
                    return {"success": True, "message": "Task completion recorded", "method": "real"}
            
            # Fallback to mock recording
            print(f"Mock: Recording task completion - Task: {task_id}, Success: {success}")
            return {"success": True, "message": "Task completion recorded (mock)", "method": "mock"}
            
        except Exception as e:
            return {"success": False, "error": f"Failed to record completion: {str(e)}"}

    async def _get_user_analytics(self, data: dict):
        """Get comprehensive analytics summary for a user."""
        try:
            user_id = data.get("user_id")
            
            if not user_id:
                return {"success": False, "error": "user_id is required"}
            
            # Try to get real analytics data
            real_data = await self._get_real_analytics_data(user_id)
            if real_data:
                workload, expertise, capacity = real_data
                summary = {
                    "current_workload": workload,
                    "expertise_by_category": expertise,
                    "historical_capacity": capacity,
                    "data_source": "real",
                    "updated_at": "2025-01-16T12:00:00Z"
                }
                print(f"Retrieved real analytics for user {user_id}")
            else:
                # Fallback to mock data
                workload, expertise, capacity = self._get_mock_analytics_data(user_id)
                summary = {
                    "current_workload": workload,
                    "expertise_by_category": expertise,
                    "historical_capacity": capacity,
                    "data_source": "mock",
                    "updated_at": "2025-01-16T12:00:00Z"
                }
                print(f"Using mock analytics for user {user_id}")
            
            return {"success": True, "analytics": summary}
        except Exception as e:
            return {"success": False, "error": f"Failed to get analytics: {str(e)}"}

    async def _test_recommendations(self, data: dict):
        """Test recommendations with mock data (for testing purposes)."""
        try:
            task_category = data.get("task_category", "general")
            task_description = data.get("task_description", "")
            
            mock_team_members = [
                {
                    "uid": "test_user1",
                    "username": "Pedro"
                },
                {
                    "uid": "test_user2", 
                    "username": "Oscar"
                },
                {
                    "uid": "test_user3",
                    "username": "Juan"
                },
                {
                    "uid": "test_user4",
                    "username": "Maria"
                },
                {
                    "uid": "test_user5",
                    "username": "Alex"
                },
                {
                    "uid": "test_user6",
                    "username": "Sofia"
                }
            ]
            
            mock_analytics = {
                "test_user1": {
                    "workload": 3,
                    "capacity": 7,
                    "expertise": {
                        "frontend": {"expertise_score": 88, "success_rate_percentage": 92},
                        "backend": {"expertise_score": 35, "success_rate_percentage": 65},
                        "testing": {"expertise_score": 55, "success_rate_percentage": 72},
                        "database": {"expertise_score": 28, "success_rate_percentage": 58},
                        "general": {"expertise_score": 68, "success_rate_percentage": 78}
                    }
                },
                "test_user2": {
                    "workload": 2,
                    "capacity": 6,
                    "expertise": {
                        "frontend": {"expertise_score": 42, "success_rate_percentage": 68},
                        "backend": {"expertise_score": 92, "success_rate_percentage": 96},
                        "testing": {"expertise_score": 65, "success_rate_percentage": 82},
                        "database": {"expertise_score": 85, "success_rate_percentage": 89},
                        "general": {"expertise_score": 73, "success_rate_percentage": 84}
                    }
                },
                "test_user3": {
                    "workload": 1,
                    "capacity": 5,
                    "expertise": {
                        "frontend": {"expertise_score": 58, "success_rate_percentage": 74},
                        "backend": {"expertise_score": 48, "success_rate_percentage": 71},
                        "testing": {"expertise_score": 91, "success_rate_percentage": 94},
                        "database": {"expertise_score": 52, "success_rate_percentage": 69},
                        "general": {"expertise_score": 64, "success_rate_percentage": 77}
                    }
                },
                "test_user4": {
                    "workload": 4,
                    "capacity": 8,
                    "expertise": {
                        "frontend": {"expertise_score": 95, "success_rate_percentage": 98},
                        "backend": {"expertise_score": 72, "success_rate_percentage": 85},
                        "testing": {"expertise_score": 68, "success_rate_percentage": 80},
                        "database": {"expertise_score": 45, "success_rate_percentage": 70},
                        "general": {"expertise_score": 82, "success_rate_percentage": 88}
                    }
                },
                "test_user5": {
                    "workload": 0,
                    "capacity": 4,
                    "expertise": {
                        "frontend": {"expertise_score": 25, "success_rate_percentage": 55},
                        "backend": {"expertise_score": 30, "success_rate_percentage": 60},
                        "testing": {"expertise_score": 40, "success_rate_percentage": 65},
                        "database": {"expertise_score": 20, "success_rate_percentage": 50},
                        "general": {"expertise_score": 35, "success_rate_percentage": 58}
                    }
                },
                "test_user6": {
                    "workload": 2,
                    "capacity": 6,
                    "expertise": {
                        "frontend": {"expertise_score": 78, "success_rate_percentage": 85},
                        "backend": {"expertise_score": 88, "success_rate_percentage": 92},
                        "testing": {"expertise_score": 82, "success_rate_percentage": 88},
                        "database": {"expertise_score": 90, "success_rate_percentage": 95},
                        "general": {"expertise_score": 85, "success_rate_percentage": 90}
                    }
                }
            }
            
            # Calculate base scores with mock data
            base_scores = []
            for member in mock_team_members:
                user_analytics = mock_analytics[member["uid"]]
                base_score = self._calculate_base_score(
                    user_analytics["workload"],
                    user_analytics["expertise"],
                    user_analytics["capacity"],
                    task_category
                )
                
                base_scores.append({
                    "user_id": member["uid"],
                    "username": member["username"],
                    "base_score": base_score,
                    "metrics": {
                        "workload": user_analytics["workload"],
                        "expertise": user_analytics["expertise"].get(task_category, {}),
                        "capacity": user_analytics["capacity"]
                    }
                })
            
            # Enhance with LLM
            try:
                enhanced_recommendations, suggested_plan = await self._enhance_with_llm(
                    base_scores, task_description, task_category, data
                )
            except Exception as e:
                print(f"LLM enhancement failed in test: {e}")
                enhanced_recommendations = self._create_fallback_recommendations(base_scores, task_category)
                suggested_plan = {
                    "primary_assignee": enhanced_recommendations[0]["username"] if enhanced_recommendations else "N/A",
                    "plan_type": "solo",
                    "rationale": "Fallback assignment to highest scoring team member"
                }
            
            return {
                "success": True,
                "recommendations": enhanced_recommendations[:3],
                "suggested_plan": suggested_plan,
                "task_category": task_category,
                "base_scores": [{"username": item["username"], "base_score": item["base_score"]} for item in base_scores]
            }
            
        except Exception as e:
            return {"success": False, "error": f"Test failed: {str(e)}"}
    
    async def _get_team_analytics(self, data: dict):
        """Get comprehensive team analytics summary."""
        try:
            group_id = data.get("group_id")
            
            if not group_id:
                return {"success": False, "error": "group_id is required"}
            
            # Try to get real team analytics
            if self.use_real_analytics:
                result = await self._call_node_service('getTeamAnalyticsSummary', {'group_id': group_id})
                if result and result.get('success'):
                    return result
            
            # Fallback to mock team analytics
            team_members = await self._get_team_members(group_id)
            team_analytics = []
            
            for member in team_members:
                workload, expertise, capacity = self._get_mock_analytics_data(member["uid"])
                
                # Calculate overall performance score
                overall_score = 0
                total_categories = 0
                for category, data in expertise.items():
                    overall_score += data.get("expertise_score", 0)
                    total_categories += 1
                
                avg_expertise = overall_score / total_categories if total_categories > 0 else 0
                
                team_analytics.append({
                    "user_id": member["uid"],
                    "username": member["username"],
                    "current_workload": workload,
                    "capacity": capacity,
                    "utilization_percentage": round((workload / capacity * 100) if capacity > 0 else 0, 1),
                    "average_expertise": round(avg_expertise, 1),
                    "expertise_by_category": expertise
                })
            
            return {
                "success": True,
                "group_id": group_id,
                "team_analytics": team_analytics,
                "data_source": "mock"
            }
            
        except Exception as e:
            return {"success": False, "error": f"Failed to get team analytics: {str(e)}"}
    
    async def _get_workload_distribution(self, data: dict):
        """Get workload distribution across team members."""
        try:
            group_id = data.get("group_id")
            
            if not group_id:
                return {"success": False, "error": "group_id is required"}
            
            # Try to get real workload distribution
            if self.use_real_analytics:
                result = await self._call_node_service('getWorkloadDistribution', {'group_id': group_id})
                if result and result.get('success'):
                    return result
            
            # Fallback to mock workload distribution
            team_members = await self._get_team_members(group_id)
            workload_distribution = []
            
            for member in team_members:
                workload, expertise, capacity = self._get_mock_analytics_data(member["uid"])
                
                utilization = (workload / capacity * 100) if capacity > 0 else 0
                
                # Determine status based on utilization
                if utilization >= 100:
                    status = "overloaded"
                elif utilization >= 80:
                    status = "high"
                elif utilization >= 50:
                    status = "moderate"
                elif utilization > 0:
                    status = "light"
                else:
                    status = "available"
                
                workload_distribution.append({
                    "user_id": member["uid"],
                    "username": member["username"],
                    "current_workload": workload,
                    "capacity": capacity,
                    "utilization_percentage": round(utilization, 1),
                    "status": status
                })
            
            # Sort by utilization percentage (highest first)
            workload_distribution.sort(key=lambda x: x["utilization_percentage"], reverse=True)
            
            return {
                "success": True,
                "group_id": group_id,
                "workload_distribution": workload_distribution,
                "data_source": "mock"
            }
            
        except Exception as e:
            return {"success": False, "error": f"Failed to get workload distribution: {str(e)}"}
    
    async def _get_expertise_rankings(self, data: dict):
        """Get expertise rankings by category."""
        try:
            group_id = data.get("group_id")
            category = data.get("category")
            
            if not group_id:
                return {"success": False, "error": "group_id is required"}
            
            # Try to get real expertise rankings
            if self.use_real_analytics:
                result = await self._call_node_service('getCategoryExpertiseRankings', {
                    'group_id': group_id,
                    'category': category
                })
                if result and result.get('success'):
                    return result
            
            # Fallback to mock expertise rankings
            team_members = await self._get_team_members(group_id)
            
            if category:
                # Single category rankings
                rankings = []
                for member in team_members:
                    workload, expertise, capacity = self._get_mock_analytics_data(member["uid"])
                    category_data = expertise.get(category, {})
                    
                    rankings.append({
                        "user_id": member["uid"],
                        "username": member["username"],
                        "expertise_score": category_data.get("expertise_score", 0),
                        "success_rate": category_data.get("success_rate_percentage", 0),
                        "current_workload": workload,
                        "availability_score": max(0, 100 - (workload / capacity * 100)) if capacity > 0 else 100
                    })
                
                # Sort by expertise score
                rankings.sort(key=lambda x: x["expertise_score"], reverse=True)
                
                return {
                    "success": True,
                    "group_id": group_id,
                    "category": category,
                    "rankings": rankings,
                    "data_source": "mock"
                }
            else:
                # All categories rankings
                categories = ["frontend", "backend", "database", "testing", "general"]
                all_rankings = {}
                
                for cat in categories:
                    rankings = []
                    for member in team_members:
                        workload, expertise, capacity = self._get_mock_analytics_data(member["uid"])
                        category_data = expertise.get(cat, {})
                        
                        rankings.append({
                            "user_id": member["uid"],
                            "username": member["username"],
                            "expertise_score": category_data.get("expertise_score", 0),
                            "success_rate": category_data.get("success_rate_percentage", 0)
                        })
                    
                    # Sort by expertise score
                    rankings.sort(key=lambda x: x["expertise_score"], reverse=True)
                    all_rankings[cat] = rankings
                
                return {
                    "success": True,
                    "group_id": group_id,
                    "expertise_rankings": all_rankings,
                    "data_source": "mock"
                }
            
        except Exception as e:
            return {"success": False, "error": f"Failed to get expertise rankings: {str(e)}"}