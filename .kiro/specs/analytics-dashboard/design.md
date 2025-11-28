# Analytics Dashboard Design Document

## Overview

The Analytics Dashboard will be integrated as a new page within the existing TaskMate application, providing intuitive visualizations of team performance data and intelligent task assignment recommendations. The design focuses on simplicity and clarity, presenting complex analytics in an easily digestible format while maintaining consistency with the existing UI.

## Integration with Existing App

### Navigation Integration
- Add "Analytics" tab to the existing main navigation
- Use existing authentication and session management
- Maintain consistent styling with current TaskMate UI theme
- Reuse existing components where possible (buttons, modals, forms)

### Data Integration
- Leverage existing user authentication and group membership
- Use existing WebSocket connections if available
- Integrate with current task management data
- Respect existing permission system for data access

### UI Consistency
- Follow existing design patterns and component library
- Use same color scheme and typography
- Maintain responsive design patterns already established
- Reuse existing loading states and error handling patterns

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│           TaskMate React App            │    │   Express API   │    │   SQL Server    │
│                                         │    │                 │    │                 │
│ Existing Pages:                         │    │ Existing:       │    │ Existing:       │
│ - Dashboard                             │    │ - Task Routes   │    │ - Users         │
│ - Tasks                                 │◄──►│ - User Routes   │◄──►│ - Tasks         │
│ - Groups                                │    │ - Group Routes  │    │ - Groups        │
│                                         │    │                 │    │                 │
│ NEW Analytics Pages:                    │    │ NEW:            │    │ NEW:            │
│ - Analytics Dashboard                   │    │ - Analytics     │    │ - TaskAnalytics │
│ - Task Recommendations                  │    │   Endpoints     │    │ - UserMetrics   │
│ - Team Performance                      │    │ - LLM Agent     │    │ - UserExpertise │
│ - Individual Analytics                  │    │   Integration   │    │                 │
└─────────────────────────────────────────┘    └─────────────────┘    └─────────────────┘
```

### Component Architecture Integration

```
taskmate-frontend/src/
├── components/
│   ├── existing/
│   │   ├── Dashboard/
│   │   ├── Tasks/
│   │   ├── Groups/
│   │   └── shared/
│   └── analytics/          # NEW ANALYTICS COMPONENTS
│       ├── Dashboard/
│       │   ├── MetricsCards.jsx
│       │   ├── WorkloadChart.jsx
│       │   └── TeamStatusGrid.jsx
│       ├── Recommendations/
│       │   ├── TaskInputForm.jsx
│       │   ├── RecommendationCard.jsx
│       │   └── RecommendationsList.jsx
│       ├── Team/
│       │   ├── TeamMemberCard.jsx
│       │   └── SkillRadarChart.jsx
│       └── Individual/
│           ├── PersonalDashboard.jsx
│           ├── SkillProgressChart.jsx
│           └── TaskHistoryList.jsx
├── pages/
│   ├── existing pages...
│   └── analytics/          # NEW ANALYTICS PAGES
│       ├── AnalyticsDashboard.jsx
│       ├── TaskRecommendations.jsx
│       ├── TeamPerformance.jsx
│       └── IndividualAnalytics.jsx
├── hooks/
│   ├── existing hooks...
│   ├── useAnalytics.js     # NEW
│   ├── useRecommendations.js # NEW
│   └── useWebSocket.js     # NEW (if not existing)
└── services/
    ├── existing services...
    └── analyticsAPI.js     # NEW
```

## Components and Interfaces

### 1. Main Dashboard Component

**Purpose:** Display overview metrics and team status
**Route:** `/analytics` (integrated into existing routing)

#### MetricsCards Component
```jsx
const MetricsCards = ({ metrics }) => {
  return (
    <div className="metrics-grid">
      <MetricCard 
        title="Active Tasks" 
        value={metrics.activeTasks} 
        icon="tasks"
        color="blue" 
      />
      <MetricCard 
        title="Team Utilization" 
        value={`${metrics.utilization}%`} 
        icon="users"
        color="green" 
      />
      <MetricCard 
        title="Success Rate" 
        value={`${metrics.successRate}%`} 
        icon="check"
        color="purple" 
      />
      <MetricCard 
        title="Avg Completion" 
        value={`${metrics.avgCompletion}h`} 
        icon="clock"
        color="orange" 
      />
    </div>
  );
};
```

#### WorkloadChart Component
```jsx
const WorkloadChart = ({ teamData }) => {
  const chartData = teamData.map(member => ({
    name: member.username,
    current: member.workload,
    capacity: member.capacity,
    status: getStatusColor(member.workload, member.capacity)
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={chartData}>
        <XAxis dataKey="name" />
        <YAxis />
        <Bar dataKey="current" fill="#3B82F6" />
        <Bar dataKey="capacity" fill="#E5E7EB" />
      </BarChart>
    </ResponsiveContainer>
  );
};
```

### 2. Task Recommendations Component

**Purpose:** Provide intelligent task assignment suggestions
**Route:** `/analytics/recommendations` (new tab/section within analytics)

#### TaskInputForm Component
```jsx
const TaskInputForm = ({ onSubmit, loading }) => {
  const [formData, setFormData] = useState({
    category: 'general',
    description: '',
    context: ''
  });

  return (
    <form onSubmit={(e) => handleSubmit(e, formData, onSubmit)}>
      <div className="form-group">
        <label>Task Category</label>
        <select 
          value={formData.category}
          onChange={(e) => setFormData({...formData, category: e.target.value})}
        >
          <option value="frontend">Frontend</option>
          <option value="backend">Backend</option>
          <option value="testing">Testing</option>
          <option value="database">Database</option>
          <option value="general">General</option>
        </select>
      </div>
      
      <div className="form-group">
        <label>Task Description</label>
        <textarea 
          value={formData.description}
          onChange={(e) => setFormData({...formData, description: e.target.value})}
          placeholder="Describe the task requirements..."
        />
      </div>
      
      <button type="submit" disabled={loading}>
        {loading ? 'Getting Recommendations...' : 'Get Recommendations'}
      </button>
    </form>
  );
};
```

#### RecommendationCard Component
```jsx
const RecommendationCard = ({ recommendation, rank }) => {
  return (
    <div className="recommendation-card">
      <div className="card-header">
        <span className="rank">#{rank}</span>
        <h3>{recommendation.username}</h3>
        <span className="score">{recommendation.score}/100</span>
      </div>
      
      <div className="card-body">
        <div className="metrics">
          <span>Workload: {recommendation.metrics.workload}/{recommendation.metrics.capacity}</span>
          <span>Expertise: {recommendation.metrics.expertise.expertise_score}%</span>
        </div>
        
        <p className="reasoning">{recommendation.reasoning}</p>
        
        {recommendation.development_opportunity && (
          <div className="development">
            <strong>Development:</strong> {recommendation.development_opportunity}
          </div>
        )}
      </div>
    </div>
  );
};
```

### 3. Team Analytics Component

**Purpose:** Display team member performance and skills
**Route:** `/analytics/team` (new tab/section within analytics)

#### TeamMemberCard Component
```jsx
const TeamMemberCard = ({ member, onClick }) => {
  const statusColor = getStatusColor(member.workload, member.capacity);
  
  return (
    <div className="team-member-card" onClick={() => onClick(member.uid)}>
      <div className="member-header">
        <div className="avatar">{member.username[0].toUpperCase()}</div>
        <div className="member-info">
          <h3>{member.username}</h3>
          <span className={`status ${statusColor}`}>
            {member.workload}/{member.capacity} tasks
          </span>
        </div>
      </div>
      
      <div className="skills-preview">
        <SkillRadarChart 
          data={member.expertise} 
          size="small" 
        />
      </div>
      
      <div className="member-stats">
        <div className="stat">
          <span>Success Rate</span>
          <span>{member.successRate}%</span>
        </div>
        <div className="stat">
          <span>Avg Time</span>
          <span>{member.avgTime}h</span>
        </div>
      </div>
    </div>
  );
};
```

### 4. Individual Analytics Component

**Purpose:** Show personal performance dashboard
**Route:** `/analytics/profile/:userId` (accessible from team view or personal profile)

#### PersonalDashboard Component
```jsx
const PersonalDashboard = ({ userId, isOwnProfile }) => {
  const { data: analytics, loading } = useAnalytics(userId);
  
  if (!isOwnProfile && !hasPermission('view_team_analytics')) {
    return <AccessDenied />;
  }
  
  return (
    <div className="personal-dashboard">
      <div className="profile-header">
        <h1>{analytics.username}'s Analytics</h1>
        <div className="current-status">
          <span className="workload">
            Current Load: {analytics.workload}/{analytics.capacity}
          </span>
        </div>
      </div>
      
      <div className="dashboard-grid">
        <div className="performance-overview">
          <h2>Performance Overview</h2>
          <div className="metrics">
            <div className="metric">
              <span className="value">{analytics.successRate}%</span>
              <span className="label">Success Rate</span>
            </div>
            <div className="metric">
              <span className="value">{analytics.avgCompletionTime}h</span>
              <span className="label">Avg Completion</span>
            </div>
            <div className="metric">
              <span className="value">{analytics.tasksThisMonth}</span>
              <span className="label">Tasks This Month</span>
            </div>
          </div>
        </div>
        
        <div className="skills-section">
          <h2>Skill Levels</h2>
          <SkillProgressChart data={analytics.expertise} />
        </div>
        
        <div className="recent-tasks">
          <h2>Recent Tasks</h2>
          <TaskHistoryList tasks={analytics.recentTasks} />
        </div>
      </div>
    </div>
  );
};
```

## Data Models

### Analytics Data Structure

```typescript
interface TeamMember {
  uid: string;
  username: string;
  workload: number;
  capacity: number;
  expertise: {
    [category: string]: {
      expertise_score: number;
      success_rate_percentage: number;
    };
  };
  successRate: number;
  avgCompletionTime: number;
  status: 'available' | 'moderate' | 'overloaded';
}

interface TaskRecommendation {
  user_id: string;
  username: string;
  score: number;
  base_score: number;
  confidence_level: 'low' | 'medium' | 'high';
  reasoning: string;
  development_opportunity?: string;
  metrics: {
    workload: number;
    capacity: number;
    expertise: {
      expertise_score: number;
      success_rate_percentage: number;
    };
  };
}

interface DashboardMetrics {
  activeTasks: number;
  teamUtilization: number;
  successRate: number;
  avgCompletionTime: number;
  lastUpdated: string;
}
```

## Error Handling

### Error Boundaries
- Wrap each major component in error boundaries
- Display user-friendly error messages
- Log errors for debugging

### API Error Handling
```javascript
const handleAPIError = (error) => {
  if (error.response?.status === 401) {
    // Redirect to login
    window.location.href = '/login';
  } else if (error.response?.status >= 500) {
    // Show server error message
    showNotification('Server error. Please try again later.', 'error');
  } else {
    // Show generic error
    showNotification('Something went wrong. Please try again.', 'error');
  }
};
```

### Loading States
- Show skeleton loaders for charts and data
- Disable form submissions during API calls
- Provide clear feedback for long-running operations

## Testing Strategy

### Unit Tests
- Test individual components with React Testing Library
- Mock API calls and WebSocket connections
- Test chart rendering and data transformations

### Integration Tests
- Test complete user flows (dashboard → recommendations → individual analytics)
- Test real-time updates via WebSocket
- Test error scenarios and recovery

### Performance Tests
- Test with large datasets (100+ team members)
- Measure chart rendering performance
- Test WebSocket connection stability

### Accessibility Tests
- Screen reader compatibility
- Keyboard navigation
- Color contrast compliance
- ARIA labels and descriptions

## Security Considerations

### Data Access Control
- Users can only see their own detailed analytics
- Managers can see team overview data
- Admin users can see all analytics

### API Security
- JWT token validation on all endpoints
- Rate limiting on recommendation requests
- Input validation and sanitization

### Client-Side Security
- No sensitive data stored in localStorage
- Secure WebSocket connections (WSS)
- XSS protection through proper data escaping

This design provides a solid foundation for implementing the analytics dashboard while maintaining simplicity and focusing on the core requirements.