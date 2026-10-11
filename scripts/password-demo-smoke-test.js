import assert from 'node:assert/strict'
import { loadDotEnv } from './load-dotenv.js'
import handler from '../api/password-demo.js'

loadDotEnv()

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value
      return this
    },
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    }
  }
}

async function request(method, body) {
  const response = makeResponse()
  await handler({ method, body }, response)
  return response
}

async function run() {
  const environment = globalThis.process.env
  const pepper = environment.PEPPER
  assert.equal(typeof pepper, 'string')
  assert.ok(pepper.length >= 32)

  const hashResponse = await request('POST', {
    action: 'hash',
    sampleId: 'sample-alpha'
  })
  assert.equal(hashResponse.statusCode, 200)
  assert.equal(hashResponse.body.sampleId, 'sample-alpha')
  assert.match(hashResponse.body.hash, /^\$2[abxy]\$12\$/)
  assert.equal(Object.hasOwn(hashResponse.body, 'pepper'), false)

  const secondHashResponse = await request('POST', {
    action: 'hash',
    sampleId: 'sample-alpha'
  })
  assert.equal(secondHashResponse.statusCode, 200)
  assert.notEqual(secondHashResponse.body.hash, hashResponse.body.hash)

  const validVerification = await request('POST', {
    action: 'verify',
    sampleId: 'sample-alpha',
    hash: hashResponse.body.hash
  })
  assert.equal(validVerification.statusCode, 200)
  assert.equal(validVerification.body.verified, true)

  const wrongSampleVerification = await request('POST', {
    action: 'verify',
    sampleId: 'sample-bravo',
    hash: hashResponse.body.hash
  })
  assert.equal(wrongSampleVerification.statusCode, 200)
  assert.equal(wrongSampleVerification.body.verified, false)

  const invalidSample = await request('POST', {
    action: 'hash',
    sampleId: 'not-a-sample'
  })
  assert.equal(invalidSample.statusCode, 400)

  const unexpectedField = await request('POST', {
    action: 'hash',
    sampleId: 'sample-alpha',
    password: 'must-not-be-accepted'
  })
  assert.equal(unexpectedField.statusCode, 400)

  const wrongMethod = await request('GET', undefined)
  assert.equal(wrongMethod.statusCode, 405)
  assert.equal(wrongMethod.headers.allow, 'POST')

  try {
    delete environment.PEPPER
    const missingPepper = await request('POST', {
      action: 'hash',
      sampleId: 'sample-alpha'
    })
    assert.equal(missingPepper.statusCode, 503)
    assert.deepEqual(missingPepper.body, {
      error: 'Password demo is unavailable.'
    })
  } finally {
    environment.PEPPER = pepper
  }

  globalThis.console.log('Password-demo smoke tests passed.')
}

run().catch(() => {
  globalThis.console.error('Password-demo smoke tests failed.')
  globalThis.process.exitCode = 1
})
