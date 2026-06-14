// Flat config (ESLint v9). Replaces the v8 .eslintrc.cjs form.
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'node_modules/**',
      '**/node_modules/**',
      'dist/**',
      '**/dist/**',
      'build/**',
      '**/build/**',
      '.next/**',
      'coverage/**',
      '**/*.config.cjs',
      '**/*.config.mjs',
      'infra/supabase-template/**',
      'apps/web/src/theme/**',
      '.specify/**',
      'specs/**',
      '.claude/**',
      '.github/**',
      'website/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module', project: false },
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', NodeJS: 'readonly' },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['**/tests/**/*.ts', '**/tests/**/*.tsx', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  prettierConfig,
];
