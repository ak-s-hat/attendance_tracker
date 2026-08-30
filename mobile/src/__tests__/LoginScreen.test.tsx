import React from 'react';
import renderer from 'react-test-renderer';
import { LoginScreen } from '../screens/LoginScreen';
import * as apiService from '../services/api';

jest.mock('../services/api');

describe('LoginScreen Unit Test Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders username input, password input, and sign in button', () => {
    let tree: any;
    renderer.act(() => {
      tree = renderer.create(<LoginScreen />);
    });

    const root = tree.root;

    const usernameInput = root.findByProps({ testID: 'login-username-input' });
    expect(usernameInput).toBeTruthy();

    const passwordInput = root.findByProps({ testID: 'login-password-input' });
    expect(passwordInput).toBeTruthy();

    const submitBtn = root.findByProps({ testID: 'login-submit-button' });
    expect(submitBtn).toBeTruthy();
  });

  it('displays error banner when login credentials are invalid', async () => {
    (apiService.loginUser as jest.Mock).mockRejectedValue({
      response: { status: 401, data: { detail: 'Invalid credentials' } },
    });

    let tree: any;
    renderer.act(() => {
      tree = renderer.create(<LoginScreen />);
    });

    const root = tree.root;
    const usernameInput = root.findByProps({ testID: 'login-username-input' });
    const passwordInput = root.findByProps({ testID: 'login-password-input' });
    const submitBtn = root.findByProps({ testID: 'login-submit-button' });

    renderer.act(() => {
      usernameInput.props.onChangeText('wrong_user');
      passwordInput.props.onChangeText('wrong_pass');
    });

    await renderer.act(async () => {
      submitBtn.props.onPress();
    });

    const errorBanner = root.findByProps({ testID: 'login-error-banner' });
    expect(errorBanner).toBeTruthy();
  });

  it('calls onLoginSuccess on successful authentication', async () => {
    const mockAuthResponse = {
      access_token: 'mock-jwt-token-123',
      token_type: 'bearer',
      role: 'admin' as const,
      user_id: 'user-001',
      username: 'admin_user',
    };

    (apiService.loginUser as jest.Mock).mockResolvedValue(mockAuthResponse);

    const onLoginSuccessMock = jest.fn();

    let tree: any;
    renderer.act(() => {
      tree = renderer.create(<LoginScreen onLoginSuccess={onLoginSuccessMock} />);
    });

    const root = tree.root;
    const usernameInput = root.findByProps({ testID: 'login-username-input' });
    const passwordInput = root.findByProps({ testID: 'login-password-input' });
    const submitBtn = root.findByProps({ testID: 'login-submit-button' });

    renderer.act(() => {
      usernameInput.props.onChangeText('admin_user');
      passwordInput.props.onChangeText('admin123');
    });

    await renderer.act(async () => {
      submitBtn.props.onPress();
    });

    expect(onLoginSuccessMock).toHaveBeenCalledWith({
      token: 'mock-jwt-token-123',
      role: 'admin',
      user_id: 'user-001',
      username: 'admin_user',
      employee_id: undefined,
    });
  });
});
