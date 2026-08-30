import React from 'react';
import renderer from 'react-test-renderer';
import { CameraKiosk } from '../src/components/CameraKiosk';
import { FaceOverlay } from '../src/components/FaceOverlay';
import { AdminDashboardScreen } from '../src/screens/AdminDashboardScreen';
import { PipelineResult, AttendanceSummaryResponse, EmployeeItem } from '../src/services/api';
import * as apiService from '../src/services/api';

jest.mock('../src/services/api');

describe('Milestone 4 Challenger Empirical Verification - Mobile Kiosk & Admin Dashboard', () => {
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

  // --------------------------------------------------------------------------
  // ITEM 1: KIOSK CAMERA FLOW VERIFICATION
  // --------------------------------------------------------------------------
  describe('Kiosk Camera Flow Empirical Verification', () => {
    it('verifies Face Detection Bounding Box Overlay rendering & tag', () => {
      let tree: any;
      renderer.act(() => {
        tree = renderer.create(
          <FaceOverlay
            bbox={[50, 60, 250, 300]}
            status="scanning"
            containerWidth={360}
            containerHeight={480}
            frameWidth={640}
            frameHeight={480}
          />
        );
        trees.push(tree);
      });

      const root = tree.root;
      const overlay = root.findByProps({ testID: 'face-overlay' });
      expect(overlay).toBeTruthy();

      const bboxRect = root.findByProps({ testID: 'bbox-rect' });
      expect(bboxRect).toBeTruthy();

      const tag = root.findByProps({ testID: 'bbox-tag' });
      expect(tag).toBeTruthy();
      const tagText = tag.findByType('Text');
      expect(tagText.props.children).toEqual(['BBox: [', 50, ', ', 60, ', ', 250, ', ', 300, ']']);
    });

    it('verifies Anti-Spoofing Alert Banner on spoof result', () => {
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

    it('verifies 3s Auto-Reset Confirmation Banner on success result', () => {
      const mockSuccessResult: PipelineResult = {
        success: true,
        employee_name: 'Verified Kiosk Employee',
        confidence: 0.965,
        check_type: 'CHECK_IN',
        bbox: [100, 100, 250, 250],
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
      const banner = root.findByProps({ testID: 'recognition-banner' });
      expect(banner).toBeTruthy();

      const empName = root.findByProps({ testID: 'employee-name' });
      expect(empName.props.children).toBe('Verified Kiosk Employee');

      const resetBadge = root.findByProps({ testID: 'reset-countdown' });
      expect(resetBadge).toBeTruthy();
      expect(resetBadge.props.children).toEqual(['Resetting in ', 3, 's...']);
    });
  });

  // --------------------------------------------------------------------------
  // ITEM 3: ADMIN DASHBOARD FLOW VERIFICATION
  // --------------------------------------------------------------------------
  describe('Admin Dashboard Flow Empirical Verification', () => {
    const mockSummary: AttendanceSummaryResponse = {
      date: '2026-08-05',
      total_employees: 12,
      present_count: 8,
      absent_count: 3,
      late_count: 1,
      departments: {
        Engineering: { present: 6, absent: 2, late: 1 },
        Marketing: { present: 2, absent: 1, late: 0 },
      },
    };

    const mockEmployees: EmployeeItem[] = [
      {
        id: 'emp-m4-1',
        name: 'Alice Johnson',
        department: 'Engineering',
        is_enrolled: true,
        is_active: true,
        leave_balance: 14.5,
        present_days: 15,
        late_count: 1,
      },
    ];

    it('verifies summary cards, department breakdown & per-employee attendance table', () => {
      let tree: any;
      renderer.act(() => {
        tree = renderer.create(
          <AdminDashboardScreen
            initialSummary={mockSummary}
            initialEmployees={mockEmployees}
          />
        );
        trees.push(tree);
      });

      const root = tree.root;

      // Summary cards
      expect(root.findByProps({ testID: 'card-present' }).findAllByType('Text')[0].props.children).toBe(8);
      expect(root.findByProps({ testID: 'card-absent' }).findAllByType('Text')[0].props.children).toBe(3);
      expect(root.findByProps({ testID: 'card-late' }).findAllByType('Text')[0].props.children).toBe(1);

      // Department breakdown
      expect(root.findByProps({ testID: 'department-breakdown-card' })).toBeTruthy();

      // Per-employee attendance table
      expect(root.findByProps({ testID: 'employee-attendance-table' })).toBeTruthy();
      expect(root.findByProps({ testID: 'employee-item-emp-m4-1' })).toBeTruthy();
    });

    it('verifies Leave Balance Adjustment modal trigger & actions', () => {
      let tree: any;
      renderer.act(() => {
        tree = renderer.create(
          <AdminDashboardScreen
            initialSummary={mockSummary}
            initialEmployees={mockEmployees}
          />
        );
        trees.push(tree);
      });

      const root = tree.root;
      const empItem = root.findByProps({ testID: 'employee-item-emp-m4-1' });

      renderer.act(() => {
        empItem.props.onPress();
      });

      const modal = root.findByProps({ testID: 'employee-detail-modal' });
      expect(modal).toBeTruthy();

      expect(root.findByProps({ testID: 'leave-adjust-modal' })).toBeTruthy();
      expect(root.findByProps({ testID: 'leave-action-select' })).toBeTruthy();
      expect(root.findByProps({ testID: 'leave-amount-input' })).toBeTruthy();
      expect(root.findByProps({ testID: 'save-leave-button' })).toBeTruthy();
    });

    it('verifies Share Registration Link Trigger Button', async () => {
      const mockTokenRes = {
        token: 'signed_invite_token_456',
        registration_url: 'http://localhost:3000/register?token=signed_invite_token_456',
        expires_at: '2026-08-06T10:00:00Z',
      };

      (apiService.generateRegistrationToken as jest.Mock).mockResolvedValue(mockTokenRes);

      let tree: any;
      renderer.act(() => {
        tree = renderer.create(
          <AdminDashboardScreen
            initialSummary={mockSummary}
            initialEmployees={mockEmployees}
          />
        );
        trees.push(tree);
      });

      const root = tree.root;
      const genBtn = root.findByProps({ testID: 'generate-token-button' });
      expect(genBtn).toBeTruthy();

      await renderer.act(async () => {
        genBtn.props.onPress();
      });

      const linkDisplay = root.findByProps({ testID: 'registration-link-display' });
      expect(linkDisplay).toBeTruthy();
      const linkText = root.findByProps({ testID: 'copy-link-button' });
      expect(linkText).toBeTruthy();
    });
  });
});
