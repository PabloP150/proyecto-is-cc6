import { act, render, screen, waitFor } from '@testing-library/react';
import { getRepository, getTaskLinks } from '../../../api/github';
import useTaskLinks from '../useTaskLinks';

jest.mock('../../../api/github', () => ({ getRepository: jest.fn(), getTaskLinks: jest.fn() }));

let latest;
function Probe({ gid }) {
  latest = useTaskLinks(gid);
  return <div data-testid="state">{latest.loading ? 'loading' : latest.repoConnected ? 'connected' : 'none'}</div>;
}

const REPO = { gid: 'G1', fullName: 'acme/app', htmlUrl: 'https://github.com/acme/app', defaultBranch: 'main' };

beforeEach(() => {
  getRepository.mockReset();
  getTaskLinks.mockReset();
  latest = null;
});

describe('useTaskLinks', () => {
  it('loads links once per group and builds GitHub URLs', async () => {
    getRepository.mockResolvedValue(REPO);
    getTaskLinks.mockResolvedValue([
      { tid: 'TASK-A', branchName: 'tm/a-1', pr: { number: 4, state: 'open', isDraft: false } },
      { tid: 'TASK-B', branchName: null, pr: null },
    ]);
    render(<Probe gid="G1" />);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('connected'));

    expect(getRepository).toHaveBeenCalledTimes(1);
    expect(getTaskLinks).toHaveBeenCalledTimes(1);
    const link = latest.getLink('task-a');
    expect(link.branchUrl).toBe('https://github.com/acme/app/tree/tm/a-1');
    expect(link.pr.htmlUrl).toBe('https://github.com/acme/app/pull/4');
    expect(latest.links.size).toBe(2);
  });

  it('carries the default branch and the PR base so merges elsewhere can be told apart', async () => {
    getRepository.mockResolvedValue(REPO);
    getTaskLinks.mockResolvedValue([
      { tid: 'TASK-A', branchName: 'tm/a-1', pr: { number: 4, state: 'merged', baseBranch: 'develop', mergedAt: '2026-10-01T00:00:00Z' } },
    ]);
    render(<Probe gid="G1" />);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('connected'));

    const link = latest.getLink('task-a');
    expect(link.defaultBranch).toBe('main');
    expect(link.pr.baseBranch).toBe('develop');
  });

  it('skips task links when the group has no repository', async () => {
    getRepository.mockResolvedValue(null);
    render(<Probe gid="G1" />);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('none'));
    expect(getTaskLinks).not.toHaveBeenCalled();
    expect(latest.getLink('x')).toBeNull();
  });

  it('exposes a readable error', async () => {
    getRepository.mockRejectedValue(Object.assign(new Error('403'), { code: 'NOT_GROUP_MEMBER', status: 403 }));
    render(<Probe gid="G1" />);
    await waitFor(() => expect(latest.error).toBe('No perteneces a este grupo.'));
    expect(latest.repoConnected).toBe(false);
  });

  it('refresh() reloads the links', async () => {
    getRepository.mockResolvedValue(REPO);
    getTaskLinks.mockResolvedValue([]);
    render(<Probe gid="G1" />);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('connected'));
    act(() => latest.refresh());
    await waitFor(() => expect(getTaskLinks).toHaveBeenCalledTimes(2));
  });
});
