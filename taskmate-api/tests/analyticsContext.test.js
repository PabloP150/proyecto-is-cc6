jest.mock('../helpers/execQuery');

const { expertiseScore } = require('../services/analyticsContext');

describe('expertiseScore (same formula as AnalyticsService._updateUserExpertise)', () => {
    test.each([
        [{ finished: 0, successRate: 0, avgHours: 0 }, 0],
        [{ finished: 3, successRate: 100, avgHours: 0 }, 100],
        [{ finished: 2, successRate: 50, avgHours: 4 }, 68],
        [{ finished: 5, successRate: 90, avgHours: 50 }, 90],
        [{ finished: 1, successRate: 0, avgHours: 0 }, 10],
    ])('%p → %p', (stats, expected) => {
        expect(expertiseScore(stats)).toBe(expected);
    });
});
