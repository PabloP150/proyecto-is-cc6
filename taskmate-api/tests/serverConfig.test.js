jest.mock('../services/LLMService', () => ({ on: jest.fn(), removeListener: jest.fn(), send: jest.fn() }));
jest.mock('../services/WebSocketServer', () => jest.fn().mockImplementation(() => ({ close: jest.fn() })));

const { webhookRetentionDays, assertStrongJwtSecret } = require('../server');

describe('server configuration', () => {
    test.each([
        [undefined, 90],
        ['', 90],
        ['abc', 90],
        ['7', 90],
        ['29', 90],
        ['30', 30],
        ['180', 180],
        ['45.5', 90],
    ])('WEBHOOK_DELIVERY_RETENTION_DAYS=%p → %p days', (value, expected) => {
        expect(webhookRetentionDays(value)).toBe(expected);
    });

    test('JWT secrets must be long and not placeholders', () => {
        expect(() => assertStrongJwtSecret('short')).toThrow();
        expect(() => assertStrongJwtSecret('change-me-to-a-long-random-string-please')).toThrow();
        expect(() => assertStrongJwtSecret('3f9c1a7e5b2d4c6e8a0b1c2d3e4f5a6b')).not.toThrow();
    });
});
