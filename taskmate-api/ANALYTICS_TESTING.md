# Analytics Agent Testing Guide

This guide explains how to test the Analytics Agent with mock data before full integration.

## Setup

1. **Database Setup** (Optional for basic testing)
   ```sql
   -- Run the analytics schema migration
   -- Execute: taskmate-api/migrations/001_add_analytics_tables.sql
   
   -- Insert test data
   -- Execute: taskmate-api/test-data/insert_analytics_test_data.sql
   ```

2. **Environment Setup**
   ```bash
   # Make sure you have the Google API key configured
   # In your .env file:
   GOOGLE_API_KEY=your_gemini_api_key_here
   LLM_MODEL=gemini-2.5-flash
   ```

## Testing the Analytics Agent

### 1. Basic Algorithm Testing (No LLM)
```bash
cd taskmate-api
python test-analytics-agent.py
```

This will test:
- Base scoring algorithm with different user profiles
- Workload calculations
- Expertise scoring logic

### 2. Full Agent Testing (With LLM)
The same script will also test:
- LLM-enhanced recommendations
- Hybrid decision making
- Different task categories (frontend, backend, testing, general)

### 3. Expected Test Results

**Test Users:**
- **alice_frontend**: Frontend expert (85% expertise), high workload (4/6 tasks)
- **bob_backend**: Backend expert (90% expertise), moderate workload (2/8 tasks)  
- **charlie_tester**: Testing expert (80% expertise), light workload (1/5 tasks)

**Expected Recommendations:**

For **Frontend Task**:
1. alice_frontend (high expertise, but penalized for workload)
2. charlie_tester (moderate expertise, available capacity)
3. bob_backend (low expertise, but available)

For **Backend Task**:
1. bob_backend (expert + available)
2. charlie_tester (moderate expertise + available)
3. alice_frontend (low expertise + overloaded)

## Understanding the Scoring

### Base Score Calculation:
- **Base**: 50 points
- **Expertise Bonus**: 0-30 points (based on expertise_score)
- **Success Rate Bonus**: 0-20 points (based on success_rate_percentage)
- **Workload Penalty**: 0-20 points (based on current_workload/capacity ratio)

### LLM Enhancement:
- Can adjust base score by ±15 points
- Considers contextual factors
- Provides natural language reasoning
- Identifies development opportunities

## Sample Output

```
Test Case 1: Frontend Task - UI Component
----------------------------------------
Task Category: frontend
Recommendations (3):

  1. alice_frontend
     Score: 78.5 (Base: 75.0)
     Confidence: medium
     Workload: 4/6
     Expertise: 85%
     Reasoning: Strong frontend expertise but currently at high workload. Consider if task is urgent or can wait.
     Development: Opportunity to mentor junior developers while working on this component

  2. charlie_tester
     Score: 72.0 (Base: 70.0)
     Confidence: high
     Workload: 1/5
     Expertise: 65%
     Reasoning: Good availability and solid frontend skills. Great opportunity for skill development.
     Development: Chance to strengthen frontend skills while contributing to UI work

  3. bob_backend
     Score: 45.0 (Base: 42.0)
     Confidence: low
     Workload: 2/8
     Expertise: 30%
     Reasoning: Available capacity but limited frontend experience. Consider for simple UI tasks only.
```

## Debugging

If tests fail:

1. **LLM Issues**: Check your Google API key and internet connection
2. **Import Errors**: Make sure you're running from the taskmate-api directory
3. **JSON Parsing**: The LLM sometimes returns malformed JSON - this is handled with fallbacks

## Next Steps

Once the agent is working well with mock data:

1. Integrate with real database queries
2. Add to MCP orchestrator
3. Create WebSocket endpoints
4. Add analytics recording integration
5. Test with real user data

## Mock Data Details

The test uses realistic analytics data:

- **Workload**: Simulates current active task counts
- **Capacity**: Historical maximum concurrent tasks
- **Expertise**: Category-specific performance scores
- **Success Rates**: Task completion success percentages
- **Completion Times**: Average hours to complete tasks

This data represents different user profiles to test various recommendation scenarios.