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
const ENV_LABELS = { staging: 'Staging', production: 'Producción' };
const envLabel = (environment) => ENV_LABELS[environment] || String(environment || '');

/**
 * Turns a live CI/CD event into a notice for this user, or null when it is not worth a toast:
 * failed runs, finished deploys, production requests for the admins and decisions for the
 * requester.
 */
export function toNotice(message, { groups = [], uid } = {}) {
  if (!message || !message.data) return null;
  const { event, data, gid } = message;
  const group = (Array.isArray(groups) ? groups : []).find((g) => sameId(g.gid, gid));
  const prefix = `[${(group && group.name) || 'Tu grupo'}] `;
  const isAdmin = Boolean(group && uid && sameId(group.adminId, uid));

  if (event === 'ci_run') {
    if (data.action !== 'completed' || !FAILED.has(data.conclusion)) return null;
    const where = data.branch ? ` en ${data.branch}` : '';
    return { severity: 'error', gid, message: `${prefix}Falló «${data.title || data.name || 'el pipeline'}»${where}.` };
  }
  if (event === 'deployment') {
    if (data.state === 'success') {
      return { severity: 'success', gid, url: safeHttpsUrl(data.url), message: `${prefix}${envLabel(data.environment)} se actualizó con ${data.shortSha}.` };
    }
    if (data.state === 'failure' || data.state === 'error') {
      return { severity: 'error', gid, message: `${prefix}Falló el deploy de ${data.shortSha} a ${envLabel(data.environment).toLowerCase()}.` };
    }
    return null;
  }
  if (event === 'deploy_request') {
    const mine = Boolean(uid && sameId(data.requestedBy, uid));
    if (data.status === 'pending' && isAdmin && !mine) {
      return {
        severity: 'warning',
        gid,
        message: `${prefix}${data.requestedByUsername || 'Un miembro'} pide publicar ${data.shortSha} en ${envLabel(data.environment).toLowerCase()}.`,
      };
    }
    if (mine && data.status === 'approved') {
      return {
        severity: 'success',
        gid,
        message: `${prefix}${data.decidedByUsername || 'Un administrador'} aprobó tu solicitud: ${data.shortSha} se está publicando en ${envLabel(data.environment).toLowerCase()}.`,
      };
    }
    if (mine && data.status === 'rejected') {
      const note = data.note ? ` Motivo: ${data.note}` : '';
      return { severity: 'warning', gid, message: `${prefix}${data.decidedByUsername || 'Un administrador'} rechazó tu solicitud de ${data.shortSha}.${note}` };
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

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  useEffect(
    () =>
      subscribe((message) => {
        const notice = toNotice(message, { groups: groupsRef.current, uid: getCurrentUserId() });
        if (!notice) return;
        counter.current += 1;
        const id = counter.current;
        setQueue((current) => [...current, { ...notice, id }].slice(-MAX_QUEUE));
      }),
    [subscribe]
  );

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
                  Abrir sitio
                </Button>
              )}
              <Button color="inherit" size="small" onClick={open}>
                Ver
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
