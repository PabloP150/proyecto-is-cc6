/**
 * Example usage of the LLMService
 * This file demonstrates how to use the LLM service in your application
 */

require('dotenv').config();
const LLMService = require('../services/LLMService');

async function demonstrateLLMService() {
  console.log('=== LLM Service Demonstration ===\n');
  
  const llmService = new LLMService();
  
  // Test connection
  console.log('1. Testing connection...');
  const isConnected = await llmService.testConnection();
  console.log(`Connection status: ${isConnected ? 'Connected' : 'Failed/Fallback mode'}\n`);
  
  // Example 1: Basic message without context
  console.log('2. Basic message without context:');
  const basicResponse = await llmService.generateResponse('Hello! Can you help me with task management?');
  console.log(`Response: ${basicResponse}\n`);
  
  // Example 2: Message with user context
  console.log('3. Message with user context:');
  const userContext = {
    tasks: [
      { title: 'Complete project proposal', description: 'Write and submit the Q1 project proposal', completed: false },
      { title: 'Review team performance', description: 'Conduct quarterly reviews', completed: true },
      { title: 'Plan sprint meeting', completed: false }
    ],
    groups: [
      { name: 'Development Team', description: 'Main development group' },
      { name: 'Project Managers', description: 'PM coordination group' }
    ]
  };
  
  const contextResponse = await llmService.generateResponse(
    'What should I prioritize from my current tasks?', 
    userContext
  );
  console.log(`Response: ${contextResponse}\n`);
  
  // Example 3: Error handling demonstration
  console.log('4. Error handling (simulated):');
  // This would normally be handled internally, but shows fallback behavior
  const fallbackResponse = llmService._getFallbackResponse('How do I create a new task?');
  console.log(`Fallback response: ${fallbackResponse}\n`);
  
  console.log('=== Demonstration Complete ===');
}

// Run the demonstration
if (require.main === module) {
  demonstrateLLMService().catch(console.error);
}

module.exports = { demonstrateLLMService };