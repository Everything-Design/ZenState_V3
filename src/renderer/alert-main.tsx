import React from 'react';
import { createRoot } from 'react-dom/client';
import AlertApp from './AlertApp';
import './styles/zenstate.css';

const root = createRoot(document.getElementById('root')!);
root.render(<AlertApp />);
