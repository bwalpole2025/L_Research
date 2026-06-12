import type { ConnectorManifest } from '@latex-studio/shared';
import type { AppConfig } from '../config.js';
import type { OAuthClientConfig } from '../oauth/flow.js';

/**
 * Static declaration of every connector. No secrets here — only ids, kinds,
 * least-privilege scopes, capabilities, and (for OAuth ones) the endpoint config.
 * `wired: true` means a real adapter/flow exists this milestone; `false` means
 * the connector is listed + typed but its data flow lands in a later milestone.
 */

export const CONNECTORS: ConnectorManifest[] = [
  // ── Model connectors (subscription via the vendor's official CLI — NO API key) ──
  {
    id: 'anthropic',
    kind: 'model',
    name: 'Claude',
    authType: 'subscriptionCli',
    scopes: [],
    capabilities: ['chat', 'edit', 'review', 'coderive', 'completions'],
    description: 'Anthropic Claude over your Claude subscription (Agent SDK). The default.',
    cli: { command: 'claude', signInHint: 'Run `claude login`', installHint: 'Install Claude Code (`npm i -g @anthropic-ai/claude-code`)' },
    wired: true,
  },
  {
    id: 'chatgpt',
    kind: 'model',
    name: 'ChatGPT',
    authType: 'subscriptionCli',
    scopes: [],
    capabilities: ['chat', 'edit', 'review', 'coderive'],
    description: 'OpenAI models over your ChatGPT subscription, via the Codex CLI. No API key.',
    cli: { command: 'codex', signInHint: 'Run `codex` and choose "Sign in with ChatGPT"', installHint: 'Install Codex (`npm i -g @openai/codex`)' },
    wired: true,
  },
  {
    id: 'gemini',
    kind: 'model',
    name: 'Gemini',
    authType: 'subscriptionCli',
    scopes: [],
    capabilities: ['chat', 'edit', 'review', 'coderive'],
    description: 'Google Gemini over your Google account, via the Gemini CLI. No API key.',
    cli: { command: 'gemini', signInHint: 'Run `gemini` and choose "Login with Google"', installHint: 'Install Gemini CLI (`npm i -g @google/gemini-cli`)' },
    wired: true,
  },

  // ── Storage / content connectors (OAuth2 + PKCE; token encrypted at rest) ──────
  {
    id: 'google-drive',
    kind: 'storage',
    name: 'Google Drive',
    authType: 'oauth2',
    scopes: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive.readonly'],
    capabilities: ['list', 'read', 'write', 'delete', 'metadata'],
    description: 'Import .tex/.bib/PDFs and back projects up to your Drive. Least-privilege scopes.',
    wired: true,
  },
  {
    id: 'notion',
    kind: 'storage',
    name: 'Notion',
    authType: 'oauth2',
    scopes: ['read_content'],
    capabilities: ['import-pages'],
    description: 'Import selected Notion pages as notes / draft .tex (read-only). Content is treated as data.',
    wired: true,
  },
  {
    id: 'dropbox',
    kind: 'storage',
    name: 'Dropbox',
    authType: 'oauth2',
    scopes: ['files.content.read', 'files.content.write'],
    capabilities: ['list', 'read', 'write', 'delete', 'metadata'],
    description: 'Dropbox file store over OAuth — list, read, write, delete files.',
    wired: true,
  },
  {
    id: 'onedrive',
    kind: 'storage',
    name: 'OneDrive',
    authType: 'oauth2',
    scopes: ['Files.ReadWrite', 'offline_access'],
    capabilities: ['list', 'read', 'write', 'delete', 'metadata'],
    description: 'Microsoft OneDrive file store over OAuth — list, read, write, delete files.',
    wired: true,
  },

  // ── Literature connectors (open APIs / API key) ────────────────────────────────
  {
    id: 'arxiv',
    kind: 'literature',
    name: 'arXiv',
    authType: 'none',
    scopes: [],
    capabilities: ['search', 'metadata', 'bibtex', 'pdf'],
    description: 'Open arXiv API: search, metadata, BibTeX, and PDF download (arXiv permits).',
    wired: true,
  },
  {
    id: 'crossref',
    kind: 'literature',
    name: 'CrossRef',
    authType: 'none',
    scopes: [],
    capabilities: ['metadata', 'bibtex'],
    description: 'Open CrossRef: search + metadata + BibTeX by DOI or title (no PDF).',
    wired: true,
  },
  {
    id: 'zotero',
    kind: 'literature',
    name: 'Zotero',
    authType: 'apiKey',
    scopes: ['library:read'],
    capabilities: ['search', 'metadata', 'bibtex', 'pdf'],
    description: 'Your Zotero library (items, BibTeX, attached PDFs) via an API key.',
    wired: true,
  },
  {
    id: 'semantic-scholar',
    kind: 'literature',
    name: 'Semantic Scholar',
    authType: 'apiKey',
    scopes: [],
    capabilities: ['search', 'metadata', 'bibtex'],
    description: 'Semantic Scholar search + metadata + BibTeX (optional API key for higher limits).',
    wired: true,
  },
];

export function getManifest(id: string): ConnectorManifest | undefined {
  return CONNECTORS.find((c) => c.id === id);
}

/**
 * Build the OAuth client config for an OAuth connector from app config, or null
 * if the connector isn't OAuth / has no endpoints. Client creds come from env
 * (the user registers the OAuth apps); the redirect URI is the api callback.
 */
export function oauthConfigFor(id: string, config: AppConfig): OAuthClientConfig | null {
  const redirectUri = `${config.oauthRedirectBaseUrl.replace(/\/+$/, '')}/connectors/${id}/callback`;
  switch (id) {
    case 'google-drive':
      return {
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        revokeUrl: 'https://oauth2.googleapis.com/revoke',
        clientId: config.googleOAuthClientId,
        clientSecret: config.googleOAuthClientSecret,
        redirectUri,
        // offline + consent so Google returns a refresh token.
        extraAuthParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
      };
    case 'notion':
      return {
        authUrl: 'https://api.notion.com/v1/oauth/authorize',
        tokenUrl: 'https://api.notion.com/v1/oauth/token',
        clientId: config.notionOAuthClientId,
        clientSecret: config.notionOAuthClientSecret,
        redirectUri,
        extraAuthParams: { owner: 'user' },
        basicAuth: true, // Notion's token endpoint uses HTTP Basic client auth
      };
    case 'dropbox':
      return {
        authUrl: 'https://www.dropbox.com/oauth2/authorize',
        tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
        revokeUrl: 'https://api.dropboxapi.com/2/auth/token/revoke',
        clientId: config.dropboxOAuthClientId,
        clientSecret: config.dropboxOAuthClientSecret,
        redirectUri,
        // token_access_type=offline so Dropbox returns a refresh token.
        extraAuthParams: { token_access_type: 'offline' },
      };
    case 'onedrive':
      return {
        authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        clientId: config.onedriveOAuthClientId,
        clientSecret: config.onedriveOAuthClientSecret,
        redirectUri,
      };
    default:
      return null;
  }
}
