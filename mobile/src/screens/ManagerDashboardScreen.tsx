import React from 'react';
import { AdminDashboardScreen, AdminDashboardScreenProps } from './AdminDashboardScreen';

export type ManagerDashboardScreenProps = AdminDashboardScreenProps;

export const ManagerDashboardScreen: React.FC<ManagerDashboardScreenProps> = (props) => {
  return <AdminDashboardScreen {...props} />;
};

export default ManagerDashboardScreen;
