import React from 'react';
import renderer from 'react-test-renderer';
import { ManagerDashboardScreen } from '../../src/screens/ManagerDashboardScreen';
import { RecentCheckinItem, EmployeeItem } from '../../src/services/api';
import * as apiService from '../../src/services/api';

jest.mock('../../src/services/api');

describe('ManagerDashboardScreen Unit Tests', () => {
  const mockRecentLogs: RecentCheckinItem[] = [
    {
      employee_name: 'Alice Johnson',
      check_type: 'CHECK_IN',
      timestamp: '2026-07-25T08:30:00',
      confidence_score: 0.98,
      status: 'SUCCESS',
      device_id: 'kiosk-01',
    },
    {
      employee_name: 'Bob Smith',
      check_type: 'CHECK_IN',
      timestamp: '2026-07-25T09:15:00', // Late (> 09:00 AM)
      confidence_score: 0.94,
      status: 'SUCCESS',
      device_id: 'kiosk-01',
    },
    {
      employee_name: 'Charlie Brown',
      check_type: 'CHECK_OUT',
      timestamp: '2026-07-25T17:00:00',
      confidence_score: 0.96,
      status: 'SUCCESS',
      device_id: 'kiosk-02',
    },
  ];

  const mockEmployees: EmployeeItem[] = [
    {
      id: 'emp-001',
      name: 'Alice Johnson',
      email: 'alice@example.com',
      department: 'Engineering',
      job_title: 'Senior Developer',
      is_enrolled: true,
      is_active: true,
    },
    {
      id: 'emp-002',
      name: 'Bob Smith',
      email: 'bob@example.com',
      department: 'Design',
      job_title: 'UI Designer',
      is_enrolled: true,
      is_active: true,
    },
    {
      id: 'emp-003',
      name: 'Charlie Brown',
      email: 'charlie@example.com',
      department: 'Product',
      job_title: 'Product Manager',
      is_enrolled: true,
      is_active: true,
    },
    {
      id: 'emp-004',
      name: 'David Miller',
      email: 'david@example.com',
      department: 'Sales',
      job_title: 'Account Exec',
      is_enrolled: true,
      is_active: true,
    },
  ];

  beforeEach(() => {
    (apiService.getRecentCheckins as jest.Mock).mockResolvedValue(mockRecentLogs);
    (apiService.getEmployees as jest.Mock).mockResolvedValue(mockEmployees);
  });

  it('renders summary cards with correct Present, Absent, and Late metrics', () => {
    let tree: any;
    renderer.act(() => {
      tree = renderer.create(
        <ManagerDashboardScreen
          initialRecentLogs={mockRecentLogs}
          initialEmployees={mockEmployees}
        />
      );
    });

    const root = tree.root;

    const presentCard = root.findByProps({ testID: 'card-present' });
    expect(presentCard.findAllByType('Text')[0].props.children).toBe(2);

    const absentCard = root.findByProps({ testID: 'card-absent' });
    expect(absentCard.findAllByType('Text')[0].props.children).toBe(2);

    const lateCard = root.findByProps({ testID: 'card-late' });
    expect(lateCard.findAllByType('Text')[0].props.children).toBe(1);
  });

  it('fetches and renders recent check-in list items from getRecentCheckins', () => {
    let tree: any;
    renderer.act(() => {
      tree = renderer.create(
        <ManagerDashboardScreen
          initialRecentLogs={mockRecentLogs}
          initialEmployees={mockEmployees}
        />
      );
    });

    const root = tree.root;
    const feedList = root.findByProps({ testID: 'feed-list' });
    expect(feedList).toBeTruthy();

    const feedItem0 = root.findByProps({ testID: 'feed-item-0' });
    expect(feedItem0).toBeTruthy();
  });

  it('opens employee detail modal when employee item is pressed', () => {
    let tree: any;
    renderer.act(() => {
      tree = renderer.create(
        <ManagerDashboardScreen
          initialRecentLogs={mockRecentLogs}
          initialEmployees={mockEmployees}
        />
      );
    });

    const root = tree.root;

    // Initially modal is not open
    expect(root.findAllByProps({ testID: 'employee-detail-modal' })).toHaveLength(0);

    // Press employee emp-001 item
    const empItem = root.findByProps({ testID: 'employee-item-emp-001' });
    renderer.act(() => {
      empItem.props.onPress();
    });

    // Modal is now open
    const modal = root.findByProps({ testID: 'employee-detail-modal' });
    expect(modal).toBeTruthy();

    // Close modal
    const closeBtn = root.findByProps({ testID: 'close-modal-button' });
    renderer.act(() => {
      closeBtn.props.onPress();
    });

    expect(root.findAllByProps({ testID: 'employee-detail-modal' })).toHaveLength(0);
  });
});
