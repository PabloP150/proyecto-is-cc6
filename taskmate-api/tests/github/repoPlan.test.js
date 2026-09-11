const { sanitizePlan, planToText, localToday } = require('../../services/github/repoPlan');

const TODAY = '2026-09-11';
const valid = () => ({
    summary: 'Resumen <b>corto</b>',
    milestones: [{ key: 'm1', name: 'MVP', description: 'Primera versión', target_date: '2026-10-01' }],
    tasks: [
        { name: 'Login page', description: 'Form', milestone_key: 'm1', due_date: '2026-09-20', category: 'frontend' },
        { name: 'API auth', description: 'JWT', milestone_key: null, due_date: '2026-09-25', category: 'backend' },
    ],
});

test('keeps a valid plan and strips markup', () => {
    const plan = sanitizePlan(valid(), { today: TODAY });
    expect(plan.summary).toBe('Resumen corto');
    expect(plan.milestones).toEqual([{ key: 'm1', name: 'MVP', description: 'Primera versión', target_date: '2026-10-01' }]);
    expect(plan.tasks).toHaveLength(2);
});

test('enforces counts (12 tasks, 5 milestones) and lengths', () => {
    const raw = {
        summary: 'x'.repeat(2000),
        milestones: Array.from({ length: 9 }, (_, i) => ({ key: `m${i}`, name: `Milestone ${i}`, target_date: '2026-12-01' })),
        tasks: Array.from({ length: 30 }, (_, i) => ({ name: `Task ${i} ${'y'.repeat(40)}`, description: 'd'.repeat(3000), due_date: '2026-12-01', category: 'testing' })),
    };
    const plan = sanitizePlan(raw, { today: TODAY });
    expect(plan.summary).toHaveLength(600);
    expect(plan.milestones).toHaveLength(5);
    expect(plan.tasks).toHaveLength(12);
    plan.tasks.forEach((t) => {
        expect(t.name.length).toBeLessThanOrEqual(25);
        expect(t.description.length).toBeLessThanOrEqual(1000);
    });
});

test('dates: invalid → dropped, past → today', () => {
    const raw = valid();
    raw.tasks[0].due_date = '2026-02-30';
    raw.tasks[1].due_date = '2020-01-01';
    raw.milestones[0].target_date = '01/10/2026';
    const plan = sanitizePlan(raw, { today: TODAY });
    expect(plan.milestones).toEqual([]);
    expect(plan.tasks).toEqual([expect.objectContaining({ name: 'API auth', due_date: TODAY, milestone_key: null })]);
});

test('unknown category → general; unknown milestone_key → null', () => {
    const raw = valid();
    raw.tasks[0].category = 'devops';
    raw.tasks[0].milestone_key = 'zzz';
    const plan = sanitizePlan(raw, { today: TODAY });
    expect(plan.tasks[0]).toMatchObject({ category: 'general', milestone_key: null });
});

test('dedupes against existing task names (case/accent-insensitive) and within the plan', () => {
    const raw = valid();
    raw.tasks.push({ name: 'login PAGE', due_date: '2026-09-30', category: 'frontend' });
    raw.tasks.push({ name: 'Añadir tests', due_date: '2026-09-30', category: 'testing' });
    const plan = sanitizePlan(raw, { today: TODAY, existingTaskNames: ['API AUTH', 'Anadir tests'] });
    expect(plan.tasks.map((t) => t.name)).toEqual(['Login page']);
});

test('nothing usable → LLM_INVALID_OUTPUT', () => {
    expect(() => sanitizePlan(null)).toThrow(expect.objectContaining({ code: 'LLM_INVALID_OUTPUT' }));
    expect(() => sanitizePlan({ tasks: [{ name: '' }] }, { today: TODAY })).toThrow(expect.objectContaining({ code: 'LLM_INVALID_OUTPUT' }));
    expect(() => sanitizePlan([], { today: TODAY })).toThrow(expect.objectContaining({ code: 'LLM_INVALID_OUTPUT' }));
});

test('planToText is plain text', () => {
    const text = planToText(sanitizePlan(valid(), { today: TODAY }), 'Mi proyecto');
    expect(text).toContain('Plan propuesto para "Mi proyecto"');
    expect(text).toContain('- Login page [frontend] - 2026-09-20');
    expect(text).not.toMatch(/[<>*#]/);
});

test('localToday formats YYYY-MM-DD in local time', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
});
