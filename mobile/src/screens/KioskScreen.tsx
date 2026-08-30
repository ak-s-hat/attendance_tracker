import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { EdgeAIPipeline } from '../ai/pipeline';
import { CameraKiosk } from '../components/CameraKiosk';
import { colors } from '../theme/colors';

export interface KioskScreenProps {
  apiBaseUrl?: string;
  mockPermissionGranted?: boolean;
  userRole?: 'super_admin' | 'admin' | 'employee';
  onLogout?: () => void;
}

export const KioskScreen: React.FC<KioskScreenProps> = ({
  apiBaseUrl = 'http://192.168.2.118:8000',
  mockPermissionGranted,
  userRole,
  onLogout,
}) => {
  const [pipeline, setPipeline] = useState<EdgeAIPipeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const initPipeline = async () => {
      try {
        const pipe = new EdgeAIPipeline(apiBaseUrl);
        await pipe.loadModels();
        if (isMounted) {
          setPipeline(pipe);
          setLoading(false);
        }
      } catch (err: any) {
        if (isMounted) {
          console.warn('Failed to load Edge AI ONNX models, falling back to stub pipeline:', err);
          const fallbackPipe = new EdgeAIPipeline(apiBaseUrl);
          setPipeline(fallbackPipe);
          setError(null);
          setLoading(false);
        }
      }
    };

    initPipeline();
    return () => {
      isMounted = false;
    };
  }, [apiBaseUrl]);

  if (loading) {
    return (
      <View testID="kiosk-loading" style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Initializing Edge AI Engine...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View testID="kiosk-error" style={styles.centerContainer}>
        <Text style={styles.errorText}>Error: {error}</Text>
      </View>
    );
  }

  return (
    <View testID="kiosk-screen" style={styles.container}>
      <CameraKiosk
        pipeline={pipeline || undefined}
        apiBaseUrl={apiBaseUrl}
        mockPermissionGranted={mockPermissionGranted}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centerContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    color: colors.primary,
    marginTop: 12,
    fontSize: 16,
  },
  errorText: {
    color: colors.error,
    fontSize: 16,
    textAlign: 'center',
  },
});
