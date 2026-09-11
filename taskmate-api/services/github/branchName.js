const { AppError } = require('../../helpers/errors');

const BRANCH_PREFIX = 'tm/';
const MAX_SLUG_LENGTH = 40;
const FALLBACK_SLUG = 'task';
const MAX_REF_LENGTH = 255;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const slugify = (text) => {
    const slug = String(text ?? '')
        .normalize('NFKD')
        .replace(/\p{M}+/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MAX_SLUG_LENGTH)
        .replace(/-+$/g, '');
    return slug || FALLBACK_SLUG;
};

// Rules from `git check-ref-format` (applied to the branch part, i.e. refs/heads/<name>).
const isValidBranchName = (name) => {
    if (typeof name !== 'string' || !name || name.length > MAX_REF_LENGTH) return false;
    if (name === '@' || name.includes('@{')) return false;
    if (/[\x00-\x20\x7f~^:?*[\\]/.test(name)) return false;
    if (name.includes('..') || name.includes('//')) return false;
    if (name.startsWith('/') || name.endsWith('/') || name.endsWith('.')) return false;
    return name.split('/').every((part) => part && !part.startsWith('.') && !part.endsWith('.lock'));
};

const buildBranchName = (taskName, tid) => {
    if (typeof tid !== 'string' || !UUID_RE.test(tid)) {
        throw new AppError('VALIDATION_ERROR', 'tid must be a valid UUID', 400);
    }
    const name = `${BRANCH_PREFIX}${slugify(taskName)}-${tid.slice(0, 8).toLowerCase()}`;
    if (!isValidBranchName(name)) {
        throw new AppError('VALIDATION_ERROR', 'Could not build a valid branch name', 400);
    }
    return name;
};

module.exports = { slugify, isValidBranchName, buildBranchName, BRANCH_PREFIX, MAX_SLUG_LENGTH };
