import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CheckIcon from '@mui/icons-material/Check';
import GroupsIcon from '@mui/icons-material/Groups';
import { Button, Divider, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import { useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { GroupContext } from './GroupContext';

const sameId = (a, b) => Boolean(a && b) && String(a).toLowerCase() === String(b).toLowerCase();

// Current group next to the logo; switching here changes the group of every page.
const NavGroupSelector = () => {
  const { selectedGroupId, setSelectedGroupId, selectedGroupName, setSelectedGroupName, groups, refreshGroups } =
    useContext(GroupContext) || {};
  const [anchorEl, setAnchorEl] = useState(null);

  useEffect(() => {
    if (!refreshGroups) return undefined;
    const controller = new AbortController();
    refreshGroups({ signal: controller.signal }).catch(() => {});
    return () => controller.abort();
  }, [refreshGroups]);

  const list = Array.isArray(groups) ? groups : [];
  const current = list.find((g) => sameId(g.gid, selectedGroupId));
  const label = (current && current.name) || selectedGroupName || 'Select a group';

  const open = (event) => {
    setAnchorEl(event.currentTarget);
    if (refreshGroups) refreshGroups().catch(() => {});
  };
  const choose = (group) => {
    setSelectedGroupId(group.gid);
    setSelectedGroupName(group.name || '');
    setAnchorEl(null);
  };

  return (
    <>
      <Button
        onClick={open}
        startIcon={<GroupsIcon />}
        endIcon={<ArrowDropDownIcon />}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchorEl)}
        aria-label={`Current group: ${label}. Change group`}
        sx={{
          ml: 2,
          maxWidth: 260,
          color: 'text.primary',
          background: 'rgba(59, 130, 246, 0.15)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          borderRadius: (theme) => theme.shape.borderRadius,
          padding: (theme) => theme.spacing(0.75, 1.5),
          fontWeight: 600,
          textTransform: 'none',
          '&:hover': { background: 'rgba(59, 130, 246, 0.25)', borderColor: 'rgba(59, 130, 246, 0.5)' },
        }}
      >
        <Typography component="span" noWrap sx={{ fontWeight: 600, fontSize: '0.9rem' }}>
          {label}
        </Typography>
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        sx={{
          '& .MuiPaper-root': {
            background: 'rgba(15, 23, 42, 0.97)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            mt: 1,
            minWidth: 220,
            maxHeight: 420,
          },
        }}
      >
        {list.length === 0 && (
          <MenuItem disabled>
            <ListItemText primary="You are not in any group yet" />
          </MenuItem>
        )}
        {list.map((group) => {
          const selected = sameId(group.gid, selectedGroupId);
          return (
            <MenuItem key={group.gid} selected={selected} onClick={() => choose(group)}>
              <ListItemIcon sx={{ color: 'primary.light', minWidth: 32 }}>
                {selected ? <CheckIcon fontSize="small" /> : null}
              </ListItemIcon>
              <ListItemText primary={group.name || 'Unnamed group'} primaryTypographyProps={{ noWrap: true }} />
            </MenuItem>
          );
        })}
        <Divider sx={{ borderColor: 'rgba(255, 255, 255, 0.1)' }} />
        <MenuItem component={Link} to="/groups" onClick={() => setAnchorEl(null)}>
          <ListItemText inset primary="Manage groups" />
        </MenuItem>
      </Menu>
    </>
  );
};

export default NavGroupSelector;
