class RecommendationsAgent {
  handle(payload) {
    console.log('RecommendationsAgent handling payload:', payload);
    // Hard-coded structured response
    const idea = payload.idea || 'New Project';
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfterTomorrow = new Date(today);
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

    return {
      recommendations: {
        project_name: `Plan for: ${idea}`,
        project_description: `A detailed plan for ${idea}.`,
        tasks: [
          {
            name: 'Define Scope',
            description: 'Clearly define the boundaries and objectives of the project.',
            due_date: tomorrow.toISOString(),
            status: 'To Do',
          },
          {
            name: 'Gather Resources',
            description: 'Identify and acquire all necessary tools, materials, and information.',
            due_date: dayAfterTomorrow.toISOString(),
            status: 'To Do',
          },
          {
            name: 'Execute First Phase',
            description: 'Begin work on the initial set of tasks.',
            due_date: new Date(dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 7)).toISOString(),
            status: 'To Do',
          },
        ],
        milestones: [
          {
            name: 'Project Kick-off',
            description: 'Official start of the project.',
            date: today.toISOString().split('T')[0],
          },
          {
            name: 'Phase 1 Completion',
            description: 'Successful completion of the first major set of deliverables.',
            date: new Date(today.setDate(today.getDate() + 14)).toISOString().split('T')[0],
          },
        ],
      },
    };
  }
}

module.exports = new RecommendationsAgent();
