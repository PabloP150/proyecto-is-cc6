const axios = require('axios');

/**
 * LLMService handles communication with external LLM APIs
 * Supports OpenAI, Gemini, and other compatible APIs
 */
class LLMService {
  constructor() {
    this.provider = process.env.LLM_PROVIDER || 'openai';
    this.apiKey = process.env.LLM_API_KEY;
    this.baseUrl = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
    this.model = process.env.LLM_MODEL || 'gpt-3.5-turbo';
    this.maxTokens = parseInt(process.env.LLM_MAX_TOKENS) || 1000;
    this.temperature = parseFloat(process.env.LLM_TEMPERATURE) || 0.7;

    if (!this.apiKey) {
      console.warn('LLM_API_KEY not configured. LLM service will use fallback responses.');
    }

    // Configure HTTP client based on provider
    const headers = { 'Content-Type': 'application/json' };

    if (this.provider === 'gemini') {
      // Gemini uses API key as query parameter, not header
      this.httpClient = axios.create({
        baseURL: this.baseUrl,
        timeout: 30000,
        headers
      });
    } else {
      // OpenAI and compatible APIs use Bearer token
      headers['Authorization'] = `Bearer ${this.apiKey}`;
      this.httpClient = axios.create({
        baseURL: this.baseUrl,
        timeout: 30000,
        headers
      });
    }
  }

  /**
   * Generate a response from the LLM based on user message and context
   * @param {string} message - User's message
   * @param {Object} context - User context including tasks and groups
   * @returns {Promise<string>} - LLM response
   */
  async generateResponse(message, context = {}) {
    try {
      if (!this.apiKey) {
        return this._getFallbackResponse(message);
      }

      const systemPrompt = this._buildSystemPrompt(context);

      if (this.provider === 'gemini') {
        return await this._generateGeminiResponse(systemPrompt, message);
      } else {
        return await this._generateOpenAIResponse(systemPrompt, message);
      }

    } catch (error) {
      console.error('LLM Service Error:', error.message);
      return this._handleError(error, message);
    }
  }

  /**
   * Generate response using Gemini API
   * @param {string} systemPrompt - System prompt with context
   * @param {string} userMessage - User's message
   * @returns {Promise<string>} - LLM response
   */
  async _generateGeminiResponse(systemPrompt, userMessage) {
    const payload = {
      contents: [{
        parts: [{
          text: `${systemPrompt}\n\nUser: ${userMessage}`
        }]
      }],
      generationConfig: {
        temperature: this.temperature,
        maxOutputTokens: this.maxTokens,
      }
    };

    const url = `/models/${this.model}:generateContent?key=${this.apiKey}`;
    const response = await this.httpClient.post(url, payload);

    if (response.data && response.data.candidates && response.data.candidates.length > 0) {
      const candidate = response.data.candidates[0];
      if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
        return candidate.content.parts[0].text.trim();
      }
    }

    throw new Error('Invalid response format from Gemini API');
  }

  /**
   * Generate response using OpenAI-compatible API
   * @param {string} systemPrompt - System prompt with context
   * @param {string} userMessage - User's message
   * @returns {Promise<string>} - LLM response
   */
  async _generateOpenAIResponse(systemPrompt, userMessage) {
    const payload = this._buildOpenAIPayload(systemPrompt, userMessage);
    const response = await this.httpClient.post('/chat/completions', payload);

    if (response.data && response.data.choices && response.data.choices.length > 0) {
      return response.data.choices[0].message.content.trim();
    } else {
      throw new Error('Invalid response format from OpenAI API');
    }
  }

  /**
   * Build system prompt with user context
   * @param {Object} context - User context data
   * @returns {string} - System prompt
   */
  _buildSystemPrompt(context) {
    let prompt = `You are a helpful AI assistant for TaskMate, a task management application. 
You help users with task planning, organization, and productivity advice.

Current user context:`;

    if (context.tasks && context.tasks.length > 0) {
      prompt += `\n\nUser's current tasks:`;
      context.tasks.forEach((task, index) => {
        prompt += `\n${index + 1}. ${task.title}${task.completed ? ' (completed)' : ''}`;
        if (task.description) {
          prompt += ` - ${task.description}`;
        }
      });
    }

    if (context.groups && context.groups.length > 0) {
      prompt += `\n\nUser's groups:`;
      context.groups.forEach((group, index) => {
        prompt += `\n${index + 1}. ${group.name}`;
        if (group.description) {
          prompt += ` - ${group.description}`;
        }
      });
    }

    prompt += `\n\nProvide helpful, concise responses focused on task management and productivity. 
If the user asks about their specific tasks or groups, reference the context provided above.`;

    return prompt;
  }

  /**
   * Build request payload for OpenAI-compatible APIs
   * @param {string} systemPrompt - System prompt with context
   * @param {string} userMessage - User's message
   * @returns {Object} - Request payload
   */
  _buildOpenAIPayload(systemPrompt, userMessage) {
    return {
      model: this.model,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userMessage
        }
      ],
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      stream: false
    };
  }

  /**
   * Handle errors and provide appropriate fallback responses
   * @param {Error} error - The error that occurred
   * @param {string} message - Original user message
   * @returns {string} - Fallback response
   */
  _handleError(error, message) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return "I'm experiencing some delays right now. Please try your question again in a moment.";
    }

    if (error.response) {
      const status = error.response.status;

      if (status === 401) {
        console.error('LLM API authentication failed. Check API key.');
        return "I'm having trouble connecting to my AI service. Please contact support if this continues.";
      }

      if (status === 429) {
        return "I'm currently handling a lot of requests. Please wait a moment and try again.";
      }

      if (status >= 500) {
        return "My AI service is temporarily unavailable. Please try again in a few minutes.";
      }
    }

    return this._getFallbackResponse(message);
  }

  /**
   * Provide contextual fallback responses when LLM is unavailable
   * @param {string} message - User's message
   * @returns {string} - Fallback response
   */
  _getFallbackResponse(message) {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('task') || lowerMessage.includes('todo')) {
      return "I'd be happy to help you with your tasks! You can create, edit, and organize your tasks using the TaskMate interface. Try breaking down large tasks into smaller, manageable steps.";
    }

    if (lowerMessage.includes('group') || lowerMessage.includes('team')) {
      return "Groups in TaskMate help you collaborate with others. You can create groups, invite members, and share tasks to work together more effectively.";
    }

    if (lowerMessage.includes('help') || lowerMessage.includes('how')) {
      return "I'm here to help you with TaskMate! You can ask me about managing tasks, organizing your work, or using different features of the application.";
    }

    return "I apologize, but I'm currently unable to process your request. Please try again later, or use the TaskMate interface to manage your tasks and groups directly.";
  }

  /**
   * Test the LLM service connection
   * @returns {Promise<boolean>} - True if connection is successful
   */
  async testConnection() {
    try {
      if (!this.apiKey) {
        return false;
      }

      if (this.provider === 'gemini') {
        const payload = {
          contents: [{
            parts: [{
              text: "Hello, this is a connection test."
            }]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 10,
          }
        };

        const url = `/models/${this.model}:generateContent?key=${this.apiKey}`;
        const response = await this.httpClient.post(url, payload);
        return response.data && response.data.candidates && response.data.candidates.length > 0;
      } else {
        const payload = this._buildOpenAIPayload(
          "You are a test assistant.",
          "Hello, this is a connection test."
        );

        const response = await this.httpClient.post('/chat/completions', payload);
        return response.data && response.data.choices && response.data.choices.length > 0;
      }
    } catch (error) {
      console.error('LLM connection test failed:', error.message);
      return false;
    }
  }
}

module.exports = LLMService;