module.exports = {
  preset: '@react-native/jest-preset',
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/__tests__/fixtures/'],
  // ESM-only packages (React Navigation, RNGH, screens, safe-area) are
  // transformed like react-native itself; so is react-native-tvos's nested
  // @react-native-tvos/virtualized-lists (FlatList, Story 2.4); so is
  // @shopify/flash-list, whose dist is ESM (ADR 0011).
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native[^/]*|@react-native(-community|-tvos)?|@react-navigation|@shopify/flash-list)/)',
  ],
  setupFiles: [
    '<rootDir>/node_modules/react-native-gesture-handler/jestSetup.js',
    // FlashList's own jest setup: fixed measurements (no native layout in Jest).
    '<rootDir>/node_modules/@shopify/flash-list/jestSetup.js',
  ],
};
