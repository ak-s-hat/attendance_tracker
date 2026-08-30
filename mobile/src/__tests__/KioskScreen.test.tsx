import React from 'react';
import renderer from 'react-test-renderer';
import { KioskScreen } from '../screens/KioskScreen';
import { CameraKiosk } from '../components/CameraKiosk';

jest.mock('../ai/pipeline', () => {
  return {
    EdgeAIPipeline: jest.fn().mockImplementation(() => ({
      loadModels: jest.fn().mockResolvedValue(true),
      processFrame: jest.fn().mockResolvedValue({
        success: true,
        employee_id: 'emp-001',
        employee_name: 'Test Employee',
        confidence: 0.95,
        check_type: 'CHECK_IN',
        is_live: true,
      }),
    })),
  };
});

describe('KioskScreen Unit Test Suite', () => {
  it('initializes Edge AI pipeline and renders CameraKiosk', async () => {
    let tree: any;
    await renderer.act(async () => {
      tree = renderer.create(<KioskScreen mockPermissionGranted={true} />);
    });

    const root = tree.root;
    const kioskScreen = root.findByProps({ testID: 'kiosk-screen' });
    expect(kioskScreen).toBeTruthy();

    const cameraKiosk = root.findByType(CameraKiosk);
    expect(cameraKiosk).toBeTruthy();
  });
});
