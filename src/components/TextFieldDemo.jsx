import React, { useState } from 'react';
import { Box, Typography, Grid, Stack, IconButton } from '@mui/material';
import { Visibility, VisibilityOff, Email, Person, Lock, Search } from '@mui/icons-material';
import { TextField } from './ui';

/**
 * TextField Demo Component
 * 
 * Demonstrates the enhanced TextField component with glass morphism styling,
 * focus states, validation, and different configurations.
 */
const TextFieldDemo = () => {
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    username: '',
    search: '',
  });
  
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});

  const handleChange = (field) => (event) => {
    const value = event.target.value;
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Simple validation
    const newErrors = { ...errors };
    
    if (field === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (value && !emailRegex.test(value)) {
        newErrors.email = 'Please enter a valid email address';
      } else {
        delete newErrors.email;
      }
    }
    
    if (field === 'password') {
      if (value && value.length < 6) {
        newErrors.password = 'Password must be at least 6 characters';
      } else {
        delete newErrors.password;
      }
    }
    
    if (field === 'confirmPassword') {
      if (value && value !== formData.password) {
        newErrors.confirmPassword = 'Passwords do not match';
      } else {
        delete newErrors.confirmPassword;
      }
    }
    
    setErrors(newErrors);
  };

  const sizes = ['small', 'medium', 'large'];

  return (
    <Box sx={{ p: 4 }}>
      <Typography variant="h4" sx={{ mb: 4, color: 'white', textAlign: 'center' }}>
        TextField Component Demo
      </Typography>
      
      {/* Basic TextField Variants */}
      <Box sx={{ mb: 6 }}>
        <Typography variant="h6" sx={{ mb: 3, color: 'white' }}>
          Basic Text Fields
        </Typography>
        <Grid container spacing={3}>
          <Grid item xs={12} md={4}>
            <TextField
              label="Standard TextField"
              placeholder="Enter some text..."
              value={formData.username}
              onChange={handleChange('username')}
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              label="With Helper Text"
              placeholder="Enter your name"
              helperText="This field is optional"
            />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              label="Disabled Field"
              placeholder="Disabled input"
              disabled
              value="Disabled value"
            />
          </Grid>
        </Grid>
      </Box>

      {/* TextField Sizes */}
      <Box sx={{ mb: 6 }}>
        <Typography variant="h6" sx={{ mb: 3, color: 'white' }}>
          TextField Sizes
        </Typography>
        <Stack spacing={3}>
          {sizes.map((size) => (
            <TextField
              key={size}
              size={size}
              label={`${size.charAt(0).toUpperCase() + size.slice(1)} Size`}
              placeholder={`This is a ${size} text field`}
            />
          ))}
        </Stack>
      </Box>

      {/* Form with Validation */}
      <Box sx={{ mb: 6 }}>
        <Typography variant="h6" sx={{ mb: 3, color: 'white' }}>
          Form with Validation
        </Typography>
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <TextField
              label="Email Address"
              type="email"
              placeholder="Enter your email"
              value={formData.email}
              onChange={handleChange('email')}
              error={!!errors.email}
              helperText={errors.email || 'We\'ll never share your email'}
              startAdornment={<Email sx={{ color: 'rgba(248, 250, 252, 0.7)' }} />}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="Username"
              placeholder="Choose a username"
              value={formData.username}
              onChange={handleChange('username')}
              success={formData.username.length >= 3}
              helperText={formData.username.length >= 3 ? 'Username looks good!' : 'Username must be at least 3 characters'}
              startAdornment={<Person sx={{ color: 'rgba(248, 250, 252, 0.7)' }} />}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="Password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter your password"
              value={formData.password}
              onChange={handleChange('password')}
              error={!!errors.password}
              helperText={errors.password || 'Password must be at least 6 characters'}
              startAdornment={<Lock sx={{ color: 'rgba(248, 250, 252, 0.7)' }} />}
              endAdornment={
                <IconButton
                  onClick={() => setShowPassword(!showPassword)}
                  edge="end"
                  sx={{ color: 'rgba(248, 250, 252, 0.7)' }}
                >
                  {showPassword ? <VisibilityOff /> : <Visibility />}
                </IconButton>
              }
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="Confirm Password"
              type="password"
              placeholder="Confirm your password"
              value={formData.confirmPassword}
              onChange={handleChange('confirmPassword')}
              error={!!errors.confirmPassword}
              helperText={errors.confirmPassword || 'Please confirm your password'}
              startAdornment={<Lock sx={{ color: 'rgba(248, 250, 252, 0.7)' }} />}
            />
          </Grid>
        </Grid>
      </Box>

      {/* Special Use Cases */}
      <Box sx={{ mb: 6 }}>
        <Typography variant="h6" sx={{ mb: 3, color: 'white' }}>
          Special Use Cases
        </Typography>
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <TextField
              label="Search"
              placeholder="Search for anything..."
              value={formData.search}
              onChange={handleChange('search')}
              startAdornment={<Search sx={{ color: 'rgba(248, 250, 252, 0.7)' }} />}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              label="Multiline Text"
              placeholder="Enter multiple lines of text..."
              multiline
              rows={4}
              helperText="This field supports multiple lines"
            />
          </Grid>
        </Grid>
      </Box>

      {/* State Examples */}
      <Box>
        <Typography variant="h6" sx={{ mb: 3, color: 'white' }}>
          Different States
        </Typography>
        <Grid container spacing={3}>
          <Grid item xs={12} md={3}>
            <TextField
              label="Normal State"
              placeholder="Normal input"
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              label="Error State"
              placeholder="Error input"
              error
              helperText="This field has an error"
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              label="Success State"
              placeholder="Success input"
              success
              helperText="This field is valid"
              value="Valid input"
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              label="Disabled State"
              placeholder="Disabled input"
              disabled
              helperText="This field is disabled"
            />
          </Grid>
        </Grid>
      </Box>
    </Box>
  );
};

export default TextFieldDemo;