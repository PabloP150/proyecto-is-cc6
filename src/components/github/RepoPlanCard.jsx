import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import FlagIcon from '@mui/icons-material/Flag';
import HourglassDisabledIcon from '@mui/icons-material/HourglassDisabled';
import { Box, Chip, CircularProgress, Divider, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import Button from '../ui/Button';
import Card from '../ui/Card';
import { formatDay, staticCardSx } from './githubUtils';

// Everything from the plan is untrusted LLM output: it is rendered only as React text nodes,
// never as markdown or HTML.

const CATEGORY_STYLES = {
  frontend: { label: 'Frontend', color: '#93c5fd', background: 'rgba(59, 130, 246, 0.18)' },
  backend: { label: 'Backend', color: '#fbbf24', background: 'rgba(245, 158, 11, 0.18)' },
  database: { label: 'Base de datos', color: '#6ee7b7', background: 'rgba(16, 185, 129, 0.18)' },
  testing: { label: 'Pruebas', color: '#d8b4fe', background: 'rgba(168, 85, 247, 0.18)' },
  general: { label: 'General', color: '#e2e8f0', background: 'rgba(148, 163, 184, 0.18)' },
};

const MAX_TIMEOUT = 2147483647;
const text = (value) => (value === undefined || value === null ? '' : String(value));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const countOr = (value, fallback) =>
  value === undefined || value === null || !Number.isFinite(Number(value)) ? fallback : Number(value);

function normalizePlan(plan) {
  const source = plan && typeof plan === 'object' ? plan : {};
  const milestones = Array.isArray(source.milestones) ? source.milestones.filter((m) => m && typeof m === 'object') : [];
  const tasks = Array.isArray(source.tasks) ? source.tasks.filter((t) => t && typeof t === 'object') : [];
  const byKey = new Map(milestones.map((m) => [text(m.key), []]));
  const loose = [];
  tasks.forEach((task) => {
    const key = text(task.milestone_key);
    if (key && byKey.has(key)) byKey.get(key).push(task);
    else loose.push(task);
  });
  return { summary: text(source.summary), milestones, tasks, byKey, loose, valid: Boolean(plan && typeof plan === 'object') };
}

function useExpired(expiresAt) {
  const deadline = expiresAt ? new Date(expiresAt).getTime() : NaN;
  const hasDeadline = Number.isFinite(deadline);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!hasDeadline) return undefined;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      if (now < deadline) setNow(Date.now());
      return undefined;
    }
    const timer = setTimeout(() => setNow(Date.now()), Math.min(remaining + 50, MAX_TIMEOUT));
    return () => clearTimeout(timer);
  }, [deadline, hasDeadline, now]);

  return { expired: hasDeadline && now >= deadline, deadline: hasDeadline ? new Date(deadline) : null };
}

function CategoryChip({ category }) {
  const style = CATEGORY_STYLES[category] || CATEGORY_STYLES.general;
  return (
    <Chip
      size="small"
      label={style.label}
      sx={{ height: 20, fontSize: '0.7rem', fontWeight: 600, color: style.color, background: style.background }}
    />
  );
}

function PlanTask({ task }) {
  const due = formatDay(text(task.due_date));
  return (
    <Box component="li" sx={{ listStyle: 'none', py: 0.75, borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: 'break-word' }}>
          {text(task.name)}
        </Typography>
        <CategoryChip category={text(task.category)} />
        {due && (
          <Typography variant="caption" color="text.secondary">
            Vence: {due}
          </Typography>
        )}
      </Box>
      {task.description && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {text(task.description)}
        </Typography>
      )}
    </Box>
  );
}

function TaskGroup({ title, subtitle, description, tasks }) {
  return (
    <Box sx={{ mt: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        <FlagIcon sx={{ fontSize: 16, color: 'secondary.light' }} aria-hidden />
        <Typography variant="subtitle2" component="h4" sx={{ fontWeight: 700, wordBreak: 'break-word' }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        )}
      </Box>
      {description && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {description}
        </Typography>
      )}
      {tasks.length > 0 ? (
        <Box component="ul" sx={{ m: 0, mt: 0.5, p: 0, pl: 2.5 }}>
          {tasks.map((task, index) => (
            <PlanTask key={`${text(task.name)}-${index}`} task={task} />
          ))}
        </Box>
      ) : (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 2.5 }}>
          Sin tareas asignadas a este hito.
        </Typography>
      )}
    </Box>
  );
}

function PlanBody({ plan, content }) {
  if (!plan.valid) {
    return content ? (
      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {text(content)}
      </Typography>
    ) : null;
  }
  return (
    <Box>
      {plan.summary && (
        <>
          <Typography variant="overline" component="p" sx={{ color: 'text.secondary', lineHeight: 1.6 }}>
            Sobre el repositorio
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', mb: 1 }}>
            {plan.summary}
          </Typography>
        </>
      )}
      {plan.milestones.map((milestone, index) => {
        const target = formatDay(text(milestone.target_date));
        return (
          <TaskGroup
            key={`${text(milestone.key)}-${index}`}
            title={text(milestone.name) || 'Hito sin nombre'}
            subtitle={target ? `Meta: ${target}` : ''}
            description={text(milestone.description)}
            tasks={plan.byKey.get(text(milestone.key)) || []}
          />
        );
      })}
      {plan.loose.length > 0 && (
        <TaskGroup title={plan.milestones.length ? 'Sin hito' : 'Tareas'} tasks={plan.loose} />
      )}
    </Box>
  );
}

/**
 * Structured card for a `repo_plan` WebSocket message.
 * Props: message ({planId, groupName, expiresAt, content, plan, status?, created?}),
 * onConfirm(planId, message) / onDiscard(planId, message) — may return a promise, or `false`
 * when the request could not be sent; busy (request in flight);
 * status ('pending' | 'saved' | 'discarded' | 'expired', defaults to message.status);
 * compact (forces the read-only summary).
 */
export default function RepoPlanCard({ message, onConfirm, onDiscard, busy = false, status, compact = false }) {
  const msg = message || {};
  const plan = normalizePlan(msg.plan);
  const finalStatus = status || msg.status || 'pending';
  const { expired, deadline } = useExpired(msg.expiresAt);
  const [pending, setPending] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const lockRef = useRef(false);
  const mountedRef = useRef(true);
  const prevBusy = useRef(busy);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (prevBusy.current && !busy) {
      lockRef.current = false;
      setPending(null);
    }
    prevBusy.current = busy;
  }, [busy]);

  const release = () => {
    lockRef.current = false;
    if (mountedRef.current) setPending(null);
  };

  const run = (kind, handler) => {
    if (lockRef.current || busy || expired || !handler) return;
    lockRef.current = true;
    setPending(kind);
    let result;
    try {
      result = handler(msg.planId, msg);
    } catch (err) {
      release();
      throw err;
    }
    if (result === false) release();
    else if (result && typeof result.then === 'function') result.then(release, release);
  };

  const groupName = text(msg.groupName) || 'el proyecto';
  const taskCount = plan.tasks.length;
  const milestoneCount = plan.milestones.length;
  const readOnly = compact || finalStatus === 'saved' || finalStatus === 'discarded' || finalStatus === 'expired';

  if (readOnly) {
    const created = msg.created || {};
    const savedTasks = countOr(created.tasks, taskCount);
    const savedMilestones = countOr(created.milestones, milestoneCount);
    let icon = <AutoAwesomeIcon sx={{ color: 'primary.light' }} aria-hidden />;
    let summary = `Plan propuesto para «${groupName}»: ${plural(taskCount, 'tarea', 'tareas')} y ${plural(milestoneCount, 'hito', 'hitos')}.`;
    if (finalStatus === 'saved') {
      icon = <CheckCircleIcon sx={{ color: 'success.main' }} aria-hidden />;
      summary = `Plan guardado en «${groupName}»: ${plural(savedTasks, 'tarea creada', 'tareas creadas')} y ${plural(savedMilestones, 'hito', 'hitos')}.`;
    } else if (finalStatus === 'discarded') {
      icon = <BlockIcon sx={{ color: 'text.secondary' }} aria-hidden />;
      summary = `Plan descartado (${plural(taskCount, 'tarea propuesta', 'tareas propuestas')}).`;
    } else if (finalStatus === 'expired' || expired) {
      icon = <HourglassDisabledIcon sx={{ color: 'warning.main' }} aria-hidden />;
      summary = 'Plan expirado: vuelve a pedir el análisis para generar uno nuevo.';
    }
    return (
      <Box
        data-testid="repo-plan-compact"
        sx={{ border: '1px solid rgba(255, 255, 255, 0.12)', borderRadius: 2, p: 1.5, background: 'rgba(15, 23, 42, 0.35)' }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {icon}
          <Typography variant="body2" sx={{ flex: 1, wordBreak: 'break-word' }}>
            {summary}
          </Typography>
          {(plan.valid || msg.content) && (
            <Button
              variant="ghost"
              size="small"
              onClick={() => setShowDetail((v) => !v)}
              aria-expanded={showDetail}
              sx={{ py: 0.25, px: 1.25, fontSize: '0.75rem' }}
            >
              {showDetail ? 'Ocultar detalle' : 'Ver detalle'}
            </Button>
          )}
        </Box>
        {showDetail && (
          <Box sx={{ mt: 1 }}>
            <PlanBody plan={plan} content={msg.content} />
          </Box>
        )}
      </Box>
    );
  }

  const disabled = busy || Boolean(pending) || expired;
  const expiryLabel = deadline
    ? `Válido hasta las ${deadline.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`
    : '';

  return (
    <Card
      variant="default"
      component="section"
      aria-label={`Plan propuesto para ${groupName}`}
      sx={{ ...staticCardSx, p: { xs: 1.5, sm: 2 }, width: '100%' }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <AutoAwesomeIcon sx={{ color: 'secondary.light' }} aria-hidden />
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }}>
          Plan propuesto para «{groupName}»
        </Typography>
        {expired ? (
          <Chip size="small" color="warning" label="Plan expirado" />
        ) : (
          expiryLabel && (
            <Typography variant="caption" color="text.secondary">
              {expiryLabel}
            </Typography>
          )
        )}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        {plural(taskCount, 'tarea', 'tareas')} · {plural(milestoneCount, 'hito', 'hitos')}
      </Typography>
      <Divider sx={{ mb: 1, borderColor: 'rgba(255, 255, 255, 0.1)' }} />

      <PlanBody plan={plan} content={msg.content} />

      <Divider sx={{ my: 1.5, borderColor: 'rgba(255, 255, 255, 0.1)' }} />
      {expired ? (
        <Typography variant="body2" color="warning.light" sx={{ mb: 1 }}>
          Plan expirado: vuelve a pedir el análisis para generar uno nuevo.
        </Typography>
      ) : (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Al confirmar se crearán {plural(taskCount, 'tarea', 'tareas')} y {plural(milestoneCount, 'hito', 'hitos')} en «{groupName}».
        </Typography>
      )}
      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button variant="ghost" size="small" disabled={disabled} onClick={() => run('discard', onDiscard)}>
          {pending === 'discard' ? <CircularProgress size={16} sx={{ mr: 1, color: 'inherit' }} /> : null}
          Descartar
        </Button>
        <Button variant="primary" size="small" disabled={disabled} onClick={() => run('confirm', onConfirm)}>
          {pending === 'confirm' ? <CircularProgress size={16} sx={{ mr: 1, color: 'inherit' }} /> : null}
          Confirmar
        </Button>
      </Stack>
    </Card>
  );
}
