import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen } from '@testing-library/react';
import { auditTask, generateTaskTests } from '../../../api/github';
import theme from '../../../theme/theme';
import TaskAiPanel from '../TaskAiPanel';

jest.mock('../../../api/github', () => ({ auditTask: jest.fn(), generateTaskTests: jest.fn() }));

const renderPanel = (props) => render(<ThemeProvider theme={theme}><TaskAiPanel tid="T-1" aiEnabled {...props} /></ThemeProvider>);

beforeEach(() => { auditTask.mockReset(); generateTaskTests.mockReset(); });

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

test('generates tests and shows proposals, flags and skips', async () => {
  generateTaskTests.mockResolvedValue({
    proposals: [
      { source: 'calc.py', test_path: 'tests/test_calc.py', framework: 'pytest', syntax_ok: true, problem: null,
        cases: [{ name: 'test_add', covers: 'suma' }], code: 'def test_add():\n    assert add(1, 2) == 3\n' },
      { source: 'neg.js', test_path: 'src/__tests__/neg.test.js', framework: 'jest', syntax_ok: false,
        problem: 'no test() / it() calls', cases: [], code: 'x' },
    ],
    skipped: [{ path: 'README.md', reason: 'no supported test framework' }],
  });
  renderPanel();
  fireEvent.click(screen.getByRole('button', { name: /generar pruebas/i }));
  expect(await screen.findByText(/2 archivos de pruebas propuestos/)).toBeInTheDocument();
  expect(screen.getByText('tests/test_calc.py')).toBeInTheDocument();
  expect(screen.getByText('sintaxis ok')).toBeInTheDocument();
  expect(screen.getByText('inválido')).toBeInTheDocument();
  expect(screen.getByText(/Omitido README.md/)).toBeInTheDocument();
});
