import React from 'react';
import { createRoot } from 'react-dom/client';
import DashboardApp from './DashboardApp';
import './styles/zenstate.css';

const root = createRoot(document.getElementById('root')!);
root.render(<DashboardApp />);
