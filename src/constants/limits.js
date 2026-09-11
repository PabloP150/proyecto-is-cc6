// Mirrors the server-side validation (400 VALIDATION_ERROR) so forms stop the input first.
export const LIMITS = Object.freeze({
  taskName: 25,
  listName: 25,
  taskDescription: 1000,
  nodeName: 25,
  roleName: 40,
  chatMessage: 4000,
  analysisInstructions: 500,
});

// Props for a text input capped at `max` characters, with a "n/max" counter as helper text.
export const limitProps = (value, max, helperText) => {
  const length = typeof value === 'string' ? value.length : 0;
  const counter = `${length}/${max}`;
  return {
    inputProps: { maxLength: max },
    helperText: helperText ? `${helperText} · ${counter}` : counter,
  };
};
