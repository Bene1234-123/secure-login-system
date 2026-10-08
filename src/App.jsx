import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'

function App() {
  // =========================
  // REGISTRATION FIELDS
  // =========================
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // =========================
  // LOGIN FIELDS
  // =========================
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  // =========================
  // MESSAGE
  // =========================
  const [message, setMessage] = useState('')

  // =========================
  // CURRENT USER
  // =========================
  const [user, setUser] = useState(null)
  const [role, setRole] = useState(null)
  const [factor, setFactor] = useState(null)
  const [verificationCode, setVerificationCode] =useState('') 
  // =========================
  // CHECK LOGIN STATUS
  // =========================
  useEffect(() => {
    async function getUser() {
      const { data } = await supabase.auth.getUser()

      setUser(data.user)

if (data.user) {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .single()

  if (!error) {
    setRole(profile.role)
  }
}
    }

    getUser()

    // Listen for login/logout changes
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
      }
    )

    // Stop listening when the component is removed
    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])
   // =========================
// SET UP 2FA
// =========================
async function handleSetup2FA() {
  setMessage('Setting up 2FA...')

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Authenticator App'
  })

  if (error) {
    setMessage(error.message)
    return
  }

  setFactor(data)
  setMessage('2FA setup started. Scan the QR code with your authenticator app and enter the generated code to complete the setup.')
}
 // =========================
// VERIFY 2FA
// =========================
async function handleVerify2FA() {
  if (!factor) {
    setMessage('Please set up 2FA first.')
    return
  }

  setMessage('Verifying 2FA code...')

  const { data: challengeData, error: challengeError } =
    await supabase.auth.mfa.challenge({
      factorId: factor.id
    })

  if (challengeError) {
    setMessage(challengeError.message)
    return
  }

  const { error: verifyError } =
    await supabase.auth.mfa.verify({
      factorId: factor.id,
      challengeId: challengeData.id,
      code: verificationCode
    })

  if (verifyError) {
    setMessage(verifyError.message)
    return
  }

  setMessage('2FA verification successful! 🎉')
}
  // =========================
  // REGISTRATION
  // =========================
  async function handleRegister(event) {
    event.preventDefault()

    setMessage('Creating account...')

    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        data: {
          full_name: fullName
        }
      }
    })

    if (error) {
      setMessage(error.message)
      return
    }

    const user = data.user

    if (!user) {
      setMessage('Account created, but user information was not returned.')
      return
    }

    // The Supabase database trigger creates the profile automatically.
    setMessage('Registration successful! Your profile has been created.')
  }

  // =========================
  // LOGIN
  // =========================
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

    setMessage('Login successful!')
  }

  // =========================
  // PAGE
  // =========================
  return (
    <div>
      <h1>Secure Login System</h1>

      {/* CURRENT LOGIN STATUS */}
      {user ? (
  <div>
    <p>Logged in as: {user.email}</p>
    <p>Role: {role}</p>
  </div>
) : (
  <p>Not logged in</p>
)}

      {user && (
  <div>
    <h2>Two-Factor Authentication</h2>

    <button type="button" onClick={handleSetup2FA}>
      Set Up 2FA
    </button>

    {factor && (
      <div>
        <h3>Scan this QR code</h3>


        <p>
          Open your authenticator app and scan the QR code.
        </p>

        <img
          src={factor.totp.qr_code}
          alt="TOTP QR Code"
        />
        <h3>Enter your 6-digit code</h3>

<input
  type="text"
  inputMode="numeric"
  maxLength="6"
  placeholder="Enter 6-digit code"
  value={verificationCode}
  onChange={(e) => setVerificationCode(e.target.value)}
/>

<br />
<br />

<button type="button" onClick={handleVerify2FA}>
  Verify 2FA
</button>
      </div>
    )}
  </div>
)}

{user && role === 'admin' && (
  <div>
    <hr />

    <h2>Admin Dashboard</h2>

    <p>Welcome, Administrator.</p>

    <p>You have access to administrative features.</p>
  </div>
)}
      <hr />

      {/* =========================
          CREATE ACCOUNT
      ========================= */}
      <h2>Create Account</h2>

      <form onSubmit={handleRegister}>
        <div>
          <label>Full Name</label>
          <br />

          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </div>

        <br />

        <div>
          <label>Email</label>
          <br />

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <br />

        <div>
          <label>Password</label>
          <br /><h3>Enter your 6-digit code</h3>

<input
  type="text"
  inputMode="numeric"
  maxLength="6"
  placeholder="Enter 6-digit code"
  value={verificationCode}
  onChange={(e) => setVerificationCode(e.target.value)}
/>

<br />
<br />

<button type="button" onClick={handleVerify2FA}>
  Verify 2FA
</button>

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <br />

        <button type="submit">
          Register
        </button>
      </form>

      <hr />

      {/* =========================
          LOGIN
      ========================= */}
      <h2>Login</h2>

      <form onSubmit={handleLogin}>
        <div>
          <label>Email</label>
          <br />
          <input
            type="email"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            required
          />
        </div>

        <br />

        <div>
          <label>Password</label>
          <br />

          <input
            type="password"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            required
          />
        </div>

        <br />

        <button type="submit">
          Login
        </button>
      </form>

      {/* =========================
          MESSAGE
      ========================= */}
      <p>{message}</p>
    </div>
  )
}

export default App