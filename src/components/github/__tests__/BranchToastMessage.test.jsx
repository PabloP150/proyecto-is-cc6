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
    ['deleted', 'success', `Branch ${NAME} deleted on GitHub.`],
    ['kept_unmerged', 'info', `Branch ${NAME} is still on GitHub: it has unmerged commits.`],
    ['kept_open_pr', 'info', `Branch ${NAME} is still on GitHub: it has an open PR.`],
    // Also a check still running when the server answered: it may delete the branch afterwards.
    ['error', 'warning', `Could not confirm what happened to branch ${NAME} on GitHub; it may still be there.`],
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
      text: '2 branches deleted on GitHub; 1 remains (unmerged commits).',
      url: 'https://github.com/acme/app/tree/tm/c',
    });
  });

  it('is a success when every branch was deleted', () => {
    expect(branchesNotice([named('tm/a', 'deleted'), named('tm/b', 'deleted'), named('tm/c', 'deleted')])).toEqual({
      severity: 'success',
      text: '3 branches deleted on GitHub.',
      url: null,
    });
  });

  it('counts each reason when the kept branches differ, and links none of several', () => {
    expect(branchesNotice([named('tm/a', 'kept_unmerged'), named('tm/b', 'kept_open_pr')])).toEqual({
      severity: 'info',
      text: '2 branches remain on GitHub (1 with unmerged commits, 1 with an open PR).',
      url: null,
    });
  });

  it('names a shared reason once', () => {
    expect(branchesNotice([named('tm/a', 'kept_open_pr'), named('tm/b', 'kept_open_pr')]).text).toBe(
      '2 branches remain on GitHub (open PRs).'
    );
  });

  it('is a warning when any branch could not be checked, and never counts those as still there', () => {
    const notice = branchesNotice([named('tm/a', 'deleted'), named('tm/b', 'kept_unmerged'), named('tm/c', 'error')]);
    expect(notice.severity).toBe('warning');
    expect(notice.text).toBe('1 branch deleted on GitHub; 1 remains (unmerged commits); 1 unconfirmed.');
    expect(branchesNotice([named('tm/a', 'deleted'), named('tm/b', 'error'), named('tm/c', 'error')]).text).toBe(
      '1 branch deleted on GitHub; 2 unconfirmed.'
    );
    expect(branchesNotice([named('tm/a', 'kept_open_pr'), named('tm/b', 'error')]).text).toBe(
      '1 branch remains on GitHub (open PR); 1 unconfirmed.'
    );
  });

  it('says it could not confirm when no branch could be checked', () => {
    expect(branchesNotice([named('tm/a', 'error'), named('tm/b', 'error')])).toEqual({
      severity: 'warning',
      text: 'Could not confirm what happened to 2 branches on GitHub; they may still be there.',
      url: null,
    });
  });

  it('uses the single-branch message, with its name, when only one branch is worth telling', () => {
    expect(branchesNotice([named('tm/a', 'skipped'), named('tm/b', 'kept_unmerged'), named('tm/c', 'missing')])).toEqual({
      severity: 'info',
      text: 'Branch tm/b is still on GitHub: it has unmerged commits.',
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
      message: `Task deleted. Branch ${NAME} deleted on GitHub.`,
      severity: 'success',
      url: null,
      duration: BRANCH_TOAST_MS,
    });
    expect(withBranchNotice('Task completed', 'success', branchNotice(branch('error')))).toEqual({
      message: `Task completed. Could not confirm what happened to branch ${NAME} on GitHub; it may still be there.`,
      severity: 'warning',
      url: URL,
      duration: BRANCH_TOAST_MS,
    });
  });
});

describe('BranchToastMessage', () => {
  it('adds «View branch» opening the branch in a new tab', () => {
    render(<BranchToastMessage message="Task completed." url={URL} />);
    const link = screen.getByRole('link', { name: 'View branch' });
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
