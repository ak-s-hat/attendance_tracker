import React from 'react';
import renderer from 'react-test-renderer';
import { AdminDashboardScreen } from '../screens/AdminDashboardScreen';
import { EmployeeItem, UserItem, AttendanceSummaryResponse } from '../services/api';
import * as apiService from '../services/api';

jest.mock('../services/api');

describe('AdminDashboardScreen Unit Test Suite', () => {
  const mockSummary: AttendanceSummaryResponse = {
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

  const mockEmployees: EmployeeItem[] = [
    {
      id: 'emp-1',
      name: 'John Doe',
      department: 'Engineering',
      is_enrolled: true,
      is_active: true,
      leave_balance: 15,
      present_days: 20,
      late_count: 1,
    },
    {
      id: 'emp-2',
      name: 'Jane Smith',
      department: 'Sales',
      is_enrolled: true,
      is_active: true,
      leave_balance: 10,
      present_days: 18,
      late_count: 0,
    },
  ];

  const mockUsers: UserItem[] = [
    { id: 'usr-1', username: 'admin1', role: 'admin' },
    { id: 'usr-2', username: 'emp1', role: 'employee' },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (apiService.getAttendanceSummary as jest.Mock).mockResolvedValue(mockSummary);
    (apiService.getEmployees as jest.Mock).mockResolvedValue(mockEmployees);
    (apiService.getUsers as jest.Mock).mockResolvedValue(mockUsers);
  });

  it('renders summary cards with present, absent, and late counts', () => {
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

    const presentCard = root.findByProps({ testID: 'card-present' });
    expect(presentCard.findAllByType('Text')[0].props.children).toBe(7);

    const absentCard = root.findByProps({ testID: 'card-absent' });
    expect(absentCard.findAllByType('Text')[0].props.children).toBe(2);

    const lateCard = root.findByProps({ testID: 'card-late' });
    expect(lateCard.findAllByType('Text')[0].props.children).toBe(1);
  });

  it('renders department breakdown and employee attendance table', () => {
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

    const deptCard = root.findByProps({ testID: 'department-breakdown-card' });
    expect(deptCard).toBeTruthy();

    const empTable = root.findByProps({ testID: 'employee-attendance-table' });
    expect(empTable).toBeTruthy();

    const empRow1 = root.findByProps({ testID: 'employee-item-emp-1' });
    expect(empRow1).toBeTruthy();
  });

  it('opens leave adjustment modal when employee item is pressed', () => {
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

    const empRow = root.findByProps({ testID: 'employee-item-emp-1' });
    renderer.act(() => {
      empRow.props.onPress();
    });

    const modal = root.findByProps({ testID: 'employee-detail-modal' });
    expect(modal).toBeTruthy();

    const closeBtn = root.findByProps({ testID: 'close-modal-button' });
    renderer.act(() => {
      closeBtn.props.onPress();
    });

    expect(root.findAllByProps({ testID: 'employee-detail-modal' }).length).toBe(0);
  });

  it('generates registration link token on generate-token-button press', async () => {
    const mockTokenRes = {
      token: 'token_abc123',
      registration_url: 'http://localhost:3000/register?token=token_abc123',
      expires_at: '2026-08-06T00:00:00Z',
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

    const linkDisplay = root.findByProps({ testID: 'registration-link-display' });
    expect(linkDisplay).toBeTruthy();
  });

  it('renders user role management section for super_admin', () => {
    let tree: any;
    renderer.act(() => {
      tree = renderer.create(
        <AdminDashboardScreen
          currentUserRole="super_admin"
          initialSummary={mockSummary}
          initialEmployees={mockEmployees}
          initialUsers={mockUsers}
        />
      );
    });

    const root = tree.root;
    const roleSection = root.findByProps({ testID: 'super-admin-role-section' });
    expect(roleSection).toBeTruthy();

    const toggleBtn = root.findByProps({ testID: 'role-toggle-usr-2' });
    expect(toggleBtn).toBeTruthy();
  });
});
