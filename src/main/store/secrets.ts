import { safeStorage } from 'electron'
import { JsonStore } from './jsonStore'

interface SecretsFile {
  /** connectionId -> base64. Encrypted via OS keychain when available. */
  secrets: Record<string, string>
  /** Whether values are OS-encrypted (true) or only base64-obfuscated (false). */
  encrypted: boolean
}

const store = new JsonStore<SecretsFile>('secrets.json', { secrets: {}, encrypted: true })

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export async function setPassword(id: string, password: string): Promise<void> {
  const useEnc = canEncrypt()
  const encoded = useEnc
    ? safeStorage.encryptString(password).toString('base64')
    : Buffer.from(password, 'utf-8').toString('base64')
  await store.update((d) => {
    d.secrets[id] = encoded
    d.encrypted = useEnc
  })
}

export async function getPassword(id: string): Promise<string | undefined> {
  const encoded = (await store.get('secrets'))[id]
  if (encoded == null) return undefined
  const encrypted = await store.get('encrypted')
  const buf = Buffer.from(encoded, 'base64')
  try {
    return encrypted && canEncrypt() ? safeStorage.decryptString(buf) : buf.toString('utf-8')
  } catch {
    return undefined
  }
}

export async function hasPassword(id: string): Promise<boolean> {
  return (await store.get('secrets'))[id] != null
}

export async function deletePassword(id: string): Promise<void> {
  await store.update((d) => {
    delete d.secrets[id]
  })
}
