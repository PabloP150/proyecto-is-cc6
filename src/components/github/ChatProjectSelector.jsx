import GitHubIcon from '@mui/icons-material/GitHub';
import { Box, Chip, FormControl, InputLabel, MenuItem, Select } from '@mui/material';
import { useId } from 'react';
import { sameId } from './githubUtils';

const NEW_PROJECT = '__new__';

/**
 * Project (group) picker for the AI chat.
 * Props: groups ([{gid, name}]), value (gid | null), onChange(gid | null),
 * repo ({fullName} | null — null means the group has no repository; undefined = still unknown),
 * disabled.
 */
export default function ChatProjectSelector({ groups = [], value = null, onChange, repo, disabled = false }) {
  const labelId = useId();
  const list = Array.isArray(groups) ? groups : [];
  const selected = value ? list.find((g) => sameId(g.gid, value)) : null;
  const selectValue = selected ? String(selected.gid) : NEW_PROJECT;

  const handleChange = (event) => {
    const next = event.target.value;
    if (!onChange) return;
    if (next === NEW_PROJECT) {
      onChange(null);
      return;
    }
    const group = list.find((g) => String(g.gid) === next);
    onChange(group ? group.gid : next);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
      <FormControl size="small" sx={{ minWidth: 240, maxWidth: '100%' }} disabled={disabled}>
        <InputLabel id={labelId}>Proyecto</InputLabel>
        <Select labelId={labelId} label="Proyecto" value={selectValue} onChange={handleChange}>
          <MenuItem value={NEW_PROJECT}>Nuevo proyecto (sin contexto)</MenuItem>
          {list.map((group) => (
            <MenuItem key={group.gid} value={String(group.gid)}>
              {group.name ? String(group.name) : 'Grupo sin nombre'}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {selected && repo !== undefined && (
        repo && repo.fullName ? (
          <Chip
            size="small"
            icon={<GitHubIcon />}
            label={String(repo.fullName)}
            sx={{ fontFamily: 'monospace', background: 'rgba(59, 130, 246, 0.15)', border: '1px solid rgba(59, 130, 246, 0.35)' }}
          />
        ) : (
          <Chip size="small" variant="outlined" label="Sin repositorio" sx={{ color: 'text.secondary' }} />
        )
      )}
    </Box>
  );
}
