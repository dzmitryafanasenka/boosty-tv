/**
 * Architecture boundaries (ARCHITECTURE-SPINE, epic-1-context "Boundaries"):
 * - shared never imports features or app;
 * - features never import app;
 * - app, features and shared never import test-only code (src/test);
 * - imports that resolve to no known element or file fail lint
 *   (no-unknown-dependencies), so unresolvable paths cannot bypass the rules;
 * - a feature imports another feature only through its index.ts, and only
 *   along the allowlisted edges listed in FEATURE_EDGES.
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
};
