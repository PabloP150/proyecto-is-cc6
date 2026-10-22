import { Box } from '@mui/material';
import { useCallback, useState } from 'react';
import Card from '../../ui/Card';
import { getCurrentUserId, staticCardSx } from '../githubUtils';
import DeployPanel from './DeployPanel';
import PipelineCard from './PipelineCard';
import PipelineSetup from './PipelineSetup';
import RunList from './RunList';

/**
 * "CI/CD" tab of /github: the group's pipeline, its environments (when it deploys) and its runs.
 * Props: gid, repo, isAdmin.
 */
export default function CicdPanel({ gid, repo, isAdmin }) {
  const [setupOpen, setSetupOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pipeline, setPipeline] = useState(null);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);
  const configured = Boolean(pipeline && pipeline.pipeline);
  const deploys = Boolean(configured && pipeline.pipeline.deploys);

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 2 }}>
      <PipelineCard
        gid={gid}
        repo={repo}
        isAdmin={isAdmin}
        refreshKey={refreshKey}
        onConfigure={() => setSetupOpen(true)}
        onLoaded={setPipeline}
      />
      {deploys && <DeployPanel gid={gid} repo={repo} isAdmin={isAdmin} uid={getCurrentUserId()} refreshKey={refreshKey} />}
      <Card variant="default" component="div" sx={staticCardSx}>
        <RunList gid={gid} refreshKey={refreshKey} isAdmin={isAdmin} canRun={configured} defaultBranch={repo && repo.defaultBranch} />
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
