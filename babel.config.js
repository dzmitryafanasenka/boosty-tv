module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // Zod 4's ESM build uses `export * as ns from` (e.g. zod/v4/classic/external.js),
  // which the RN preset does not transform; Metro fails the bundle without this.
  plugins: ['@babel/plugin-transform-export-namespace-from'],
};
