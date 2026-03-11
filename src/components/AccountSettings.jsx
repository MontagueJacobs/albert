import { useState } from 'react'
import { useAuth } from '../lib/authContext'
import { supabase } from '../lib/supabaseClient'

const modalStyles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: '#1e293b',
    borderRadius: '16px',
    padding: '2rem',
    width: '100%',
    maxWidth: '450px',
    margin: '1rem',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
    maxHeight: '90vh',
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.5rem',
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#f3f4f6',
    margin: 0,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '1.5rem',
    color: '#9ca3af',
    cursor: 'pointer',
    padding: '0.25rem',
  },
  section: {
    marginBottom: '1.5rem',
    padding: '1rem',
    backgroundColor: '#0f172a',
    borderRadius: '12px',
  },
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#f3f4f6',
    marginBottom: '1rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  label: {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: '#9ca3af',
    marginBottom: '0.5rem',
  },
  input: {
    width: '100%',
    padding: '0.75rem',
    border: '2px solid #334155',
    borderRadius: '8px',
    fontSize: '1rem',
    backgroundColor: '#1e293b',
    color: '#f3f4f6',
    boxSizing: 'border-box',
    marginBottom: '0.75rem',
  },
  inputReadonly: {
    width: '100%',
    padding: '0.75rem',
    border: '2px solid #334155',
    borderRadius: '8px',
    fontSize: '1rem',
    backgroundColor: '#334155',
    color: '#9ca3af',
    boxSizing: 'border-box',
    marginBottom: '0.75rem',
  },
  button: {
    width: '100%',
    padding: '0.75rem',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  primaryBtn: {
    backgroundColor: '#22c55e',
    color: 'white',
  },
  secondaryBtn: {
    backgroundColor: '#334155',
    color: '#f3f4f6',
  },
  dangerBtn: {
    backgroundColor: '#ef4444',
    color: 'white',
  },
  error: {
    padding: '0.75rem',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid #ef4444',
    borderRadius: '8px',
    color: '#fca5a5',
    fontSize: '0.875rem',
    marginBottom: '1rem',
  },
  success: {
    padding: '0.75rem',
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    border: '1px solid #22c55e',
    borderRadius: '8px',
    color: '#86efac',
    fontSize: '0.875rem',
    marginBottom: '1rem',
  },
  infoText: {
    fontSize: '0.8rem',
    color: '#9ca3af',
    marginTop: '0.5rem',
  },
}

export default function AccountSettings({ isOpen, onClose }) {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('profile')
  
  // Profile state
  const [displayName, setDisplayName] = useState(user?.user_metadata?.display_name || '')
  
  // Password state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  
  // UI state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  if (!isOpen) return null

  const handleUpdateProfile = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const { error } = await supabase.auth.updateUser({
        data: { display_name: displayName }
      })

      if (error) throw error
      setSuccess('Profile updated successfully!')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleChangePassword = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match')
      setLoading(false)
      return
    }

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters')
      setLoading(false)
      return
    }

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      })

      if (error) throw error
      
      setSuccess('Password changed successfully!')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <div style={modalStyles.overlay} onClick={handleOverlayClick}>
      <div style={modalStyles.modal}>
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>⚙️ Account Settings</h2>
          <button style={modalStyles.closeBtn} onClick={onClose}>×</button>
        </div>

        {/* Tab buttons */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
          <button
            onClick={() => { setActiveTab('profile'); setError(''); setSuccess(''); }}
            style={{
              ...modalStyles.button,
              ...(activeTab === 'profile' ? modalStyles.primaryBtn : modalStyles.secondaryBtn),
              flex: 1,
            }}
          >
            👤 Profile
          </button>
          <button
            onClick={() => { setActiveTab('security'); setError(''); setSuccess(''); }}
            style={{
              ...modalStyles.button,
              ...(activeTab === 'security' ? modalStyles.primaryBtn : modalStyles.secondaryBtn),
              flex: 1,
            }}
          >
            🔒 Security
          </button>
        </div>

        {error && <div style={modalStyles.error}>{error}</div>}
        {success && <div style={modalStyles.success}>{success}</div>}

        {/* Profile Tab */}
        {activeTab === 'profile' && (
          <form onSubmit={handleUpdateProfile}>
            <div style={modalStyles.section}>
              <h3 style={modalStyles.sectionTitle}>📧 Email</h3>
              <input
                type="email"
                value={user?.email || ''}
                readOnly
                style={modalStyles.inputReadonly}
              />
              <p style={modalStyles.infoText}>
                Email cannot be changed. Contact support if needed.
              </p>
            </div>

            <div style={modalStyles.section}>
              <h3 style={modalStyles.sectionTitle}>👤 Display Name</h3>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your display name"
                style={modalStyles.input}
              />
              <button
                type="submit"
                disabled={loading}
                style={{
                  ...modalStyles.button,
                  ...modalStyles.primaryBtn,
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}

        {/* Security Tab */}
        {activeTab === 'security' && (
          <form onSubmit={handleChangePassword}>
            <div style={modalStyles.section}>
              <h3 style={modalStyles.sectionTitle}>🔑 Change Password</h3>
              
              <label style={modalStyles.label}>New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
                style={modalStyles.input}
                required
                minLength={6}
              />

              <label style={modalStyles.label}>Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                style={modalStyles.input}
                required
                minLength={6}
              />

              <button
                type="submit"
                disabled={loading || !newPassword || !confirmPassword}
                style={{
                  ...modalStyles.button,
                  ...modalStyles.primaryBtn,
                  opacity: loading || !newPassword || !confirmPassword ? 0.7 : 1,
                  marginTop: '0.5rem',
                }}
              >
                {loading ? 'Changing Password...' : 'Change Password'}
              </button>
            </div>

            <div style={modalStyles.section}>
              <h3 style={modalStyles.sectionTitle}>📱 Account Info</h3>
              <p style={{ ...modalStyles.infoText, marginTop: 0 }}>
                <strong>User ID:</strong><br />
                <code style={{ fontSize: '0.7rem', wordBreak: 'break-all' }}>{user?.id}</code>
              </p>
              <p style={modalStyles.infoText}>
                <strong>Created:</strong> {user?.created_at ? new Date(user.created_at).toLocaleDateString() : 'N/A'}
              </p>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
