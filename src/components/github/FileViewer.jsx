import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import WrapTextIcon from '@mui/icons-material/WrapText';
import { Alert, Box, CircularProgress, FormControlLabel, Switch, Typography } from '@mui/material';
import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import Button from '../ui/Button';
import { formatBytes, safeGitHubUrl } from './githubUtils';

const MARKDOWN_RE = /\.(md|markdown|mdown|mkd|mkdn)$/i;
export const isMarkdownPath = (path) => MARKDOWN_RE.test(String(path || ''));

// README content is untrusted: GFM + sanitize only (never rehype-raw).
const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeSanitize];

const markdownSx = {
  color: 'text.primary',
  lineHeight: 1.7,
  wordBreak: 'break-word',
  '& h1, & h2, & h3, & h4': { mt: 2.5, mb: 1, fontWeight: 600, lineHeight: 1.3 },
  '& h1': { fontSize: '1.6rem', pb: 0.5, borderBottom: '1px solid rgba(255,255,255,0.12)' },
  '& h2': { fontSize: '1.3rem', pb: 0.5, borderBottom: '1px solid rgba(255,255,255,0.08)' },
  '& h3': { fontSize: '1.1rem' },
  '& a': { color: 'secondary.light' },
  '& img': { maxWidth: '100%' },
  '& ul, & ol': { pl: 3 },
  '& code': { backgroundColor: 'rgba(0,0,0,0.35)', px: 0.5, borderRadius: 0.5, fontFamily: 'monospace', fontSize: '0.88em' },
  '& pre': { backgroundColor: 'rgba(0,0,0,0.35)', p: 1.5, borderRadius: 1, overflowX: 'auto' },
  '& pre code': { backgroundColor: 'transparent', p: 0 },
  '& table': { borderCollapse: 'collapse', my: 1.5, display: 'block', overflowX: 'auto' },
  '& th, & td': { border: '1px solid rgba(255,255,255,0.18)', px: 1.25, py: 0.5 },
  '& th': { backgroundColor: 'rgba(255,255,255,0.08)' },
  '& blockquote': { borderLeft: '3px solid rgba(255,255,255,0.3)', m: 0, pl: 1.5, color: 'text.secondary' },
  '& hr': { border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)' },
};

const ABSOLUTE_RE = /^[a-z][a-z0-9+.-]*:/i;

function resolveUrl(href, base) {
  if (!href || ABSOLUTE_RE.test(href) || href.startsWith('#') || !base) return href;
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function MarkdownView({ content, linkBase, imageBase }) {
  // Relative README links/images point into the repo on GitHub, not into TaskMate.
  const components = useMemo(
    () => ({
      a: ({ node, href, children, ...rest }) => {
        const target = resolveUrl(href, linkBase);
        const external = typeof target === 'string' && /^https?:/i.test(target);
        return (
          <a href={target} {...rest} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            {children}
          </a>
        );
      },
      img: ({ node, src, alt, ...rest }) => (
        <img src={resolveUrl(src, imageBase)} alt={alt || ''} loading="lazy" referrerPolicy="no-referrer" {...rest} />
      ),
    }),
    [linkBase, imageBase]
  );

  return (
    <Box className="markdown-content" sx={markdownSx} data-testid="markdown-view">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={components}>
        {String(content || '')}
      </ReactMarkdown>
    </Box>
  );
}

function CodeView({ content }) {
  const [wrap, setWrap] = useState(false);
  const text = String(content || '');
  const lineCount = text.length === 0 ? 1 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  const numbers = useMemo(
    () => Array.from({ length: Math.max(lineCount, 1) }, (_, i) => i + 1).join('\n'),
    [lineCount]
  );

  const preSx = {
    m: 0,
    py: 1.5,
    fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Consolas, monospace',
    fontSize: '0.82rem',
    lineHeight: 1.6,
  };

  return (
    <Box>
      <FormControlLabel
        sx={{ mb: 1 }}
        control={<Switch size="small" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />}
        label={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <WrapTextIcon fontSize="small" aria-hidden />
            <Typography variant="body2">Ajustar líneas</Typography>
          </Box>
        }
      />
      <Box
        sx={{
          display: 'flex',
          borderRadius: 1,
          border: '1px solid rgba(255,255,255,0.1)',
          background: 'rgba(2, 6, 23, 0.55)',
          overflow: 'auto',
          maxHeight: '65vh',
        }}
      >
        {/* Line numbers only line up with unwrapped code. */}
        {!wrap && (
          <Box
            component="pre"
            aria-hidden
            data-testid="line-numbers"
            sx={{
              ...preSx,
              px: 1.5,
              textAlign: 'right',
              color: 'rgba(148, 163, 184, 0.6)',
              userSelect: 'none',
              borderRight: '1px solid rgba(255,255,255,0.08)',
              position: 'sticky',
              left: 0,
              background: 'rgba(2, 6, 23, 0.9)',
            }}
          >
            {numbers}
          </Box>
        )}
        <Box
          component="pre"
          data-testid="code-view"
          tabIndex={0}
          aria-label="Contenido del archivo"
          sx={{ ...preSx, px: 2, flex: 1, whiteSpace: wrap ? 'pre-wrap' : 'pre', wordBreak: wrap ? 'break-word' : 'normal' }}
        >
          {text}
        </Box>
      </Box>
    </Box>
  );
}

function GitHubLinkButton({ href, children = 'Ver en GitHub' }) {
  const safe = safeGitHubUrl(href);
  if (!safe) return null;
  return (
    <Button
      variant="ghost"
      size="small"
      component="a"
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      endIcon={<OpenInNewIcon fontSize="small" />}
    >
      {children}
    </Button>
  );
}

/**
 * Shows one file (or the README). Props: path, loading, error ({code, message} | null),
 * file ({path, size, binary, content, htmlUrl} | null), fallbackUrl (GitHub blob URL when the API
 * gives none), linkBase/imageBase (for relative markdown URLs), onRetry, emptyMessage.
 */
export default function FileViewer({ path, loading, error, file, fallbackUrl, linkBase, imageBase, onRetry, emptyMessage }) {
  const githubUrl = safeGitHubUrl(file && file.htmlUrl) || safeGitHubUrl(fallbackUrl);

  let body;
  if (loading) {
    body = (
      <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 4, justifyContent: 'center' }}>
        <CircularProgress size={22} />
        <Typography color="text.secondary">Cargando archivo…</Typography>
      </Box>
    );
  } else if (error) {
    const tooLarge = error.code === 'FILE_TOO_LARGE' || error.status === 413;
    body = (
      <Alert
        severity={tooLarge ? 'info' : 'error'}
        action={
          tooLarge ? (
            <GitHubLinkButton href={githubUrl} />
          ) : (
            onRetry && (
              <Button variant="ghost" size="small" onClick={onRetry}>
                Reintentar
              </Button>
            )
          )
        }
      >
        {tooLarge ? 'El archivo supera 1 MB y no se puede mostrar aquí. Ábrelo en GitHub.' : error.message}
      </Alert>
    );
  } else if (!file) {
    body = (
      <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
        {emptyMessage || 'Selecciona un archivo del árbol para verlo.'}
      </Typography>
    );
  } else if (file.binary) {
    body = (
      <Alert severity="info" action={<GitHubLinkButton href={githubUrl} />}>
        Este archivo es binario y no se puede previsualizar.
      </Alert>
    );
  } else if (isMarkdownPath(file.path || path)) {
    body = <MarkdownView content={file.content} linkBase={linkBase} imageBase={imageBase} />;
  } else {
    body = <CodeView key={file.path || path} content={file.content} />;
  }

  return (
    <Box sx={{ minWidth: 0 }}>
      {(path || file) && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
          <Typography component="h3" sx={{ fontFamily: 'monospace', fontWeight: 600, wordBreak: 'break-all', flex: 1, minWidth: 0 }}>
            {(file && file.path) || path}
          </Typography>
          {file && Number.isFinite(Number(file.size)) && (
            <Typography variant="caption" color="text.secondary">
              {formatBytes(file.size)}
            </Typography>
          )}
          {file && !error && !loading && <GitHubLinkButton href={githubUrl} />}
        </Box>
      )}
      {body}
    </Box>
  );
}
