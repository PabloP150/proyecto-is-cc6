import { render, screen } from '@testing-library/react';
import ChatProjectInfo from '../ChatProjectInfo';

const GROUPS = [
  { gid: 'AAA-1', name: 'Equipo Web' },
  { gid: 'BBB-2', name: 'Equipo Móvil' },
];

describe('ChatProjectInfo', () => {
  it('without a group says to pick one in the navbar and shows no repo chip', () => {
    render(<ChatProjectInfo groups={GROUPS} value={null} />);
    expect(screen.getByTestId('chat-project')).toHaveTextContent('select a group in the navbar');
    expect(screen.queryByText('No repository')).not.toBeInTheDocument();
  });

  it('matches the value case-insensitively and shows the repository chip', () => {
    render(<ChatProjectInfo groups={GROUPS} value="aaa-1" repo={{ fullName: 'acme/web', defaultBranch: 'main' }} />);
    expect(screen.getByTestId('chat-project')).toHaveTextContent('Equipo Web');
    expect(screen.getByText('acme/web')).toBeInTheDocument();
  });

  it('shows "No repository" when the group has none', () => {
    render(<ChatProjectInfo groups={GROUPS} value="BBB-2" repo={null} />);
    expect(screen.getByText('No repository')).toBeInTheDocument();
  });
});
