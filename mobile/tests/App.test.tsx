import React from 'react';
import renderer from 'react-test-renderer';
import App from '../App';

// Mock child screens for unit testing App navigation frame
jest.mock('../src/screens/KioskScreen', () => ({
  KioskScreen: () => {
    const React = require('react');
    const { View, Text } = require('react-native');
    return (
      <View testID="mock-kiosk-screen">
        <Text>Mock Kiosk Screen</Text>
      </View>
    );
  },
}));

jest.mock('../src/screens/ManagerDashboardScreen', () => ({
  ManagerDashboardScreen: () => {
    const React = require('react');
    const { View, Text } = require('react-native');
    return (
      <View testID="mock-manager-dashboard-screen">
        <Text>Mock Manager Dashboard Screen</Text>
      </View>
    );
  },
}));

describe('App Mode Switcher Unit Tests', () => {
  const mockAdminSession = { token: 'mock-token', role: 'admin' as const, user_id: 'usr-1', username: 'admin' };

  it('defaults to Kiosk Mode screen on launch', () => {
    let tree: any;
    renderer.act(() => {
      tree = renderer.create(<App initialSession={mockAdminSession} />);
    });

    const root = tree.root;
    expect(root.findByProps({ testID: 'mock-kiosk-screen' })).toBeTruthy();
    expect(root.findAllByProps({ testID: 'mock-manager-dashboard-screen' }).length).toBe(0);
  });

  it('switches to Manager Dashboard screen when tab-manager is pressed', () => {
    let tree: any;
    renderer.act(() => {
      tree = renderer.create(<App initialSession={mockAdminSession} />);
    });

    const root = tree.root;
    const tabManager = root.findByProps({ testID: 'tab-manager' });

    renderer.act(() => {
      tabManager.props.onPress();
    });

    expect(root.findByProps({ testID: 'mock-manager-dashboard-screen' })).toBeTruthy();
    expect(root.findAllByProps({ testID: 'mock-kiosk-screen' }).length).toBe(0);
  });

  it('switches back to Kiosk Mode screen when tab-kiosk is pressed', () => {
    let tree: any;
    renderer.act(() => {
      tree = renderer.create(<App initialSession={mockAdminSession} />);
    });

    const root = tree.root;
    const tabManager = root.findByProps({ testID: 'tab-manager' });
    const tabKiosk = root.findByProps({ testID: 'tab-kiosk' });

    // Switch to Manager
    renderer.act(() => {
      tabManager.props.onPress();
    });

    // Switch back to Kiosk
    renderer.act(() => {
      tabKiosk.props.onPress();
    });

    expect(root.findByProps({ testID: 'mock-kiosk-screen' })).toBeTruthy();
    expect(root.findAllByProps({ testID: 'mock-manager-dashboard-screen' }).length).toBe(0);
  });
});
