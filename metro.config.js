const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * ADR 0014: react-native-qrcode-svg imports `react-native-svg/css` (logo
 * support, unused by the app), whose asset helper requires
 * `@react-native/assets-registry/registry`. react-native-tvos 0.87 ships the
 * same registry as `react-native/asset-registry` (Metro's own
 * `assetRegistryPath`) and no `@react-native/assets-registry` package, so
 * that one module name is resolved to it.
 */
const ASSET_REGISTRY_ALIASES = {
  '@react-native/assets-registry/registry': 'react-native/asset-registry',
};

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    resolveRequest: (context, moduleName, platform) =>
      context.resolveRequest(
        context,
        ASSET_REGISTRY_ALIASES[moduleName] ?? moduleName,
        platform,
      ),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
