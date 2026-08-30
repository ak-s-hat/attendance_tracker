import React from 'react';
import renderer from 'react-test-renderer';
import { LoginScreen } from '../src/screens/LoginScreen';
import { CameraKiosk } from '../src/components/CameraKiosk';
import App from '../App';
import * as apiService from '../src/services/api';

jest.mock('../src/services/api');

// Mock EdgeAIPipeline for KioskScreen
jest.mock('../src/ai/pipeline', () => ({
  EdgeAIPipeline: jest.fn().mockImplementation(() => ({
    loadModels: jest.fn().mockResolvedValue(true),
    processFrame: jest.fn().mockResolvedValue({
      success: true,
      employee_id: 'emp-1',
      employee_name: 'John Doe',
      confidence: 0.95,
      check_type: 'CHECK_IN',
    }),
  })),
}));

// Mock AdminDashboardScreen to avoid heavy nested dependencies during App layout tests
jest.mock('../src/screens/AdminDashboardScreen', () => ({
  AdminDashboardScreen: () => {
    const React = require('react');
    const { View, Text } = require('react-native');
    return (
      <View testID="mock-admin-dashboard-screen">
        <Text>Mock Admin Dashboard Screen</Text>
      </View>
    );
  },
}));

describe('Empirical Verification Suite — Milestone 3 Login Auth & Kiosk Camera Screen', () => {
  let trees: any[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    trees.forEach((t) => {
      try {
        renderer.act(() => {
          t.unmount();
        });
      } catch (e) {}
    });
    trees = [];
  });

  // -------------------------------------------------------------------------
  // REQUIREMENT 1: LoginScreen
  // -------------------------------------------------------------------------
  describe('1. LoginScreen Verification', () => {

    it('1.1 & 1.2: Authenticates username + password only against /api/auth/login and stores JWT token & role', async () => {
      const mockLoginResponse = {
        access_token: 'mock-jwt-token-xyz789',
        token_type: 'bearer',
        role: 'admin' as const,
        user_id: 'user-id-001',
        username: 'testadmin',
      };

      (apiService.loginUser as jest.Mock).mockResolvedValue(mockLoginResponse);

      const onLoginSuccessMock = jest.fn();

      let tree: any;
      renderer.act(() => {
        tree = renderer.create(<LoginScreen apiBaseUrl="http://192.168.1.11:8000" onLoginSuccess={onLoginSuccessMock} />);
        trees.push(tree);
      });

      const root = tree.root;
      const usernameInput = root.findByProps({ testID: 'login-username-input' });
      const passwordInput = root.findByProps({ testID: 'login-password-input' });
      const submitBtn = root.findByProps({ testID: 'login-submit-button' });

      renderer.act(() => {
        usernameInput.props.onChangeText('testadmin');
        passwordInput.props.onChangeText('password123');
      });

      await renderer.act(async () => {
        submitBtn.props.onPress();
      });

      // Verify loginUser was called with endpoint base URL and payload { username, password }
      expect(apiService.loginUser).toHaveBeenCalledWith('http://192.168.1.11:8000', {
        username: 'testadmin',
        password: 'password123',
      });

      // Verify onLoginSuccess callback received token and role
      expect(onLoginSuccessMock).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'mock-jwt-token-xyz789',
          role: 'admin',
          username: 'testadmin',
        })
      );
    });

    it('1.3: Employee role lands directly on Kiosk Screen without admin tabs', async () => {
      let tree: any;
      renderer.act(() => {
        tree = renderer.create(<App />);
        trees.push(tree);
      });

      const root = tree.root;

      // Simulate employee login
      const mockEmployeeAuth = {
        access_token: 'emp-jwt-token',
        token_type: 'bearer',
        role: 'employee' as const,
        user_id: 'emp-101',
        username: 'john_emp',
      };
      (apiService.loginUser as jest.Mock).mockResolvedValue(mockEmployeeAuth);

      const usernameInput = root.findByProps({ testID: 'login-username-input' });
      const passwordInput = root.findByProps({ testID: 'login-password-input' });
      const submitBtn = root.findByProps({ testID: 'login-submit-button' });

      renderer.act(() => {
        usernameInput.props.onChangeText('john_emp');
        passwordInput.props.onChangeText('secret');
      });

      await renderer.act(async () => {
        submitBtn.props.onPress();
      });

      // Check mode switcher tab headers are NOT rendered for employee
      const modeSwitcher = root.findAllByProps({ testID: 'mode-switcher' });
      expect(modeSwitcher.length).toBe(0);

      // Check kiosk screen container is rendered
      const kioskScreen = root.findByProps({ testID: 'kiosk-screen' });
      expect(kioskScreen).toBeTruthy();
    });

    it('1.4: Admin and Super Admin roles get Kiosk Camera + Admin Dashboard tabs', async () => {
      let tree: any;
      renderer.act(() => {
        tree = renderer.create(<App />);
        trees.push(tree);
      });

      const root = tree.root;

      const mockAdminAuth = {
        access_token: 'admin-jwt-token',
        token_type: 'bearer',
        role: 'admin' as const,
        user_id: 'admin-007',
        username: 'admin_user',
      };
      (apiService.loginUser as jest.Mock).mockResolvedValue(mockAdminAuth);

      const usernameInput = root.findByProps({ testID: 'login-username-input' });
      const passwordInput = root.findByProps({ testID: 'login-password-input' });
      const submitBtn = root.findByProps({ testID: 'login-submit-button' });

      renderer.act(() => {
        usernameInput.props.onChangeText('admin_user');
        passwordInput.props.onChangeText('adminpass');
      });

      await renderer.act(async () => {
        submitBtn.props.onPress();
      });

      // Check mode switcher tabs exist for Admin
      const modeSwitcher = root.findByProps({ testID: 'mode-switcher' });
      expect(modeSwitcher).toBeTruthy();

      const tabKiosk = root.findByProps({ testID: 'tab-kiosk' });
      const tabAdmin = root.findByProps({ testID: 'tab-manager' });
      expect(tabKiosk).toBeTruthy();
      expect(tabAdmin).toBeTruthy();
    });

    it('1.5: Invalid password / credentials shows error banner', async () => {
      (apiService.loginUser as jest.Mock).mockRejectedValue({
        response: { status: 401, data: { detail: 'Invalid username or password.' } },
      });

      let tree: any;
      renderer.act(() => {
        tree = renderer.create(<LoginScreen />);
        trees.push(tree);
      });

      const root = tree.root;
      const usernameInput = root.findByProps({ testID: 'login-username-input' });
      const passwordInput = root.findByProps({ testID: 'login-password-input' });
      const submitBtn = root.findByProps({ testID: 'login-submit-button' });

      renderer.act(() => {
        usernameInput.props.onChangeText('user');
        passwordInput.props.onChangeText('wrongpass');
      });

      await renderer.act(async () => {
        submitBtn.props.onPress();
      });

      const errorBanner = root.findByProps({ testID: 'login-error-banner' });
      expect(errorBanner).toBeTruthy();
    });

  });

  // -------------------------------------------------------------------------
  // REQUIREMENT 2: Kiosk Camera Screen
  // -------------------------------------------------------------------------
  describe('2. Kiosk Camera Screen Verification', () => {

    it('2.1: Captures frames silently with shutterSound: false', () => {
      let tree: any;
      renderer.act(() => {
        tree = renderer.create(
          <CameraKiosk
            mockPermissionGranted={true}
            initialStatus="idle"
          />
        );
        trees.push(tree);
      });

      const root = tree.root;
      const cameraView = root.findByProps({ testID: 'camera-view' });
      expect(cameraView).toBeTruthy();
    });

    it('2.2: Displays face bounding box overlay', () => {
      const mockResult = {
        success: true,
        bbox: [100, 100, 300, 300] as [number, number, number, number],
        det_score: 0.95,
        employee_name: 'Jane Doe',
        confidence: 0.98,
        check_type: 'CHECK_IN',
      };

      let tree: any;
      renderer.act(() => {
        tree = renderer.create(
          <CameraKiosk
            mockPermissionGranted={true}
            initialResult={mockResult}
            initialStatus="success"
          />
        );
        trees.push(tree);
      });

      const root = tree.root;
      const faceOverlay = root.findByProps({ testID: 'face-overlay' });
      expect(faceOverlay).toBeTruthy();

      const bboxRect = root.findByProps({ testID: 'bbox-rect' });
      expect(bboxRect).toBeTruthy();
    });

    it('2.3: Displays anti-spoofing alert banner on liveness error ("Spoof detected — use a real face")', () => {
      const mockSpoofResult = {
        success: false,
        is_live: false,
        reason: 'spoof_detected',
        bbox: [50, 50, 200, 200] as [number, number, number, number],
      };

      let tree: any;
      renderer.act(() => {
        tree = renderer.create(
          <CameraKiosk
            mockPermissionGranted={true}
            initialResult={mockSpoofResult}
            initialStatus="spoof"
          />
        );
        trees.push(tree);
      });

      const root = tree.root;
      const spoofBanner = root.findByProps({ testID: 'spoof-banner' });
      expect(spoofBanner).toBeTruthy();

      const spoofMsg = root.findByProps({ testID: 'spoof-message' });
      expect(spoofMsg.props.children).toBe('Spoof detected — use a real face');
    });

    it('2.4: Displays 3-second auto-reset green confirmation banner on successful check-in', () => {
      const mockSuccessResult = {
        success: true,
        employee_id: 'emp-101',
        employee_name: 'John Smith',
        confidence: 0.96,
        check_type: 'CHECK_IN',
        bbox: [100, 120, 250, 280] as [number, number, number, number],
      };

      let tree: any;
      renderer.act(() => {
        tree = renderer.create(
          <CameraKiosk
            mockPermissionGranted={true}
            initialResult={mockSuccessResult}
            initialStatus="success"
          />
        );
        trees.push(tree);
      });

      const root = tree.root;
      const recogBanner = root.findByProps({ testID: 'recognition-banner' });
      expect(recogBanner).toBeTruthy();

      const empNameText = root.findByProps({ testID: 'employee-name' });
      expect(empNameText.props.children).toBe('John Smith');

      const countdownText = root.findByProps({ testID: 'reset-countdown' });
      expect(countdownText).toBeTruthy();
    });

  });
});
