import { Chip, Stack, styled } from '@mui/material';

// ---- Estilos y utilidades integradas (antes en RoleChip) ----
function hexToRgb(hex) {
  let h = (hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (!h) return { r: 150, g: 150, b: 150 };
  const num = parseInt(h, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
const clamp = (v, min = 0, max = 255) => Math.min(max, Math.max(min, v));
const adjust = (hex, amt) => {
  try {
    const { r, g, b } = hexToRgb(hex);
    return `#${[r + amt, g + amt, b + amt].map(v => clamp(v).toString(16).padStart(2, '0')).join('')}`;
  } catch { return hex; }
};
const readableTextColor = (hex) => {
  const { r, g, b } = hexToRgb(hex || '#999');
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? '#17202e' : '#fff';
};

const StyledChip = styled(Chip)(({ ownerState }) => {
  const base = ownerState.baseColor || '#1976d2';
  const light = adjust(base, 40);
  const dark = adjust(base, -25);
  const text = readableTextColor(base);
  return {
    fontWeight: 600,
    letterSpacing: 0.25,
    paddingInline: 4,
    color: text,
    background: `linear-gradient(140deg, ${light} 0%, ${base} 40%, ${dark} 100%)`,
    border: `1px solid ${adjust(base, -35)}`,
    boxShadow: '0 2px 4px rgba(0,0,0,0.25), inset 0 0 0 1px rgba(255,255,255,0.08)',
    backdropFilter: 'blur(2px)',
    WebkitBackdropFilter: 'blur(2px)',
    '.material-icons': { fontSize: 18, marginLeft: 2, color: text },
    '&:hover': { boxShadow: '0 4px 10px rgba(0,0,0,0.35)', transform: 'translateY(-1px)' },
    '&:active': { transform: 'translateY(0)', boxShadow: '0 2px 5px rgba(0,0,0,0.3)' },
    transition: 'all .18s cubic-bezier(.4,0,.2,1)',
  };
});

const InlineRoleChip = ({ role, size = 'small', withTooltip }) => {
  const chip = (
    <StyledChip
      size={size}
      label={role.gr_name}
      ownerState={{ baseColor: role.gr_color }}
      icon={role.gr_icon ? <span className="material-icons">{role.gr_icon}</span> : null}
    />
  );
  return chip;
};

/**
 * Muestra los roles de un usuario como chips de colores.
 * Props:
 * - roles: [{ gr_id, gr_name, gr_color, gr_icon }]
 * - size: 'small' | 'medium' (opcional)
 * - showDesc: bool (opcional, muestra descripción en tooltip)
 */
const UserRolesChips = ({ roles = [], size = 'small' }) => {
  if (!roles.length) return null;
  return (
    <Stack direction="row" spacing={0.5}>
      {roles.map(role => (
        <InlineRoleChip key={role.gr_id} role={role} size={size} />
      ))}
    </Stack>
  );
};

export default UserRolesChips;
