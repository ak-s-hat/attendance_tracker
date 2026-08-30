import React from 'react';
import renderer from 'react-test-renderer';
import { AdminDashboardScreen } from '../../src/screens/AdminDashboardScreen';
import * as apiService from '../../src/services/api';

jest.mock('../../src/services/api');

describe('Milestone 3 Admin Dashboard Empirical Verification Suite', () => {
  const mockSummary: apiService.AttendanceSummaryResponse = {
    date: '2026-08-05',
    total_employees: 10,
    present_count: 7,
    absent_count: 2,
    late_count: 1,
    departments: {
      Engineering: { present: 5, absent: 1, late: 1 },
      Sales: { present: 2, absent: 1, late: 0 },
    },
  };

  const mockEmployees: apiService.EmployeeItem[] = [
    {
      id: 'emp-101',
      name: 'Alice Johnson',
      department: 'Engineering',
      is_enrolled: true,
      is_active: true,
      leave_balance: 14,
      present_days: 22,
      late_count: 2,
    },
    {
      id: 'emp-102',
      name: 'Bob Smith',
      department: 'Sales',
      is_enrolled: true,
      is_active: true,
      leave_balance: 8,
      present_days: 15,
      late_count: 0,
    },
  ];

  const mockUsers: apiService.UserItem[] = [
    { id: 'usr-1', username: 'superadmin', role: 'super_admin' },
    { id: 'usr-2', username: 'admin_john', role: 'admin' },
    { id: 'usr-3', username: 'employee_mary', role: 'employee' },
  ];

  const mockRecentLogs: apiService.RecentCheckinItem[] = [
    {
      employee_name: 'Alice Johnson',
      check_type: 'CHECK_IN',
      timestamp: '2026-08-05T09:15:00Z', // 09:15 AM -> Late (> 09:00 AM)
      confidence_score: 0.98,
      status: 'SUCCESS',
      device_id: 'kiosk-1',
    },
    {
      employee_name: 'Bob Smith',
      check_type: 'CHECK_IN',
      timestamp: '2026-08-05T08:45:00Z', // 08:45 AM -> On time (<= 09:00 AM)
      confidence_score: 0.95,
      status: 'SUCCESS',
      device_id: 'kiosk-1',
    },
    {
      employee_name: 'Bob Smith',
      check_type: 'CHECK_OUT',
      timestamp: '2026-08-05T17:00:00Z', // Check Out -> Should NOT be counted as late check-in
      confidence_score: 0.96,
      status: 'SUCCESS',
      device_id: 'kiosk-1',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (apiService.getAttendanceSummary as jest.Mock).mockResolvedValue(mockSummary);
    (apiService.getEmployees as jest.Mock).mockResolvedValue(mockEmployees);
    (apiService.getUsers as jest.Mock).mockResolvedValue(mockUsers);
    (apiService.getRecentCheckins as jest.Mock).mockResolvedValue(mockRecentLogs);
  });

  // Feature 1: Summary & Department Cards
  it('1. Summary & Department Cards: Displays present, absent, late counts and department breakdown', () => {
    let tree: any;
    renderer.act(() => {
      tree = renderer.create(
        <AdminDashboardScreen
          initialSummary={mockSummary}
          initialEmployees={mockEmployees}
          initialUsers={mockUsers}
          initialRecentLogs={mockRecentLogs}
        />
      );
    });

    const root = tree.root;

    // Verify summary metric cards
    const cardPresent = root.findByProps({ testID: 'card-present' });
    expect(cardPresent.findAllByType('Text')[0].props.children).toBe(7);

    const cardAbsent = root.findByProps({ testID: 'card-absent' });
    expect(cardAbsent.findAllByType('Text')[0].props.children).toBe(2);

    const cardLate = root.findByProps({ testID: 'card-late' });
    expect(cardLate.findAllByType('Text')[0].props.children).toBe(1);

    // Verify department breakdown card
    const deptCard = root.findByProps({ testID: 'department-breakdown-card' });
    expect(deptCard).toBeTruthy();
  });

  // Feature 2: Per-Employee Table & Leave Adjustment
  it('2. Per-Employee Table & Leave Adjustment: Displays employee table and handles leave balance update via PATCH /api/employees/{id}/leave', async () => {
    (apiService.adjustLeaveBalance as jest.Mock).mockResolvedValue({
      employee_id: 'emp-101',
      new_leave_balance: 17,
      message: 'Leave adjusted successfully',
    });

    let tree: any;
    renderer.act(() => {
      tree = renderer.create(
        <AdminDashboardScreen
          initialSummary={mockSummary}
          initialEmployees={mockEmployees}
          initialUsers={mockUsers}
        />
      );
    });

    const root = tree.root;

    // Verify employee table
    const empTable = root.findByProps({ testID: 'employee-attendance-table' });
    expect(empTable).toBeTruthy();

    const empRow = root.findByProps({ testID: 'employee-item-emp-101' });
    expect(empRow).toBeTruthy();

    // Open Leave Adjustment Modal
    renderer.act(() => {
      empRow.props.onPress();
    });

    const modal = root.findByProps({ testID: 'employee-detail-modal' });
    expect(modal).toBeTruthy();

    // Select 'add' action and trigger save
    const saveBtn = root.findByProps({ testID: 'save-leave-button' });
    await renderer.act(async () => {
      saveBtn.props.onPress();
    });

    expect(apiService.adjustLeaveBalance).toHaveBeenCalledWith(
      expect.any(String),
      'emp-101',
      { action: 'add', amount: 1 },
      undefined
    );
  });

  // Feature 3: Late Entry Stats
  it('3. Late Entry Stats: Compares check-in timestamps against work_start_time (09:00 AM)', () => {
    let tree: any;
    renderer.act(() => {
      tree = renderer.create(
        <AdminDashboardScreen
          initialSummary={null} // Force fallback calculation from recentLogs
          initialEmployees={mockEmployees}
          initialRecentLogs={mockRecentLogs}
        />
      );
    });

    const root = tree.root;

    // Late count should equal 1 because only 1 log is CHECK_IN and > 09:00 AM (09:15 AM)
    const cardLate = root.findByProps({ testID: 'card-late' });
    expect(cardLate.findAllByType('Text')[0].props.children).toBe(1);
  });

  // Feature 4: Share Web Registration Link
  it('4. Share Web Registration Link: Calls POST /api/registration/token and displays link', async () => {
    const mockTokenRes: apiService.RegistrationTokenResponse = {
      token: 'reg_token_xyz999',
      registration_url: 'http://localhost:3000/register?token=reg_token_xyz999',
      expires_at: '2026-08-06T09:00:00Z',
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
    });

    const root = tree.root;
    const generateBtn = root.findByProps({ testID: 'generate-token-button' });

    await renderer.act(async () => {
      generateBtn.props.onPress();
    });

    expect(apiService.generateRegistrationToken).toHaveBeenCalled();
    const linkDisplay = root.findByProps({ testID: 'registration-link-display' });
    expect(linkDisplay).toBeTruthy();
  });

  // Feature 5: Super Admin User Role Management
  it('5. Super Admin User Role Management: Visible only to super_admin and updates role via PATCH /api/users/{id}/role', async () => {
    (apiService.updateUserRole as jest.Mock).mockResolvedValue({
      user_id: 'usr-2',
      role: 'employee',
    });

    // Test 5a: Visible for super_admin
    let treeSuper: any;
    renderer.act(() => {
      treeSuper = renderer.create(
        <AdminDashboardScreen
          currentUserRole="super_admin"
          initialSummary={mockSummary}
          initialEmployees={mockEmployees}
          initialUsers={mockUsers}
        />
      );
    });

    const rootSuper = treeSuper.root;
    const roleSection = rootSuper.findByProps({ testID: 'super-admin-role-section' });
    expect(roleSection).toBeTruthy();

    const toggleBtn = rootSuper.findByProps({ testID: 'role-toggle-usr-2' });
    await renderer.act(async () => {
      toggleBtn.props.onPress();
    });

    expect(apiService.updateUserRole).toHaveBeenCalledWith(
      expect.any(String),
      'usr-2',
      'employee',
      undefined
    );

    // Test 5b: Hidden for admin
    let treeAdmin: any;
    renderer.act(() => {
      treeAdmin = renderer.create(
        <AdminDashboardScreen
          currentUserRole="admin"
          initialSummary={mockSummary}
          initialEmployees={mockEmployees}
          initialUsers={mockUsers}
        />
      );
    });

    expect(treeAdmin.root.findAllByProps({ testID: 'super-admin-role-section' }).length).toBe(0);
  });
});
