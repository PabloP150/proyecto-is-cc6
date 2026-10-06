import { render, screen } from '@testing-library/react';
import BranchToastMessage, {
  BRANCH_TOAST_MS,
  branchesNotice,
  branchNotice,
  withBranchNotice,
} from '../BranchToastMessage';

const NAME = 'tm/escribir-informe-1a2b3c4d';
const URL = `https://github.com/acme/app/tree/${NAME}`;
const SCRIPT_URL = ['javascript', 'alert(1)'].join(':');
const branch = (outcome, extra = {}) => ({ name: NAME, outcome, url: URL, ...extra });

describe('branchNotice', () => {
  it.each([
    ['deleted', 'success', `Rama ${NAME} eliminada en GitHub.`],
    ['kept_unmerged', 'info', `La rama ${NAME} sigue en GitHub: tiene commits sin fusionar.`],
    ['kept_open_pr', 'info', `La rama ${NAME} sigue en GitHub: tiene un PR abierto.`],
    // Also a check still running when the server answered: it may delete the branch afterwards.
    ['error', 'warning', `No se pudo confirmar qué pasó con la rama ${NAME} en GitHub; puede que siga ahí.`],
  ])('%s → %s: %s', (outcome, severity, text) => {
    expect(branchNotice(branch(outcome))).toEqual(expect.objectContaining({ severity, text }));
  });

  it('links to the branch only while it is still on GitHub', () => {
    expect(branchNotice(branch('kept_unmerged')).url).toBe(URL);
    expect(branchNotice(branch('kept_open_pr')).url).toBe(URL);
    expect(branchNotice(branch('error')).url).toBe(URL);
    expect(branchNotice(branch('deleted')).url).toBeNull();
  });

  it('never links outside https://github.com', () => {
    expect(branchNotice(branch('kept_unmerged', { url: SCRIPT_URL })).url).toBeNull();
    expect(branchNotice(branch('kept_unmerged', { url: 'https://evil.example/tree/x' })).url).toBeNull();
    expect(branchNotice(branch('kept_unmerged', { url: null })).url).toBeNull();
  });

  it.each([
    ['no branch', undefined],
    ['null', null],
    ['missing', branch('missing', { url: null })],
    ['skipped', branch('skipped')],
    ['an outcome this UI does not know', branch('archived')],
    ['an inherited property name as outcome', branch('toString')],
    ['a branch without a name', { outcome: 'deleted', url: null }],
  ])('says nothing for %s', (label, value) => {
    expect(branchNotice(value)).toBeNull();
  });
});

describe('branchesNotice (list deletion)', () => {
  const named = (name, outcome) => ({ name, outcome, url: outcome === 'deleted' ? null : `https://github.com/acme/app/tree/${name}` });

  it('summarizes deleted and kept branches', () => {
    expect(branchesNotice([named('tm/a', 'deleted'), named('tm/b', 'deleted'), named('tm/c', 'kept_unmerged')])).toEqual({
      severity: 'info',
      text: '2 ramas eliminadas en GitHub; 1 sigue (commits sin fusionar).',
      url: 'https://github.com/acme/app/tree/tm/c',
    });
  });

  it('is a success when every branch was deleted', () => {
    expect(branchesNotice([named('tm/a', 'deleted'), named('tm/b', 'deleted'), named('tm/c', 'deleted')])).toEqual({
      severity: 'success',
      text: '3 ramas eliminadas en GitHub.',
      url: null,
    });
  });

  it('counts each reason when the kept branches differ, and links none of several', () => {
    expect(branchesNotice([named('tm/a', 'kept_unmerged'), named('tm/b', 'kept_open_pr')])).toEqual({
      severity: 'info',
      text: '2 ramas siguen en GitHub (1 con commits sin fusionar, 1 con PR abierto).',
      url: null,
    });
  });

  it('names a shared reason once', () => {
    expect(branchesNotice([named('tm/a', 'kept_open_pr'), named('tm/b', 'kept_open_pr')]).text).toBe(
      '2 ramas siguen en GitHub (PRs abiertos).'
    );
  });

  it('is a warning when any branch could not be checked, and never counts those as still there', () => {
    const notice = branchesNotice([named('tm/a', 'deleted'), named('tm/b', 'kept_unmerged'), named('tm/c', 'error')]);
    expect(notice.severity).toBe('warning');
    expect(notice.text).toBe('1 rama eliminada en GitHub; 1 sigue (commits sin fusionar); 1 sin confirmar.');
    expect(branchesNotice([named('tm/a', 'deleted'), named('tm/b', 'error'), named('tm/c', 'error')]).text).toBe(
      '1 rama eliminada en GitHub; 2 sin confirmar.'
    );
    expect(branchesNotice([named('tm/a', 'kept_open_pr'), named('tm/b', 'error')]).text).toBe(
      '1 rama sigue en GitHub (PR abierto); 1 sin confirmar.'
    );
  });

  it('says it could not confirm when no branch could be checked', () => {
    expect(branchesNotice([named('tm/a', 'error'), named('tm/b', 'error')])).toEqual({
      severity: 'warning',
      text: 'No se pudo confirmar qué pasó con 2 ramas en GitHub; puede que sigan ahí.',
      url: null,
    });
  });

  it('uses the single-branch message, with its name, when only one branch is worth telling', () => {
    expect(branchesNotice([named('tm/a', 'skipped'), named('tm/b', 'kept_unmerged'), named('tm/c', 'missing')])).toEqual({
      severity: 'info',
      text: 'La rama tm/b sigue en GitHub: tiene commits sin fusionar.',
      url: 'https://github.com/acme/app/tree/tm/b',
    });
  });

  it.each([
    ['no branches field', undefined],
    ['an empty list', []],
    ['only missing and skipped branches', [named('tm/a', 'missing'), named('tm/b', 'skipped')]],
  ])('says nothing for %s', (label, value) => {
    expect(branchesNotice(value)).toBeNull();
  });
});

describe('withBranchNotice', () => {
  it('keeps the toast exactly as it was without a notice', () => {
    expect(withBranchNotice('Task deleted', 'info', null)).toEqual({ message: 'Task deleted', severity: 'info', url: null, duration: null });
  });

  it('appends the GitHub sentence, takes its severity and gives it time to be read', () => {
    expect(withBranchNotice('Task deleted', 'info', branchNotice(branch('deleted')))).toEqual({
      message: `Task deleted. Rama ${NAME} eliminada en GitHub.`,
      severity: 'success',
      url: null,
      duration: BRANCH_TOAST_MS,
    });
    expect(withBranchNotice('Task completed', 'success', branchNotice(branch('error')))).toEqual({
      message: `Task completed. No se pudo confirmar qué pasó con la rama ${NAME} en GitHub; puede que siga ahí.`,
      severity: 'warning',
      url: URL,
      duration: BRANCH_TOAST_MS,
    });
  });
});

describe('BranchToastMessage', () => {
  it('adds «Ver rama» opening the branch in a new tab', () => {
    render(<BranchToastMessage message="Task completed." url={URL} />);
    const link = screen.getByRole('link', { name: 'Ver rama' });
    expect(link).toHaveAttribute('href', URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders only the message without a safe url', () => {
    const { container } = render(<BranchToastMessage message="Task completed" url={SCRIPT_URL} />);
    expect(container).toHaveTextContent(/^Task completed$/);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
