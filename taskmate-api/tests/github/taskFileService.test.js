jest.mock('../../models/github.model', () => ({
    replaceTaskFiles: jest.fn(),
    getTaskFiles: jest.fn(),
}));
jest.mock('../../services/github/repoService', () => ({
    getPullRequestFiles: jest.fn(),
}));

const githubModel = require('../../models/github.model');
const repoService = require('../../services/github/repoService');
const { recordFilesForTask } = require('../../services/github/taskFileService');

const TID = 'a0000000-0000-4000-8000-00000000000a';
const REPO = { repoId: 42, owner: 'Sirk02', name: 'taskmate' };

const FILES = [
    { path: 'src/api/deploy.js', status: 'added', additions: 30, deletions: 0 },
    { path: 'src/App.js', status: 'modified', additions: 2, deletions: 1 },
];

beforeEach(() => {
    jest.clearAllMocks();
    repoService.getPullRequestFiles.mockResolvedValue(FILES);
    githubModel.replaceTaskFiles.mockResolvedValue(FILES.length);
});

describe('recordFilesForTask', () => {
    test('stores the pull request file list against the task', async () => {
        const result = await recordFilesForTask({ tid: TID, repo: REPO, prNumber: 7, headSha: 'b'.repeat(40) });

        expect(result).toEqual({ recorded: true, count: 2 });
        expect(repoService.getPullRequestFiles).toHaveBeenCalledWith(REPO, 7);
        expect(githubModel.replaceTaskFiles).toHaveBeenCalledWith(
            TID, FILES, { prNumber: 7, headSha: 'b'.repeat(40) },
        );
    });

    test('a GitHub failure is reported, not thrown', async () => {
        // The file list is supporting detail: it must never break task completion.
        repoService.getPullRequestFiles.mockRejectedValue(new Error('rate limited'));

        const result = await recordFilesForTask({ tid: TID, repo: REPO, prNumber: 7 });

        expect(result.recorded).toBe(false);
        expect(result.reason).toContain('rate limited');
        expect(githubModel.replaceTaskFiles).not.toHaveBeenCalled();
    });

    test('a database failure is reported, not thrown', async () => {
        githubModel.replaceTaskFiles.mockRejectedValue(new Error('deadlock'));

        const result = await recordFilesForTask({ tid: TID, repo: REPO, prNumber: 7 });

        expect(result.recorded).toBe(false);
        expect(result.reason).toContain('deadlock');
    });

    test('does nothing without a pull request number', async () => {
        const result = await recordFilesForTask({ tid: TID, repo: REPO, prNumber: null });

        expect(result.recorded).toBe(false);
        expect(repoService.getPullRequestFiles).not.toHaveBeenCalled();
    });

    test('does nothing without a task or repository', async () => {
        expect((await recordFilesForTask({ tid: null, repo: REPO, prNumber: 7 })).recorded).toBe(false);
        expect((await recordFilesForTask({ tid: TID, repo: null, prNumber: 7 })).recorded).toBe(false);
        expect(repoService.getPullRequestFiles).not.toHaveBeenCalled();
    });

    test('an empty pull request records an empty list rather than failing', async () => {
        repoService.getPullRequestFiles.mockResolvedValue([]);
        githubModel.replaceTaskFiles.mockResolvedValue(0);

        const result = await recordFilesForTask({ tid: TID, repo: REPO, prNumber: 7 });

        expect(result).toEqual({ recorded: true, count: 0 });
    });
});
