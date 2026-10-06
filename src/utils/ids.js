// GUIDs come uppercase from SQL Server but lowercase from uuid() (e.g. a freshly created group),
// so ids must always be compared case-insensitively.
export const normalizeId = (id) => (id === undefined || id === null ? '' : String(id).toLowerCase());
export const sameId = (a, b) => normalizeId(a) !== '' && normalizeId(a) === normalizeId(b);
