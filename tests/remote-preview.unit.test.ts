import { expect, it } from 'vitest'
import { createRemotePreviewReceiver, encryptRemotePreview } from '../src/shared/remote-preview'

it('encrypts a screenshot for its requesting client and rejects altered ciphertext', async () => {
  let receiver = await createRemotePreviewReceiver(), other = await createRemotePreviewReceiver()
  let snapshot = { image: 'data:image/jpeg;base64,c2VjcmV0', capturedAt: 123456 }
  let value = await encryptRemotePreview(receiver.publicKey, snapshot)
  expect(JSON.stringify(value)).not.toContain(snapshot.image)
  expect(await receiver.decrypt(value)).toEqual(snapshot)
  await expect(other.decrypt(value)).rejects.toThrow()
  await expect(receiver.decrypt({ ...value, data: `${value.data[0] === 'A' ? 'B' : 'A'}${value.data.slice(1)}` })).rejects.toThrow()
})

it('bounds received screenshots and rejects invalid capture times', async () => {
  let receiver = await createRemotePreviewReceiver()
  for (let snapshot of [{ image: 'data:image/jpeg;base64,c2VjcmV0', capturedAt: 0 }, { image: 'x'.repeat(65537), capturedAt: 123456 }]) {
    await expect(receiver.decrypt(await encryptRemotePreview(receiver.publicKey, snapshot))).rejects.toThrow('Invalid remote preview')
  }
})
