const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Expo Config Plugin to resolve native library merge conflicts
 * (e.g. duplicate libreactnative.so between onnxruntime-react-native and react-android).
 */
const withPackagingOptions = (config) => {
  return withAppBuildGradle(config, (modConfig) => {
    if (modConfig.modResults.language === 'groovy') {
      const packagingOptionsBlock = `
// [withPackagingOptions] Resolve duplicate native libraries from onnxruntime-react-native
android {
    packagingOptions {
        pickFirst '**/libreactnative.so'
        pickFirst '**/libc++_shared.so'
        pickFirst '**/libfbjni.so'
        pickFirst '**/libturbomodulejsijni.so'
    }
}
`;
      if (!modConfig.modResults.contents.includes('[withPackagingOptions]')) {
        modConfig.modResults.contents += packagingOptionsBlock;
      }
    }
    return modConfig;
  });
};

module.exports = withPackagingOptions;
