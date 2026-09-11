// Field validators for request bodies: each returns the normalized value or throws
// AppError VALIDATION_ERROR (400) with a message the UI can show.
const { AppError } = require('../helpers/errors');

const invalid = (message) => {
    throw new AppError('VALIDATION_ERROR', message, 400);
};

const isMissing = (value) => value === undefined || value === null || value === '';

// NVARCHAR(n) counts UTF-16 code units, which is exactly String#length.
const text = (value, name, { max, required = false, pattern, patternMessage } = {}) => {
    if (isMissing(value) || (required && typeof value === 'string' && !value.trim())) {
        if (required) invalid(`${name} is required`);
        return value === '' ? '' : undefined;
    }
    if (typeof value !== 'string') invalid(`${name} must be text`);
    if (max !== undefined && value.length > max) invalid(`${name} must be at most ${max} characters`);
    if (pattern && !pattern.test(value)) invalid(patternMessage || `${name} has an invalid format`);
    return value;
};

const toNumber = (value) => (typeof value === 'string' && value.trim() !== '' ? Number(value) : value);

const integer = (value, name, { min, max, required = false } = {}) => {
    if (isMissing(value)) {
        if (required) invalid(`${name} is required`);
        return undefined;
    }
    const n = toNumber(value);
    if (!Number.isInteger(n) || n < min || n > max) invalid(`${name} must be an integer between ${min} and ${max}`);
    return n;
};

const number = (value, name, { required = false } = {}) => {
    if (isMissing(value)) {
        if (required) invalid(`${name} is required`);
        return undefined;
    }
    const n = toNumber(value);
    if (typeof n !== 'number' || !Number.isFinite(n)) invalid(`${name} must be a number`);
    return n;
};

const BITS = new Map([[true, true], [false, false], [1, true], [0, false], ['1', true], ['0', false], ['true', true], ['false', false]]);

const bit = (value, name, { required = false } = {}) => {
    if (isMissing(value)) {
        if (required) invalid(`${name} is required`);
        return undefined;
    }
    if (!BITS.has(value)) invalid(`${name} must be true/false or 1/0`);
    return BITS.get(value);
};

// Local date or date-time as the UI sends it: YYYY-MM-DD, optionally followed by THH:mm[:ss].
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?)?$/;
const MIN_DATE = new Date(1900, 0, 1);

const dateTime = (value, name, { required = false, max } = {}) => {
    if (isMissing(value)) {
        if (required) invalid(`${name} is required`);
        return undefined;
    }
    const match = typeof value === 'string' && value.match(DATE_RE);
    if (!match) invalid(`${name} must be a date like YYYY-MM-DD or YYYY-MM-DDTHH:mm`);
    const [y, mo, d, h = 0, mi = 0, s = 0] = match.slice(1).map((part) => (part === undefined ? undefined : Number(part)));
    const date = new Date(y, mo - 1, d, h, mi, s);
    const exists = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && h < 24 && mi < 60 && s < 60;
    if (!exists || date < MIN_DATE || (max && date > max)) invalid(`${name} is not a valid date`);
    return value;
};

module.exports = { text, integer, number, bit, dateTime };
