import GitHubIcon from '@mui/icons-material/GitHub';
import { Box, Chip, Typography } from '@mui/material';
import { sameId } from './githubUtils';

/**
 * Project (group) the AI chat talks about. Read-only: the group is chosen in the navbar.
 * Props: groups ([{gid, name}]), value (gid | null),
 * repo ({fullName} | null — null means the group has no repository; undefined = still unknown),
 * newProject (true: the chat is shaping a new project on purpose, not merely without a group).
 */
export default function ChatProjectInfo({ groups = [], value = null, repo, newProject = false }) {
  const list = Array.isArray(groups) ? groups : [];
  const selected = value ? list.find((g) => sameId(g.gid, value)) : null;
  const name = selected ? (selected.name ? String(selected.name) : 'Unnamed group') : null;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
      <Typography variant="body2" color="text.secondary" data-testid="chat-project">
        Project: <Box component="strong" sx={{ color: 'text.primary' }}>{name || (newProject ? 'new project' : 'none (select a group in the navbar)')}</Box>
      </Typography>
      {selected && repo !== undefined && (
        repo && repo.fullName ? (
          <Chip
            size="small"
            icon={<GitHubIcon />}
            label={String(repo.fullName)}
            sx={{ fontFamily: 'monospace', background: 'rgba(59, 130, 246, 0.15)', border: '1px solid rgba(59, 130, 246, 0.35)' }}
          />
        ) : (
          <Chip size="small" variant="outlined" label="No repository" sx={{ color: 'text.secondary' }} />
        )
      )}
    </Box>
  );
}
