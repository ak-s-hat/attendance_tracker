/**
 * patch-ort.js
 * 
 * Removes legacy unimodule.json from onnxruntime-react-native.
 * The presence of unimodule.json causes expo-modules-autolinking to misidentify
 * onnxruntime-react-native as a legacy unimodule and exclude it from standard
 * React Native community autolinking, causing NativeModules.Onnxruntime to be null.
 * 
 * Deleting this file allows React Native Gradle autolinking to detect android/build.gradle
 * and automatically bind OnnxruntimePackage in PackageList.java.
 */
const fs = require('fs');
const path = require('path');

const candidates = [
  path.join(__dirname, '..', 'node_modules', 'onnxruntime-react-native', 'unimodule.json'),
  path.join(__dirname, '..', '..', 'node_modules', 'onnxruntime-react-native', 'unimodule.json'),
];

let removed = false;
for (const p of candidates) {
  if (fs.existsSync(p)) {
    try {
      fs.unlinkSync(p);
      console.log(`[patch-ort] Successfully deleted ${p}`);
      removed = true;
    } catch (err) {
      console.warn(`[patch-ort] Failed to delete ${p}:`, err.message);
    }
  }
}

if (!removed) {
  console.log('[patch-ort] unimodule.json not found or already deleted.');
}
