import React from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity } from 'react-native';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  label?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: string;
}

/**
 * Catches React render crashes and displays the full error + stack trace
 * on screen instead of crashing the app. This is essential for debugging
 * production APK builds where console.log is invisible.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: '' };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const errorInfo = [
      `[ErrorBoundary: ${this.props.label || 'App'}]`,
      `Error: ${error.message}`,
      `Stack: ${error.stack || 'N/A'}`,
      `Component Stack: ${info.componentStack || 'N/A'}`,
    ].join('\n\n');
    this.setState({ errorInfo });
    console.error('[ErrorBoundary]', errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>🔴 App Crash Caught</Text>
          <Text style={styles.label}>{this.props.label || 'Root'}</Text>
          <Text style={styles.errorName}>{this.state.error?.name}: {this.state.error?.message}</Text>
          <ScrollView style={styles.scrollBox}>
            <Text style={styles.stackText} selectable>{this.state.errorInfo}</Text>
          </ScrollView>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => this.setState({ hasError: false, error: null, errorInfo: '' })}
          >
            <Text style={styles.retryText}>🔄 Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a0000',
    padding: 16,
    paddingTop: 50,
  },
  title: {
    color: '#ff4444',
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  label: {
    color: '#ff8888',
    fontSize: 14,
    marginBottom: 8,
  },
  errorName: {
    color: '#ffaaaa',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  scrollBox: {
    flex: 1,
    backgroundColor: '#0d0d0d',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  stackText: {
    color: '#cccccc',
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  retryBtn: {
    backgroundColor: '#333',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  retryText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
