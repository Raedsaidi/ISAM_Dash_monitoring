import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

interface LoginFormProps {
  onShowRegister?: () => void;
}

interface LoginErrors {
  username?: string;
  password?: string;
  general?: string;
}

export default function LoginForm({ onShowRegister }: LoginFormProps) {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<LoginErrors>({});

  function validate(): boolean {
    const e: LoginErrors = {};
    if (!username.trim()) {
      e.username = 'Username is required.';
    } else if (username.length < 3 || username.length > 32) {
      e.username = 'Username must be between 3 and 32 characters.';
    }
    if (!password) {
      e.password = 'Password is required.';
    } else if (password.length < 8) {
      e.password = 'Password must be at least 8 characters.';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    if (!validate()) return;

    setSubmitting(true);
    try {
      await login(username, password);
    } catch (err: any) {
      setErrors({ general: err.message || 'Login failed.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="bg-white shadow-lg rounded-2xl p-8 w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center mb-3">
            <span className="text-white text-2xl font-bold">I</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">ISAM & CISCO Central</h1>
          <p className="text-slate-500 text-sm mt-1">
            Access your centralized platform
          </p>
        </div>

        {errors.general && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {errors.general}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                errors.username
                  ? 'border-red-400 focus:ring-red-500'
                  : 'border-slate-300 focus:ring-blue-500'
              }`}
              placeholder="your.username"
            />
            {errors.username && (
              <div className="text-xs text-red-500 mt-1">
                {errors.username}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                errors.password
                  ? 'border-red-400 focus:ring-red-500'
                  : 'border-slate-300 focus:ring-blue-500'
              }`}
              placeholder="••••••••"
            />
            {errors.password && (
              <div className="text-xs text-red-500 mt-1">
                {errors.password}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>

           
          {/*<div className="text-xs text-slate-500 text-center mt-2">
            Don&apos;t have an account?{' '}
            <button
              type="button"
              className="text-blue-600 hover:underline"
              onClick={onShowRegister}
            >
              Create one
            </button>
          </div>*/}
        </form>
      </div>
    </div>
  );
}