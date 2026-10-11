import { createHmac } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { loadDotEnv } from '../scripts/load-dotenv.js'

loadDotEnv()

const BCRYPT_COST = 12
const BCRYPT_HASH_PATTERN = /^\$2[abxy]\$12\$[./A-Za-z0-9]{53}$/

const SAMPLE_PASSWORDS = Object.freeze({
  'sample-alpha': 'Learning-only-Sample-Alpha-9!',
  'sample-bravo': 'Learning-only-Sample-Bravo-4!',
  'sample-charlie': 'Learning-only-Sample-Charlie-7!'
})

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value, expectedKeys) {
  const keys = Object.keys(value).sort()
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index])
  )
}

function deriveBcryptInput(password, pepper) {
  return createHmac('sha256', pepper)
    .update(password, 'utf8')
    .digest('hex')
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed.' })
  }

  const pepper = globalThis.process?.env?.PEPPER
  if (typeof pepper !== 'string' || pepper.length < 32) {
    return res.status(503).json({ error: 'Password demo is unavailable.' })
  }

  const body = req.body
  if (!isPlainObject(body) || typeof body.action !== 'string') {
    return res.status(400).json({ error: 'Invalid request.' })
  }

  const validSampleId =
    typeof body.sampleId === 'string' &&
    Object.hasOwn(SAMPLE_PASSWORDS, body.sampleId)

  if (!validSampleId) {
    return res.status(400).json({ error: 'Invalid request.' })
  }

  try {
    const samplePassword = SAMPLE_PASSWORDS[body.sampleId]
    const bcryptInput = deriveBcryptInput(samplePassword, pepper)

    if (
      body.action === 'hash' &&
      hasExactKeys(body, ['action', 'sampleId'])
    ) {
      const hash = await bcrypt.hash(bcryptInput, BCRYPT_COST)
      return res.status(200).json({ sampleId: body.sampleId, hash })
    }

    if (
      body.action === 'verify' &&
      hasExactKeys(body, ['action', 'hash', 'sampleId']) &&
      typeof body.hash === 'string' &&
      BCRYPT_HASH_PATTERN.test(body.hash)
    ) {
      const verified = await bcrypt.compare(bcryptInput, body.hash)
      return res.status(200).json({ sampleId: body.sampleId, verified })
    }

    return res.status(400).json({ error: 'Invalid request.' })
  } catch {
    return res.status(500).json({ error: 'Password demo request failed.' })
  }
}
