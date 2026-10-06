import { useCallback, useEffect, useMemo, useState } from 'react';
import { getRepository, getTaskLinks } from '../../api/github';
import {
  branchUrl,
  errorMessage,
  isAbortError,
  normalizeId,
  pullRequestUrl,
  repoHtmlUrl,
  safeGitHubUrl,
} from './githubUtils';

const EMPTY_LINKS = new Map();

function toLinkMap(list, repo) {
  const repoUrl = repoHtmlUrl(repo);
  const defaultBranch = (repo && repo.defaultBranch) || null;
  const links = new Map();
  (Array.isArray(list) ? list : []).forEach((item) => {
    if (!item || !item.tid) return;
    links.set(normalizeId(item.tid), {
      ...item,
      // A PR merged into another base (pr.baseBranch) does not complete the task.
      defaultBranch,
      branchUrl: safeGitHubUrl(item.branchUrl) || branchUrl(repoUrl, item.branchName),
      pr: item.pr
        ? { ...item.pr, htmlUrl: safeGitHubUrl(item.pr.htmlUrl) || pullRequestUrl(repoUrl, item.pr.number) }
        : null,
    });
  });
  return links;
}

/**
 * Branch/PR links for every task of a group: one getRepository + one getTaskLinks per group
 * (not per task). Keys of `links` are lower-cased tids; prefer `getLink(tid)`.
 */
export default function useTaskLinks(gid) {
  const [state, setState] = useState({ gid: null, repo: null, links: EMPTY_LINKS, error: null });
  const [loading, setLoading] = useState(Boolean(gid));
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!gid) {
      setState({ gid: null, repo: null, links: EMPTY_LINKS, error: null });
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true);

    (async () => {
      try {
        const repo = await getRepository(gid, { signal: controller.signal });
        const list = repo ? await getTaskLinks(gid, { signal: controller.signal }) : [];
        if (!active) return;
        setState({ gid, repo: repo || null, links: repo ? toLinkMap(list, repo) : EMPTY_LINKS, error: null });
      } catch (err) {
        if (!active || isAbortError(err)) return;
        if (err && err.code === 'REPO_NOT_CONNECTED') {
          setState({ gid, repo: null, links: EMPTY_LINKS, error: null });
        } else {
          setState((prev) => ({
            ...(prev.gid === gid ? prev : { repo: null, links: EMPTY_LINKS }),
            gid,
            error: errorMessage(err, 'No se pudieron cargar los enlaces de GitHub.'),
          }));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [gid, version]);

  // Never expose the previous group's repo/links while a new group loads.
  const current = state.gid && normalizeId(state.gid) === normalizeId(gid) ? state : null;
  const links = current ? current.links : EMPTY_LINKS;
  const repo = current ? current.repo : null;

  const getLink = useCallback((tid) => links.get(normalizeId(tid)) || null, [links]);

  return useMemo(
    () => ({
      links,
      getLink,
      repo,
      repoConnected: Boolean(repo),
      loading,
      error: current ? current.error : null,
      refresh,
    }),
    [links, getLink, repo, loading, current, refresh]
  );
}
