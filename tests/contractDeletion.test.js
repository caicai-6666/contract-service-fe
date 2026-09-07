import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'

test('删除请求契约、权限、204 空响应和错误重试', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  globalThis.window = { sessionStorage: { setItem() {}, removeItem() {} }, dispatchEvent() {} }
  try {
    const auth = await server.ssrLoadModule('/src/services/contractApi.js')
    const { deleteContractDocument } = await server.ssrLoadModule('/src/services/contractLibraryApi.js')
    let calls = 0
    let status = 204
    const id = 'a'.repeat(64)
    globalThis.fetch = async (url, init) => {
      calls++
      assert.equal(url, `/dev/contract/api/contract/documents/${id}`)
      assert.equal(init.method, 'DELETE')
      assert.equal(init.body, undefined)
      assert.equal(init.headers.get('Authorization'), 'Bearer test-token')
      return new Response(null, { status })
    }
    const login = (permissionLevel) => auth.saveAuthSession({ loginCode: 'test-token', userName: '测试', permissionLevel })
    for (const level of [2, 3]) {
      login(level)
      await assert.rejects(deleteContractDocument(id), (error) => error.status === 403)
    }
    assert.equal(calls, 0)
    login(1)
    for (const invalid of ['file.pdf', `/${id}.pdf`, id.toUpperCase(), '../test']) {
      await assert.rejects(deleteContractDocument(invalid), (error) => error.status === 422)
    }
    assert.equal(calls, 0)
    await deleteContractDocument(id)
    for (const code of [403, 404, 409, 422, 502]) {
      status = code
      await assert.rejects(deleteContractDocument(id), (error) => error.status === code && (code !== 502 || error.message.includes('部分删除')))
    }
    status = 204
    await deleteContractDocument(id)
    assert.equal(calls, 7)
  } finally {
    globalThis.fetch = originalFetch
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
    await server.close()
  }
})
