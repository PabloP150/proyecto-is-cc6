import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { auditTask } from '../../../api/github';
import theme from '../../../theme/theme';
import TaskAiPanel from '../TaskAiPanel';

jest.mock('../../../api/github', () => ({ auditTask: jest.fn() }));

const renderPanel = (props) => render(<ThemeProvider theme={theme}><TaskAiPanel tid="T-1" aiEnabled {...props} /></ThemeProvider>);

beforeEach(() => auditTask.mockReset());

test('runs the audit and lists findings with their source', async () => {
  auditTask.mockResolvedValue({
    verdict: 'fail',
    files: [{ path: 'a.py' }],
    counts: { high: 1, medium: 0, low: 1 },
    findings: [
      { path: 'a.py', line: 3, severity: 'high', title: 'Hardcoded credential', source: 'rule', detail: 'PW = "x"' },
      { path: 'a.py', line: 9, severity: 'low', title: 'Magic numbers', source: 'model' },
    ],
  });
  renderPanel();
  fireEvent.click(screen.getByRole('button', { name: /auditar/i }));
  expect(screen.getByRole('status')).toBeInTheDocument();
  expect(await screen.findByText(/Problemas graves/)).toBeInTheDocument();
  expect(screen.getByText('Hardcoded credential')).toBeInTheDocument();
  expect(screen.getByText('a.py:3')).toBeInTheDocument();
  expect(screen.getAllByText('IA, orientativo')).toHaveLength(1);
  expect(auditTask).toHaveBeenCalledWith('T-1', expect.objectContaining({ signal: expect.anything() }));
});

test('shows the server error', async () => {
  auditTask.mockRejectedValue(Object.assign(new Error('The AI server is not configured (AI_SERVER_URL).'), { code: 'AI_SERVER_DISABLED' }));
  renderPanel();
  fireEvent.click(screen.getByRole('button', { name: /auditar/i }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /auditar/i })).toBeEnabled();
});

test('without admin consent there is no audit button', () => {
  renderPanel({ aiEnabled: false });
  expect(screen.queryByRole('button', { name: /auditar/i })).not.toBeInTheDocument();
  expect(screen.getByText(/desactivado/)).toBeInTheDocument();
});
