import { randomUUID } from 'node:crypto'
import pg from 'pg'

const { Pool } = pg

let pool
let database
let connecting

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/

function revive(value) {
  if (typeof value === 'string' && ISO_TIMESTAMP.test(value)) return new Date(value)
  if (Array.isArray(value)) return value.map(revive)
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, revive(item)]))
  return value
}

function stored(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function clone(value) {
  if (value === undefined) return undefined
  return revive(stored(value))
}

function pathParts(path) {
  return String(path).split('.').filter(Boolean)
}

function getPath(document, path) {
  let current = document
  for (const part of pathParts(path)) {
    if (current == null || !Object.prototype.hasOwnProperty.call(current, part))
      return { exists: false, value: undefined }
    current = current[part]
  }
  return { exists: true, value: current }
}

function setPath(document, path, value) {
  const parts = pathParts(path)
  let current = document
  parts.forEach((part, index) => {
    if (index === parts.length - 1) current[part] = clone(value)
    else {
      if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part]))
        current[part] = {}
      current = current[part]
    }
  })
}

function unsetPath(document, path) {
  const parts = pathParts(path)
  let current = document
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (!current?.[parts[index]] || typeof current[parts[index]] !== 'object') return
    current = current[parts[index]]
  }
  if (current) delete current[parts.at(-1)]
}

function normalized(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string' && ISO_TIMESTAMP.test(value)) return new Date(value).getTime()
  return value
}

function equal(actual, expected) {
  const left = normalized(actual)
  const right = normalized(expected)
  if (Array.isArray(left) && !Array.isArray(right)) return left.some((item) => equal(item, right))
  if (Array.isArray(left) && Array.isArray(right))
    return left.length === right.length && left.every((item, index) => equal(item, right[index]))
  if (left && right && typeof left === 'object' && typeof right === 'object')
    return JSON.stringify(stored(left)) === JSON.stringify(stored(right))
  return left === right
}

function regexMatches(actual, expression, options = '') {
  const regex = expression instanceof RegExp
    ? new RegExp(expression.source, expression.flags)
    : new RegExp(String(expression), options)
  if (Array.isArray(actual)) return actual.some((value) => regex.test(String(value ?? '')))
  return regex.test(String(actual ?? ''))
}

function matchesField(document, path, condition) {
  const { exists, value } = getPath(document, path)
  if (condition instanceof RegExp) return exists && regexMatches(value, condition)
  if (condition && typeof condition === 'object' && !Array.isArray(condition) && !(condition instanceof Date)) {
    const operators = Object.keys(condition).filter((key) => key.startsWith('$'))
    if (!operators.length) return exists && equal(value, condition)
    for (const operator of operators) {
      const operand = condition[operator]
      if (operator === '$options') continue
      if (operator === '$exists' && Boolean(operand) !== exists) return false
      if (operator === '$in') {
        if (!Array.isArray(operand)) return false
        const candidates = Array.isArray(value) ? value : [value]
        if (!candidates.some((actual) => operand.some((expected) => expected instanceof RegExp ? regexMatches(actual, expected) : equal(actual, expected)))) return false
      }
      if (operator === '$ne') {
        if (operand === null) {
          if (!exists || value === null) return false
        } else if (exists && equal(value, operand)) return false
      }
      if (operator === '$regex' && (!exists || !regexMatches(value, operand, condition.$options || ''))) return false
      if (operator === '$gt' && (!exists || !(normalized(value) > normalized(operand)))) return false
      if (operator === '$gte' && (!exists || !(normalized(value) >= normalized(operand)))) return false
      if (operator === '$lt' && (!exists || !(normalized(value) < normalized(operand)))) return false
      if (operator === '$lte' && (!exists || !(normalized(value) <= normalized(operand)))) return false
    }
    return true
  }
  if (condition === null) return !exists || value === null
  return exists && equal(value, condition)
}

function matches(document, filter = {}) {
  return Object.entries(filter || {}).every(([key, condition]) => {
    if (key === '$or') return Array.isArray(condition) && condition.some((item) => matches(document, item))
    if (key === '$and') return Array.isArray(condition) && condition.every((item) => matches(document, item))
    return matchesField(document, key, condition)
  })
}

function project(document, projection = {}) {
  const entries = Object.entries(projection)
  if (!entries.length) return clone(document)
  const inclusive = entries.some(([, include]) => Boolean(include))
  if (inclusive) {
    const output = {}
    for (const [path, include] of entries) {
      if (!include) continue
      const result = getPath(document, path)
      if (result.exists) setPath(output, path, result.value)
    }
    if (projection._id !== 0 && document._id !== undefined) output._id = clone(document._id)
    return output
  }
  const output = clone(document)
  for (const [path, include] of entries) if (!include) unsetPath(output, path)
  return output
}

function compareDocuments(left, right, spec) {
  for (const [path, direction] of Object.entries(spec || {})) {
    const a = normalized(getPath(left, path).value)
    const b = normalized(getPath(right, path).value)
    if (a == null && b == null) continue
    if (a == null) return direction >= 0 ? -1 : 1
    if (b == null) return direction >= 0 ? 1 : -1
    if (a < b) return direction >= 0 ? -1 : 1
    if (a > b) return direction >= 0 ? 1 : -1
  }
  return 0
}

function updateDocument(original, update, inserting = false) {
  const document = clone(original || {})
  if (!Object.keys(update || {}).some((key) => key.startsWith('$'))) return clone(update)
  if (inserting)
    for (const [path, value] of Object.entries(update.$setOnInsert || {})) setPath(document, path, value)
  for (const [path, value] of Object.entries(update.$set || {})) setPath(document, path, value)
  for (const path of Object.keys(update.$unset || {})) unsetPath(document, path)
  for (const [path, increment] of Object.entries(update.$inc || {})) {
    const current = Number(getPath(document, path).value || 0)
    setPath(document, path, current + Number(increment || 0))
  }
  for (const [path, value] of Object.entries(update.$push || {})) {
    const current = getPath(document, path).value
    setPath(document, path, [...(Array.isArray(current) ? current : []), value])
  }
  return document
}

function upsertBase(filter) {
  const document = {}
  for (const [path, value] of Object.entries(filter || {})) {
    if (path.startsWith('$') || value instanceof RegExp) continue
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).some((key) => key.startsWith('$'))) continue
    setPath(document, path, value)
  }
  return document
}

function documentKey(document) {
  const value = document.id ?? document._id ?? randomUUID()
  return typeof value === 'object' && value?.toString ? value.toString() : String(value)
}

function duplicateError(error) {
  if (error?.code === '23505') {
    error.postgresCode = error.code
    error.code = 11000
  }
  return error
}

class Cursor {
  constructor(collection, filter, options = {}) {
    this.collection = collection
    this.filter = filter || {}
    this.projection = options.projection || {}
    this.sortSpec = null
    this.skipCount = 0
    this.limitCount = null
  }

  sort(spec) { this.sortSpec = spec; return this }
  skip(value) { this.skipCount = Math.max(0, Number(value) || 0); return this }
  limit(value) { this.limitCount = Math.max(0, Number(value) || 0); return this }

  async toArray() {
    const rows = await this.collection.database.pool.query(
      'SELECT data FROM tms_documents WHERE collection_name = $1',
      [this.collection.name],
    )
    let documents = rows.rows.map((row) => revive(row.data)).filter((document) => matches(document, this.filter))
    if (this.sortSpec) documents.sort((a, b) => compareDocuments(a, b, this.sortSpec))
    if (this.skipCount) documents = documents.slice(this.skipCount)
    if (this.limitCount != null) documents = documents.slice(0, this.limitCount)
    return documents.map((document) => project(document, this.projection))
  }
}

class Collection {
  constructor(databaseInstance, name) {
    this.database = databaseInstance
    this.name = name
  }

  async createIndex() { return `${this.name}_document_index` }
  find(filter = {}, options = {}) { return new Cursor(this, filter, options) }

  async findOne(filter = {}, options = {}) {
    const cursor = this.find(filter, options).limit(1)
    return (await cursor.toArray())[0] || null
  }

  async countDocuments(filter = {}) {
    return (await this.find(filter).toArray()).length
  }

  async insertOne(document) {
    const key = documentKey(document)
    try {
      await this.database.pool.query(
        'INSERT INTO tms_documents (collection_name, document_key, data) VALUES ($1, $2, $3::jsonb)',
        [this.name, key, JSON.stringify(stored(document))],
      )
      return { acknowledged: true, insertedId: document._id ?? document.id ?? key }
    } catch (error) {
      throw duplicateError(error)
    }
  }

  async insertMany(documents) {
    if (!documents.length) return { acknowledged: true, insertedCount: 0, insertedIds: {} }
    const client = await this.database.pool.connect()
    try {
      await client.query('BEGIN')
      const insertedIds = {}
      for (let index = 0; index < documents.length; index += 1) {
        const document = documents[index]
        const key = documentKey(document)
        await client.query(
          'INSERT INTO tms_documents (collection_name, document_key, data) VALUES ($1, $2, $3::jsonb)',
          [this.name, key, JSON.stringify(stored(document))],
        )
        insertedIds[index] = document._id ?? document.id ?? key
      }
      await client.query('COMMIT')
      return { acknowledged: true, insertedCount: documents.length, insertedIds }
    } catch (error) {
      await client.query('ROLLBACK')
      throw duplicateError(error)
    } finally {
      client.release()
    }
  }

  async _lockedDocuments(client) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [this.name])
    const result = await client.query(
      'SELECT document_key, data FROM tms_documents WHERE collection_name = $1 FOR UPDATE',
      [this.name],
    )
    return result.rows.map((row) => ({ key: row.document_key, document: revive(row.data) }))
  }

  async updateOne(filter, update, options = {}) {
    const result = await this._update(filter, update, { ...options, many: false })
    return { acknowledged: true, matchedCount: result.matched, modifiedCount: result.modified, upsertedCount: result.upserted, upsertedId: result.upsertedId || null }
  }

  async updateMany(filter, update, options = {}) {
    const result = await this._update(filter, update, { ...options, many: true })
    return { acknowledged: true, matchedCount: result.matched, modifiedCount: result.modified, upsertedCount: result.upserted, upsertedId: result.upsertedId || null }
  }

  async findOneAndUpdate(filter, update, options = {}) {
    const result = await this._update(filter, update, { ...options, many: false, returnDocument: true })
    if (!result.matched && !result.upserted) return null
    return options.returnDocument === 'before' ? result.before : result.after
  }

  async _update(filter, update, options) {
    const client = await this.database.pool.connect()
    try {
      await client.query('BEGIN')
      const rows = await this._lockedDocuments(client)
      const selected = rows.filter((row) => matches(row.document, filter))
      const targets = options.many ? selected : selected.slice(0, 1)
      let modified = 0
      let before = null
      let after = null
      for (const row of targets) {
        before ||= clone(row.document)
        const next = updateDocument(row.document, update)
        await client.query(
          'UPDATE tms_documents SET data = $3::jsonb, updated_at = now() WHERE collection_name = $1 AND document_key = $2',
          [this.name, row.key, JSON.stringify(stored(next))],
        )
        after ||= clone(next)
        if (JSON.stringify(stored(row.document)) !== JSON.stringify(stored(next))) modified += 1
      }
      let upserted = 0
      let upsertedId = null
      if (!targets.length && options.upsert) {
        const next = updateDocument(upsertBase(filter), update, true)
        const key = documentKey(next)
        await client.query(
          'INSERT INTO tms_documents (collection_name, document_key, data) VALUES ($1, $2, $3::jsonb)',
          [this.name, key, JSON.stringify(stored(next))],
        )
        upserted = 1
        upsertedId = next._id ?? next.id ?? key
        after = clone(next)
      }
      await client.query('COMMIT')
      return { matched: targets.length, modified, upserted, upsertedId, before, after }
    } catch (error) {
      await client.query('ROLLBACK')
      throw duplicateError(error)
    } finally {
      client.release()
    }
  }

  async deleteOne(filter) {
    const result = await this._delete(filter, false)
    return { acknowledged: true, deletedCount: result }
  }

  async deleteMany(filter) {
    const result = await this._delete(filter, true)
    return { acknowledged: true, deletedCount: result }
  }

  async _delete(filter, many) {
    const client = await this.database.pool.connect()
    try {
      await client.query('BEGIN')
      const rows = await this._lockedDocuments(client)
      const matchedRows = rows.filter((row) => matches(row.document, filter))
      const targets = many ? matchedRows : matchedRows.slice(0, 1)
      for (const row of targets)
        await client.query('DELETE FROM tms_documents WHERE collection_name = $1 AND document_key = $2', [this.name, row.key])
      await client.query('COMMIT')
      return targets.length
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async bulkWrite(operations, options = {}) {
    let upsertedCount = 0
    let modifiedCount = 0
    let matchedCount = 0
    const errors = []
    for (const operation of operations) {
      try {
        if (operation.updateOne) {
          const { filter, update, upsert } = operation.updateOne
          const result = await this.updateOne(filter, update, { upsert })
          upsertedCount += result.upsertedCount
          modifiedCount += result.modifiedCount
          matchedCount += result.matchedCount
        }
      } catch (error) {
        errors.push(error)
        if (options.ordered !== false) throw error
      }
    }
    if (errors.length && options.ordered !== false) throw errors[0]
    return { acknowledged: true, upsertedCount, modifiedCount, matchedCount }
  }
}

class PostgresDocumentDatabase {
  constructor(poolInstance) {
    this.pool = poolInstance
    this.collections = new Map()
  }

  collection(name) {
    if (!this.collections.has(name)) this.collections.set(name, new Collection(this, name))
    return this.collections.get(name)
  }

  async storeBlob(attachmentId, content, sha256 = null) {
    await this.pool.query(
      `INSERT INTO tms_attachment_blobs (attachment_id, content, sha256)
       VALUES ($1, $2, $3)
       ON CONFLICT (attachment_id) DO UPDATE SET content = EXCLUDED.content, sha256 = EXCLUDED.sha256, updated_at = now()`,
      [attachmentId, content, sha256],
    )
  }

  async getBlob(attachmentId) {
    const result = await this.pool.query('SELECT content FROM tms_attachment_blobs WHERE attachment_id = $1', [attachmentId])
    return result.rows[0]?.content || null
  }

  async deleteBlob(attachmentId) {
    const result = await this.pool.query('DELETE FROM tms_attachment_blobs WHERE attachment_id = $1', [attachmentId])
    return result.rowCount > 0
  }

  async consumeRateLimit(keyHash, limit, windowMs, weight = 1) {
    const increment = Math.max(1, Math.round(Number(weight) || 1))
    const result = await this.pool.query(
      `INSERT INTO tms_rate_limits (key_hash, attempts, window_started_at, expires_at)
       VALUES ($1, $3, now(), now() + ($2::bigint * interval '1 millisecond'))
       ON CONFLICT (key_hash) DO UPDATE SET
         attempts = CASE WHEN tms_rate_limits.expires_at <= now() THEN $3 ELSE tms_rate_limits.attempts + $3 END,
         window_started_at = CASE WHEN tms_rate_limits.expires_at <= now() THEN now() ELSE tms_rate_limits.window_started_at END,
         expires_at = CASE WHEN tms_rate_limits.expires_at <= now() THEN now() + ($2::bigint * interval '1 millisecond') ELSE tms_rate_limits.expires_at END
       RETURNING attempts, expires_at`,
      [keyHash, windowMs, increment],
    )
    const row = result.rows[0]
    return { limited: Number(row.attempts) > limit, attempts: Number(row.attempts), expiresAt: row.expires_at }
  }

  async clearRateLimit(keyHash) {
    await this.pool.query('DELETE FROM tms_rate_limits WHERE key_hash = $1', [keyHash])
  }
}

async function initialize(poolInstance) {
  await poolInstance.query(`
    CREATE TABLE IF NOT EXISTS tms_documents (
      collection_name text NOT NULL,
      document_key text NOT NULL,
      data jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (collection_name, document_key)
    );
    CREATE INDEX IF NOT EXISTS tms_documents_data_gin ON tms_documents USING gin (data jsonb_path_ops);
    CREATE INDEX IF NOT EXISTS tms_documents_collection_updated ON tms_documents (collection_name, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS tms_users_email_unique ON tms_documents ((lower(data->>'email'))) WHERE collection_name = 'users' AND data ? 'email';
    CREATE UNIQUE INDEX IF NOT EXISTS tms_tickets_id_unique ON tms_documents ((data->>'id')) WHERE collection_name = 'tickets' AND data ? 'id';
    CREATE UNIQUE INDEX IF NOT EXISTS tms_tickets_human_id_unique ON tms_documents ((data->>'human_id')) WHERE collection_name = 'tickets' AND data ? 'human_id';
    CREATE UNIQUE INDEX IF NOT EXISTS tms_attachments_id_unique ON tms_documents ((data->>'id')) WHERE collection_name = 'attachments' AND data ? 'id';
    CREATE UNIQUE INDEX IF NOT EXISTS tms_outbox_dedupe_unique ON tms_documents ((data->>'dedupe_key')) WHERE collection_name = 'email_outbox' AND data ? 'dedupe_key';
    CREATE UNIQUE INDEX IF NOT EXISTS tms_verification_token_unique ON tms_documents ((data->>'token_hash')) WHERE collection_name = 'email_verifications' AND data ? 'token_hash';
    CREATE UNIQUE INDEX IF NOT EXISTS tms_firewall_archive_unique ON tms_documents ((data->>'firewall_id'), (data->>'date')) WHERE collection_name = 'firewall_daily_archives';
    CREATE UNIQUE INDEX IF NOT EXISTS tms_firewall_health_unique ON tms_documents ((data->>'firewall_id')) WHERE collection_name = 'firewall_health';
    CREATE UNIQUE INDEX IF NOT EXISTS tms_firewall_open_outage_unique ON tms_documents ((data->>'firewall_id')) WHERE collection_name = 'firewall_outages' AND data->>'open' = 'true';
    CREATE UNIQUE INDEX IF NOT EXISTS tms_parking_slot_unique ON tms_documents ((data->>'location'), (data->>'vehicle_type'), (data->>'slot_number')) WHERE collection_name = 'parking_allocations';
    CREATE UNIQUE INDEX IF NOT EXISTS tms_parking_vehicle_unique ON tms_documents ((upper(data->>'vehicle_number'))) WHERE collection_name = 'parking_allocations';
    CREATE TABLE IF NOT EXISTS tms_attachment_blobs (
      attachment_id text PRIMARY KEY,
      content bytea NOT NULL,
      sha256 text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS tms_rate_limits (
      key_hash text PRIMARY KEY,
      attempts integer NOT NULL,
      window_started_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tms_rate_limits_expiry ON tms_rate_limits (expires_at);
  `)
}

export async function connectToPostgres() {
  if (database) return database
  if (!connecting) {
    connecting = (async () => {
      pool = new Pool({
        connectionString: process.env.DATABASE_URL || undefined,
        database: process.env.DATABASE_URL ? undefined : (process.env.PGDATABASE || 'ticketflow_local'),
        max: Number(process.env.PG_POOL_MAX || 10),
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        allowExitOnIdle: false,
      })
      pool.on('error', (error) => console.error('PostgreSQL pool error:', error.message))
      await initialize(pool)
      database = new PostgresDocumentDatabase(pool)
      return database
    })().catch((error) => {
      connecting = null
      throw error
    })
  }
  return connecting
}

export async function closePostgres() {
  if (pool) await pool.end()
  pool = null
  database = null
  connecting = null
}

export { matches as documentMatches }
