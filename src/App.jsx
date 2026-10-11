import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import './App.css'

async function checkMFAStatus() {
  const { data, error } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel()

  if (error) throw error

  return data
}

function App() {
  // Registration fields
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // Login fields
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [showLoginPassword, setShowLoginPassword] = useState(false)

  // General state
  const [message, setMessage] = useState('')
  const [page, setPage] = useState('login')
  const [user, setUser] = useState(null)
  const [authStep, setAuthStep] = useState('checking')
  const [role, setRole] = useState(null)
  const [factor, setFactor] = useState(null)
  const [mfaVerified, setMfaVerified] = useState(false)
  const [verificationCode, setVerificationCode] = useState('')

  // Automatically clear messages after 3 seconds
  useEffect(() => {
    if (!message) return

    const timer = setTimeout(() => {
      setMessage('')
    }, 3000)

    return () => clearTimeout(timer)
  }, [message])

  // Restore sessions and keep protected content gated by the current MFA level.
  useEffect(() => {
    let mounted = true
    let sessionCheck = 0

    async function resolveSession(session) {
      const checkId = ++sessionCheck

      if (!session?.user) {
        setUser(null)
        setRole(null)
        setFactor(null)
        setMfaVerified(false)
        setVerificationCode('')
        setAuthStep('login')
        return
      }

      setUser(null)
      setRole(null)
      setAuthStep('checking')
      setMfaVerified(false)

      try {
        const mfaStatus = await checkMFAStatus()
        if (!mounted || checkId !== sessionCheck) return

        if (
          mfaStatus.nextLevel === 'aal2' &&
          mfaStatus.currentLevel !== 'aal2'
        ) {
          setUser(session.user)
          const { data, error } = await supabase.auth.mfa.listFactors()

          if (!mounted || checkId !== sessionCheck) return

          if (error) {
            setAuthStep('2fa-setup')
            setMessage(`Could not load your authenticator factors: ${error.message}`)
            return
          }

          const verifiedFactor = data.totp?.find(
            (item) => item.status === 'verified'
          )
          const pendingFactor = data.totp?.find(
            (item) => item.status === 'unverified'
          )

          if (verifiedFactor) {
            setFactor(verifiedFactor)
            setAuthStep('2fa-verify')
            setMessage('Enter the current code from your authenticator app.')
          } else {
            setFactor(pendingFactor ?? null)
            setAuthStep('2fa-setup')
            setMessage(
              pendingFactor
                ? 'Finish setting up your authenticator to continue.'
                : 'Two-factor authentication is required. Set up an authenticator to continue.'
            )
          }
          return
        }

        setMfaVerified(mfaStatus.currentLevel === 'aal2')
        setUser(session.user)
        setAuthStep('dashboard')
        setMessage('')
      } catch {
        if (!mounted || checkId !== sessionCheck) return
        setUser(null)
        setRole(null)
        setAuthStep('login')
        setMessage('Could not verify your security status. Please log in again.')
      }
    }

    const { data: listener } =
      supabase.auth.onAuthStateChange((event, session) => {
        if (!mounted) return

        if (event === 'SIGNED_OUT' || !session?.user) {
          sessionCheck += 1
          setUser(null)
          setRole(null)
          setFactor(null)
          setMfaVerified(false)
          setVerificationCode('')
          setAuthStep('login')
          return
        }

        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
          setFactor(null)
          setVerificationCode('')
        }

        window.setTimeout(() => {
          if (mounted) void resolveSession(session)
        }, 0)
      })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!user || authStep !== 'dashboard') return

    let mounted = true
    const controller = new AbortController()

    async function loadRole() {
      setRole(null)
      const timeoutId = window.setTimeout(() => controller.abort(), 10000)

      try {
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle()
          .abortSignal(controller.signal)

        if (!mounted) return

        if (error) {
          console.error('Profile role loading error:', error)
          setRole('Not assigned')
          setMessage(
            `Could not load your role (${error.code ?? 'unknown error'}). Check the profiles table, role column, and your existing SELECT policy.`
          )
          return
        }

        const profileRole =
          typeof profile?.role === 'string' ? profile.role.trim() : ''
        setRole(profileRole || 'Not assigned')

        if (!profile || !profileRole) {
          console.warn(
            'No readable profiles row with a non-empty role was returned for the signed-in user. A missing row or SELECT RLS policy may cause this.'
          )
          setMessage(
            'No readable profile role was returned. If your profile row exists, check that its SELECT policy allows the signed-in user to read their own row.'
          )
        }
      } catch (error) {
        if (!mounted) return

        console.error('Profile role loading request failed:', error)
        setRole('Not assigned')
        setMessage('Could not load your role because the profile request failed.')
      } finally {
        window.clearTimeout(timeoutId)
      }
    }

    void loadRole()

    return () => {
      mounted = false
      controller.abort()
    }
  }, [user, authStep])

  // Set up or find an existing 2FA factor
  async function handleSetup2FA() {
    setMessage('Checking your 2FA setup...')

    const { data, error } =
      await supabase.auth.mfa.listFactors()

    if (error) {
      setMessage(error.message)
      return
    }

    const verifiedFactor = data.totp?.find(
      (item) => item.status === 'verified'
    )

    if (verifiedFactor) {
      setFactor(verifiedFactor)
      if (authStep !== 'dashboard') setAuthStep('2fa-verify')
      setMessage('Enter the current code from your authenticator app.')
      return
    }

    const unverifiedFactor = data.totp?.find(
      (item) => item.status === 'unverified'
    )

    if (unverifiedFactor) {
      setFactor(unverifiedFactor)
      if (authStep !== 'dashboard') setAuthStep('2fa-setup')
      setMessage('Continue with your pending authenticator setup.')
      return
    }

    const { data: enrollment, error: enrollError } =
      await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Authenticator App'
      })

    if (enrollError) {
      setMessage(enrollError.message)
      return
    }

    setFactor(enrollment)
    if (authStep !== 'dashboard') setAuthStep('2fa-setup')
    setMessage(
      'Scan the QR code with your authenticator app, then verify the six-digit code.'
    )
  }

  // Verify the 2FA code
  async function handleVerify2FA(event) {
    event.preventDefault()

    if (!factor?.id) {
      setMessage('Set up an authenticator before verifying a code.')
      return
    }

    setMessage('Verifying 2FA code...')

    const { data: factors, error: factorsError } =
      await supabase.auth.mfa.listFactors()

    if (factorsError) {
      setMessage(`Could not confirm your authenticator: ${factorsError.message}`)
      return
    }

    const currentFactor = factors.totp?.find(
      (item) =>
        item.id === factor.id &&
        (item.status === 'verified' || item.status === 'unverified')
    )

    if (!currentFactor) {
      setFactor(null)
      setAuthStep('2fa-setup')
      setMessage('That authenticator is no longer available. Set it up again to continue.')
      return
    }

    const { data: challengeData, error: challengeError } =
      await supabase.auth.mfa.challenge({
        factorId: currentFactor.id
      })

    if (challengeError) {
      setMessage(challengeError.message)
      return
    }

    const { error: verifyError } =
      await supabase.auth.mfa.verify({
        factorId: currentFactor.id,
        challengeId: challengeData.id,
        code: verificationCode
      })

    if (verifyError) {
      setMessage(verifyError.message)
      return
    }

    let mfaStatus
    try {
      mfaStatus = await checkMFAStatus()
    } catch {
      setMessage('The code was accepted, but your security status could not be confirmed. Please retry.')
      return
    }

    if (
      mfaStatus.nextLevel === 'aal2' &&
      mfaStatus.currentLevel !== 'aal2'
    ) {
      setMessage('The code was accepted, but two-factor verification is still required. Please try a current code.')
      return
    }

    setVerificationCode('')
    setMfaVerified(true)
    setFactor(currentFactor)
    if (authStep !== 'dashboard') setAuthStep('dashboard')
    setMessage('2FA verification successful!')
  }

  // Register a new account
  async function handleRegister(event) {
    event.preventDefault()
    setMessage('Creating account...')

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          full_name: fullName
        }
      }
    })

    if (error) {
      setMessage(error.message)
      return
    }

    if (!data.user) {
      setMessage(
        'Account creation was not confirmed. Please check your details.'
      )
      return
    }

    setMessage(
      'Registration successful! Check your email if confirmation is required.'
    )
  }

    // Log in
    async function handleLogin(event) {
      event.preventDefault()
      setMessage('Logging in...')

      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword
      })

      if (error) {
        setMessage(error.message)
        return
      }

      setLoginEmail('')
      setLoginPassword('')
      setShowLoginPassword(false)
      setMessage('Checking your account security...')
    }

  // Log out
  async function handleLogout() {
    const { error } = await supabase.auth.signOut()

    if (error) {
      setMessage(error.message)
      return
    }

    setUser(null)
    setRole(null)
    setFactor(null)
    setMfaVerified(false)
    setVerificationCode('')
    setPage('login')
    setAuthStep('login')
    setLoginEmail('')
    setLoginPassword('')
    setShowLoginPassword(false)
    setMessage('You have logged out successfully.')
  }

  // Page display
  return (
    <div className={authStep === 'dashboard' ? 'app-container' : 'app-container app-container--auth'}>
        <div className="cyber-backdrop" aria-hidden="true" />

        <header className="site-header">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">SL</span>
            <span className="brand-name">CYBER PROTECTION SYSTEM</span>
          </div>
          <span className="header-caption">Identity &amp; access</span>
        </header>

        <main className={authStep === 'dashboard' ? 'main-content main-content--account' : 'main-content'}>
        {message && <p className="status-message" role="status">{message}</p>}

        {!user || authStep !== 'dashboard' ? (
          <>
            {authStep === 'checking' ? (
              <section className="auth-card auth-card--mfa" aria-live="polite">
                <div className="auth-heading">
                  <h1>Checking your secure session</h1>
                  <p className="section-description">
                    Confirming your authentication status before opening your account.
                  </p>
                </div>
              </section>
            ) : authStep === '2fa-verify' || authStep === '2fa-setup' ? (
              <section className="auth-card auth-card--mfa" aria-labelledby="mfa-heading">
                <div className="auth-heading">
                  <p className="eyebrow">ACCOUNT SECURITY</p>
                  <h1 id="mfa-heading">
                    {authStep === '2fa-setup' ? 'Set up two-factor authentication' : 'Verify your identity'}
                  </h1>
                  <p className="section-description">
                    {authStep === '2fa-setup'
                      ? 'Scan the enrollment QR code with your authenticator app, then enter a current six-digit code to verify setup.'
                      : 'Enter the current six-digit code from your authenticator app to continue to your account.'}
                  </p>
                </div>

                {authStep === '2fa-setup' && !factor && (
                  <button
                    className="button button--primary login-submit"
                    type="button"
                    onClick={handleSetup2FA}
                  >
                    Set Up Authenticator
                  </button>
                )}

                {factor?.totp?.qr_code && (
                  <div className="authenticator-setup">
                    <div className="qr-frame">
                      <img
                        src={factor.totp.qr_code}
                        alt="Authenticator enrollment QR code"
                        width="200"
                      />
                    </div>
                    <p className="section-description">
                      This QR code is for enrollment only. Scan it with your authenticator app, then enter the current code below.
                    </p>
                  </div>
                )}

                {authStep === '2fa-setup' && factor && !factor.totp?.qr_code && (
                  <p className="inline-note">
                    A pending authenticator was found, but Supabase did not return its enrollment QR code. If you already scanned it, enter a current code below. Otherwise, do not share a code; ask your project administrator how to safely clear the pending enrollment before trying setup again.
                  </p>
                )}

                {(authStep === '2fa-verify' || factor) && (
                  <form className="verification-form" onSubmit={handleVerify2FA}>
                    <div className="form-field">
                      <label htmlFor="login-verification-code">
                        6-digit verification code
                      </label>
                      <input
                        id="login-verification-code"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        placeholder="Enter 6-digit code"
                        value={verificationCode}
                        onChange={(event) =>
                          setVerificationCode(
                            event.target.value.replace(/\D/g, '').slice(0, 6)
                          )
                        }
                        required
                      />
                    </div>
                    <button className="button button--primary" type="submit">
                      Verify
                    </button>
                  </form>
                )}

                <button
                  className="button button--secondary mfa-logout"
                  type="button"
                  onClick={handleLogout}
                >
                  Cancel and log out
                </button>
              </section>
            ) : !user && page === 'login' ? (
              <section className="auth-card auth-card--login" aria-labelledby="login-heading">
                <div className="security-badge" aria-hidden="true">
                  <svg className="shield-icon" viewBox="0 0 64 72" focusable="false">
                    <path d="M32 3 57 13v19c0 17-10 29-25 37C17 61 7 49 7 32V13L32 3Z" />
                    <path d="M24 32v-6a8 8 0 0 1 16 0v6m-19 0h22v18H21z" />
                    <circle cx="32" cy="40" r="2" />
                    <path d="M32 42v4" />
                  </svg>
                </div>

                <div className="auth-heading">
                  <h1 id="login-heading"><span>Cyber </span><span className="heading-accent">Protection</span><span> System</span></h1>
                  <p className="section-description"><span>Secure Access</span> <span className="dot-separator">•</span> <span>Stronger Tomorrow</span></p>
                </div>

                <div className="mode-toggle" aria-label="Authentication tabs">
                  <button type="button" className="mode-button mode-button--active">Login</button>
                  <button
                    type="button"
                    className="mode-button"
                    onClick={() => {
                      setMessage('')
                      setFullName('')
                      setEmail('')
                      setPassword('')
                      setPage('register')
                    }}
                  >
                    Create Account
                  </button>
                </div>

                <form className="auth-form" onSubmit={handleLogin} autoComplete="off">
                  <div className="form-field">
                    <label htmlFor="login-email" className="sr-only">Email</label>
                    <div className="input-shell">
                      <span className="field-icon" aria-hidden="true">✉</span>
                      <input
                        id="login-email"
                        type="email"
                        placeholder="Email"
                        autoComplete="off"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-field">
                    <label htmlFor="login-password" className="sr-only">Password</label>
                    <div className="input-shell">
                      <span className="field-icon" aria-hidden="true">◒</span>
                      <input
                        id="login-password"
                        type={showLoginPassword ? 'text' : 'password'}
                        placeholder="Password"
                        autoComplete="new-password"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        required
                      />
                      <button
                        className="field-action"
                        type="button"
                        aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                        aria-pressed={showLoginPassword}
                        onClick={() => setShowLoginPassword((visible) => !visible)}
                      >
                        ◉
                      </button>
                    </div>
                  </div>

                  <button className="button button--primary login-submit" type="submit">Login</button>
                </form>

                <div className="divider-line"><span>OR</span></div>

                <div className="security-note">
                  <span className="check-badge" aria-hidden="true">✓</span>
                  <p>Your data is protected with advanced security and 2FA.</p>
                </div>
              </section>
            ) : !user ? (
              <section className="auth-card auth-card--register" aria-labelledby="register-heading">
                <div className="security-badge" aria-hidden="true">
                  <svg className="shield-icon" viewBox="0 0 64 72" focusable="false">
                    <path d="M32 3 57 13v19c0 17-10 29-25 37C17 61 7 49 7 32V13L32 3Z" />
                    <path d="M24 32v-6a8 8 0 0 1 16 0v6m-19 0h22v18H21z" />
                    <circle cx="32" cy="40" r="2" />
                    <path d="M32 42v4" />
                  </svg>
                </div>

                <div className="auth-heading">
                  <h1 id="register-heading"><span>Cyber </span><span className="heading-accent">Protection</span><span> System</span></h1>
                  <p className="section-description"><span>Secure Access</span> <span className="dot-separator">•</span> <span>Stronger Tomorrow</span></p>
                </div>

                <div className="mode-toggle" aria-label="Authentication tabs">
                  <button type="button" className="mode-button" onClick={() => { setMessage(''); setPage('login') }}>Login</button>
                  <button type="button" className="mode-button mode-button--active">Create Account</button>
                </div>

                <form className="auth-form" onSubmit={handleRegister} autoComplete="off">
                  <div className="form-field">
                    <label htmlFor="full-name" className="sr-only">Full Name</label>
                    <div className="input-shell">
                      <span className="field-icon" aria-hidden="true">👤</span>
                      <input
                        id="full-name"
                        type="text"
                        placeholder="Full Name"
                        autoComplete="off"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-field">
                    <label htmlFor="register-email" className="sr-only">Email</label>
                    <div className="input-shell">
                      <span className="field-icon" aria-hidden="true">✉</span>
                      <input
                        id="register-email"
                        type="email"
                        placeholder="Email"
                        autoComplete="off"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="form-field">
                    <label htmlFor="register-password" className="sr-only">Password</label>
                    <div className="input-shell">
                      <span className="field-icon" aria-hidden="true">◒</span>
                      <input
                        id="register-password"
                        type="password"
                        placeholder="Password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <button className="button button--primary login-submit" type="submit">Register</button>
                </form>

                <div className="divider-line"><span>OR</span></div>

                <div className="security-note">
                  <span className="check-badge" aria-hidden="true">✓</span>
                  <p>Your data is protected with advanced security and 2FA.</p>
                </div>
              </section>
            ) : (
              <section className="auth-card auth-card--mfa" role="alert">
                <div className="auth-heading">
                  <h1>Sign-in could not continue</h1>
                  <p className="section-description">
                    Your account remains protected. Please log out and try again.
                  </p>
                </div>
                <button className="button button--secondary" type="button" onClick={handleLogout}>
                  Log out
                </button>
              </section>
            )}
          </>
        ) : (
          <div className="account-layout">
            <section className="panel account-panel" aria-labelledby="account-heading">
              <div className="account-panel-heading">
                <div>
                  <p className="eyebrow">ACCOUNT OVERVIEW</p>
                  <h1 id="account-heading">Your account</h1>
                </div>
                <button className="button button--secondary" type="button" onClick={handleLogout}>
                  Logout
                </button>
              </div>

              <div className="account-details">
                <div className="detail-item">
                  <span className="detail-label">Signed in as</span>
                  <p>{user.email}</p>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Role</span>
                  <p>{role ?? 'Loading...'}</p>
                </div>
              </div>
            </section>

            <section className="panel security-panel" aria-labelledby="two-factor-heading">
              <p className="eyebrow">ACCOUNT SECURITY</p>
              <h2 id="two-factor-heading">Two-factor authentication</h2>
              <p className="section-description">
                {mfaVerified
                  ? 'Your account is protected by authenticator verification.'
                  : 'Add an authenticator app for an extra layer of account security.'}
              </p>

              {!factor && (
                <button
                  className="button button--primary setup-button"
                  type="button"
                  onClick={handleSetup2FA}
                >
                  Set Up 2FA
                </button>
              )}

              {mfaVerified ? (
                <p className="inline-note" role="status">
                  Your authenticator verification is complete. You are securely signed in.
                </p>
              ) : factor && factor.totp?.qr_code ? (
                <div className="authenticator-setup">
                  <h3>Authenticator setup</h3>
                  <p className="section-description">
                    Scan this QR code only using your own
                    authenticator app.
                  </p>

                  <div className="qr-frame">
                    <img
                      src={factor.totp.qr_code}
                      alt="Authenticator setup QR code"
                      width="200"
                    />
                  </div>

                  <form className="verification-form" onSubmit={handleVerify2FA}>
                    <div className="form-field">
                      <label htmlFor="verification-code">
                        6-digit verification code
                      </label>

                      <input
                        id="verification-code"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        placeholder="Enter 6-digit code"
                        value={verificationCode}
                        onChange={(e) =>
                          setVerificationCode(
                            e.target.value
                              .replace(/\D/g, '')
                              .slice(0, 6)
                          )
                        }
                        required
                      />
                    </div>

                    <button className="button button--primary" type="submit">
                      Verify 2FA
                    </button>
                  </form>
                </div>
              ) : factor && factor.status === 'verified' ? (
                <p className="inline-note" role="status">
                  Your authenticator app is set up and verified.
                </p>
              ) : factor ? (
                <div className="authenticator-setup">
                  <h3>Finish authenticator setup</h3>
                  <p className="section-description">
                    Open your authenticator app and enter its current six-digit code.
                  </p>
                  <form className="verification-form" onSubmit={handleVerify2FA}>
                    <div className="form-field">
                      <label htmlFor="verification-code">
                        6-digit verification code
                      </label>
                      <input
                        id="verification-code"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        placeholder="Enter 6-digit code"
                        value={verificationCode}
                        onChange={(event) =>
                          setVerificationCode(
                            event.target.value.replace(/\D/g, '').slice(0, 6)
                          )
                        }
                        required
                      />
                    </div>
                    <button className="button button--primary" type="submit">
                      Verify 2FA
                    </button>
                  </form>
                </div>
              ) : null}

            </section>
            
            {role === 'admin' && (
              <section className="panel admin-panel" aria-labelledby="admin-heading">
                <p className="eyebrow">ADMINISTRATION</p>
                <h2 id="admin-heading">Admin dashboard</h2>
                <p className="section-description">Welcome, Administrator.</p>
                <p className="admin-copy">
                  You have access to administrative features.
                </p>
              </section>
            )}
          </div>
        )}
      </main>

      <footer className="site-footer">
        <span>Secure Login System</span>
      </footer>
    </div>
  )
}

export default App