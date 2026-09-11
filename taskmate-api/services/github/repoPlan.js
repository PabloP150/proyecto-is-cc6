const { AppError } = require('../../helpers/errors');

const PLAN_LIMITS = Object.freeze({ maxTasks: 12, maxMilestones: 5 });
const CATEGORIES = Object.freeze(['frontend', 'backend', 'database', 'testing', 'general']);
const MAX_NAME = 25;
const MAX_DESCRIPTION = 1000;
const MAX_SUMMARY = 600;
const MAX_KEY = 40;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n) => String(n).padStart(2, '0');
const localToday = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

// Plain text only: no markup, no control characters (newlines allowed in long fields).
const cleanText = (value, max, { multiline = false } = {}) => {
    if (typeof value !== 'string') return '';
    let text = value.replace(/<[^>]*>/g, '').replace(multiline ? /[\x00-\x09\x0b-\x1f\x7f]/g : /[\x00-\x1f\x7f]/g, ' ');
    text = multiline ? text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n') : text.replace(/\s+/g, ' ');
    text = text.trim();
    return text.length > max ? text.slice(0, max).trimEnd() : text;
};

const nameKey = (name) => name.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

const isRealDate = (value) => {
    const match = typeof value === 'string' && value.match(DATE_RE);
    if (!match) return false;
    const [y, m, d] = match.slice(1).map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

// Invalid dates drop the item; past dates are moved to today (string compare works for YYYY-MM-DD).
const normalizeDate = (value, today) => {
    if (!isRealDate(value)) return null;
    return value < today ? today : value;
};

const invalidOutput = () => new AppError('LLM_INVALID_OUTPUT', 'The AI returned an invalid plan', 502);

// Python validates too; Node re-validates because the plan is later written to the DB.
const sanitizePlan = (raw, { today = localToday(), existingTaskNames = [], limits = PLAN_LIMITS } = {}) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalidOutput();
    const rawMilestones = Array.isArray(raw.milestones) ? raw.milestones : [];
    const rawTasks = Array.isArray(raw.tasks) ? raw.tasks : [];

    const milestones = [];
    const milestoneKeys = new Set();
    const milestoneNames = new Set();
    for (const [i, item] of rawMilestones.entries()) {
        if (milestones.length >= limits.maxMilestones) break;
        if (!item || typeof item !== 'object') continue;
        const name = cleanText(item.name, MAX_NAME);
        const targetDate = normalizeDate(item.target_date, today);
        if (!name || !targetDate || milestoneNames.has(nameKey(name))) continue;
        let key = cleanText(item.key === undefined || item.key === null ? '' : String(item.key), MAX_KEY) || `m${i + 1}`;
        if (milestoneKeys.has(key)) key = `${key}-${i + 1}`;
        milestoneKeys.add(key);
        milestoneNames.add(nameKey(name));
        milestones.push({ key, name, description: cleanText(item.description, MAX_DESCRIPTION, { multiline: true }), target_date: targetDate });
    }

    const taken = new Set(existingTaskNames.filter((n) => typeof n === 'string').map(nameKey));
    const tasks = [];
    for (const item of rawTasks) {
        if (tasks.length >= limits.maxTasks) break;
        if (!item || typeof item !== 'object') continue;
        const name = cleanText(item.name, MAX_NAME);
        const dueDate = normalizeDate(item.due_date, today);
        if (!name || !dueDate || taken.has(nameKey(name))) continue;
        taken.add(nameKey(name));
        const milestoneKey = item.milestone_key === undefined || item.milestone_key === null ? null : String(item.milestone_key);
        tasks.push({
            name,
            description: cleanText(item.description, MAX_DESCRIPTION, { multiline: true }),
            milestone_key: milestoneKey !== null && milestoneKeys.has(milestoneKey) ? milestoneKey : null,
            due_date: dueDate,
            category: CATEGORIES.includes(item.category) ? item.category : 'general',
        });
    }

    if (tasks.length === 0 && milestones.length === 0) throw invalidOutput();
    return { summary: cleanText(raw.summary, MAX_SUMMARY, { multiline: true }), milestones, tasks };
};

// Plain-text fallback for clients that cannot render the plan card.
const planToText = (plan, groupName) => {
    const lines = [`Plan propuesto para "${groupName || 'el proyecto'}"`];
    if (plan.summary) lines.push('', plan.summary);
    if (plan.milestones.length) {
        lines.push('', 'Hitos:');
        plan.milestones.forEach((m) => lines.push(`- ${m.name} (${m.target_date})`));
    }
    if (plan.tasks.length) {
        lines.push('', 'Tareas:');
        plan.tasks.forEach((t) => lines.push(`- ${t.name} [${t.category}] - ${t.due_date}`));
    }
    lines.push('', 'Confirma o descarta el plan desde la tarjeta.');
    return lines.join('\n');
};

module.exports = { sanitizePlan, planToText, localToday, PLAN_LIMITS, CATEGORIES };
