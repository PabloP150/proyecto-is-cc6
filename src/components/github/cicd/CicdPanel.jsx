import { Box } from '@mui/material';
import { useCallback, useState } from 'react';
import Card from '../../ui/Card';
import { staticCardSx } from '../githubUtils';
import PipelineCard from './PipelineCard';
import PipelineSetup from './PipelineSetup';
import RunList from './RunList';

/** "CI/CD" tab of /github: the group's pipeline and its runs. Props: gid, repo, isAdmin. */
export default function CicdPanel({ gid, repo, isAdmin }) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PipelineCard gid={gid} repo={repo} isAdmin={isAdmin} refreshKey={refreshKey} onConfigure={() => setSetupOpen(true)} />
      <Card variant="default" component="div" sx={staticCardSx}>
        <RunList gid={gid} refreshKey={refreshKey} />
      </Card>
      {isAdmin && (
        <PipelineSetup
          open={setupOpen}
          gid={gid}
          defaultBranch={repo && repo.defaultBranch}
          onClose={() => setSetupOpen(false)}
          onApplied={refresh}
        />
      )}
    </Box>
  );
}
