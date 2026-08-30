import React from 'react';
import renderer from 'react-test-renderer';
import { CameraKiosk } from '../../src/components/CameraKiosk';
import { PipelineResult } from '../../src/ai/types';

describe('CameraKiosk Component Unit Tests', () => {
  let trees: any[] = [];

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

  it('displays camera permission prompt when permission is ungranted', () => {
    let tree: any;
    renderer.act(() => {
      tree = renderer.create(<CameraKiosk mockPermissionGranted={false} />);
      trees.push(tree);
    });

    const root = tree.root;
    const prompt = root.findByProps({ testID: 'permission-prompt' });
    expect(prompt.props.children).toContain('Camera access is required for Kiosk Mode.');
    const grantBtn = root.findByProps({ testID: 'grant-permission-button' });
    expect(grantBtn).toBeTruthy();
  });

  it('renders live CameraView when permission is granted', () => {
    let tree: any;
    renderer.act(() => {
      tree = renderer.create(<CameraKiosk mockPermissionGranted={true} />);
      trees.push(tree);
    });

    const root = tree.root;
    const cameraView = root.findByProps({ testID: 'camera-view' });
    expect(cameraView).toBeTruthy();
    expect(cameraView.props.facing).toBe('front');
  });

  it('triggers spoof warning alert banner "Spoof detected — use a real face" on spoof result', () => {
    const mockSpoofResult: PipelineResult = {
      success: false,
      reason: 'spoof_detected',
      is_live: false,
      bbox: [100, 100, 200, 200],
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

  it('displays employee name and confidence percentage on success result', () => {
    const mockSuccessResult: PipelineResult = {
      success: true,
      employee_name: 'Jane Doe',
      confidence: 0.984,
      check_type: 'CHECK_IN',
      bbox: [120, 80, 340, 300],
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
    const recognitionBanner = root.findByProps({ testID: 'recognition-banner' });
    expect(recognitionBanner).toBeTruthy();

    const empName = root.findByProps({ testID: 'employee-name' });
    expect(empName.props.children).toBe('Jane Doe');

    const confText = root.findByProps({ testID: 'confidence-text' });
    expect(confText.props.children).toEqual(['Confidence: ', '98.4', '%']);

    const badge = root.findByProps({ testID: 'check-type-badge' });
    const badgeText = badge.findByType('Text');
    expect(badgeText.props.children).toBe('CHECK_IN');
  });

  it('shows reset countdown text when in result state', () => {
    const mockSuccessResult: PipelineResult = {
      success: true,
      employee_name: 'John Smith',
      confidence: 0.95,
      check_type: 'CHECK_OUT',
      bbox: [100, 100, 200, 200],
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
    const resetBadge = root.findByProps({ testID: 'reset-countdown' });
    expect(resetBadge).toBeTruthy();
    expect(resetBadge.props.children).toEqual(['Resetting in ', 3, 's...']);
  });
});
