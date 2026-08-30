import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import Constants from 'expo-constants';
import { loginUser } from '../services/api';
import { colors } from '../theme/colors';

export interface LoginScreenProps {
  apiBaseUrl?: string;
  onLoginSuccess?: (authData: {
    token: string;
    role: 'super_admin' | 'admin' | 'employee';
    user_id: string;
    username: string;
    employee_id?: string | null;
  }) => void;
  onServerUrlChange?: (url: string) => void;
}

const DEFAULT_SERVER_URL =
  Constants.expoConfig?.extra?.apiBaseUrl ||
  'https://attendance-tracker-backend-yfoc.onrender.com';

export const LoginScreen: React.FC<LoginScreenProps> = ({
  apiBaseUrl = DEFAULT_SERVER_URL,
  onLoginSuccess,
  onServerUrlChange,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [serverUrl, setServerUrl] = useState(apiBaseUrl || DEFAULT_SERVER_URL);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setErrorMessage('Please enter both username and password.');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      const response = await loginUser(serverUrl, {
        username: username.trim(),
        password: password.trim(),
      });

      if (response && response.access_token) {
        // Always sync the server URL to App.tsx on successful login
        if (onServerUrlChange) {
          onServerUrlChange(serverUrl.trim().replace(/\/+$/, ''));
        }
        if (onLoginSuccess) {
          onLoginSuccess({
            token: response.access_token,
            role: response.role || 'employee',
            user_id: response.user_id,
            username: response.username || username.trim(),
            employee_id: response.employee_id,
          });
        }
      } else {
        setErrorMessage('Invalid response from server.');
      }
    } catch (error: any) {
      console.warn('Login error:', error);
      if (error?.response?.status === 401) {
        setErrorMessage('Invalid username or password.');
      } else if (error?.message?.includes('Network Error')) {
        setErrorMessage('Cannot connect to server. Check the Server URL below.');
      } else {
        setErrorMessage(error?.response?.data?.detail || 'Authentication failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleServerUrlSave = () => {
    const trimmed = serverUrl.trim().replace(/\/+$/, '');
    setServerUrl(trimmed);
    if (onServerUrlChange) {
      onServerUrlChange(trimmed);
    }
    setShowServerSettings(false);
  };

  return (
    <KeyboardAvoidingView
      testID="login-screen"
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.title}>Attendance Tracker</Text>
          <Text style={styles.subtitle}>Sign in to your account</Text>

          {errorMessage ? (
            <View testID="login-error-banner" style={styles.errorBanner}>
              <Text style={styles.errorText}>⚠️ {errorMessage}</Text>
            </View>
          ) : null}

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              testID="login-username-input"
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="Enter username"
              placeholderTextColor={colors.secondaryText}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              testID="login-password-input"
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Enter password"
              placeholderTextColor={colors.secondaryText}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>

          <TouchableOpacity
            testID="login-submit-button"
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <ActivityIndicator color="#FFFFFF" size="small" style={{ marginRight: 8 }} />
                <Text style={styles.buttonText}>Connecting to Server...</Text>
              </View>
            ) : (
              <Text style={styles.buttonText}>Sign In</Text>
            )}
          </TouchableOpacity>

          {/* Instant Offline Edge Kiosk Launch */}
          <TouchableOpacity
            style={styles.offlineKioskBtn}
            onPress={() => {
              if (onLoginSuccess) {
                onLoginSuccess({
                  token: 'offline_edge_token',
                  role: 'employee',
                  user_id: 'offline_kiosk_operator',
                  username: 'Edge Kiosk (Offline)',
                  employee_id: null,
                });
              }
            }}
          >
            <Text style={styles.offlineKioskBtnText}>⚡ Launch Offline Edge Kiosk</Text>
          </TouchableOpacity>

          {/* Server URL Configuration */}
          <TouchableOpacity
            style={styles.serverToggle}
            onPress={() => setShowServerSettings(!showServerSettings)}
          >
            <Text style={styles.serverToggleText}>
              {showServerSettings ? '▼' : '▶'} ⚙️ Server Settings
            </Text>
            <Text style={styles.serverUrlPreview} numberOfLines={1}>
              {serverUrl}
            </Text>
          </TouchableOpacity>

          {showServerSettings && (
            <View style={styles.serverSection}>
              <Text style={styles.serverLabel}>Backend API URL</Text>
              <Text style={styles.serverHelpText}>
                Paste your live Render URL (e.g. https://your-app.onrender.com) or local IP (http://192.168.x.x:8000). Do not use localhost on physical Android.
              </Text>
              <TextInput
                testID="server-url-input"
                style={styles.input}
                value={serverUrl}
                onChangeText={setServerUrl}
                placeholder="https://your-app.onrender.com"
                placeholderTextColor={colors.secondaryText}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <TouchableOpacity style={styles.saveUrlBtn} onPress={handleServerUrlSave}>
                <Text style={styles.saveUrlBtnText}>Save URL</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <Text style={styles.footerText}>
          Connected to: {serverUrl.replace('http://', '').replace('https://', '')}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderColor: colors.card,
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: colors.secondaryText,
    textAlign: 'center',
    marginBottom: 24,
  },
  errorBanner: {
    backgroundColor: colors.errorBg,
    borderColor: colors.error,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  inputGroup: {
    marginBottom: 18,
  },
  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.inputBg,
    borderColor: colors.card,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  serverToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.card,
  },
  serverToggleText: {
    color: colors.secondaryText,
    fontSize: 13,
    fontWeight: '600',
  },
  serverUrlPreview: {
    color: colors.textMuted,
    fontSize: 11,
    maxWidth: '55%',
  },
  serverSection: {
    marginTop: 12,
    paddingTop: 8,
  },
  serverLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  offlineKioskBtn: {
    backgroundColor: colors.card,
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  offlineKioskBtnText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: 'bold',
  },
  serverHelpText: {
    color: colors.textMuted,
    fontSize: 11,
    marginBottom: 8,
    lineHeight: 16,
  },
  saveUrlBtn: {
    backgroundColor: colors.success,
    borderRadius: 6,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  saveUrlBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  footerText: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 16,
  },
});
