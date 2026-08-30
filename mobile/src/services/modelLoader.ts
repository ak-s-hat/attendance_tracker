import { Asset } from 'expo-asset';

export async function getLocalModelPath(assetModule: number, filename: string): Promise<string> {
  const asset = Asset.fromModule(assetModule);
  await asset.downloadAsync();

  if (!asset.localUri && !asset.uri) {
    throw new Error(`Failed to resolve local URI for model asset: ${filename}`);
  }

  return asset.localUri || asset.uri;
}
