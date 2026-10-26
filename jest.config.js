module.exports = {
  preset: '@react-native/jest-preset',
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/__tests__/fixtures/'],
  // ESM-only packages (React Navigation, RNGH, screens, safe-area) are
  // transformed like react-native itself; so is react-native-tvos's nested
  // @react-native-tvos/virtualized-lists (FlatList, Story 2.4).
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native[^/]*|@react-native(-community|-tvos)?|@react-navigation)/)',
  ],
  setupFiles: ['<rootDir>/node_modules/react-native-gesture-handler/jestSetup.js'],
};
