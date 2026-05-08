import React from 'react';
import { createRoot } from 'react-dom/client';
import MiniTimerApp from './MiniTimerApp';
import './styles/zenstate.css';

const root = createRoot(document.getElementById('root')!);
root.render(<MiniTimerApp />);
