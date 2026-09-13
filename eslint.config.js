import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const routingRestrictions = ['node:child_process', 'child_process', 'execa', 'node:http', 'node:https', 'node:net', 'node:tls', 'http', 'https', 'net', 'tls', 'undici', '**/net/**', '**/report/**', '**/ingest/ccusage'];
const analysisRestrictions = ['**/providers/**', '**/net/**', '**/git/**', '**/store/**', 'node:fs', 'node:fs/promises', 'fs', 'fs/promises', 'node:child_process', 'child_process', 'execa'];

// Two hard constraints from AGENTS.md are enforced here rather than by convention:
// network access only under src/net, and the report layer never importing the
// layers that know about providers or numbers.
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'Network access lives only in src/net/. See AGENTS.md.' },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/net/**/*.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    // The site's local preview server is plain ESM run by node. typescript-eslint switches
    // no-undef off for TypeScript, so nothing else in the tree needs these declared.
    files: ['site/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly' } },
  },
  {
    files: ['src/report/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/analysis/**', '**/ingest/**', '**/providers/**', '**/config/**', '**/store/**', '**/net/**', '**/git/**', '**/routing/**'],
              message: 'src/report renders a Report value and nothing else. See AGENTS.md.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/routing/**/*.ts', 'src/analysis/routing.ts', 'src/commands/route*.ts', 'src/store/routing.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: routingRestrictions,
          message: 'Shadow routing has no network, executor process or provider report interface.',
        }],
      }],
    },
  },
  {
    files: ['src/analysis/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: analysisRestrictions,
              message: 'src/analysis is pure over normalized records. See AGENTS.md.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/analysis/routing.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{
        group: [...new Set([...routingRestrictions, ...analysisRestrictions])],
        message: 'Routing analysis is pure and has no executor, network or report interface.',
      }] }],
    },
  },
);
