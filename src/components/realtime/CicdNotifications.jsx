import { Alert, Button, Link, Snackbar } from '@mui/material';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { safeHttpsUrl } from '../github/cicd/cicdUtils';
import { getCurrentUserId } from '../github/githubUtils';
import { GroupContext } from '../GroupContext';
import { sameId } from '../../utils/ids';
import { useRealtime } from './RealtimeContext';

const MAX_QUEUE = 5;
const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);
const DEPLOY_FAILED = new Set(['failure', 'error']);
const ENV_LABELS = { staging: 'Staging', production: 'Production' };
const envLabel = (environment) => ENV_LABELS[environment] || String(environment || '');
// Runs whose deploy failure was already toasted: a few, for a while (a run finishes within minutes).
const MAX_REPORTED_RUNS = 50;
const REPORTED_RUN_TTL_MS = 15 * 60 * 1000;
// The deploy's failure status is posted by a step of the same run, so it normally arrives before
// the run's 'completed'; a finished run's toast waits this long in case the two came out of order.
export const RUN_NOTICE_DELAY_MS = 3000;
const RUN_URL = /\/actions\/runs\/(\d+)(?:[/?#]|$)/;

/** Run id of a 'deployment' event: the workflow sets the status log_url to its own run. */
export const deploymentRunId = (data) => {
  const match = RUN_URL.exec(String((data && data.logUrl) || ''));
  return match ? match[1] : null;
};

/**
 * Remembers the runs whose deploy failure a 'deployment' event reported, so their own failed or
 * cancelled ci_run is not a second toast; a new attempt of a run (re-run) forgets it. `runs` is a
 * Map runId → time, bounded in size and age.
 */
export function trackDeployFailures(runs, message, now = Date.now()) {
  if (!message || !message.data) return;
  const { event, data } = message;
  if (event === 'ci_run' && data.action === 'requested' && data.runId != null) {
    runs.delete(String(data.runId));
    return;
  }
  if (event !== 'deployment' || !DEPLOY_FAILED.has(data.state)) return;
  const runId = deploymentRunId(data);
  if (!runId) return;
  runs.forEach((at, id) => {
    if (now - at > REPORTED_RUN_TTL_MS) runs.delete(id);
  });
  runs.delete(runId);
  runs.set(runId, now);
  while (runs.size > MAX_REPORTED_RUNS) runs.delete(runs.keys().next().value);
}

/**
 * Turns a live CI/CD event into a notice for this user, or null when it is not worth a toast:
 * failed runs, finished deploys, production requests for the admins and decisions for the
 * requester. `reportedRuns` (see trackDeployFailures) holds the runs whose deploy failure was
 * already reported.
 */
export function toNotice(message, { groups = [], uid, reportedRuns } = {}) {
  if (!message || !message.data) return null;
  const { event, data, gid } = message;
  const group = (Array.isArray(groups) ? groups : []).find((g) => sameId(g.gid, gid));
  const prefix = `[${(group && group.name) || 'Your group'}] `;
  const isAdmin = Boolean(group && uid && sameId(group.adminId, uid));

  if (event === 'ci_run') {
    if (data.action !== 'completed') return null;
    // Its deploy failed and the 'deployment' event already said so (also for a deploy cancelled
    // after it started publishing): one toast, not two. Matched by run, not by isDeploy: a deploy
    // run can fail before it creates its Deployment, and push runs deploy staging too.
    if (reportedRuns && data.runId != null && reportedRuns.has(String(data.runId))) return null;
    const title = data.title || data.name || 'the pipeline';
    // A deploy cancelled before it created its Deployment (no 'deployment' event): only the admins
    // (who deploy, re-run and cancel) need to hear about it.
    if (data.isDeploy && data.conclusion === 'cancelled') {
      return isAdmin ? { severity: 'warning', gid, message: `${prefix}“${title}” was cancelled before publishing.` } : null;
    }
    if (!FAILED.has(data.conclusion)) return null;
    const where = data.branch ? ` on ${data.branch}` : '';
    return { severity: 'error', gid, message: `${prefix}“${title}” failed${where}.` };
  }
  if (event === 'deployment') {
    if (data.state === 'success') {
      return { severity: 'success', gid, url: safeHttpsUrl(data.url), message: `${prefix}${envLabel(data.environment)} was updated to ${data.shortSha}.` };
    }
    if (data.state === 'failure' || data.state === 'error') {
      return { severity: 'error', gid, message: `${prefix}Deploy of ${data.shortSha} to ${envLabel(data.environment).toLowerCase()} failed.` };
    }
    return null;
  }
  if (event === 'deploy_request') {
    const mine = Boolean(uid && sameId(data.requestedBy, uid));
    if (data.status === 'pending' && isAdmin && !mine) {
      return {
        severity: 'warning',
        gid,
        message: `${prefix}${data.requestedByUsername || 'A member'} asks to publish ${data.shortSha} to ${envLabel(data.environment).toLowerCase()}.`,
      };
    }
    if (mine && data.status === 'approved') {
      return {
        severity: 'success',
        gid,
        message: `${prefix}${data.decidedByUsername || 'An admin'} approved your request: publishing ${data.shortSha} to ${envLabel(data.environment).toLowerCase()}.`,
      };
    }
    if (mine && data.status === 'rejected') {
      const note = data.note ? ` Reason: ${data.note}` : '';
      return { severity: 'warning', gid, message: `${prefix}${data.decidedByUsername || 'An admin'} rejected your request for ${data.shortSha}.${note}` };
    }
  }
  return null;
}

/** Global toasts for CI/CD activity in the user's groups; «Ver» opens the group's CI/CD tab. */
export default function CicdNotifications() {
  const { subscribe } = useRealtime();
  const { groups, setSelectedGroupId, setSelectedGroupName } = useContext(GroupContext) || {};
  const navigate = useNavigate();
  const [queue, setQueue] = useState([]);
  const groupsRef = useRef(groups);
  const counter = useRef(0);
  const reportedRuns = useRef(new Map());

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  useEffect(() => {
    const timers = new Set();
    const show = (notice) => {
      counter.current += 1;
      const id = counter.current;
      setQueue((current) => [...current, { ...notice, id }].slice(-MAX_QUEUE));
    };
    const unsubscribe = subscribe((message) => {
      trackDeployFailures(reportedRuns.current, message);
      const notice = toNotice(message, { groups: groupsRef.current, uid: getCurrentUserId(), reportedRuns: reportedRuns.current });
      if (!notice) return;
      if (message.event !== 'ci_run') {
        show(notice);
        return;
      }
      const runId = message.data.runId;
      const timer = setTimeout(() => {
        timers.delete(timer);
        // Its deploy failure arrived meanwhile and was already toasted.
        if (runId != null && reportedRuns.current.has(String(runId))) return;
        show(notice);
      }, RUN_NOTICE_DELAY_MS);
      timers.add(timer);
    });
    return () => {
      timers.forEach(clearTimeout);
      unsubscribe();
    };
  }, [subscribe]);

  const current = queue[0];
  const close = useCallback((event, reason) => {
    if (reason === 'clickaway') return;
    setQueue((items) => items.slice(1));
  }, []);

  const open = () => {
    const group = (groupsRef.current || []).find((g) => sameId(g.gid, current.gid));
    if (group) {
      if (setSelectedGroupId) setSelectedGroupId(group.gid);
      if (setSelectedGroupName) setSelectedGroupName(group.name || '');
    }
    navigate('/github?tab=cicd');
    close();
  };

  return (
    <Snackbar
      key={current ? current.id : undefined}
      open={Boolean(current)}
      autoHideDuration={9000}
      onClose={close}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
    >
      {current ? (
        <Alert
          severity={current.severity}
          variant="filled"
          onClose={close}
          sx={{ maxWidth: 480, alignItems: 'center' }}
          action={
            <>
              {current.url && (
                <Button component={Link} href={current.url} target="_blank" rel="noopener noreferrer" color="inherit" size="small">
                  Open site
                </Button>
              )}
              <Button color="inherit" size="small" onClick={open}>
                View
              </Button>
            </>
          }
        >
          {current.message}
        </Alert>
      ) : (
        <span />
      )}
    </Snackbar>
  );
}
