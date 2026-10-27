/**
 * Architecture boundaries (ARCHITECTURE-SPINE, epic-1-context "Boundaries"):
 * - shared never imports features or app;
 * - features never import app;
 * - app, features and shared never import test-only code (src/test);
 * - imports that resolve to no known element or file fail lint
 *   (no-unknown-dependencies), so unresolvable paths cannot bypass the rules;
 * - a feature imports another feature only through its index.ts, and only
 *   along the allowlisted edges listed in FEATURE_EDGES;
 * - src/shared/api/session/ is private to the SessionManager facade (ADR
 *   0009): only sessionManager.ts imports it, and among the session
 *   modules a session module imports only ./core, ./codec and ./types
 *   (eslint-plugin-boundaries sees shared/api as one element, so
 *   no-restricted-imports enforces this).
 * __tests__/boundaries.test.js proves the rules fail on forbidden imports.
 */

/** Allowlisted feature -> feature edges (from -> to[]). */
const FEATURE_EDGES = {
  post: ['polls', 'player'],
};

const featureEdgePolicies = Object.entries(FEATURE_EDGES).map(
  ([from, targets]) => ({
    from: { element: { type: 'feature', captured: { feature: from } } },
    allow: {
      to: {
        element: {
          type: 'feature',
          captured: { feature: targets },
          fileInternalPath: ['index.ts', 'index.tsx'],
        },
      },
    },
  }),
);

const SESSION_PRIVATE_MESSAGE =
  'src/shared/api/session/ is private: import the SessionManager facade (ADR 0009).';
const SESSION_MODULE_MESSAGE =
  'Among the session modules, a session module imports only ./core, ./codec and ./types, never the facade (ADR 0009).';
/** The session folder by its full path, from anywhere. */
const SESSION_FOLDER = ['**/shared/api/session', '**/shared/api/session/**'];

const COPY_MESSAGE = 'UI strings come from the i18n catalog (t / tp).';
/** A JS expression rendered as a JSX child (not an attribute value). */
const JSX_CHILD = ':matches(JSXElement, JSXFragment) > JSXExpressionContainer';
/** A non-blank string literal or any template literal. */
const STRING = ':matches(Literal[value=/\\S/], TemplateLiteral)';
/** Props that carry user-facing copy. */
const COPY_PROPS =
  '/^(label|accessibilityLabel|accessibilityHint|placeholder|title)$/';

module.exports = {
  root: true,
  extends: '@react-native',
  plugins: ['boundaries'],
  settings: {
    'import/resolver': {
      node: { extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'] },
    },
    'boundaries/legacy-templates': false,
    'boundaries/elements': [
      { type: 'app', pattern: 'src/app' },
      { type: 'feature', pattern: 'src/features/*', capture: ['feature'] },
      { type: 'shared', pattern: 'src/shared/*', capture: ['module'] },
      { type: 'test', pattern: 'src/test' },
    ],
  },
  rules: {
    'boundaries/dependencies': [
      2,
      {
        default: 'allow',
        policies: [
          {
            from: { element: { type: 'shared' } },
            disallow: {
              to: { element: { type: ['app', 'feature'] } },
            },
          },
          {
            from: { element: { type: 'feature' } },
            disallow: { to: { element: { type: 'app' } } },
          },
          {
            from: { element: { type: 'feature' } },
            disallow: {
              to: {
                element: {
                  type: 'feature',
                  captured: { feature: '!{{ from.element.captured.feature }}' },
                },
              },
            },
          },
          {
            from: { element: { type: ['app', 'feature', 'shared'] } },
            disallow: { to: { element: { type: 'test' } } },
          },
          // Later policies override earlier ones: re-allow the edges above.
          ...featureEdgePolicies,
        ],
      },
    ],
    'boundaries/no-unknown-dependencies': 2,
  },
  overrides: [
    {
      // ADR 0009: outside the facade and session/ itself, nothing imports a
      // session module.
      files: ['**/*.{js,jsx,ts,tsx}'],
      excludedFiles: [
        'src/shared/api/sessionManager.ts',
        'src/shared/api/session/**',
      ],
      rules: {
        'no-restricted-imports': [
          2,
          {
            patterns: [
              {
                group: SESSION_FOLDER,
                message: SESSION_PRIVATE_MESSAGE,
              },
            ],
          },
        ],
      },
    },
    {
      // Another shared module reaches session/ through `../api/session`.
      files: ['src/shared/**/*.{js,jsx,ts,tsx}'],
      excludedFiles: ['src/shared/api/**'],
      rules: {
        'no-restricted-imports': [
          2,
          {
            patterns: [
              {
                group: [
                  ...SESSION_FOLDER,
                  '../api/session',
                  '../api/session/**',
                  '../../api/session',
                  '../../api/session/**',
                ],
                message: SESSION_PRIVATE_MESSAGE,
              },
            ],
          },
        ],
      },
    },
    {
      // Inside shared/api, relative paths reach session/ without the
      // shared/api prefix.
      files: ['src/shared/api/**/*.{js,jsx,ts,tsx}'],
      excludedFiles: [
        'src/shared/api/sessionManager.ts',
        'src/shared/api/session/**',
      ],
      rules: {
        'no-restricted-imports': [
          2,
          {
            patterns: [
              {
                group: [
                  ...SESSION_FOLDER,
                  './session',
                  './session/**',
                  '../session',
                  '../session/**',
                ],
                message: SESSION_PRIVATE_MESSAGE,
              },
            ],
          },
        ],
      },
    },
    {
      // ADR 0009: among the session modules, a session module imports only
      // core, codec and types (directly as ./x, not up and back into
      // session/); never the facade. Their tests (session/__tests__) may
      // import any module.
      files: ['src/shared/api/session/*.{js,jsx,ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          2,
          {
            paths: [
              { name: '..', message: SESSION_MODULE_MESSAGE },
              { name: '../', message: SESSION_MODULE_MESSAGE },
            ],
            patterns: [
              {
                group: ['./*', '!./core', '!./codec', '!./types'],
                message: SESSION_MODULE_MESSAGE,
              },
              {
                group: [
                  ...SESSION_FOLDER,
                  '../session',
                  '../session/**',
                  '../../api/session',
                  '../../api/session/**',
                  '../sessionManager',
                  '../index',
                ],
                message: SESSION_MODULE_MESSAGE,
              },
            ],
          },
        ],
      },
    },
    {
      // UI copy only through the typed i18n catalog (src/shared/i18n).
      // no-raw-text catches literals outside <Text>; it allows any element
      // named Text, so no-restricted-syntax also rejects literal JSX
      // children (also inside ternaries, && and +, and in fragments) and
      // literal copy-bearing props. __tests__/noRawText.test.js proves each.
      files: [
        'src/app/**',
        'src/features/**',
        'src/shared/ui/**',
        'src/shared/focus/**',
      ],
      excludedFiles: ['**/__tests__/**'],
      rules: {
        'react-native/no-raw-text': 2,
        'no-restricted-syntax': [
          2,
          {
            selector: 'JSXText[value=/\\S/]',
            message: COPY_MESSAGE,
          },
          {
            selector: `${JSX_CHILD} > ${STRING}`,
            message: COPY_MESSAGE,
          },
          {
            selector: `${JSX_CHILD} > :matches(ConditionalExpression, LogicalExpression, BinaryExpression) > ${STRING}`,
            message: COPY_MESSAGE,
          },
          {
            selector: `JSXAttribute[name.name=${COPY_PROPS}] > ${STRING}`,
            message: COPY_MESSAGE,
          },
          {
            selector: `JSXAttribute[name.name=${COPY_PROPS}] > JSXExpressionContainer > ${STRING}`,
            message: COPY_MESSAGE,
          },
        ],
      },
    },
  ],
};
