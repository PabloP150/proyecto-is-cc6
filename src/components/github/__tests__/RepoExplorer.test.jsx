import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { getFile, getReadme, getTree } from '../../../api/github';
import theme from '../../../theme/theme';
import RepoExplorer from '../RepoExplorer';

// The markdown stack is ESM-only; capture the props to check the security configuration.
const mockMarkdownCalls = [];
jest.mock('react-markdown', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: (props) => {
      mockMarkdownCalls.push(props);
      return React.createElement('div', { 'data-testid': 'markdown-render' }, props.children);
    },
  };
});
jest.mock('remark-gfm', () => ({ __esModule: true, default: function remarkGfm() {} }));
jest.mock('rehype-sanitize', () => ({ __esModule: true, default: function rehypeSanitize() {} }));
jest.mock('rehype-raw', () => ({ __esModule: true, default: function rehypeRaw() {} }));
jest.mock('../../../api/github', () => ({ getTree: jest.fn(), getFile: jest.fn(), getReadme: jest.fn() }));

const REPO = { fullName: 'acme/app', htmlUrl: 'https://github.com/acme/app', defaultBranch: 'main' };
const TREE = {
  ref: 'main',
  sha: 'abc',
  truncated: false,
  entries: [
    { path: 'README.md', type: 'blob', size: 40 },
    { path: 'src', type: 'tree' },
    { path: 'src/index.js', type: 'blob', size: 30 },
    { path: 'src/components', type: 'tree' },
    { path: 'src/components/App.jsx', type: 'blob', size: 50 },
    { path: 'logo.png', type: 'blob', size: 2048 },
    { path: 'data.csv', type: 'blob', size: 5000000 },
  ],
};
const README = { path: 'README.md', size: 40, binary: false, content: '# Hola\n<script>alert(1)</script>', htmlUrl: 'https://github.com/acme/app/blob/main/README.md' };

const renderExplorer = () =>
  render(
    <ThemeProvider theme={theme}>
      <RepoExplorer gid="G1" repo={REPO} />
    </ThemeProvider>
  );

beforeEach(() => {
  mockMarkdownCalls.length = 0;
  getTree.mockReset().mockResolvedValue(TREE);
  getReadme.mockReset().mockResolvedValue(README);
  getFile.mockReset();
});

const tree = () => screen.getByRole('navigation', { name: 'Archivos del repositorio' });

describe('RepoExplorer', () => {
  it('opens the README by default with sanitize and without rehype-raw', async () => {
    renderExplorer();
    expect(await screen.findByTestId('markdown-render')).toHaveTextContent('# Hola');
    const props = mockMarkdownCalls[mockMarkdownCalls.length - 1];
    expect(props.rehypePlugins).toEqual([rehypeSanitize]);
    expect(props.rehypePlugins).not.toContain(rehypeRaw);
    expect(props.remarkPlugins).toEqual([remarkGfm]);
    expect(screen.getByRole('link', { name: /Ver en GitHub/ })).toHaveAttribute('href', README.htmlUrl);
  });

  it('builds a collapsible folder tree', async () => {
    renderExplorer();
    const folder = await within(tree()).findByRole('button', { name: 'src' });
    expect(folder).toHaveAttribute('aria-expanded', 'false');
    expect(within(tree()).queryByRole('button', { name: 'index.js' })).not.toBeInTheDocument();

    fireEvent.click(folder);
    expect(folder).toHaveAttribute('aria-expanded', 'true');
    expect(within(tree()).getByRole('button', { name: 'index.js' })).toBeInTheDocument();
    expect(within(tree()).getByRole('button', { name: 'components' })).toBeInTheDocument();

    fireEvent.click(folder);
    expect(within(tree()).queryByRole('button', { name: 'index.js' })).not.toBeInTheDocument();
  });

  it('filters files and expands the matching folders', async () => {
    renderExplorer();
    await within(tree()).findByRole('button', { name: 'src' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Filtrar archivos por nombre o ruta' }), { target: { value: 'app' } });
    expect(within(tree()).getByRole('button', { name: 'App.jsx' })).toBeInTheDocument();
    expect(within(tree()).queryByRole('button', { name: 'index.js' })).not.toBeInTheDocument();
    expect(screen.getByText('1 coincidencia.')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Filtrar archivos por nombre o ruta' }), { target: { value: 'zzz' } });
    expect(screen.getByText('Ningún archivo coincide con el filtro.')).toBeInTheDocument();
  });

  it('warns when the tree is truncated', async () => {
    getTree.mockResolvedValue({ ...TREE, truncated: true });
    renderExplorer();
    expect(await screen.findByText(/solo se muestran los primeros 7 elementos/)).toBeInTheDocument();
  });

  it('shows text files with line numbers and a wrap toggle', async () => {
    getFile.mockResolvedValue({ path: 'src/index.js', size: 30, binary: false, content: 'const a = 1;\nconst b = 2;\n', htmlUrl: 'https://github.com/acme/app/blob/main/src/index.js' });
    renderExplorer();
    fireEvent.click(await within(tree()).findByRole('button', { name: 'src' }));
    fireEvent.click(within(tree()).getByRole('button', { name: 'index.js' }));

    const code = await screen.findByTestId('code-view');
    expect(getFile).toHaveBeenCalledWith('G1', 'src/index.js', expect.objectContaining({ ref: 'main' }));
    expect(code).toHaveTextContent('const a = 1;');
    expect(screen.getByTestId('line-numbers').textContent).toBe('1\n2');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Ajustar líneas' }));
    expect(screen.queryByTestId('line-numbers')).not.toBeInTheDocument();
  });

  it('offers GitHub for binary files', async () => {
    getFile.mockResolvedValue({ path: 'logo.png', size: 2048, binary: true, content: null, htmlUrl: 'https://github.com/acme/app/blob/main/logo.png' });
    renderExplorer();
    fireEvent.click(await within(tree()).findByRole('button', { name: 'logo.png' }));
    expect(await screen.findByText('Este archivo es binario y no se puede previsualizar.')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /Ver en GitHub/ });
    expect(links.some((a) => a.getAttribute('href') === 'https://github.com/acme/app/blob/main/logo.png')).toBe(true);
  });

  it('explains 413 FILE_TOO_LARGE and links to GitHub', async () => {
    getFile.mockRejectedValue(Object.assign(new Error('too large'), { code: 'FILE_TOO_LARGE', status: 413 }));
    renderExplorer();
    fireEvent.click(await within(tree()).findByRole('button', { name: 'data.csv' }));
    expect(await screen.findByText(/El archivo supera 1 MB/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ver en GitHub/ })).toHaveAttribute('href', 'https://github.com/acme/app/blob/main/data.csv');
  });

  it('handles a repository without README', async () => {
    getReadme.mockRejectedValue(Object.assign(new Error('404'), { code: 'FILE_NOT_FOUND', status: 404 }));
    renderExplorer();
    expect(await screen.findByText(/Este repositorio no tiene README/)).toBeInTheDocument();
  });

  it('shows a retryable error when the tree fails', async () => {
    getTree.mockRejectedValueOnce(Object.assign(new Error('502'), { code: 'GITHUB_ERROR', status: 502 }));
    renderExplorer();
    expect(await screen.findByText('GitHub respondió con un error. Inténtalo más tarde.')).toBeInTheDocument();
    fireEvent.click(within(tree()).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(getTree).toHaveBeenCalledTimes(2));
    expect(await within(tree()).findByRole('button', { name: 'src' })).toBeInTheDocument();
  });

  describe('README images', () => {
    const renderComponents = async () => {
      renderExplorer();
      await screen.findByTestId('markdown-render');
      return mockMarkdownCalls[mockMarkdownCalls.length - 1].components;
    };

    it('loads images only from GitHub hosts', async () => {
      const { img: Img } = await renderComponents();
      render(
        <>
          <Img src="https://raw.githubusercontent.com/acme/app/main/logo.png" alt="logo" />
          <Img src="https://user-images.githubusercontent.com/1/shot.png" alt="shot" />
          <Img src="https://evil.example/pixel.gif" alt="pixel" />
        </>
      );
      expect(screen.getByRole('img', { name: 'logo' })).toHaveAttribute('src', 'https://raw.githubusercontent.com/acme/app/main/logo.png');
      expect(screen.getByRole('img', { name: 'shot' })).toBeInTheDocument();
      expect(screen.queryByRole('img', { name: 'pixel' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: '[Imagen: pixel]' })).toHaveAttribute('href', 'https://evil.example/pixel.gif');
    });

    it('resolves relative images to the repository raw URL', async () => {
      const { img: Img } = await renderComponents();
      render(<Img src="docs/diagram.png" alt="diagram" />);
      expect(screen.getByRole('img', { name: 'diagram' })).toHaveAttribute('src', 'https://github.com/acme/app/raw/main/docs/diagram.png');
    });

    it('never nests a link for an external image inside a link (badges)', async () => {
      const { a: A, img: Img } = await renderComponents();
      render(
        <div data-testid="badge">
          <A href="https://ci.example/build">
            <Img src="https://img.shields.io/badge/build-passing-green" alt="build" />
          </A>
        </div>
      );
      const badge = within(screen.getByTestId('badge'));
      expect(badge.getByRole('link', { name: '[Imagen: build]' })).toHaveAttribute('href', 'https://ci.example/build');
      expect(badge.getAllByRole('link')).toHaveLength(1);
    });
  });
});
