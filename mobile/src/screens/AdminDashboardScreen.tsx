import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Modal,
  RefreshControl,
  ActivityIndicator,
  ScrollView,
  TextInput,
  Alert,
  Share,
  Image,
  Switch,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  getAttendanceSummary,
  getEmployees,
  getEmployeeAttendance,
  adjustLeaveBalance,
  generateRegistrationToken,
  getUsers,
  updateUserRole,
  createEmployee,
  enrollEmployeeFace,
  deleteEmployee,
  getSystemSettings,
  updateSystemSettings,
  getDatabaseStats,
  purgeLogs,
  updateCheckinLogStatus,
  AttendanceSummaryResponse,
  EmployeeItem,
  UserItem,
  RecentCheckinItem,
  getRecentCheckins,
  getDailyAttendanceMatrix,
  DailyMatrixItem,
  SystemSettings,
  DatabaseStats,
} from '../services/api';
import { colors } from '../theme/colors';

export interface AdminDashboardScreenProps {
  apiBaseUrl?: string;
  authToken?: string;
  currentUserRole?: 'super_admin' | 'admin' | 'employee';
  initialSummary?: AttendanceSummaryResponse | null;
  initialEmployees?: EmployeeItem[] | null;
  initialUsers?: UserItem[] | null;
  initialRecentLogs?: RecentCheckinItem[] | null;
}

type DashboardTab = 'summary' | 'daily_matrix' | 'employees' | 'feed' | 'users' | 'settings';

export const AdminDashboardScreen: React.FC<AdminDashboardScreenProps> = ({
  apiBaseUrl = 'http://192.168.2.118:8000',
  authToken,
  currentUserRole = 'super_admin',
  initialSummary = null,
  initialEmployees = null,
  initialUsers = null,
  initialRecentLogs = null,
}) => {
  const [activeTab, setActiveTab] = useState<DashboardTab>('summary');
  const [summary, setSummary] = useState<AttendanceSummaryResponse | null>(initialSummary);
  const [employees, setEmployees] = useState<EmployeeItem[]>(initialEmployees || []);
  const [users, setUsers] = useState<UserItem[]>(initialUsers || []);
  const [recentLogs, setRecentLogs] = useState<RecentCheckinItem[]>(initialRecentLogs || []);
  const [dailyMatrix, setDailyMatrix] = useState<DailyMatrixItem[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [dbStats, setDbStats] = useState<DatabaseStats | null>(null);
  const [loading, setLoading] = useState(!initialSummary && !initialEmployees && !initialRecentLogs);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeItem | null>(null);

  // Camera & Face Ingestion State
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('front');
  const [newEmpPhotoUri, setNewEmpPhotoUri] = useState<string | null>(null);
  const [targetEmployeeForFaceUpdate, setTargetEmployeeForFaceUpdate] = useState<EmployeeItem | null>(null);
  const cameraRef = useRef<any>(null);

  // Daily Matrix Filters & Sorting
  const [matrixFilterStatus, setMatrixFilterStatus] = useState<string>('ALL');
  const [matrixSearchQuery, setMatrixSearchQuery] = useState<string>('');

  // Live Feed Filters & Search
  const [feedFilterType, setFeedFilterType] = useState<string>('ALL');
  const [feedSearchQuery, setFeedSearchQuery] = useState<string>('');

  // Direct Employee Registration State
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState(false);
  const [newEmpName, setNewEmpName] = useState('');
  const [newEmpDept, setNewEmpDept] = useState('');
  const [newEmpJobTitle, setNewEmpJobTitle] = useState('');
  const [newEmpEmail, setNewEmpEmail] = useState('');
  const [creatingEmployee, setCreatingEmployee] = useState(false);
  const [createEmpMessage, setCreateEmpMessage] = useState<{ text: string; isError: boolean } | null>(null);

  // Leave Adjustment Modal State
  const [leaveAction, setLeaveAction] = useState<'add' | 'deduct' | 'set'>('add');
  const [leaveAmount, setLeaveAmount] = useState('1');
  const [updatingLeave, setUpdatingLeave] = useState(false);
  const [leaveMessage, setLeaveMessage] = useState<string | null>(null);

  // Settings Form State
  const [formDebounceMins, setFormDebounceMins] = useState('2.0');
  const [formWorkStartTime, setFormWorkStartTime] = useState('09:00');
  const [formHalfDayTime, setFormHalfDayTime] = useState('13:00');
  const [formCheckoutTime, setFormCheckoutTime] = useState('17:00');
  const [formDupThreshold, setFormDupThreshold] = useState('0.65');
  const [formAutoDeduct, setFormAutoDeduct] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSaveMessage, setSettingsSaveMessage] = useState<string | null>(null);

  // Registration Token Link State
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [generatingToken, setGeneratingToken] = useState(false);
  const [copiedNotification, setCopiedNotification] = useState(false);

  // User Role Management State
  const [updatingUserRole, setUpdatingUserRole] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [sumData, empsData, logsData, matrixData, settingsData, statsData] = await Promise.all([
        Promise.resolve(getAttendanceSummary(apiBaseUrl, authToken)).catch(() => null),
        Promise.resolve(getEmployees(apiBaseUrl, authToken)).catch(() => []),
        Promise.resolve(getRecentCheckins(apiBaseUrl, authToken, feedFilterType, feedSearchQuery)).catch(() => []),
        Promise.resolve(getDailyAttendanceMatrix(apiBaseUrl, undefined, authToken)).catch(() => []),
        Promise.resolve(getSystemSettings(apiBaseUrl, authToken)).catch(() => null),
        Promise.resolve(getDatabaseStats(apiBaseUrl, authToken)).catch(() => null),
      ]);

      if (sumData) setSummary(sumData);
      setEmployees(empsData);
      setRecentLogs(logsData);
      setDailyMatrix(matrixData);

      if (settingsData) {
        setSettings(settingsData);
        setFormDebounceMins(String(settingsData.rapid_scan_debounce_minutes));
        setFormWorkStartTime(settingsData.work_start_time);
        setFormHalfDayTime(settingsData.half_day_cutoff_time);
        setFormCheckoutTime(settingsData.valid_checkout_time);
        setFormDupThreshold(String(settingsData.duplicate_face_threshold));
        setFormAutoDeduct(settingsData.auto_deduct_absent_leave);
      }
      if (statsData) setDbStats(statsData);

      if (currentUserRole === 'super_admin') {
        const usersData = await getUsers(apiBaseUrl, authToken).catch(() => []);
        setUsers(usersData);
      }
    } catch (err) {
      console.warn('Failed to load Admin Dashboard data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiBaseUrl, authToken, currentUserRole, feedFilterType, feedSearchQuery]);

  useEffect(() => {
    if (!initialSummary && !initialEmployees && !initialRecentLogs) {
      fetchData();
    }
  }, [fetchData, initialSummary, initialEmployees, initialRecentLogs]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  const presentCount = summary?.present_count ?? 0;
  const absentCount = summary?.absent_count ?? 0;
  const lateCount = summary?.late_count ?? 0;

  // Open Camera for Face Capture
  const handleOpenCamera = async (targetEmp?: EmployeeItem) => {
    if (targetEmp) {
      setTargetEmployeeForFaceUpdate(targetEmp);
    } else {
      setTargetEmployeeForFaceUpdate(null);
    }

    if (!cameraPermission?.granted) {
      const permissionRes = await requestCameraPermission();
      if (!permissionRes.granted) {
        Alert.alert('Permission Required', 'Camera permission is needed to take a face registration photo.');
        return;
      }
    }
    setIsCameraOpen(true);
  };

  // Snap Face Photo
  const handleSnapFacePhoto = async () => {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.8,
        skipProcessing: true,
        shutterSound: false,
      });
      if (photo && photo.uri) {
        setIsCameraOpen(false);

        // If this is a direct update for an existing employee
        if (targetEmployeeForFaceUpdate) {
          try {
            const enrollRes = await enrollEmployeeFace(
              apiBaseUrl,
              targetEmployeeForFaceUpdate.id,
              photo.uri,
              authToken
            );
            if (enrollRes.success) {
              Alert.alert('Success', `Biometric face updated for ${targetEmployeeForFaceUpdate.name}!`);
              setEmployees((prev) =>
                prev.map((e) => (e.id === targetEmployeeForFaceUpdate.id ? { ...e, is_enrolled: true } : e))
              );
            }
          } catch (e: any) {
            Alert.alert('Enrollment Error', e?.response?.data?.detail || 'Failed to update face biometric.');
          } finally {
            setTargetEmployeeForFaceUpdate(null);
          }
        } else {
          setNewEmpPhotoUri(photo.uri);
        }
      }
    } catch (e: any) {
      Alert.alert('Capture Failed', e?.message || 'Unable to capture photo.');
    }
  };

  // Direct Register Employee Handler
  const handleDirectRegisterEmployee = async () => {
    if (!newEmpName.trim()) {
      setCreateEmpMessage({ text: 'Employee name is required.', isError: true });
      return;
    }

    setCreatingEmployee(true);
    setCreateEmpMessage(null);

    try {
      const cleanEmail = newEmpEmail.trim() ? newEmpEmail.trim() : undefined;
      const created = await createEmployee(
        apiBaseUrl,
        {
          name: newEmpName.trim(),
          department: newEmpDept.trim() || 'General',
          job_title: newEmpJobTitle.trim() || undefined,
          email: cleanEmail,
        },
        authToken
      );

      let enrolledSuccess = false;

      // If photo was captured, enroll face embedding immediately
      if (newEmpPhotoUri) {
        try {
          const enrollRes = await enrollEmployeeFace(
            apiBaseUrl,
            created.id,
            newEmpPhotoUri,
            authToken
          );
          if (enrollRes.success) {
            enrolledSuccess = true;
            created.is_enrolled = true;
          }
        } catch (enrollErr: any) {
          console.warn('Face enrollment failed:', enrollErr);
        }
      }

      setEmployees((prev) => [created, ...prev]);
      setDailyMatrix((prev) => [
        {
          employee_id: created.id,
          name: created.name,
          department: created.department || 'General',
          job_title: created.job_title || null,
          status: 'ABSENT',
          first_check_in: null,
          last_check_out: null,
          total_hours: null,
          late_minutes: 0,
          leave_balance: 15.0,
          confidence_score: null,
          liveness_score: null,
        },
        ...prev,
      ]);

      const successText = enrolledSuccess
        ? `✅ Registered & Biometric Face Enrolled for ${created.name}!`
        : `✅ Registered ${created.name}! (Face can be enrolled anytime)`;

      setCreateEmpMessage({
        text: successText,
        isError: false,
      });

      setTimeout(() => {
        setIsRegisterModalOpen(false);
        setCreateEmpMessage(null);
        setNewEmpName('');
        setNewEmpDept('');
        setNewEmpJobTitle('');
        setNewEmpEmail('');
        setNewEmpPhotoUri(null);
      }, 1500);
    } catch (err: any) {
      const errMsg = err?.response?.data?.detail || 'Failed to register employee.';
      setCreateEmpMessage({ text: `❌ ${errMsg}`, isError: true });
    } finally {
      setCreatingEmployee(false);
    }
  };

  // Delete Employee Handler (Item 2)
  const handleDeleteEmployee = (emp: EmployeeItem) => {
    Alert.alert(
      '⚠️ Confirm Permanent Deletion',
      `Are you sure you want to permanently delete all biometric data, attendance logs, and records for ${emp.name}?\n\nThis action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Permanently',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteEmployee(apiBaseUrl, emp.id, true, authToken);
              setEmployees((prev) => prev.filter((e) => e.id !== emp.id));
              setDailyMatrix((prev) => prev.filter((m) => m.employee_id !== emp.id));
              Alert.alert('Deleted', `Employee ${emp.name} has been removed.`);
            } catch (err: any) {
              Alert.alert('Error', err?.response?.data?.detail || 'Failed to delete employee.');
            }
          },
        },
      ]
    );
  };

  // Adjust Leave Balance Handler (Item 8 & 11)
  const handleAdjustLeave = async () => {
    if (!selectedEmployee) return;
    const amountNum = parseFloat(leaveAmount);
    if (isNaN(amountNum) || amountNum < 0) {
      setLeaveMessage('Please enter a valid positive number of days.');
      return;
    }

    setUpdatingLeave(true);
    setLeaveMessage(null);

    try {
      const res = await adjustLeaveBalance(
        apiBaseUrl,
        selectedEmployee.id,
        { action: leaveAction, amount: amountNum },
        authToken
      );

      setEmployees((prev) =>
        prev.map((e) => (e.id === selectedEmployee.id ? { ...e, leave_balance: res.new_leave_balance } : e))
      );
      setDailyMatrix((prev) =>
        prev.map((m) => (m.employee_id === selectedEmployee.id ? { ...m, leave_balance: res.new_leave_balance } : m))
      );
      setSelectedEmployee((prev) => (prev ? { ...prev, leave_balance: res.new_leave_balance } : null));
      setLeaveMessage(`Leave balance updated to ${res.new_leave_balance} days!`);
    } catch (err: any) {
      setLeaveMessage(err?.response?.data?.detail || 'Failed to update leave balance.');
    } finally {
      setUpdatingLeave(false);
    }
  };

  // Generate & Share Invite Link Handler
  const handleGenerateRegistrationToken = async () => {
    setGeneratingToken(true);
    setGeneratedLink(null);
    setCopiedNotification(false);

    try {
      const res = await generateRegistrationToken(apiBaseUrl, authToken, 24);
      const cleanBase = apiBaseUrl.replace(/\/$/, '');
      const fullUrl = `${cleanBase}/register?token=${res.token}`;
      setGeneratedLink(fullUrl);
    } catch (err) {
      console.warn('Failed to generate token:', err);
      const cleanBase = apiBaseUrl.replace(/\/$/, '');
      setGeneratedLink(`${cleanBase}/register?token=mock_reg_token_${Date.now()}`);
    } finally {
      setGeneratingToken(false);
    }
  };

  const handleShareOrCopyLink = async () => {
    if (!generatedLink) return;
    try {
      await Share.share({
        title: 'Attendance Tracker Registration Invite',
        message: `Register your face for company attendance tracking here:\n${generatedLink}`,
        url: generatedLink,
      });
      setCopiedNotification(true);
    } catch (e) {
      Alert.alert('Share Link', generatedLink);
      setCopiedNotification(true);
    }
  };

  // Save Settings Handler (Item 4, 5, 9, 11)
  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setSettingsSaveMessage(null);
    try {
      const updated = await updateSystemSettings(
        apiBaseUrl,
        {
          rapid_scan_debounce_minutes: parseFloat(formDebounceMins) || 2.0,
          work_start_time: formWorkStartTime.trim(),
          half_day_cutoff_time: formHalfDayTime.trim(),
          valid_checkout_time: formCheckoutTime.trim(),
          duplicate_face_threshold: parseFloat(formDupThreshold) || 0.65,
          auto_deduct_absent_leave: formAutoDeduct,
        },
        authToken
      );
      setSettings(updated);
      setSettingsSaveMessage('✅ System rules saved successfully!');
      setTimeout(() => setSettingsSaveMessage(null), 3000);
    } catch (err: any) {
      setSettingsSaveMessage(`❌ ${err?.response?.data?.detail || 'Failed to save settings.'}`);
    } finally {
      setSavingSettings(false);
    }
  };

  // Purge Unknown Logs Handler (Item 12)
  const handlePurgeLogs = (purgeType: string) => {
    Alert.alert(
      '🧹 Confirm Log Purge',
      `Purge unneeded ${purgeType} scan logs to reclaim database storage?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Purge Now',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await purgeLogs(apiBaseUrl, purgeType, 30, authToken);
              Alert.alert('Purge Complete', res.message);
              fetchData();
            } catch (err: any) {
              Alert.alert('Error', err?.response?.data?.detail || 'Failed to purge logs.');
            }
          },
        },
      ]
    );
  };

  // Half-Day Override Handler (Item 10)
  const handleReviewHalfDayLog = (log: RecentCheckinItem) => {
    if (!log.id) return;
    Alert.alert(
      'Review Attendance Record',
      `Employee: ${log.employee_name}\nCurrent Status: ${log.check_type}\nTimestamp: ${log.timestamp}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve as Valid CHECK_OUT',
          onPress: async () => {
            try {
              await updateCheckinLogStatus(apiBaseUrl, log.id!, { check_type: 'CHECK_OUT' }, authToken);
              Alert.alert('Updated', 'Record updated to CHECK_OUT.');
              fetchData();
            } catch (e: any) {
              Alert.alert('Error', e?.response?.data?.detail || 'Failed to update record.');
            }
          },
        },
        {
          text: 'Confirm as HALF_DAY',
          onPress: async () => {
            try {
              await updateCheckinLogStatus(apiBaseUrl, log.id!, { check_type: 'HALF_DAY' }, authToken);
              Alert.alert('Confirmed', 'Record confirmed as HALF_DAY.');
              fetchData();
            } catch (e: any) {
              Alert.alert('Error', e?.response?.data?.detail || 'Failed to update record.');
            }
          },
        },
      ]
    );
  };

  // User Role Promotion/Demotion Handler
  const handleToggleRole = async (user: UserItem) => {
    if (user.role === 'super_admin') {
      Alert.alert('Action Not Allowed', 'Super Admin role cannot be modified.');
      return;
    }
    const newRole = user.role === 'admin' ? 'employee' : 'admin';
    const actionLabel = newRole === 'admin' ? 'Promote to Admin' : 'Demote to Employee';

    Alert.alert('Confirm Role Change', `${actionLabel} for user "${user.username}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        onPress: async () => {
          setUpdatingUserRole(user.id);
          try {
            await updateUserRole(apiBaseUrl, user.id, newRole, authToken);
            setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, role: newRole } : u)));
          } catch (err: any) {
            Alert.alert('Error', err?.response?.data?.detail || 'Failed to update role.');
          } finally {
            setUpdatingUserRole(null);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading Dashboard...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Horizontal Scrollable Carousel Navigation Bar (Item 13) */}
      <View style={styles.carouselHeaderWrapper}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.carouselContainer}
        >
          <TouchableOpacity
            style={[styles.carouselTab, activeTab === 'summary' && styles.carouselTabActive]}
            onPress={() => setActiveTab('summary')}
          >
            <Text style={[styles.carouselTabText, activeTab === 'summary' && styles.carouselTabTextActive]}>
              📊 Overview
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.carouselTab, activeTab === 'daily_matrix' && styles.carouselTabActive]}
            onPress={() => setActiveTab('daily_matrix')}
          >
            <Text style={[styles.carouselTabText, activeTab === 'daily_matrix' && styles.carouselTabTextActive]}>
              🕒 Arrival Matrix
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.carouselTab, activeTab === 'employees' && styles.carouselTabActive]}
            onPress={() => setActiveTab('employees')}
          >
            <Text style={[styles.carouselTabText, activeTab === 'employees' && styles.carouselTabTextActive]}>
              👥 Employees ({employees.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.carouselTab, activeTab === 'feed' && styles.carouselTabActive]}
            onPress={() => setActiveTab('feed')}
          >
            <Text style={[styles.carouselTabText, activeTab === 'feed' && styles.carouselTabTextActive]}>
              📡 Live Feed
            </Text>
          </TouchableOpacity>

          {currentUserRole === 'super_admin' && (
            <TouchableOpacity
              style={[styles.carouselTab, activeTab === 'users' && styles.carouselTabActive]}
              onPress={() => setActiveTab('users')}
            >
              <Text style={[styles.carouselTabText, activeTab === 'users' && styles.carouselTabTextActive]}>
                🔑 Users ({users.length})
              </Text>
            </TouchableOpacity>
          )}

          {currentUserRole === 'super_admin' && (
            <TouchableOpacity
              style={[styles.carouselTab, activeTab === 'settings' && styles.carouselTabActive]}
              onPress={() => setActiveTab('settings')}
            >
              <Text style={[styles.carouselTabText, activeTab === 'settings' && styles.carouselTabTextActive]}>
                ⚙️ Settings & Hygiene
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* TAB 1: SUMMARY / OVERVIEW */}
        {activeTab === 'summary' && (
          <View>
            <View style={styles.actionBannerRow}>
              <TouchableOpacity
                style={styles.primaryActionButton}
                onPress={() => {
                  setNewEmpPhotoUri(null);
                  setIsRegisterModalOpen(true);
                }}
              >
                <Text style={styles.primaryActionButtonText}>➕ Register Employee</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.statsGrid}>
              <View style={[styles.statCard, { borderLeftColor: colors.success }]}>
                <Text style={styles.statLabel}>Present</Text>
                <Text style={[styles.statValue, { color: colors.success }]}>{presentCount}</Text>
              </View>
              <View style={[styles.statCard, { borderLeftColor: colors.error }]}>
                <Text style={styles.statLabel}>Absent</Text>
                <Text style={[styles.statValue, { color: colors.error }]}>{absentCount}</Text>
              </View>
              <View style={[styles.statCard, { borderLeftColor: colors.warning }]}>
                <Text style={styles.statLabel}>Late</Text>
                <Text style={[styles.statValue, { color: colors.warning }]}>{lateCount}</Text>
              </View>
            </View>

            {/* Registration Invite Link Generator */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>🔗 Web Registration Portal</Text>
              <Text style={styles.sectionDesc}>
                Generate an invite link for new employees to submit their face biometric data via browser:
              </Text>
              {generatedLink ? (
                <View style={styles.linkContainer}>
                  <Text style={styles.linkText} numberOfLines={2} selectable>
                    {generatedLink}
                  </Text>
                  <TouchableOpacity style={styles.copyBtn} onPress={handleShareOrCopyLink}>
                    <Text style={styles.copyBtnText}>
                      {copiedNotification ? '✓ Shared / Copied' : '📤 Share / Copy Link'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.generateBtn, generatingToken && styles.btnDisabled]}
                  onPress={handleGenerateRegistrationToken}
                  disabled={generatingToken}
                >
                  {generatingToken ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.generateBtnText}>⚡ Generate 24-Hour Invite Link</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* TAB 2: DAILY ARRIVAL MATRIX */}
        {activeTab === 'daily_matrix' && (
          <View>
            <View style={styles.matrixFilterBar}>
              <TextInput
                style={styles.matrixSearchInput}
                placeholder="🔍 Search arrival by employee name..."
                placeholderTextColor={colors.secondaryText}
                value={matrixSearchQuery}
                onChangeText={setMatrixSearchQuery}
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.matrixChipsRow}>
                {['ALL', 'PRESENT', 'LATE', 'ABSENT'].map((status) => (
                  <TouchableOpacity
                    key={status}
                    style={[styles.matrixChip, matrixFilterStatus === status && styles.matrixChipActive]}
                    onPress={() => setMatrixFilterStatus(status)}
                  >
                    <Text style={[styles.matrixChipText, matrixFilterStatus === status && styles.matrixChipTextActive]}>
                      {status}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {dailyMatrix
              .filter((item) => {
                const matchesFilter = matrixFilterStatus === 'ALL' || item.status === matrixFilterStatus;
                const matchesSearch =
                  !matrixSearchQuery.trim() ||
                  item.name.toLowerCase().includes(matrixSearchQuery.toLowerCase()) ||
                  (item.department && item.department.toLowerCase().includes(matrixSearchQuery.toLowerCase()));
                return matchesFilter && matchesSearch;
              })
              .map((row) => (
                <View key={row.employee_id} style={styles.matrixCard}>
                  <View style={styles.matrixCardHeader}>
                    <View>
                      <Text style={styles.matrixEmpName}>{row.name}</Text>
                      <Text style={styles.matrixEmpDept}>{row.department || 'General'}</Text>
                    </View>
                    <View
                      style={[
                        styles.matrixStatusBadge,
                        row.status === 'PRESENT'
                          ? styles.statusPresent
                          : row.status === 'LATE'
                          ? styles.statusLate
                          : styles.statusAbsent,
                      ]}
                    >
                      <Text style={styles.matrixStatusText}>{row.status}</Text>
                    </View>
                  </View>

                  <View style={styles.matrixDetailsGrid}>
                    <View style={styles.matrixDetailItem}>
                      <Text style={styles.matrixDetailLabel}>First Arrival</Text>
                      <Text style={styles.matrixDetailValue}>
                        {row.first_check_in ? new Date(row.first_check_in).toLocaleTimeString() : '--:--'}
                      </Text>
                    </View>
                    <View style={styles.matrixDetailItem}>
                      <Text style={styles.matrixDetailLabel}>Last Checkout</Text>
                      <Text style={styles.matrixDetailValue}>
                        {row.last_check_out ? new Date(row.last_check_out).toLocaleTimeString() : '--:--'}
                      </Text>
                    </View>
                    <View style={styles.matrixDetailItem}>
                      <Text style={styles.matrixDetailLabel}>Hours Worked</Text>
                      <Text style={styles.matrixDetailValue}>
                        {row.total_hours !== null && row.total_hours !== undefined ? `${row.total_hours} hrs` : '--'}
                      </Text>
                    </View>
                    <View style={styles.matrixDetailItem}>
                      <Text style={styles.matrixDetailLabel}>Leave Quota</Text>
                      <Text style={[styles.matrixDetailValue, { color: colors.primary }]}>{row.leave_balance} days</Text>
                    </View>
                  </View>
                </View>
              ))}
          </View>
        )}

        {/* TAB 3: EMPLOYEES DIRECT MANAGEMENT */}
        {activeTab === 'employees' && (
          <View>
            <View style={styles.empHeaderActions}>
              <TouchableOpacity
                style={styles.primaryActionButton}
                onPress={() => {
                  setNewEmpPhotoUri(null);
                  setIsRegisterModalOpen(true);
                }}
              >
                <Text style={styles.primaryActionButtonText}>➕ Register Employee</Text>
              </TouchableOpacity>
            </View>

            {employees.map((emp) => (
              <View key={emp.id} style={styles.employeeCard}>
                <View style={styles.employeeCardTop}>
                  <View>
                    <Text style={styles.employeeName}>{emp.name}</Text>
                    <Text style={styles.employeeSub}>
                      {emp.department || 'General'} {emp.job_title ? `• ${emp.job_title}` : ''}
                    </Text>
                    {emp.email && <Text style={styles.employeeEmail}>{emp.email}</Text>}
                  </View>
                  <View style={[styles.enrolledBadge, emp.is_enrolled ? styles.badgeEnrolled : styles.badgeNotEnrolled]}>
                    <Text style={styles.enrolledText}>{emp.is_enrolled ? 'Biometric ✓' : 'No Face'}</Text>
                  </View>
                </View>

                <View style={styles.empMetricsRow}>
                  <Text style={styles.empMetricText}>
                    Leave Quota: <Text style={styles.metricHighlight}>{emp.leave_balance ?? 15.0} days</Text>
                  </Text>
                </View>

                <View style={styles.empActionButtonsRow}>
                  <TouchableOpacity
                    style={styles.leaveAdjustBtn}
                    onPress={() => {
                      setSelectedEmployee(emp);
                      setLeaveMessage(null);
                      setLeaveAmount('1');
                    }}
                  >
                    <Text style={styles.leaveAdjustText}>⚖️ Adjust Leave</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.updateFaceBtn}
                    onPress={() => handleOpenCamera(emp)}
                  >
                    <Text style={styles.updateFaceText}>📸 {emp.is_enrolled ? 'Update Face' : 'Enroll Face'}</Text>
                  </TouchableOpacity>

                  {currentUserRole === 'super_admin' && (
                    <TouchableOpacity
                      style={styles.deleteEmpBtn}
                      onPress={() => handleDeleteEmployee(emp)}
                    >
                      <Text style={styles.deleteEmpText}>🗑️</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* TAB 4: LIVE FEED WITH FILTERS & SEARCH */}
        {activeTab === 'feed' && (
          <View>
            <View style={styles.feedFilterBar}>
              <TextInput
                style={styles.feedSearchInput}
                placeholder="🔍 Search scan logs by name..."
                placeholderTextColor={colors.secondaryText}
                value={feedSearchQuery}
                onChangeText={(txt) => {
                  setFeedSearchQuery(txt);
                  fetchData();
                }}
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.feedChipsRow}>
                {['ALL', 'CHECK_IN', 'CHECK_OUT', 'HALF_DAY', 'SPOOF', 'UNKNOWN'].map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.feedChip, feedFilterType === t && styles.feedChipActive]}
                    onPress={() => {
                      setFeedFilterType(t);
                      fetchData();
                    }}
                  >
                    <Text style={[styles.feedChipText, feedFilterType === t && styles.feedChipTextActive]}>
                      {t}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {recentLogs.map((log, index) => (
              <View key={log.id || index} style={styles.feedCard}>
                <View style={styles.feedCardHeader}>
                  <View>
                    <Text style={styles.feedEmpName}>{log.employee_name || 'Unknown Person'}</Text>
                    <Text style={styles.feedTime}>{log.timestamp ? new Date(log.timestamp).toLocaleString() : ''}</Text>
                  </View>
                  <View
                    style={[
                      styles.feedStatusBadge,
                      log.status === 'SUCCESS' ? styles.feedSuccessBadge : styles.feedFailBadge,
                    ]}
                  >
                    <Text style={styles.feedStatusText}>
                      {log.check_type || log.status}
                    </Text>
                  </View>
                </View>

                {/* Metadata badges */}
                <View style={styles.feedMetaRow}>
                  {log.confidence_score !== undefined && log.confidence_score !== null && (
                    <Text style={styles.metaBadgeText}>Similarity: {Math.round(log.confidence_score * 100)}%</Text>
                  )}
                  {log.liveness_score !== undefined && log.liveness_score !== null && (
                    <Text style={styles.metaBadgeText}>Live: {Math.round(log.liveness_score * 100)}%</Text>
                  )}
                </View>

                {/* Half-Day Review Action (Item 10) */}
                {log.check_type === 'HALF_DAY' && currentUserRole === 'super_admin' && (
                  <TouchableOpacity style={styles.reviewHalfDayBtn} onPress={() => handleReviewHalfDayLog(log)}>
                    <Text style={styles.reviewHalfDayText}>✏️ Review / Edit Half-Day Status</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}

        {/* TAB 5: USERS ROLE MANAGEMENT */}
        {activeTab === 'users' && currentUserRole === 'super_admin' && (
          <View>
            {users.map((u) => (
              <View key={u.id} style={styles.userCard}>
                <View>
                  <Text style={styles.userName}>{u.username}</Text>
                  <Text style={styles.userRole}>Role: {u.role}</Text>
                </View>
                {u.role !== 'super_admin' && (
                  <TouchableOpacity
                    style={[styles.roleBtn, u.role === 'admin' ? styles.demoteBtn : styles.promoteBtn]}
                    onPress={() => handleToggleRole(u)}
                    disabled={updatingUserRole === u.id}
                  >
                    <Text style={styles.roleBtnText}>
                      {u.role === 'admin' ? 'Demote to Employee' : 'Promote to Admin'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}

        {/* TAB 6: SETTINGS & DATABASE HYGIENE (Item 4, 5, 9, 11, 12) */}
        {activeTab === 'settings' && currentUserRole === 'super_admin' && (
          <View>
            {/* Database Hygiene & Storage Meter */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>💾 Database Health & Storage Meter</Text>
              {dbStats && (
                <View style={styles.dbStatsGrid}>
                  <View style={styles.dbStatItem}>
                    <Text style={styles.dbStatNum}>{dbStats.total_employees}</Text>
                    <Text style={styles.dbStatLabel}>Employees</Text>
                  </View>
                  <View style={styles.dbStatItem}>
                    <Text style={styles.dbStatNum}>{dbStats.enrolled_employees}</Text>
                    <Text style={styles.dbStatLabel}>Face Biometrics</Text>
                  </View>
                  <View style={styles.dbStatItem}>
                    <Text style={styles.dbStatNum}>{dbStats.total_logs}</Text>
                    <Text style={styles.dbStatLabel}>Total Logs</Text>
                  </View>
                  <View style={styles.dbStatItem}>
                    <Text style={styles.dbStatNum}>{dbStats.db_size_mb} MB</Text>
                    <Text style={styles.dbStatLabel}>DB Footprint</Text>
                  </View>
                </View>
              )}

              {/* 10-Day Reminder Banner */}
              <View style={styles.healthReminderBadge}>
                <Text style={styles.healthReminderText}>
                  🛡️ Health Check Status: Database optimized. No overflow detected.
                </Text>
              </View>

              <View style={styles.purgeBtnRow}>
                <TouchableOpacity
                  style={styles.purgeBtn}
                  onPress={() => handlePurgeLogs('unknown')}
                >
                  <Text style={styles.purgeBtnText}>🧹 Purge Unknown Scans</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.purgeBtn}
                  onPress={() => handlePurgeLogs('all_failed')}
                >
                  <Text style={styles.purgeBtnText}>🗑️ Purge Failed Logs</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Attendance & Shift Time Rules */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>⚙️ Attendance & Biometric Rules</Text>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Rapid-Scan Debounce (Minutes)</Text>
                <TextInput
                  style={styles.formInput}
                  value={formDebounceMins}
                  onChangeText={setFormDebounceMins}
                  keyboardType="numeric"
                  placeholder="e.g. 2.0"
                  placeholderTextColor={colors.secondaryText}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Expected Work Start Time (HH:MM 24h)</Text>
                <TextInput
                  style={styles.formInput}
                  value={formWorkStartTime}
                  onChangeText={setFormWorkStartTime}
                  placeholder="09:00"
                  placeholderTextColor={colors.secondaryText}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Half-Day Checkout Cutoff Time (HH:MM)</Text>
                <TextInput
                  style={styles.formInput}
                  value={formHalfDayTime}
                  onChangeText={setFormHalfDayTime}
                  placeholder="13:00"
                  placeholderTextColor={colors.secondaryText}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Valid Full Checkout Time (HH:MM)</Text>
                <TextInput
                  style={styles.formInput}
                  value={formCheckoutTime}
                  onChangeText={setFormCheckoutTime}
                  placeholder="17:00"
                  placeholderTextColor={colors.secondaryText}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Duplicate Face Similarity Threshold</Text>
                <TextInput
                  style={styles.formInput}
                  value={formDupThreshold}
                  onChangeText={setFormDupThreshold}
                  keyboardType="numeric"
                  placeholder="0.65"
                  placeholderTextColor={colors.secondaryText}
                />
              </View>

              {settingsSaveMessage && (
                <Text style={styles.saveFeedbackText}>{settingsSaveMessage}</Text>
              )}

              <TouchableOpacity
                style={[styles.saveSettingsBtn, savingSettings && styles.btnDisabled]}
                onPress={handleSaveSettings}
                disabled={savingSettings}
              >
                {savingSettings ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.saveSettingsBtnText}>💾 Save System Rules</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* MODAL: DIRECT EMPLOYEE REGISTRATION */}
      <Modal visible={isRegisterModalOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Register New Employee</Text>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Full Name *</Text>
              <TextInput
                style={styles.formInput}
                placeholder="e.g. Rahul Sharma"
                placeholderTextColor={colors.secondaryText}
                value={newEmpName}
                onChangeText={setNewEmpName}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Department</Text>
              <TextInput
                style={styles.formInput}
                placeholder="e.g. Engineering, Sales"
                placeholderTextColor={colors.secondaryText}
                value={newEmpDept}
                onChangeText={setNewEmpDept}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Job Title</Text>
              <TextInput
                style={styles.formInput}
                placeholder="e.g. Senior Software Engineer"
                placeholderTextColor={colors.secondaryText}
                value={newEmpJobTitle}
                onChangeText={setNewEmpJobTitle}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Email (Optional)</Text>
              <TextInput
                style={styles.formInput}
                placeholder="e.g. rahul@company.com"
                placeholderTextColor={colors.secondaryText}
                keyboardType="email-address"
                autoCapitalize="none"
                value={newEmpEmail}
                onChangeText={setNewEmpEmail}
              />
            </View>

            {/* Photo Capture Preview or Button */}
            {newEmpPhotoUri ? (
              <View style={styles.previewContainer}>
                <Image source={{ uri: newEmpPhotoUri }} style={styles.previewThumbnail} />
                <View style={styles.previewMeta}>
                  <Text style={styles.previewSuccessText}>Face photo captured ✓</Text>
                  <TouchableOpacity onPress={() => handleOpenCamera()}>
                    <Text style={styles.retakeText}>Retake Photo</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity style={styles.cameraTriggerBtn} onPress={() => handleOpenCamera()}>
                <Text style={styles.cameraTriggerText}>📸 Capture Employee Face Photo</Text>
              </TouchableOpacity>
            )}

            {createEmpMessage && (
              <Text style={[styles.feedbackText, createEmpMessage.isError ? styles.textError : styles.textSuccess]}>
                {createEmpMessage.text}
              </Text>
            )}

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  setIsRegisterModalOpen(false);
                  setCreateEmpMessage(null);
                  setNewEmpPhotoUri(null);
                }}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmBtn, creatingEmployee && styles.btnDisabled]}
                onPress={handleDirectRegisterEmployee}
                disabled={creatingEmployee}
              >
                {creatingEmployee ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.confirmBtnText}>Register Employee</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: LIVE CAMERA CAPTURE */}
      <Modal visible={isCameraOpen} animationType="fade">
        <View style={styles.fullCameraContainer}>
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFillObject} facing={cameraFacing} />

          <View style={styles.cameraOvalGuide} />

          <View style={styles.cameraTopBar}>
            <TouchableOpacity style={styles.cameraCloseBtn} onPress={() => setIsCameraOpen(false)}>
              <Text style={styles.cameraCloseText}>✕ Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.cameraFlipBtn}
              onPress={() => setCameraFacing((p) => (p === 'front' ? 'back' : 'front'))}
            >
              <Text style={styles.cameraFlipText}>🔄 Flip</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.cameraBottomBar}>
            <Text style={styles.cameraInstructText}>Align face in the blue guide</Text>
            <TouchableOpacity style={styles.cameraSnapButton} onPress={handleSnapFacePhoto}>
              <View style={styles.cameraSnapInner} />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* MODAL: LEAVE ADJUSTMENT */}
      <Modal visible={!!selectedEmployee} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Adjust Leave: {selectedEmployee?.name}</Text>
            <Text style={styles.currentLeaveLabel}>
              Current Balance: <Text style={styles.metricHighlight}>{selectedEmployee?.leave_balance ?? 15} days</Text>
            </Text>

            <View style={styles.actionPillRow}>
              {(['add', 'deduct', 'set'] as const).map((act) => (
                <TouchableOpacity
                  key={act}
                  style={[styles.actionPill, leaveAction === act && styles.actionPillActive]}
                  onPress={() => setLeaveAction(act)}
                >
                  <Text style={[styles.actionPillText, leaveAction === act && styles.actionPillTextActive]}>
                    {act.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Number of Days</Text>
              <TextInput
                style={styles.formInput}
                keyboardType="numeric"
                value={leaveAmount}
                onChangeText={setLeaveAmount}
              />
            </View>

            {leaveMessage && <Text style={styles.saveFeedbackText}>{leaveMessage}</Text>}

            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setSelectedEmployee(null)}>
                <Text style={styles.cancelBtnText}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, updatingLeave && styles.btnDisabled]}
                onPress={handleAdjustLeave}
                disabled={updatingLeave}
              >
                <Text style={styles.confirmBtnText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: colors.text,
    marginTop: 12,
    fontSize: 15,
  },
  carouselHeaderWrapper: {
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  carouselContainer: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  carouselTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  carouselTabActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  carouselTabText: {
    color: colors.secondaryText,
    fontSize: 13,
    fontWeight: '600',
  },
  carouselTabTextActive: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  actionBannerRow: {
    marginBottom: 16,
  },
  primaryActionButton: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryActionButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.card,
    padding: 14,
    borderRadius: 12,
    borderLeftWidth: 4,
  },
  statLabel: {
    color: colors.secondaryText,
    fontSize: 12,
    fontWeight: '600',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 4,
  },
  sectionCard: {
    backgroundColor: colors.card,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  sectionDesc: {
    color: colors.secondaryText,
    fontSize: 13,
    marginBottom: 12,
  },
  linkContainer: {
    backgroundColor: colors.surface,
    padding: 12,
    borderRadius: 8,
    gap: 10,
  },
  linkText: {
    color: colors.primary,
    fontSize: 13,
  },
  copyBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  copyBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
  generateBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  generateBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  matrixFilterBar: {
    marginBottom: 12,
  },
  matrixSearchInput: {
    backgroundColor: colors.card,
    color: colors.text,
    padding: 12,
    borderRadius: 8,
    fontSize: 14,
    marginBottom: 8,
  },
  matrixChipsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  matrixChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.card,
    borderRadius: 16,
    marginRight: 6,
  },
  matrixChipActive: {
    backgroundColor: colors.primary,
  },
  matrixChipText: {
    color: colors.secondaryText,
    fontSize: 12,
    fontWeight: '600',
  },
  matrixChipTextActive: {
    color: '#FFFFFF',
  },
  matrixCard: {
    backgroundColor: colors.card,
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
  },
  matrixCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  matrixEmpName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: 'bold',
  },
  matrixEmpDept: {
    color: colors.secondaryText,
    fontSize: 12,
  },
  matrixStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusPresent: { backgroundColor: colors.success },
  statusLate: { backgroundColor: colors.warning },
  statusAbsent: { backgroundColor: colors.error },
  matrixStatusText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 11,
  },
  matrixDetailsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  matrixDetailItem: {
    alignItems: 'center',
  },
  matrixDetailLabel: {
    color: colors.secondaryText,
    fontSize: 11,
    marginBottom: 2,
  },
  matrixDetailValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  empHeaderActions: {
    marginBottom: 14,
  },
  employeeCard: {
    backgroundColor: colors.card,
    padding: 14,
    borderRadius: 12,
    marginBottom: 10,
  },
  employeeCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  employeeName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  employeeSub: {
    color: colors.secondaryText,
    fontSize: 12,
    marginTop: 2,
  },
  employeeEmail: {
    color: colors.primary,
    fontSize: 12,
    marginTop: 2,
  },
  enrolledBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeEnrolled: { backgroundColor: 'rgba(16, 185, 129, 0.2)' },
  badgeNotEnrolled: { backgroundColor: 'rgba(239, 68, 68, 0.2)' },
  enrolledText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '600',
  },
  empMetricsRow: {
    marginTop: 8,
  },
  empMetricText: {
    color: colors.secondaryText,
    fontSize: 13,
  },
  metricHighlight: {
    color: colors.primary,
    fontWeight: 'bold',
  },
  empActionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  leaveAdjustBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  leaveAdjustText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  updateFaceBtn: {
    flex: 1,
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  updateFaceText: {
    color: '#60A5FA',
    fontSize: 12,
    fontWeight: '600',
  },
  deleteEmpBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  deleteEmpText: {
    fontSize: 14,
  },
  feedFilterBar: {
    marginBottom: 12,
  },
  feedSearchInput: {
    backgroundColor: colors.card,
    color: colors.text,
    padding: 12,
    borderRadius: 8,
    fontSize: 14,
    marginBottom: 8,
  },
  feedChipsRow: {
    flexDirection: 'row',
  },
  feedChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: colors.card,
    borderRadius: 16,
    marginRight: 6,
  },
  feedChipActive: {
    backgroundColor: colors.primary,
  },
  feedChipText: {
    color: colors.secondaryText,
    fontSize: 12,
    fontWeight: '600',
  },
  feedChipTextActive: {
    color: '#FFFFFF',
  },
  feedCard: {
    backgroundColor: colors.card,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  feedCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  feedEmpName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: 'bold',
  },
  feedTime: {
    color: colors.secondaryText,
    fontSize: 11,
    marginTop: 2,
  },
  feedStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  feedSuccessBadge: { backgroundColor: colors.success },
  feedFailBadge: { backgroundColor: colors.error },
  feedStatusText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: 'bold',
  },
  feedMetaRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  metaBadgeText: {
    color: colors.secondaryText,
    fontSize: 11,
  },
  reviewHalfDayBtn: {
    marginTop: 8,
    backgroundColor: colors.surface,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'center',
  },
  reviewHalfDayText: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: 'bold',
  },
  userCard: {
    backgroundColor: colors.card,
    padding: 14,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  userName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: 'bold',
  },
  userRole: {
    color: colors.secondaryText,
    fontSize: 12,
    marginTop: 2,
  },
  roleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  promoteBtn: { backgroundColor: colors.primary },
  demoteBtn: { backgroundColor: colors.surface },
  roleBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  dbStatsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  dbStatItem: {
    alignItems: 'center',
  },
  dbStatNum: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: 'bold',
  },
  dbStatLabel: {
    color: colors.secondaryText,
    fontSize: 11,
    marginTop: 2,
  },
  healthReminderBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  healthReminderText: {
    color: colors.success,
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '600',
  },
  purgeBtnRow: {
    flexDirection: 'row',
    gap: 8,
  },
  purgeBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  purgeBtnText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  formGroup: {
    marginBottom: 12,
  },
  formLabel: {
    color: colors.secondaryText,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  formInput: {
    backgroundColor: colors.surface,
    color: colors.text,
    padding: 12,
    borderRadius: 8,
    fontSize: 14,
  },
  saveSettingsBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 6,
  },
  saveSettingsBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  saveFeedbackText: {
    color: colors.success,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 8,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: colors.card,
    padding: 20,
    borderRadius: 16,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  currentLeaveLabel: {
    color: colors.secondaryText,
    fontSize: 13,
    marginBottom: 12,
  },
  actionPillRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  actionPill: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderRadius: 6,
    alignItems: 'center',
  },
  actionPillActive: {
    backgroundColor: colors.primary,
  },
  actionPillText: {
    color: colors.secondaryText,
    fontSize: 12,
    fontWeight: 'bold',
  },
  actionPillTextActive: {
    color: '#FFFFFF',
  },
  cameraTriggerBtn: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  cameraTriggerText: {
    color: '#60A5FA',
    fontSize: 13,
    fontWeight: 'bold',
  },
  previewContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: 8,
    borderRadius: 8,
    marginBottom: 12,
    gap: 10,
  },
  previewThumbnail: {
    width: 50,
    height: 50,
    borderRadius: 6,
  },
  previewMeta: {
    flex: 1,
  },
  previewSuccessText: {
    color: colors.success,
    fontSize: 13,
    fontWeight: '600',
  },
  retakeText: {
    color: colors.primary,
    fontSize: 12,
    marginTop: 2,
  },
  feedbackText: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 10,
  },
  textError: { color: colors.error },
  textSuccess: { color: colors.success },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: colors.surface,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: colors.secondaryText,
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 12,
    backgroundColor: colors.primary,
    borderRadius: 8,
    alignItems: 'center',
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  fullCameraContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  cameraOvalGuide: {
    position: 'absolute',
    top: '30%',
    left: '20%',
    right: '20%',
    height: '35%',
    borderWidth: 2,
    borderColor: '#3B82F6',
    borderRadius: 150,
    borderStyle: 'dashed',
  },
  cameraTopBar: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cameraCloseBtn: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  cameraCloseText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  cameraFlipBtn: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  cameraFlipText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  cameraBottomBar: {
    position: 'absolute',
    bottom: 50,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  cameraInstructText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 16,
  },
  cameraSnapButton: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraSnapInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
  },
});
