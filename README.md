# Secure Login System

This project demonstrates a secure authentication flow built with React, Vite, and Supabase Auth. It includes:

- email/password sign-up and sign-in
- MFA/TOTP setup and verification
- role-based access checks for the admin dashboard
- a password-hashing demo using bcrypt with a server-side pepper

## Local setup

1. Copy [.env.example](.env.example) to a real `.env` file in the project root.
2. Add the required Supabase values for the frontend app:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
3. Set a strong `PEPPER` value for the password demo API. It must be at least 32 characters long.
4. Start the app with `npm install` and `npm run dev`.

## Required environment variables

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key
PEPPER=replace-with-a-long-random-secret-at-least-32-characters
```

Keep `.env` out of version control. The project uses a local `.env` file during development and deployment setup.

## Verification

Run the validation checks before deployment:

```bash
npm run build
npm run test:password-demo
```

The smoke test loads the local `.env` file automatically so it does not fail when a project is run from a fresh clone.
