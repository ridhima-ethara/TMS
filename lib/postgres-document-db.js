import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
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
  // Documents here only ever hold JSON values and revived Dates, so
  // structuredClone yields the same copy as clone() at a fraction of the cost.
  if (!entries.length) return structuredClone(document)
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
  const output = structuredClone(document)
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

// Collections whose documents are megabytes each (firewall daily archives can
// hold up to 250k embedded traffic records). Loading the whole collection and
// filtering in JS parses tens of MB per query and stalls the event loop for
// every other request, so simple scalar string equality filters are pushed
// down to SQL for these collections only. The JS matcher still runs on the
// narrowed rows; the filtered fields (firewall_id, date, id) are always
// scalar strings in these documents, so the pushdown can only narrow the
// candidate set, never change the result.
const SQL_FILTERED_COLLECTIONS = new Set(['firewall_daily_archives'])

function sqlEqualityConditions(name, filter, params) {
  const conditions = []
  if (!SQL_FILTERED_COLLECTIONS.has(name)) return conditions
  for (const [key, value] of Object.entries(filter || {})) {
    if (!/^[A-Za-z0-9_]+$/.test(key)) continue
    if (typeof value !== 'string' || ISO_TIMESTAMP.test(value)) continue
    params.push(value)
    conditions.push(` AND data->>'${key}' = $${params.length}`)
  }
  return conditions
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
    let documents
    const cached = await this.collection._cachedDocuments()
    if (cached) documents = cached.filter((document) => matches(document, this.filter))
    else {
      const params = [this.collection.name]
      const pushdown = sqlEqualityConditions(this.collection.name, this.filter, params)
      const rows = await this.collection.database.pool.query(
        `SELECT data FROM tms_documents WHERE collection_name = $1${pushdown.join('')}`,
        params,
      )
      documents = rows.rows.map((row) => revive(row.data)).filter((document) => matches(document, this.filter))
    }
    if (this.sortSpec) documents.sort((a, b) => compareDocuments(a, b, this.sortSpec))
    if (this.skipCount) documents = documents.slice(this.skipCount)
    if (this.limitCount != null) documents = documents.slice(0, this.limitCount)
    return documents.map((document) => project(document, this.projection))
  }
}

// Every find() used to pull the whole collection out of Postgres and revive it
// (deep regex walk over every string) before filtering in JS, so each request
// re-parsed all tickets several times over and pages took seconds to load.
// Small collections are now held in memory as revived documents. The cache is
// dropped on every write made through this process, and before each read it is
// revalidated against a cheap indexed signature (row count + newest
// updated_at), so writes from scripts or other processes are picked up too.
// Callers still receive deep copies (project() clones), so nothing they mutate
// leaks back into the cache.
const UNCACHED_COLLECTIONS = new Set(['firewall_daily_archives'])
const CACHE_MAX_AGE_MS = 30_000

class Collection {
  constructor(databaseInstance, name) {
    this.database = databaseInstance
    this.name = name
    this._cache = null
    this._cacheLoading = null
    this._cacheVersion = 0
  }

  _invalidate() {
    this._cacheVersion += 1
    this._cache = null
    this._cacheLoading = null
  }

  async _signature() {
    const result = await this.database.pool.query(
      'SELECT count(*)::int AS n, max(updated_at) AS latest FROM tms_documents WHERE collection_name = $1',
      [this.name],
    )
    const row = result.rows[0] || {}
    return `${row.n}|${row.latest ? new Date(row.latest).getTime() : 0}`
  }

  async _cachedDocuments() {
    if (UNCACHED_COLLECTIONS.has(this.name)) return null
    if (this._cache && Date.now() - this._cache.loadedAt < CACHE_MAX_AGE_MS) {
      const signature = await this._signature()
      if (this._cache && signature === this._cache.signature) return this._cache.documents
      this._invalidate()
    }
    if (!this._cacheLoading) {
      const version = this._cacheVersion
      const loading = (async () => {
        const signature = await this._signature()
        const rows = await this.database.pool.query(
          'SELECT data FROM tms_documents WHERE collection_name = $1',
          [this.name],
        )
        const documents = rows.rows.map((row) => revive(row.data))
        // A write that landed while this load ran may not be in `rows`.
        if (version === this._cacheVersion)
          this._cache = { documents, signature, loadedAt: Date.now() }
        return documents
      })()
      this._cacheLoading = loading
      loading.finally(() => { if (this._cacheLoading === loading) this._cacheLoading = null }).catch(() => {})
    }
    return this._cacheLoading
  }

  async createIndex() { return `${this.name}_document_index` }
  find(filter = {}, options = {}) { return new Cursor(this, filter, options) }

  async findOne(filter = {}, options = {}) {
    const cursor = this.find(filter, options).limit(1)
    return (await cursor.toArray())[0] || null
  }

  async countDocuments(filter = {}) {
    const cached = await this._cachedDocuments()
    if (cached) return cached.reduce((count, document) => count + (matches(document, filter) ? 1 : 0), 0)
    return (await this.find(filter).toArray()).length
  }

  async insertOne(document) {
    const key = documentKey(document)
    try {
      await this.database.pool.query(
        'INSERT INTO tms_documents (collection_name, document_key, data) VALUES ($1, $2, $3::jsonb)',
        [this.name, key, JSON.stringify(stored(document))],
      )
      this._invalidate()
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
      this._invalidate()
      return { acknowledged: true, insertedCount: documents.length, insertedIds }
    } catch (error) {
      await client.query('ROLLBACK')
      throw duplicateError(error)
    } finally {
      client.release()
    }
  }

  async _lockedDocuments(client, filter) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [this.name])
    const params = [this.name]
    const pushdown = sqlEqualityConditions(this.name, filter, params)
    const result = await client.query(
      `SELECT document_key, data FROM tms_documents WHERE collection_name = $1${pushdown.join('')} FOR UPDATE`,
      params,
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
      const rows = await this._lockedDocuments(client, filter)
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
      if (targets.length || upserted) this._invalidate()
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
      const rows = await this._lockedDocuments(client, filter)
      const matchedRows = rows.filter((row) => matches(row.document, filter))
      const targets = many ? matchedRows : matchedRows.slice(0, 1)
      for (const row of targets)
        await client.query('DELETE FROM tms_documents WHERE collection_name = $1 AND document_key = $2', [this.name, row.key])
      await client.query('COMMIT')
      if (targets.length) this._invalidate()
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
    CREATE TABLE IF NOT EXISTS tms_firewall_traffic_records (
      firewall_id text NOT NULL,
      archive_date date NOT NULL,
      record_key text NOT NULL,
      observed_at timestamptz NOT NULL,
      client_key text NOT NULL,
      source_ip text,
      source_mac text,
      source_name text,
      source_device_type text,
      source_os_name text,
      source_vendor text,
      asset_user_name text,
      employee_code text,
      asset_email text,
      av_status text,
      inventory_match boolean NOT NULL DEFAULT false,
      sent_bytes bigint NOT NULL DEFAULT 0,
      received_bytes bigint NOT NULL DEFAULT 0,
      appliance_serial text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (firewall_id, archive_date, record_key)
    );
    CREATE INDEX IF NOT EXISTS tms_firewall_traffic_period
      ON tms_firewall_traffic_records (firewall_id, observed_at);
    CREATE INDEX IF NOT EXISTS tms_firewall_traffic_client_period
      ON tms_firewall_traffic_records (firewall_id, client_key, observed_at);
    CREATE TABLE IF NOT EXISTS tms_firewall_bandwidth_hourly (
      firewall_id text NOT NULL,
      archive_date date NOT NULL,
      bucket_start timestamptz NOT NULL,
      client_key text NOT NULL,
      source_ip text,
      source_mac text,
      source_name text,
      source_device_type text,
      source_os_name text,
      source_vendor text,
      asset_user_name text,
      employee_code text,
      asset_email text,
      av_status text,
      inventory_match boolean NOT NULL DEFAULT false,
      traffic_records bigint NOT NULL DEFAULT 0,
      sent_bytes bigint NOT NULL DEFAULT 0,
      received_bytes bigint NOT NULL DEFAULT 0,
      first_activity timestamptz,
      last_activity timestamptz,
      appliance_serial text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (firewall_id, archive_date, bucket_start, client_key)
    );
    CREATE INDEX IF NOT EXISTS tms_firewall_bandwidth_hourly_period
      ON tms_firewall_bandwidth_hourly (firewall_id, bucket_start);
  `)
}

const LOOPBACK_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function databaseHostIsLocal() {
  const url = process.env.DATABASE_URL
  // No DATABASE_URL means a local socket/PGHOST connection, which never leaves the host.
  if (!url) return true
  try {
    return LOOPBACK_DATABASE_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}

// Managed Postgres (RDS) traffic crosses the VPC, so it must be encrypted and the
// server authenticated. `sslmode` inside DATABASE_URL is deliberately ignored:
// pg maps `sslmode=require` to an unverified connection, which accepts any
// certificate and leaves the link open to an in-VPC man-in-the-middle.
function databaseTlsOptions() {
  const configured = String(process.env.DATABASE_SSL || '').trim().toLowerCase()
  const production = process.env.NODE_ENV === 'production'
  const mode = configured || (production && !databaseHostIsLocal() ? 'verify-full' : 'disable')

  if (mode === 'disable') {
    if (production && !databaseHostIsLocal())
      throw new Error(
        'DATABASE_SSL must not be "disable" for a remote database in production. ' +
          'Use "verify-full" with DATABASE_CA_CERT_PATH pointing at the RDS CA bundle.',
      )
    return false
  }

  const caPath = process.env.DATABASE_CA_CERT_PATH
  let ca
  if (caPath) {
    try {
      ca = readFileSync(caPath, 'utf8')
    } catch (error) {
      throw new Error(`DATABASE_CA_CERT_PATH could not be read (${caPath}): ${error.message}`)
    }
  }

  if (mode === 'require') {
    // Encrypted but unauthenticated. Only defensible when the endpoint cannot be
    // impersonated, so it stays an explicit opt-in and never a default.
    console.warn(
      'PostgreSQL TLS is set to "require": the server certificate is NOT verified. ' +
        'Prefer DATABASE_SSL=verify-full with DATABASE_CA_CERT_PATH.',
    )
    // nosemgrep: bypass-tls-verification -- only when DATABASE_SSL=require is chosen explicitly (warned above); verify-full is the recommended mode
    return { rejectUnauthorized: false }
  }

  if (mode === 'verify-ca' || mode === 'verify-full') {
    if (production && !ca)
      throw new Error(
        'DATABASE_CA_CERT_PATH must point at the database CA bundle when DATABASE_SSL=' +
          `${mode} in production (for RDS, the Amazon root bundle).`,
      )
    // Node's default checkServerIdentity performs the hostname check that
    // separates verify-full from verify-ca.
    return {
      rejectUnauthorized: true,
      ...(ca ? { ca } : {}),
      ...(mode === 'verify-ca' ? { checkServerIdentity: () => undefined } : {}),
    }
  }

  throw new Error(
    `Unsupported DATABASE_SSL value "${configured}". Use disable, require, verify-ca, or verify-full.`,
  )
}

export async function connectToPostgres() {
  if (database) return database
  if (!connecting) {
    connecting = (async () => {
      pool = new Pool({
        connectionString: process.env.DATABASE_URL || undefined,
        database: process.env.DATABASE_URL ? undefined : (process.env.PGDATABASE || 'ticketflow_local'),
        ssl: databaseTlsOptions(),
        max: Number(process.env.PG_POOL_MAX || 20),
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
