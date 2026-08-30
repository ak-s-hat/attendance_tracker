import { Platform } from 'react-native';

export async function createInferenceSession(modelPathOrUri: string) {
  if (Platform.OS === 'web') {
    const ortWeb = require('onnxruntime-web');
    return await ortWeb.InferenceSession.create(modelPathOrUri, {
      executionProviders: ['wasm'],
    });
  } else {
    const ortNative = require('onnxruntime-react-native');
    return await ortNative.InferenceSession.create(modelPathOrUri, {
      executionProviders: ['cpu'], // or 'nnapi' / 'coreml'
    });
  }
}
