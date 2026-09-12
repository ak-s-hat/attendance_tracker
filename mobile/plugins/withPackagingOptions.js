const { withAppBuildGradle } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Ensure legacy unimodule.json is removed from onnxruntime-react-native
// so expo-modules-autolinking does not exclude it from React Native autolinking
const candidates = [
  path.join(__dirname, '..', 'node_modules', 'onnxruntime-react-native', 'unimodule.json'),
  path.join(__dirname, '..', '..', 'node_modules', 'onnxruntime-react-native', 'unimodule.json'),
];
for (const p of candidates) {
  if (fs.existsSync(p)) {
    try {
      fs.unlinkSync(p);
      console.log('[withPackagingOptions] Removed legacy unimodule.json to enable autolinking');
    } catch (e) {
      console.warn('[withPackagingOptions] Could not unlink unimodule.json:', e.message);
    }
  }
}

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
