import React from 'react';
import renderer from 'react-test-renderer';
import { ScrollView } from 'react-native';
import { ManagerDashboardScreen } from '../../src/screens/ManagerDashboardScreen';
import { RecentCheckinItem, EmployeeItem } from '../../src/services/api';
import * as apiService from '../../src/services/api';

jest.mock('../../src/services/api');

describe('ManagerDashboardScreen Challenger Edge Cases & Verification Suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Metric Calculation Edge Cases', () => {
    it('edge case 1: 0 enrolled employees (empty list or all enrolled=false)', () => {
      const mockLogs: RecentCheckinItem[] = [
        {
          employee_name: 'Alice Johnson',
          check_type: 'CHECK_IN',
          timestamp: '2026-07-25T08:30:00Z',
          confidence_score: 0.98,
          status: 'SUCCESS',
          device_id: 'kiosk-01',
        },
      ];

      const mockEmployees: EmployeeItem[] = [
        {
          id: 'emp-001',
          name: 'Alice Johnson',
          email: 'alice@example.com',
          is_enrolled: false,
          is_active: true,
        },
      ];

      let tree: any;
      renderer.act(() => {
        tree = renderer.create(
          <ManagerDashboardScreen
            initialRecentLogs={mockLogs}
            initialEmployees={mockEmployees}
          />
        );
      });

      const root = tree.root;
      const presentCard = root.findByProps({ testID: 'card-present' });
      expect(presentCard.findAllByType('Text')[0].props.children).toBe(1);

      const absentCard = root.findByProps({ testID: 'card-absent' });
      // Math.max(0, 0 - 1) = 0
      expect(absentCard.findAllByType('Text')[0].props.children).toBe(0);
    });

    it('edge case 2: empty recent logs array', () => {
      const mockLogs: RecentCheckinItem[] = [];
      const mockEmployees: EmployeeItem[] = [
        {
          id: 'emp-001',
          name: 'Alice Johnson',
          email: 'alice@example.com',
          is_enrolled: true,
          is_active: true,
        },
        {
          id: 'emp-002',
          name: 'Bob Smith',
          email: 'bob@example.com',
          is_enrolled: true,
          is_active: true,
        },
      ];

      let tree: any;
      renderer.act(() => {
        tree = renderer.create(
          <ManagerDashboardScreen
            initialRecentLogs={mockLogs}
            initialEmployees={mockEmployees}
          />
        );
      });

      const root = tree.root;
      const presentCard = root.findByProps({ testID: 'card-present' });
      expect(presentCard.findAllByType('Text')[0].props.children).toBe(0);

      const absentCard = root.findByProps({ testID: 'card-absent' });
      expect(absentCard.findAllByType('Text')[0].props.children).toBe(2);

      const lateCard = root.findByProps({ testID: 'card-late' });
      expect(lateCard.findAllByType('Text')[0].props.children).toBe(0);

      const emptyText = root.findByProps({ testID: 'empty-feed' });
      expect(emptyText.props.children).toBe('No recent check-ins recorded.');
    });

    it('edge case 3: all check-ins are late (> 09:00 AM)', () => {
      const mockLogs: RecentCheckinItem[] = [
        {
          employee_name: 'Alice Johnson',
          check_type: 'CHECK_IN',
          timestamp: '2026-07-25T09:15:00Z',
          confidence_score: 0.95,
          status: 'SUCCESS',
          device_id: 'kiosk-01',
        },
        {
          employee_name: 'Bob Smith',
          check_type: 'CHECK_IN',
          timestamp: '2026-07-25T10:00:00Z',
          confidence_score: 0.92,
          status: 'SUCCESS',
          device_id: 'kiosk-01',
        },
      ];

      const mockEmployees: EmployeeItem[] = [
        { id: '1', name: 'Alice Johnson', email: 'a@ex.com', is_enrolled: true, is_active: true },
        { id: '2', name: 'Bob Smith', email: 'b@ex.com', is_enrolled: true, is_active: true },
      ];

      let tree: any;
      renderer.act(() => {
        tree = renderer.create(
          <ManagerDashboardScreen
            initialRecentLogs={mockLogs}
            initialEmployees={mockEmployees}
          />
        );
      });

      const root = tree.root;
      const lateCard = root.findByProps({ testID: 'card-late' });
      expect(lateCard.findAllByType('Text')[0].props.children).toBe(2);
    });

    it('edge case 4: invalid timestamp format in log does not crash metrics', () => {
      const mockLogs: RecentCheckinItem[] = [
        {
          employee_name: 'Alice Johnson',
          check_type: 'CHECK_IN',
          timestamp: 'invalid-date-format',
          confidence_score: 0.95,
          status: 'SUCCESS',
          device_id: 'kiosk-01',
        },
      ];

      const mockEmployees: EmployeeItem[] = [
        { id: '1', name: 'Alice Johnson', email: 'a@ex.com', is_enrolled: true, is_active: true },
      ];

      let tree: any;
      renderer.act(() => {
        tree = renderer.create(
          <ManagerDashboardScreen
            initialRecentLogs={mockLogs}
            initialEmployees={mockEmployees}
          />
        );
      });

      const root = tree.root;
      const lateCard = root.findByProps({ testID: 'card-late' });
      // Invalid date returns false for late check
      expect(lateCard.findAllByType('Text')[0].props.children).toBe(0);
    });

    it('VERIFIED FIX: CHECK_OUT events occurring after 09:00 AM are NOT counted as LATE', () => {
      const mockLogs: RecentCheckinItem[] = [
        {
          employee_name: 'Alice Johnson',
          check_type: 'CHECK_IN',
          timestamp: '2026-07-25T08:30:00', // On time check-in (8:30 AM local)
          confidence_score: 0.98,
          status: 'SUCCESS',
          device_id: 'kiosk-01',
        },
        {
          employee_name: 'Alice Johnson',
          check_type: 'CHECK_OUT',
          timestamp: '2026-07-25T17:00:00', // Normal end-of-day check-out (5:00 PM local)
          confidence_score: 0.97,
          status: 'SUCCESS',
          device_id: 'kiosk-01',
        },
      ];

      const mockEmployees: EmployeeItem[] = [
        { id: '1', name: 'Alice Johnson', email: 'a@ex.com', is_enrolled: true, is_active: true },
      ];

      let tree: any;
      renderer.act(() => {
        tree = renderer.create(
          <ManagerDashboardScreen
            initialRecentLogs={mockLogs}
            initialEmployees={mockEmployees}
          />
        );
      });

      const root = tree.root;
      const lateCard = root.findByProps({ testID: 'card-late' });
      const calculatedLateCount = lateCard.findAllByType('Text')[0].props.children;

      // Expected late count is 0 because Alice checked in on time (8:30 AM) and checked out at 5:00 PM.
      console.log('Empirical test result - Late count with CHECK_OUT log:', calculatedLateCount);
      expect(calculatedLateCount).toBe(0); // Verified correct behavior after filtering check_type
    });
  });

  describe('2. Pull-to-Refresh & Modal Interactions', () => {
    it('triggers API fetch on refresh control pull', async () => {
      (apiService.getRecentCheckins as jest.Mock).mockResolvedValue([]);
      (apiService.getEmployees as jest.Mock).mockResolvedValue([]);

      let tree: any;
      renderer.act(() => {
        tree = renderer.create(
          <ManagerDashboardScreen
            initialRecentLogs={[]}
            initialEmployees={[]}
          />
        );
      });

      const root = tree.root;
      const scrollView = root.findByType(ScrollView);
      const refreshControl = scrollView.props.refreshControl;

      await renderer.act(async () => {
        refreshControl.props.onRefresh();
      });

      expect(apiService.getRecentCheckins).toHaveBeenCalledTimes(1);
      expect(apiService.getEmployees).toHaveBeenCalledTimes(1);
    });

    it('opens and closes employee detail modal correctly', () => {
      const mockEmployees: EmployeeItem[] = [
        {
          id: 'emp-101',
          name: 'Jane Doe',
          email: 'jane@example.com',
          department: 'HR',
          job_title: 'Manager',
          is_enrolled: true,
          is_active: true,
        },
      ];

      let tree: any;
      renderer.act(() => {
        tree = renderer.create(
          <ManagerDashboardScreen
            initialRecentLogs={[]}
            initialEmployees={mockEmployees}
          />
        );
      });

      const root = tree.root;

      // Verify modal is not rendered initially
      expect(root.findAllByProps({ testID: 'employee-detail-modal' }).length).toBe(0);

      // Press employee item
      const empItem = root.findByProps({ testID: 'employee-item-emp-101' });
      renderer.act(() => {
        empItem.props.onPress();
      });

      // Verify modal is now displayed
      const modal = root.findByProps({ testID: 'employee-detail-modal' });
      expect(modal).toBeTruthy();

      // Press close button
      const closeBtn = root.findByProps({ testID: 'close-modal-button' });
      renderer.act(() => {
        closeBtn.props.onPress();
      });

      // Verify modal is closed
      expect(root.findAllByProps({ testID: 'employee-detail-modal' }).length).toBe(0);
    });
  });
});
