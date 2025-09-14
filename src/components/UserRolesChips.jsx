import { Chip, Stack, Tooltip } from '@mui/material';

/**
 * Muestra los roles de un usuario como chips de colores.
 * Props:
 * - roles: [{ gr_id, gr_name, gr_color, gr_icon, gr_desc }]
 * - size: 'small' | 'medium' (opcional)
 * - showDesc: bool (opcional, muestra descripción en tooltip)
 */
const UserRolesChips = ({ roles = [], size = 'small', showDesc = true }) => {
  if (!roles.length) return null;
  return (
    <Stack direction="row" spacing={0.5}>
      {roles.map(role => {
        const chip = (
          <Chip
            key={role.gr_id}
            label={role.gr_name}
            size={size}
            icon={role.gr_icon ? <span className="material-icons" style={{ fontSize: 18 }}>{role.gr_icon}</span> : null}
            style={{ backgroundColor: role.gr_color || '#e0e0e0', color: '#222', fontWeight: 500 }}
            variant="filled"
          />
        );
        return showDesc && role.gr_desc ? (
          <Tooltip key={role.gr_id} title={role.gr_desc} arrow>
            {chip}
          </Tooltip>
        ) : chip;
      })}
    </Stack>
  );
};

export default UserRolesChips;
