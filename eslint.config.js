import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        chrome: 'readonly',
        console: 'readonly',
        document: 'readonly',
        window: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        Promise: 'readonly',
        Map: 'readonly',
        Set: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        FileReader: 'readonly',
        FileList: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLFormElement: 'readonly',
        HTMLSelectElement: 'readonly',
        HTMLDivElement: 'readonly',
        MouseEvent: 'readonly',
        KeyboardEvent: 'readonly',
        self: 'readonly',
        prompt: 'readonly',
        require: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooksPlugin,
    },
    rules: {
      // TypeScript rules
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // React rules
      //
      // eslint-plugin-react is deliberately not installed. The only two of its
      // rules this config ever named were both switched off — one because the
      // new JSX transform makes it wrong, the other because TypeScript already
      // does the job — so it contributed nothing while capping eslint at 9.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // General rules
      'no-console': 'off',
      'no-unused-vars': 'off', // Use TypeScript's version
      'no-undef': 'off', // TypeScript handles this
      'prefer-const': 'warn',
      'no-var': 'error',
    },
  },
  {
    // Firefox's chrome.* namespace returns undefined instead of a promise, so
    // `await chrome.storage.local.get(...)` resolves INSTANTLY and the call
    // silently does nothing — no error, and Chrome-only CI stays green. That
    // has shipped at least four times: context menus racing to empty, header
    // rules never applied, the client left unbuilt, and every context-menu add
    // falling back to the cookie-less path.
    //
    // Always use the callback form wrapped in a Promise; tools/chromeStorage.ts
    // is the model.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        // The callee is a member chain of unknown depth (chrome.tabs.create,
        // chrome.storage.local.get, ...), so each depth is matched explicitly.
        ...[1, 2, 3, 4].map((depth) => ({
          selector: `AwaitExpression > CallExpression > MemberExpression[${'object.'.repeat(depth)}name='chrome']`,
          message:
            'chrome.* returns undefined on Firefox, so await resolves immediately and the call does nothing. Use the callback form wrapped in a Promise (see tools/chromeStorage.ts).',
        })),
        ...[1, 2, 3, 4].map((depth) => ({
          selector: `MemberExpression[property.name='then'] > CallExpression > MemberExpression[${'object.'.repeat(depth)}name='chrome']`,
          message:
            'chrome.* returns undefined on Firefox, so .then() throws. Use the callback form wrapped in a Promise (see tools/chromeStorage.ts).',
        })),
      ],
    },
  },
  {
    // The layering is real and holds today, but nothing enforced it: tools/ is
    // a leaf, and the UI reaches the background only through the message
    // dispatcher. A single careless import would erode that invisibly.
    files: ['src/tools/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/bg/*', '**/stores/*', '**/components/*', '**/pages/*', '**/hooks/*'],
              // A type carries no runtime dependency, and two helpers
              // legitimately describe shapes that upper layers own:
              // safeJsonParse returns a TransmissionResponse, rootStoreCtx
              // types a React context.
              allowTypeImports: true,
              message:
                'tools/ is a leaf layer: it must not depend at runtime on bg/, stores/, components/, pages/ or hooks/. Type-only imports are allowed.',
            },
          ],
        },
      ],
    },
  },
  {
    // stores/ is in here now that the settings table has moved to protocol/.
    // It was the one UI-side layer that could import bg/ and pass lint, which
    // is how ClientStore came to restate what the table already declared.
    files: [
      'src/components/**/*.{ts,tsx}',
      'src/hooks/**/*.{ts,tsx}',
      'src/pages/**/*.{ts,tsx}',
      'src/stores/**/*.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/bg/*'],
              // Types are fine — ClientStore already imports PeerData and
              // TorrentDetailData from the service that defines them.
              allowTypeImports: true,
              message:
                'The UI reaches the background through callApi and the message contract, never by importing bg/ directly. Type-only imports are allowed.',
            },
          ],
        },
      ],
    },
  },
  {
    // Assertions are how a test says "this is set up correctly"; the rule is
    // aimed at production code, where it hides a real nullability decision.
    files: ['src/**/__tests__/**/*.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // The build scripts are plain CommonJS run by Node during the build. They
    // were excluded from linting entirely, which is how the manifest transform
    // and the packaging code ended up as the only production-affecting code in
    // the repo with neither lint nor tests.
    files: ['builder/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        // defaultBuildEnv.js publishes BUILD_ENV on the global object, which is
        // how webpack.config.js and the compress scripts read it
        global: 'writable',
        BUILD_ENV: 'readonly',
        TextEncoder: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'webpack.config.js'],
  },
];
