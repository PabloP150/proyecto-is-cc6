const LLMService = require('../services/LLMService');
const axios = require('axios');

// Mock axios
jest.mock('axios');
const mockedAxios = axios;

describe('LLMService', () => {
  let llmService;
  let originalEnv;

  beforeEach(() => {
    // Store original environment
    originalEnv = process.env;
    
    // Set up test environment
    process.env = {
      ...originalEnv,
      LLM_API_KEY: 'test-api-key',
      LLM_BASE_URL: 'https://api.openai.com/v1',
      LLM_MODEL: 'gpt-3.5-turbo',
      LLM_MAX_TOKENS: '500',
      LLM_TEMPERATURE: '0.5'
    };

    // Mock axios.create
    mockedAxios.create = jest.fn(() => ({
      post: jest.fn()
    }));

    llmService = new LLMService();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with environment variables', () => {
      expect(llmService.apiKey).toBe('test-api-key');
      expect(llmService.baseUrl).toBe('https://api.openai.com/v1');
      expect(llmService.model).toBe('gpt-3.5-turbo');
      expect(llmService.maxTokens).toBe(500);
      expect(llmService.temperature).toBe(0.5);
    });

    it('should use default values when environment variables are not set', () => {
      delete process.env.LLM_BASE_URL;
      delete process.env.LLM_MODEL;
      delete process.env.LLM_MAX_TOKENS;
      delete process.env.LLM_TEMPERATURE;

      const service = new LLMService();
      expect(service.baseUrl).toBe('https://api.openai.com/v1');
      expect(service.model).toBe('gpt-3.5-turbo');
      expect(service.maxTokens).toBe(1000);
      expect(service.temperature).toBe(0.7);
    });

    it('should warn when API key is not configured', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      delete process.env.LLM_API_KEY;

      new LLMService();
      expect(consoleSpy).toHaveBeenCalledWith('LLM_API_KEY not configured. LLM service will use fallback responses.');
      
      consoleSpy.mockRestore();
    });
  });

  describe('generateResponse', () => {
    it('should generate response successfully', async () => {
      const mockResponse = {
        data: {
          choices: [{
            message: {
              content: 'This is a test response from the AI.'
            }
          }]
        }
      };

      llmService.httpClient.post.mockResolvedValue(mockResponse);

      const result = await llmService.generateResponse('Hello, AI!');
      expect(result).toBe('This is a test response from the AI.');
      expect(llmService.httpClient.post).toHaveBeenCalledWith('/chat/completions', expect.any(Object));
    });

    it('should include user context in system prompt', async () => {
      const mockResponse = {
        data: {
          choices: [{
            message: {
              content: 'Response with context'
            }
          }]
        }
      };

      const context = {
        tasks: [
          { title: 'Complete project', description: 'Finish the TaskMate app', completed: false },
          { title: 'Review code', completed: true }
        ],
        groups: [
          { name: 'Development Team', description: 'Main dev group' }
        ]
      };

      llmService.httpClient.post.mockResolvedValue(mockResponse);

      await llmService.generateResponse('What are my tasks?', context);

      const callArgs = llmService.httpClient.post.mock.calls[0][1];
      const systemMessage = callArgs.messages[0].content;
      
      expect(systemMessage).toContain('Complete project');
      expect(systemMessage).toContain('Review code');
      expect(systemMessage).toContain('Development Team');
    });

    it('should return fallback response when API key is missing', async () => {
      delete process.env.LLM_API_KEY;
      const serviceWithoutKey = new LLMService();

      const result = await serviceWithoutKey.generateResponse('Help me with tasks');
      expect(result).toContain('tasks');
      expect(result).toContain('TaskMate');
    });

    it('should handle API errors gracefully', async () => {
      const error = new Error('API Error');
      error.response = { status: 500 };
      
      llmService.httpClient.post.mockRejectedValue(error);

      const result = await llmService.generateResponse('Hello');
      expect(result).toContain('temporarily unavailable');
    });

    it('should handle timeout errors', async () => {
      const error = new Error('Timeout');
      error.code = 'ETIMEDOUT';
      
      llmService.httpClient.post.mockRejectedValue(error);

      const result = await llmService.generateResponse('Hello');
      expect(result).toContain('delays');
    });

    it('should handle authentication errors', async () => {
      const error = new Error('Unauthorized');
      error.response = { status: 401 };
      
      llmService.httpClient.post.mockRejectedValue(error);

      const result = await llmService.generateResponse('Hello');
      expect(result).toContain('trouble connecting');
    });

    it('should handle rate limiting errors', async () => {
      const error = new Error('Rate Limited');
      error.response = { status: 429 };
      
      llmService.httpClient.post.mockRejectedValue(error);

      const result = await llmService.generateResponse('Hello');
      expect(result).toContain('lot of requests');
    });

    it('should handle invalid response format', async () => {
      const mockResponse = {
        data: {
          choices: []
        }
      };

      llmService.httpClient.post.mockResolvedValue(mockResponse);

      const result = await llmService.generateResponse('Hello');
      expect(result).toContain('unable to process');
    });
  });

  describe('_buildSystemPrompt', () => {
    it('should build basic system prompt without context', () => {
      const prompt = llmService._buildSystemPrompt({});
      expect(prompt).toContain('TaskMate');
      expect(prompt).toContain('task management');
    });

    it('should include tasks in system prompt', () => {
      const context = {
        tasks: [
          { title: 'Task 1', description: 'Description 1', completed: false },
          { title: 'Task 2', completed: true }
        ]
      };

      const prompt = llmService._buildSystemPrompt(context);
      expect(prompt).toContain('Task 1');
      expect(prompt).toContain('Task 2');
      expect(prompt).toContain('(completed)');
    });

    it('should include groups in system prompt', () => {
      const context = {
        groups: [
          { name: 'Group 1', description: 'Description 1' },
          { name: 'Group 2' }
        ]
      };

      const prompt = llmService._buildSystemPrompt(context);
      expect(prompt).toContain('Group 1');
      expect(prompt).toContain('Group 2');
    });
  });

  describe('_buildRequestPayload', () => {
    it('should build correct request payload', () => {
      const systemPrompt = 'System prompt';
      const userMessage = 'User message';

      const payload = llmService._buildRequestPayload(systemPrompt, userMessage);

      expect(payload).toEqual({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        max_tokens: 500,
        temperature: 0.5,
        stream: false
      });
    });
  });

  describe('_getFallbackResponse', () => {
    it('should provide task-related fallback for task queries', () => {
      const response = llmService._getFallbackResponse('How do I manage my tasks?');
      expect(response).toContain('tasks');
      expect(response).toContain('TaskMate');
    });

    it('should provide group-related fallback for group queries', () => {
      const response = llmService._getFallbackResponse('Tell me about groups');
      expect(response).toContain('Groups');
      expect(response).toContain('collaborate');
    });

    it('should provide help fallback for help queries', () => {
      const response = llmService._getFallbackResponse('I need help');
      expect(response).toContain('help');
      expect(response).toContain('TaskMate');
    });

    it('should provide generic fallback for other queries', () => {
      const response = llmService._getFallbackResponse('Random question');
      expect(response).toContain('unable to process');
    });
  });

  describe('testConnection', () => {
    it('should return true for successful connection', async () => {
      const mockResponse = {
        data: {
          choices: [{
            message: {
              content: 'Test response'
            }
          }]
        }
      };

      llmService.httpClient.post.mockResolvedValue(mockResponse);

      const result = await llmService.testConnection();
      expect(result).toBe(true);
    });

    it('should return false when API key is missing', async () => {
      delete process.env.LLM_API_KEY;
      const serviceWithoutKey = new LLMService();

      const result = await serviceWithoutKey.testConnection();
      expect(result).toBe(false);
    });

    it('should return false on connection error', async () => {
      llmService.httpClient.post.mockRejectedValue(new Error('Connection failed'));

      const result = await llmService.testConnection();
      expect(result).toBe(false);
    });
  });
});