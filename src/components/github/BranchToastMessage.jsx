import { Link } from '@mui/material';
import { safeGitHubUrl } from './githubUtils';

// When a task leaves the board the server deletes its GitHub branch only when that is safe and
// answers what it did: branch = { name, outcome, url }. These helpers turn that into toast text.

// Long enough to read the GitHub sentence and reach «Ver rama» (the Snackbar pauses on hover).
export const BRANCH_TOAST_MS = 6000;

// 'error' is also a check still running when the server answered, which may delete the branch
// afterwards: its text never claims the branch is still there.
const SINGLE = {
  deleted: (name) => ({ severity: 'success', text: `Rama ${name} eliminada en GitHub.` }),
  kept_unmerged: (name) => ({ severity: 'info', text: `La rama ${name} sigue en GitHub: tiene commits sin fusionar.` }),
  kept_open_pr: (name) => ({ severity: 'info', text: `La rama ${name} sigue en GitHub: tiene un PR abierto.` }),
  error: (name) => ({ severity: 'warning', text: `No se pudo confirmar qué pasó con la rama ${name} en GitHub; puede que siga ahí.` }),
};

// 'missing' and 'skipped' (and any outcome this UI does not know yet) say nothing to the user.
const isReportable = (branch) =>
  Boolean(branch) &&
  typeof branch.name === 'string' &&
  branch.name !== '' &&
  Object.prototype.hasOwnProperty.call(SINGLE, branch.outcome);

// A deleted branch has nothing left to link to.
const keptUrl = (branch) => (branch.outcome === 'deleted' ? null : safeGitHubUrl(branch.url));

/** { severity, text, url } for one task's branch, or null when there is nothing to tell. */
export function branchNotice(branch) {
  if (!isReportable(branch)) return null;
  return { ...SINGLE[branch.outcome](branch.name), url: keptUrl(branch) };
}

const plural = (n, one, many) => (n === 1 ? one : many);

// Why the kept branches are still there: the bare reason when they all share it, counted otherwise.
const KEPT_REASONS = [
  { outcome: 'kept_unmerged', alone: () => 'commits sin fusionar', counted: (n) => `${n} con commits sin fusionar` },
  { outcome: 'kept_open_pr', alone: (n) => plural(n, 'PR abierto', 'PRs abiertos'), counted: (n) => `${n} con PR abierto` },
];

/** One notice for all the branches of a deleted list, e.g. «2 ramas eliminadas en GitHub; 1 sigue (commits sin fusionar).» */
export function branchesNotice(branches) {
  const reportable = (Array.isArray(branches) ? branches : []).filter(isReportable);
  if (reportable.length === 0) return null;
  if (reportable.length === 1) return branchNotice(reportable[0]);

  const count = (outcome) => reportable.filter((b) => b.outcome === outcome).length;
  const deleted = count('deleted');
  // Not counted as kept: like a single 'error', these may still be deleted after the answer.
  const unconfirmed = count('error');
  const kept = reportable.length - deleted - unconfirmed;
  const reasons = KEPT_REASONS.map((r) => ({ ...r, n: count(r.outcome) })).filter((r) => r.n > 0);

  const parts = [];
  if (deleted > 0) parts.push(`${deleted} ${plural(deleted, 'rama eliminada', 'ramas eliminadas')} en GitHub`);
  if (kept > 0) {
    const why = reasons.length === 1 ? reasons[0].alone(kept) : reasons.map((r) => r.counted(r.n)).join(', ');
    const subject = parts.length > 0
      ? plural(kept, 'sigue', 'siguen')
      : `${plural(kept, 'rama sigue', 'ramas siguen')} en GitHub`;
    parts.push(`${kept} ${subject} (${why})`);
  }
  if (unconfirmed > 0) {
    // With nothing before it there are at least two of them (one alone gets the single message).
    parts.push(parts.length > 0
      ? `${unconfirmed} sin confirmar`
      : `No se pudo confirmar qué pasó con ${unconfirmed} ramas en GitHub; puede que sigan ahí`);
  }

  // «Ver rama» only when exactly one of these branches is still on GitHub.
  const urls = reportable.map(keptUrl).filter(Boolean);
  return {
    severity: count('error') > 0 ? 'warning' : kept > 0 ? 'info' : 'success',
    text: `${parts.join('; ')}.`,
    url: urls.length === 1 ? urls[0] : null,
  };
}

/** The task toast with the GitHub sentence appended; without a notice it is returned unchanged. */
export function withBranchNotice(message, severity, notice) {
  if (!notice) return { message, severity, url: null, duration: null };
  return {
    message: `${message}. ${notice.text}`,
    severity: notice.severity,
    url: notice.url,
    duration: BRANCH_TOAST_MS,
  };
}

/** Toast body: the message plus a «Ver rama» link when the branch is still on GitHub. */
export default function BranchToastMessage({ message, url }) {
  const href = safeGitHubUrl(url);
  return (
    <>
      {message}
      {href && (
        <Link
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          color="inherit"
          underline="always"
          sx={{ ml: 1, fontWeight: 600, whiteSpace: 'nowrap' }}
        >
          Ver rama
        </Link>
      )}
    </>
  );
}
