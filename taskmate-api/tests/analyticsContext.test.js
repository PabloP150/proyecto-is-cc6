jest.mock('../helpers/execQuery');

const { execReadCommand } = require('../helpers/execQuery');
const { buildTeamContext, expertiseScore, GROUP_CAPACITY_SQL } = require('../services/analyticsContext');

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

describe('GROUP_CAPACITY_SQL (capacity inside one group)', () => {
    it('only reads this group\'s facts, on both sides of the concurrency count', () => {
        expect(GROUP_CAPACITY_SQL).not.toMatch(/UserMetrics/);
        expect(GROUP_CAPACITY_SQL).toMatch(/FROM dbo\.TaskAnalytics f\s+CROSS APPLY/);
        expect(GROUP_CAPACITY_SQL).toMatch(/WHERE f\.gid = @gid\s+GROUP BY f\.uid/);
        expect(GROUP_CAPACITY_SQL).toMatch(/FROM dbo\.TaskAnalytics x\s+WHERE x\.gid = @gid AND x\.uid = f\.uid/);
        // open at the moment f was assigned
        expect(GROUP_CAPACITY_SQL).toMatch(/x\.assigned_at <= f\.assigned_at/);
        expect(GROUP_CAPACITY_SQL).toMatch(/x\.completed_at IS NULL OR x\.completed_at > f\.assigned_at/);
    });
});

describe('buildTeamContext', () => {
    beforeEach(() => jest.clearAllMocks());

    it('takes historical_capacity from this group (3 without history), not from UserMetrics', async () => {
        execReadCommand
            .mockResolvedValueOnce([
                { uid: 'U-1', username: 'ana', current_workload: 1, historical_capacity: 2 },
                { uid: 'u-2', username: 'beto', current_workload: 0, historical_capacity: null },
            ])
            .mockResolvedValueOnce([]);

        const { team_members: [ana, beto] } = await buildTeamContext('group-1');

        expect(ana).toEqual(expect.objectContaining({ uid: 'U-1', current_workload: 1, historical_capacity: 2 }));
        expect(beto).toEqual(expect.objectContaining({ current_workload: 0, historical_capacity: 3 }));
        const [membersSql, params] = execReadCommand.mock.calls[0];
        expect(membersSql).not.toMatch(/UserMetrics/);
        expect(membersSql).toContain(GROUP_CAPACITY_SQL);
        expect(membersSql).toMatch(/\) cap ON cap\.uid = u\.uid/);
        expect(params).toEqual([expect.objectContaining({ name: 'gid', value: 'group-1' })]);
    });
});
