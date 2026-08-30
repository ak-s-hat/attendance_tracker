const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Add .onnx to assetExts so Metro bundles binary neural network models
config.resolver.assetExts.push('onnx');

module.exports = config;
