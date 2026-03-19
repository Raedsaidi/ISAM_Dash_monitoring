import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

const AUTH_BASE_URL = 'http://127.0.0.1:9000';

interface RegisterSelfFormProps {
  onShowLogin?: () => void;
}

interface RegisterErrors {
  username?: string;
  full_name?: string;
  email?: string;
  password?: string;
  general?: string;
}

export default function RegisterSelfForm({ onShowLogin }: RegisterSelfFormProps) {
  const { login } = useAuth();

  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<RegisterErrors>({});
  const [success, setSuccess] = useState<string | null>(null);

  function validate(): boolean {
    const e: RegisterErrors = {};

    if (!username.trim()) {
      e.username = 'Username is required.';
    } else if (username.length < 3 || username.length > 32) {
      e.username = 'Username must be between 3 and 32 characters.';
    }

    if (!fullName.trim()) {
      e.full_name = 'Full name is required.';
    } else if (fullName.length < 3) {
      e.full_name = 'Full name must be at least 3 characters.';
    }

    if (!email.trim()) {
      e.email = 'Email is required.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      e.email = 'Invalid email format.';
    }

    if (!password) {
      e.password = 'Password is required.';
    } else if (password.length < 8) {
      e.password = 'Password must be at least 8 characters.';
    } else {
      if (!/[a-z]/.test(password)) {
        e.password = 'Password must contain a lowercase letter.';
      } else if (!/[A-Z]/.test(password)) {
        e.password = 'Password must contain an uppercase letter.';
      } else if (!/[0-9]/.test(password)) {
        e.password = 'Password must contain a digit.';
      } else if (!/[!@#$%^&*()\-_=+\[\]{};:,.?/\\|]/.test(password)) {
        e.password = 'Password must contain a special character.';
      }
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setSuccess(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      const res = await fetch(`${AUTH_BASE_URL}/api/v1/auth/register-self`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          full_name: fullName,
          email,
          password,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const detail =
          data?.detail ||
          data?.message ||
          (Array.isArray(data) && data[0]?.msg) ||
          'Registration failed.';
        throw new Error(detail);
      }

      setSuccess('Account created successfully. Signing you in...');
      await login(username, password);
    } catch (err: any) {
      setErrors({ general: err.message || 'Registration failed.' });
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
          <h1 className="text-2xl font-bold text-slate-900">Create Account</h1>
          <p className="text-slate-500 text-sm mt-1">
            Register a new ISAM Central account
          </p>
        </div>

        {errors.general && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {errors.general}
          </div>
        )}
        {success && (
          <div className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3 text-sm">
          <div>
            <label className="block font-medium text-slate-700 mb-1">
              Username
            </label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 ${
                errors.username
                  ? 'border-red-400 focus:ring-red-500'
                  : 'border-slate-300 focus:ring-blue-500'
              }`}
            />
            {errors.username && (
              <div className="text-xs text-red-500 mt-1">
                {errors.username}
              </div>
            )}
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">
              Full name
            </label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 ${
                errors.full_name
                  ? 'border-red-400 focus:ring-red-500'
                  : 'border-slate-300 focus:ring-blue-500'
              }`}
            />
            {errors.full_name && (
              <div className="text-xs text-red-500 mt-1">
                {errors.full_name}
              </div>
            )}
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 ${
                errors.email
                  ? 'border-red-400 focus:ring-red-500'
                  : 'border-slate-300 focus:ring-blue-500'
              }`}
            />
            {errors.email && (
              <div className="text-xs text-red-500 mt-1">
                {errors.email}
              </div>
            )}
          </div>

          <div>
            <label className="block font-medium text-slate-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 ${
                errors.password
                  ? 'border-red-400 focus:ring-red-500'
                  : 'border-slate-300 focus:ring-blue-500'
              }`}
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
            {submitting ? 'Creating account...' : 'Create account'}
          </button>

          <div className="text-xs text-slate-500 text-center mt-2">
            Already have an account?{' '}
            <button
              type="button"
              className="text-blue-600 hover:underline"
              onClick={onShowLogin}
            >
              Sign in
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}