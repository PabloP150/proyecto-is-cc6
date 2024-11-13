import React from 'react';
import { components } from 'react-big-calendar';
const { Toolbar } = components;

const CustomToolbar = ({ label, onNavigate, date, view, onNavigateToToday }) => {
  // Add your custom button here
  const customButton = (
    <button onClick={() => alert('Custom button clicked')}>Custom Button</button>
  );

  return (
    <Toolbar>
      {customButton}
    </Toolbar>
  );
};

export default CustomToolbar;