import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, SafeAreaView, Alert, LogBox } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { LoginScreen } from './src/screens/LoginScreen';
import { KioskScreen } from './src/screens/KioskScreen';
import { ManagerDashboardScreen } from './src/screens/ManagerDashboardScreen';
import { colors } from './src/theme/colors';
import { syncEmployeeEmbeddingsDelta } from './src/services/syncService';
import { log, errorToData, flushLogsToDb, APP_VERSION } from './src/services/logger';
import { startLogUploader } from './src/services/logUploader';

export type AppMode = 'KIOSK' | 'ADMIN';

export interface UserAuthSession {
  token: string;
  role: 'super_admin' | 'admin' | 'employee';
  user_id: string;
  username: string;
  employee_id?: string | null;
}

export interface AppProps {
  initialSession?: UserAuthSession | null;
  initialMode?: AppMode;
}

const DEFAULT_API_URL =
  Constants.expoConfig?.extra?.apiBaseUrl ||
  'https://attendance-tracker-backend-yfoc.onrender.com';

// ──────────────────────────────────────────────────────────────────────────────
// Global JS error handlers — every unhandled exception & promise rejection is
// written to the log trail (console + SQLite + backend upload). Only fatal errors
// raise an Alert, so non-fatal noise can't stack dialogs on an unattended kiosk.
// ──────────────────────────────────────────────────────────────────────────────
const originalHandler = ErrorUtils.getGlobalHandler();
ErrorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
  log.error('CRASH', isFatal ? 'Fatal JS error' : 'Unhandled JS error', { fatal: !!isFatal, ...errorToData(error) });
  flushLogsToDb().catch(() => {});
  if (isFatal) {
    try {
      Alert.alert(
        '🔴 Fatal JS Error',
        `${error?.message || error}\n\nStack: ${error?.stack?.substring(0, 500) || 'N/A'}`,
        [{ text: 'OK' }]
      );
    } catch (_) {
      // Alert itself might fail if the app is in a bad state
    }
  }
  // Still call the original handler so React Native can do its thing
  if (originalHandler) {
    originalHandler(error, isFatal);
  }
});

const hermes = (global as any).HermesInternal;
if (hermes?.enablePromiseRejectionTracker) {
  hermes.enablePromiseRejectionTracker({
    allRejections: true,
    onUnhandled: (id: number, rejection: any) => {
      log.warn('CRASH', 'Unhandled promise rejection', { id, ...errorToData(rejection) });
    },
    onHandled: () => {},
  });
}

log.info('APP', 'App started', { version: APP_VERSION, api: DEFAULT_API_URL, dev: __DEV__ });
startLogUploader(DEFAULT_API_URL);

// Suppress noisy yellow-box warnings in dev builds but keep errors
LogBox.ignoreLogs(['Warning:']);

function AppInner({ initialSession = null, initialMode = 'KIOSK' }: AppProps) {
  const [session, setSession] = useState<UserAuthSession | null>(initialSession);
  const [mode, setMode] = useState<AppMode>(initialMode);
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_URL);

  const handleLoginSuccess = (authData: UserAuthSession) => {
    setSession(authData);
    setMode('KIOSK');
    // Defer contact to server by 2s so KioskScreen mounts, SQLite initializes cleanly, and UI renders
    setTimeout(() => {
      syncEmployeeEmbeddingsDelta(apiBaseUrl, authData.token).catch((err) =>
        console.warn('[App] Post-login employee sync error:', err?.message || err)
      );
    }, 2000);
  };

  const handleLogout = () => {
    setSession(null);
    setMode('KIOSK');
  };

  const handleServerUrlChange = (url: string) => {
    setApiBaseUrl(url);
    startLogUploader(url);
    log.info('APP', 'Server URL changed', { api: url });
  };

  // If unauthenticated, display Login Screen
  if (!session) {
    return (
      <SafeAreaView testID="main-app" style={styles.container}>
        <StatusBar style="light" />
        <ErrorBoundary label="LoginScreen">
          <LoginScreen
            apiBaseUrl={apiBaseUrl}
            onLoginSuccess={handleLoginSuccess}
            onServerUrlChange={handleServerUrlChange}
          />
        </ErrorBoundary>
      </SafeAreaView>
    );
  }

  const isEmployee = session.role === 'employee';

  return (
    <SafeAreaView testID="main-app" style={styles.container}>
      <StatusBar style="light" />

      {/* Top Header Bar */}
      <View style={styles.topBar}>
        <View style={styles.userBadgeGroup}>
          <Text style={styles.usernameText}>👤 {session.username}</Text>
          <View
            style={[
              styles.roleBadge,
              session.role === 'super_admin'
                ? styles.roleSuperAdmin
                : session.role === 'admin'
                ? styles.roleAdmin
                : styles.roleEmployee,
            ]}
          >
            <Text style={styles.roleBadgeText}>{session.role.toUpperCase().replace('_', ' ')}</Text>
          </View>
        </View>

        <TouchableOpacity testID="logout-button" style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutBtnText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Mode Switcher Header for Admins & Super Admins */}
      {!isEmployee && (
        <View testID="mode-switcher" style={styles.navHeader}>
          <TouchableOpacity
            testID="tab-kiosk"
            style={[styles.navTab, mode === 'KIOSK' && styles.activeTab]}
            onPress={() => setMode('KIOSK')}
          >
            <Text style={[styles.navText, mode === 'KIOSK' && styles.activeNavText]}>
              📷 Kiosk Mode
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="tab-manager"
            style={[styles.navTab, mode === 'ADMIN' && styles.activeTab]}
            onPress={() => setMode('ADMIN')}
          >
            <Text style={[styles.navText, mode === 'ADMIN' && styles.activeNavText]}>
              📊 Admin Dashboard
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Screen Body */}
      <View style={styles.body}>
        <ErrorBoundary label={isEmployee || mode === 'KIOSK' ? 'KioskScreen' : 'ManagerDashboard'}>
          {isEmployee || mode === 'KIOSK' ? (
            <KioskScreen
              apiBaseUrl={apiBaseUrl}
              userRole={session.role}
              onLogout={handleLogout}
            />
          ) : (
            <ManagerDashboardScreen
              apiBaseUrl={apiBaseUrl}
              authToken={session.token}
              currentUserRole={session.role}
            />
          )}
        </ErrorBoundary>
      </View>
    </SafeAreaView>
  );
}

export default function App(props: AppProps = {}) {
  return (
    <ErrorBoundary label="App Root">
      <AppInner {...props} />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.card,
  },
  userBadgeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  usernameText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  roleSuperAdmin: {
    backgroundColor: colors.errorBg,
    borderColor: colors.error,
    borderWidth: 1,
  },
  roleAdmin: {
    backgroundColor: colors.warningBg,
    borderColor: colors.warning,
    borderWidth: 1,
  },
  roleEmployee: {
    backgroundColor: colors.successBg,
    borderColor: colors.success,
    borderWidth: 1,
  },
  roleBadgeText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: 'bold',
  },
  logoutBtn: {
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  logoutBtnText: {
    color: colors.secondaryText,
    fontSize: 12,
    fontWeight: 'bold',
  },
  navHeader: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.card,
  },
  navTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  activeTab: {
    borderBottomColor: colors.primary,
  },
  navText: {
    color: colors.secondaryText,
    fontSize: 14,
    fontWeight: '600',
  },
  activeNavText: {
    color: colors.primary,
    fontWeight: 'bold',
  },
  body: {
    flex: 1,
  },
});
