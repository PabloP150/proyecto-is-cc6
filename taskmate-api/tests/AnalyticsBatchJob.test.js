jest.mock('node-cron', () => ({ schedule: jest.fn(), validate: jest.fn() }));
jest.mock('../services/AnalyticsIntegration', () => ({ runBatchUpdate: jest.fn() }));

const loadJob = (env = {}) => {
    jest.resetModules();
    const saved = { ...process.env };
    Object.assign(process.env, env);
    const cron = require('node-cron');
    const job = require('../services/AnalyticsBatchJob');
    process.env = saved;
    return { cron, job };
};

describe('AnalyticsBatchJob', () => {
    beforeEach(() => {
        delete process.env.ANALYTICS_BATCH_ENABLED;
        delete process.env.ANALYTICS_BATCH_SCHEDULE;
    });

    test('is opt-in: does not schedule unless ANALYTICS_BATCH_ENABLED=true', () => {
        const { cron, job } = loadJob();
        job.start();
        expect(job.enabled).toBe(false);
        expect(cron.schedule).not.toHaveBeenCalled();
    });

    test('schedules with the configured cron expression when enabled', () => {
        const { cron, job } = loadJob({ ANALYTICS_BATCH_ENABLED: 'true', ANALYTICS_BATCH_SCHEDULE: '*/5 * * * *' });
        cron.validate.mockReturnValue(true);
        cron.schedule.mockReturnValue({ stop: jest.fn() });

        job.start();

        expect(cron.schedule).toHaveBeenCalledWith('*/5 * * * *', expect.any(Function), expect.objectContaining({ scheduled: true }));
        expect(job.getStatus()).toMatchObject({ enabled: true, schedule: '*/5 * * * *', nextRun: null });
    });

    test('refuses an invalid schedule', () => {
        const { cron, job } = loadJob({ ANALYTICS_BATCH_ENABLED: 'true', ANALYTICS_BATCH_SCHEDULE: 'not a cron' });
        cron.validate.mockReturnValue(false);
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        job.start();

        expect(cron.schedule).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalled();
    });

    test('runBatchUpdate does not overlap with a run in progress', async () => {
        const { job } = loadJob();
        const integration = require('../services/AnalyticsIntegration');
        let release;
        integration.runBatchUpdate.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        jest.spyOn(console, 'log').mockImplementation(() => {});

        const first = job.runBatchUpdate();
        await job.runBatchUpdate();
        release({ success: true, users_updated: 1, expertise_records_updated: 0 });
        await first;

        expect(integration.runBatchUpdate).toHaveBeenCalledTimes(1);
        expect(job.lastRun.success).toBe(true);
    });
});
