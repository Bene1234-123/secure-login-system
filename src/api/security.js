export default function handler(req, res) {
  const pepper = process.env.PEPPER

  if (!pepper) {
    return res.status(500).json({
      error: 'PEPPER is not configured'
    })
  }

  return res.status(200).json({
    message: 'Server-side security configuration is working.'
  })
}