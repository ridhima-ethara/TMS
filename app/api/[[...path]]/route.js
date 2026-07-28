import { MongoClient } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'

// ---------------- MongoDB ----------------
let client
let db
let connecting
async function connectToMongo() {
  if (db) return db
  if (!connecting) {
    connecting = (async () => {
      client = new MongoClient(process.env.MONGO_URL)
      await client.connect()
      db = client.db(process.env.DB_NAME)
      return db
    })()
  }
  return connecting
}

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'dev-secret')

// ---------------- helpers ----------------
function json(data, status = 200) {
  const res = NextResponse.json(data, { status })
  res.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*')
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH')
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.headers.set('Access-Control-Allow-Credentials', 'true')
  return res
}

function clean(doc) {
  if (!doc) return doc
  if (Array.isArray(doc)) return doc.map(clean)
  const { _id, password_hash, ...rest } = doc
  return rest
}

async function getSession(request) {
  try {
    const token = request.cookies.get('tf_token')?.value
    if (!token) return null
    const { payload } = await jwtVerify(token, SECRET)
    return payload
  } catch (e) {
    return null
  }
}

function pad(n) { return String(n).padStart(6, '0') }
function ddmmyy(d = new Date()) {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${dd}${mm}${yy}`
}
async function nextSeq(db, key) {
  const r = await db.collection('counters').findOneAndUpdate(
    { _id: key }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' }
  )
  return r.value ? r.value.seq : (r.seq || 1)
}
async function humanId(db, prefix, location) {
  const seq = await nextSeq(db, `${prefix}-${location || ''}-${ddmmyy()}`)
  if (location) return `${prefix}-${location}-${ddmmyy()}-${pad(seq)}`
  return `${prefix}-${ddmmyy()}-${pad(seq)}`
}

async function audit(db, actor, action, entity, entityId, details = {}) {
  await db.collection('audit_logs').insertOne({
    id: uuidv4(), actor_id: actor?.id || 'system', actor_name: actor?.name || 'system',
    actor_role: actor?.role || 'system', action, entity, entity_id: entityId,
    details, created_at: new Date(),
  })
}
async function notify(db, userIds, message, ticket) {
  const ids = Array.isArray(userIds) ? userIds : [userIds]
  const docs = ids.filter(Boolean).map((uid) => ({
    id: uuidv4(), user_id: uid, message, ticket_id: ticket?.id || null,
    ticket_human_id: ticket?.human_id || null, read: false, created_at: new Date(),
  }))
  if (docs.length) await db.collection('notifications').insertMany(docs)
}
async function addHistory(db, ticketId, type, actor, note, from, to) {
  await db.collection('history').insertOne({
    id: uuidv4(), ticket_id: ticketId, type, from: from ?? null, to: to ?? null,
    by_id: actor?.id, by_name: actor?.name, by_role: actor?.role, note: note || '',
    created_at: new Date(),
  })
}

// SLA matrix in hours { response, resolution }
const SLA = {
  IT: { Critical: [1, 4], High: [2, 8], Medium: [4, 24], Low: [8, 48] },
  Admin: { Critical: [2, 8], High: [4, 24], Medium: [8, 48], Low: [24, 72] },
}
function slaDates(department, priority) {
  const m = (SLA[department] && SLA[department][priority]) || [8, 48]
  const now = Date.now()
  return {
    sla_response_due: new Date(now + m[0] * 3600000),
    sla_resolution_due: new Date(now + m[1] * 3600000),
  }
}

const STATUSES = ['Open','Assigned','Acknowledged','Approval Preparation','Pending Super Admin Approval','Clarification Required','Approval On Hold','Approval Rejected','Approved - Ready for Action','In Progress','Pending User Response','Pending Vendor','Pending Finance','Pending Material','On Hold','Resolved','Closed','Reopened','Cancelled']

// role-based ticket filter
function scopeFilter(session) {
  if (session.role === 'super_admin') return {}
  if (session.role === 'it') return { department: 'IT' }
  if (session.role === 'admin') return { department: 'Admin' }
  // employee -> only own
  return { raised_by_id: session.id }
}

// ---------------- SEED ----------------
const IT_CATEGORIES = ['Hardware','Laptop Allocation','Network/Wi-Fi','Email/Access','Password Reset','Software','Biometric','Meeting-Room Support','Onboarding','Offboarding','Asset Recovery','Security Incident']
const ADMIN_CATEGORIES = ['Facilities','AC','Electricity','Furniture','Housekeeping','Washroom','Water','Parking','ID/Access Cards','Seating','Stationery','Medicine','Pantry','Courier','Vendors','Procurement','Insurance','Banking','Payments','Expense Summary','Cash Flow','Printers','Assets','Inventory']
const LOCATIONS = ['HQ1','HQ2','301']

const IT_SEED = [
  ['Lalit','Network/Wi-Fi','High','Internet not working at desk','Ajeet Kumar','Resolve'],
  ['Shivani Dhankar','Laptop Allocation','Medium','New laptop assignment','Ajeet Kumar','Resolve'],
  ['Rishabh Ramayne','Laptop Allocation','Medium','Laptop assign for new joiner','Ajeet Kumar','Resolve'],
  ['Rikta','Printers','High','Printer not printing','Sunil Rathore','Resolve'],
  ['Utakrsh','Biometric','Low','Biometric IP assign','Sunil Rathore','Resolve'],
  ['Aman Yadav','Email/Access','High','Email not syncing','Ajeet Kumar','Resolve'],
  ['Yassir Mulla','Offboarding','High','Employee offboarding - revoke access','Ajeet Kumar','Resolve'],
  ['Swarnim Jain','Password Reset','High','Email password reset','Sunil Rathore','In Progress'],
  ['Aniket Soni','Network/Wi-Fi','High','Internet issue in cabin','Ajeet Kumar','In Progress'],
  ['Shreya Kumari','Hardware','High','Laptop not booting','Ajeet Kumar','In Progress'],
  ['Gourav Singh','Printers','Low','PDF printout support','Sunil Rathore','Resolve'],
  ['Shivani Sehgal','Hardware','Medium','Laptop charger issue','Ajeet Kumar','In Progress'],
]

const ADMIN_TASK_SEED = [
  ['Update the Expense Summary on a daily basis','Expense Summary','HQ1','daily','Done',''],
  ['Prepare the Payment Sheet','Payments','HQ1','daily','Done','No payment done today'],
  ['Prepare Receivables vs Payables report','Payments','HQ1','monthly','Done',''],
  ['Handle banking tasks - account opening & payments','Banking','HQ1','daily','Done','GRT Rekyc and demat account docs prepared'],
  ['Update the Cash Flow statement daily','Cash Flow','HQ1','daily','Done',''],
  ['Process vendor and business payments','Payments','HQ1','daily','Done','No vendor payment done today'],
  ['Food Vendor License and agreement','Vendors','HQ1','one-time','In Process','Agreement pending for review'],
  ['New food vendor meeting (Round Tummy)','Vendors','HQ1','one-time','In Process','Menu received, will ask for food taste'],
  ['ID Card query and Parking issue at 301','Parking','301','one-time','In Process','Parking issue under discussion'],
  ['Printer Quotation HQ2','Printers','HQ2','one-time','Done','New printer received'],
  ['NPS enrollment','Insurance','HQ1','one-time','In Process','Meeting fixed on 05/08'],
  ['Group Medical Policy','Insurance','HQ1','one-time','In Process','Need employee details for quotation'],
  ['Laptop Insurance','Insurance','HQ1','one-time','In Process','Need asset details for quotation'],
]

const CHECKLIST_ITEMS = ['Courier and inward register','Wi-Fi','CCTV and assets','Parking','Food vendor billing','Housekeeping','Stationery inventory','Air conditioning','Visitor register','Medicine register','Complaint register','Seat count','Medicine requirements']

function mapStatus(s) {
  const m = { 'Resolve': 'Resolved', 'Done': 'Completed', 'In Process': 'In Progress' }
  return m[s] || s
}

async function seedDb(db) {
  const existing = await db.collection('users').countDocuments()
  if (existing > 0) return { seeded: false, message: 'already seeded' }

  const hash = await bcrypt.hash('Passw0rd!', 10)
  const users = [
    { name: 'Emma Employee', email: 'employee@demo.com', role: 'employee', department: 'General', employee_id: 'EMP-1001', location: 'HQ1' },
    { name: 'Ajeet Kumar', email: 'it@demo.com', role: 'it', department: 'IT', employee_id: 'IT-2001', location: 'HQ1' },
    { name: 'Sunil Rathore', email: 'it2@demo.com', role: 'it', department: 'IT', employee_id: 'IT-2002', location: 'HQ2' },
    { name: 'Rajeev Goyal', email: 'admin@demo.com', role: 'admin', department: 'Admin', employee_id: 'ADM-3001', location: 'HQ1' },
    { name: 'Sara Superadmin', email: 'superadmin@demo.com', role: 'super_admin', department: 'Management', employee_id: 'SA-9001', location: 'HQ1' },
  ]
  const userDocs = users.map((u) => ({ id: uuidv4(), password_hash: hash, active: true, created_at: new Date(), ...u }))
  await db.collection('users').insertMany(userDocs)
  const byName = (n) => userDocs.find((u) => u.name === n)
  const employee = byName('Emma Employee')

  // categories
  const cats = [
    ...IT_CATEGORIES.map((c) => ({ id: uuidv4(), department: 'IT', name: c })),
    ...ADMIN_CATEGORIES.map((c) => ({ id: uuidv4(), department: 'Admin', name: c })),
  ]
  await db.collection('categories').insertMany(cats)
  await db.collection('locations').insertMany(LOCATIONS.map((l) => ({ id: uuidv4(), name: l, code: l })))

  // IT tickets from CSV (with realistic spread-out timestamps for SLA analytics)
  const itTickets = []
  const histDocs = []
  const HOUR = 3600000
  for (const row of IT_SEED) {
    const [uname, cat, prio, desc, assignee, statusRaw] = row
    const status = mapStatus(statusRaw)
    const id = uuidv4()
    const hid = await humanId(db, 'IT')
    const assigneeUser = byName(assignee)
    const createdAt = new Date(Date.now() - Math.floor(1 + Math.random() * 13) * 24 * HOUR - Math.floor(Math.random() * 10) * HOUR)
    const ackAt = new Date(createdAt.getTime() + Math.floor(1 + Math.random() * 6) * HOUR)
    const resolvedAt = new Date(ackAt.getTime() + Math.floor(2 + Math.random() * 40) * HOUR)
    const m = (SLA['IT'][prio] || [8, 48])
    const t = {
      id, human_id: hid, department: 'IT', category: cat, subcategory: '',
      title: `${cat} - ${uname}`, description: desc, priority: prio, status,
      raised_by_id: employee.id, raised_by_name: uname, raised_for_name: uname,
      employee_id: 'EMP-' + Math.floor(1000 + Math.random() * 9000), email: 'user@company.com',
      location: 'HQ1', assignee_id: assigneeUser?.id || null, assignee_name: assignee,
      approval_required: false, legacy_id: null,
      sla_response_due: new Date(createdAt.getTime() + m[0] * HOUR),
      sla_resolution_due: new Date(createdAt.getTime() + m[1] * HOUR),
      created_at: createdAt, updated_at: resolvedAt,
      first_response_at: ackAt,
      resolution: status === 'Resolved' ? { summary: 'Issue resolved', action_taken: 'Standard fix applied', root_cause: '', resolved_by: assignee, resolved_date: resolvedAt } : null,
      confirmation: null,
    }
    itTickets.push(t)
    histDocs.push({ id: uuidv4(), ticket_id: id, type: 'created', by_name: uname, by_role: 'employee', note: 'Ticket raised', created_at: createdAt })
    histDocs.push({ id: uuidv4(), ticket_id: id, type: 'status', to: 'Acknowledged', by_name: assignee, by_role: 'it', note: '', created_at: ackAt })
    if (status === 'Resolved') histDocs.push({ id: uuidv4(), ticket_id: id, type: 'status', to: status, by_name: assignee, by_role: 'it', note: '', created_at: resolvedAt })
  }
  await db.collection('tickets').insertMany(itTickets)
  if (histDocs.length) await db.collection('history').insertMany(histDocs)

  // Admin tasks from CSV
  const admin = byName('Rajeev Goyal')
  const taskDocs = []
  for (const row of ADMIN_TASK_SEED) {
    const [title, cat, loc, rec, statusRaw, remarks] = row
    const hid = await humanId(db, 'ATSK')
    taskDocs.push({
      id: uuidv4(), human_id: hid, title, category: cat, location: loc, recurrence: rec,
      owner_id: admin.id, owner_name: admin.name, backup_owner_name: 'Admin Backup',
      priority: 'Medium', due_date: new Date(), status: mapStatus(statusRaw), remarks,
      linked_approval: null, completion_proof: null, created_at: new Date(), updated_at: new Date(),
    })
  }
  await db.collection('tasks').insertMany(taskDocs)

  // Checklist templates per location
  const templates = []
  for (const loc of LOCATIONS) {
    templates.push({
      id: uuidv4(), name: `Daily Facility Checklist - ${loc}`, location: loc, frequency: 'daily',
      items: CHECKLIST_ITEMS.map((label, i) => ({ key: `item_${i}`, label })), created_at: new Date(),
    })
  }
  await db.collection('checklist_templates').insertMany(templates)

  // One sample admin approval ticket
  const aid = uuidv4()
  const ahid = await humanId(db, 'ADM')
  await db.collection('tickets').insertOne({
    id: aid, human_id: ahid, department: 'Admin', category: 'Printers', subcategory: '',
    title: 'New printer procurement for HQ2', description: 'Existing printer beyond repair, need replacement',
    priority: 'High', status: 'Approval Preparation', raised_by_id: employee.id, raised_by_name: 'Emma Employee',
    raised_for_name: 'Emma Employee', employee_id: 'EMP-1001', email: 'employee@demo.com', location: 'HQ2',
    assignee_id: admin.id, assignee_name: admin.name, approval_required: true, legacy_id: null,
    ...slaDates('Admin', 'High'), created_at: new Date(), updated_at: new Date(), resolution: null, confirmation: null,
  })
  await db.collection('history').insertOne({ id: uuidv4(), ticket_id: aid, type: 'created', by_name: 'Emma Employee', by_role: 'employee', note: 'Ticket raised', created_at: new Date() })

  // Extra Admin tickets for split-view / SLA / calendar richness
  const ADMIN_TICKET_SEED = [
    ['AC not working in meeting room', 'AC', 'High', 'Resolved'],
    ['Housekeeping delay report', 'Housekeeping', 'Low', 'Resolved'],
    ['Parking allocation for new joiner', 'Parking', 'Medium', 'In Progress'],
    ['Stationery restock request', 'Stationery', 'Low', 'Resolved'],
    ['Courier not delivered', 'Courier', 'Medium', 'Open'],
    ['Water dispenser leaking', 'Water', 'High', 'Resolved'],
    ['ID card replacement', 'ID/Access Cards', 'Medium', 'Resolved'],
  ]
  const adminTickets = []
  const adminHist = []
  for (const [title, cat, prio, status] of ADMIN_TICKET_SEED) {
    const id = uuidv4()
    const hid = await humanId(db, 'ADM')
    const createdAt = new Date(Date.now() - Math.floor(1 + Math.random() * 12) * 24 * HOUR)
    const ackAt = new Date(createdAt.getTime() + Math.floor(1 + Math.random() * 8) * HOUR)
    const resolvedAt = new Date(ackAt.getTime() + Math.floor(3 + Math.random() * 50) * HOUR)
    const m = (SLA['Admin'][prio] || [8, 48])
    adminTickets.push({
      id, human_id: hid, department: 'Admin', category: cat, subcategory: '',
      title, description: title, priority: prio, status,
      raised_by_id: employee.id, raised_by_name: 'Emma Employee', raised_for_name: 'Emma Employee',
      employee_id: 'EMP-1001', email: 'employee@demo.com', location: LOCATIONS[Math.floor(Math.random() * 3)],
      assignee_id: admin.id, assignee_name: admin.name, approval_required: false, legacy_id: null,
      sla_response_due: new Date(createdAt.getTime() + m[0] * HOUR),
      sla_resolution_due: new Date(createdAt.getTime() + m[1] * HOUR),
      created_at: createdAt, updated_at: resolvedAt, first_response_at: ackAt,
      resolution: status === 'Resolved' ? { summary: 'Handled', action_taken: 'Resolved by admin team', root_cause: '', resolved_by: admin.name, resolved_date: resolvedAt } : null,
      confirmation: null,
    })
    adminHist.push({ id: uuidv4(), ticket_id: id, type: 'created', by_name: 'Emma Employee', by_role: 'employee', note: 'Ticket raised', created_at: createdAt })
    adminHist.push({ id: uuidv4(), ticket_id: id, type: 'status', to: 'Acknowledged', by_name: admin.name, by_role: 'admin', created_at: ackAt })
    if (status === 'Resolved') adminHist.push({ id: uuidv4(), ticket_id: id, type: 'status', to: 'Resolved', by_name: admin.name, by_role: 'admin', created_at: resolvedAt })
  }
  await db.collection('tickets').insertMany(adminTickets)
  await db.collection('history').insertMany(adminHist)

  // Per-member daily checklists (defined by Super Admin)
  const superUser = byName('Sara Superadmin')
  const memberChecklists = [
    { member: byName('Ajeet Kumar'), title: 'IT Daily Ops Checklist', items: ['Verify server backups completed', 'Check network & Wi-Fi uptime', 'Respond to all pending tickets', 'Update asset & inventory register', 'Review security alerts'] },
    { member: byName('Sunil Rathore'), title: 'IT Support Daily Checklist', items: ['Check printer & peripheral status', 'Process new laptop allocations', 'Verify biometric devices online', 'Clear helpdesk queue'] },
    { member: byName('Rajeev Goyal'), title: 'Admin Daily Ops Checklist', items: ['Update expense summary', 'Check courier & inward register', 'Verify housekeeping done', 'Reconcile petty cash', 'Review vendor payments'] },
  ]
  const mcDocs = memberChecklists.filter((c) => c.member).map((c) => ({
    id: uuidv4(), member_id: c.member.id, member_name: c.member.name, member_role: c.member.role,
    title: c.title, frequency: 'daily', active: true,
    items: c.items.map((label, i) => ({ key: `mc_${i}`, label })),
    created_by: superUser?.name || 'Super Admin', created_at: new Date(),
  }))
  if (mcDocs.length) await db.collection('member_checklists').insertMany(mcDocs)

  return { seeded: true, users: users.map((u) => ({ email: u.email, role: u.role })) }
}

// ---------------- OPTIONS ----------------
export async function OPTIONS() {
  return json({}, 200)
}

// ---------------- ROUTER ----------------
async function handleRoute(request, { params }) {
  const { path = [] } = await params
  const route = `/${path.join('/')}`
  const method = request.method
  const seg = path

  try {
    const db = await connectToMongo()

    // health
    if (route === '/' || route === '/root') return json({ message: 'TicketFlow API' })

    // seed (idempotent, supports ?force=true reset)
    if (route === '/seed' && method === 'POST') {
      const force = new URL(request.url).searchParams.get('force') === 'true'
      if (force) {
        for (const c of ['users','categories','locations','tickets','history','comments','approvals','tasks','checklist_templates','checklist_executions','member_checklists','member_checklist_submissions','notifications','audit_logs','counters']) {
          await db.collection(c).deleteMany({})
        }
      }
      const r = await seedDb(db)
      return json(r)
    }

    // ---- AUTH ----
    if (route === '/auth/login' && method === 'POST') {
      const body = await request.json()
      const user = await db.collection('users').findOne({ email: (body.email || '').toLowerCase() })
      if (!user || !(await bcrypt.compare(body.password || '', user.password_hash))) {
        return json({ error: 'Invalid credentials' }, 401)
      }
      const token = await new SignJWT({ id: user.id, name: user.name, email: user.email, role: user.role, department: user.department })
        .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('7d').setIssuedAt().sign(SECRET)
      const res = json({ user: clean(user) })
      res.cookies.set('tf_token', token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 7 * 24 * 3600 })
      await audit(db, user, 'login', 'user', user.id, {})
      return res
    }
    if (route === '/auth/logout' && method === 'POST') {
      const res = json({ ok: true })
      res.cookies.set('tf_token', '', { httpOnly: true, path: '/', maxAge: 0 })
      return res
    }
    if (route === '/auth/me' && method === 'GET') {
      const s = await getSession(request)
      if (!s) return json({ user: null }, 200)
      const user = await db.collection('users').findOne({ id: s.id })
      return json({ user: clean(user) })
    }

    // everything below requires auth
    const session = await getSession(request)
    if (!session) return json({ error: 'Unauthorized' }, 401)

    // ---- USERS / CONFIG ----
    if (route === '/users' && method === 'GET') {
      const users = await db.collection('users').find({}).toArray()
      return json(clean(users))
    }
    if (route === '/categories' && method === 'GET') {
      const dept = new URL(request.url).searchParams.get('department')
      const q = dept ? { department: dept } : {}
      const cats = await db.collection('categories').find(q).toArray()
      return json(clean(cats))
    }
    if (route === '/locations' && method === 'GET') {
      return json(clean(await db.collection('locations').find({}).toArray()))
    }

    // ---- DASHBOARD ----
    if (route === '/dashboard' && method === 'GET') {
      const deptParam = new URL(request.url).searchParams.get('department')
      let filter = scopeFilter(session)
      // super_admin may scope by department for split views
      if (session.role === 'super_admin' && deptParam) filter = { department: deptParam }
      const tickets = await db.collection('tickets').find(filter).toArray()
      const count = (f) => tickets.filter(f).length
      const now = Date.now()
      const HOUR = 3600000
      // SLA timings
      const respTimes = [], resTimes = []
      let slaMet = 0, slaTotalResolved = 0
      for (const t of tickets) {
        if (t.first_response_at && t.created_at) respTimes.push((new Date(t.first_response_at) - new Date(t.created_at)) / HOUR)
        if (t.resolution?.resolved_date && t.created_at) {
          const rt = (new Date(t.resolution.resolved_date) - new Date(t.created_at)) / HOUR
          resTimes.push(rt)
          slaTotalResolved++
          if (t.sla_resolution_due && new Date(t.resolution.resolved_date) <= new Date(t.sla_resolution_due)) slaMet++
        }
      }
      const avg = (a) => a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : 0
      const stats = {
        total: tickets.length,
        open: count((t) => t.status === 'Open'),
        assigned: count((t) => t.status === 'Assigned'),
        in_progress: count((t) => t.status === 'In Progress'),
        pending_user: count((t) => t.status === 'Pending User Response'),
        pending_approval: count((t) => t.status === 'Pending Super Admin Approval'),
        clarification: count((t) => t.status === 'Clarification Required'),
        approved_ready: count((t) => t.status === 'Approved - Ready for Action'),
        resolved: count((t) => t.status === 'Resolved'),
        closed: count((t) => t.status === 'Closed'),
        overdue: count((t) => !['Resolved', 'Closed', 'Cancelled'].includes(t.status) && t.sla_resolution_due && new Date(t.sla_resolution_due).getTime() < now),
        avg_response_hours: avg(respTimes),
        avg_resolution_hours: avg(resTimes),
        sla_compliance: slaTotalResolved ? Math.round((slaMet / slaTotalResolved) * 100) : 0,
        by_priority: ['Critical', 'High', 'Medium', 'Low'].map((p) => ({ name: p, value: count((t) => t.priority === p) })),
        by_status: STATUSES.map((s) => ({ name: s, value: count((t) => t.status === s) })).filter((x) => x.value > 0),
        by_category: Object.entries(tickets.reduce((a, t) => { a[t.category] = (a[t.category] || 0) + 1; return a }, {})).map(([name, value]) => ({ name, value })),
      }
      // extra for tasks/approvals
      if (session.role === 'admin' || session.role === 'super_admin') {
        const tasks = await db.collection('tasks').find({}).toArray()
        stats.tasks_total = tasks.length
        stats.tasks_overdue = tasks.filter((t) => t.status !== 'Completed' && t.due_date && new Date(t.due_date).getTime() < now).length
        stats.tasks_in_progress = tasks.filter((t) => t.status === 'In Progress').length
      }
      const recent = [...tickets].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 8)
      stats.recent = clean(recent)
      // calendar payload (lightweight, all scoped tickets)
      stats.calendar = tickets.map((t) => ({ id: t.id, human_id: t.human_id, title: t.title, priority: t.priority, status: t.status, created_at: t.created_at }))
      return json(stats)
    }

    // ---- REPORTS: member SLA ----
    if (route === '/reports/member-sla' && method === 'GET') {
      if (session.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
      const dept = new URL(request.url).searchParams.get('department') || 'IT'
      const role = dept === 'Admin' ? 'admin' : 'it'
      const members = await db.collection('users').find({ role }).toArray()
      const tickets = await db.collection('tickets').find({ department: dept }).toArray()
      const HOUR = 3600000
      const avg = (a) => a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : 0
      const rows = members.map((mUser) => {
        const mt = tickets.filter((t) => t.assignee_id === mUser.id)
        const resp = [], res = []
        let met = 0, resolvedCount = 0
        for (const t of mt) {
          if (t.first_response_at && t.created_at) resp.push((new Date(t.first_response_at) - new Date(t.created_at)) / HOUR)
          if (t.resolution?.resolved_date && t.created_at) {
            res.push((new Date(t.resolution.resolved_date) - new Date(t.created_at)) / HOUR)
            resolvedCount++
            if (t.sla_resolution_due && new Date(t.resolution.resolved_date) <= new Date(t.sla_resolution_due)) met++
          }
        }
        const openCount = mt.filter((t) => !['Resolved', 'Closed', 'Cancelled'].includes(t.status)).length
        return {
          member_id: mUser.id, member_name: mUser.name, email: mUser.email, location: mUser.location,
          assigned: mt.length, open: openCount, resolved: resolvedCount,
          avg_response_hours: avg(resp), avg_resolution_hours: avg(res),
          sla_compliance: resolvedCount ? Math.round((met / resolvedCount) * 100) : 0,
        }
      })
      return json({ department: dept, members: rows })
    }

    // ---- TICKETS ----
    if (route === '/tickets' && method === 'GET') {
      const url = new URL(request.url)
      const p = url.searchParams
      const filter = { ...scopeFilter(session) }
      if (p.get('department')) filter.department = p.get('department')
      if (p.get('status')) filter.status = p.get('status')
      if (p.get('priority')) filter.priority = p.get('priority')
      if (p.get('category')) filter.category = p.get('category')
      if (p.get('location')) filter.location = p.get('location')
      if (p.get('assignee_id')) filter.assignee_id = p.get('assignee_id')
      if (p.get('search')) {
        const rx = new RegExp(p.get('search').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        filter.$or = [{ title: rx }, { human_id: rx }, { description: rx }, { raised_by_name: rx }]
      }
      const page = parseInt(p.get('page') || '1')
      const limit = parseInt(p.get('limit') || '15')
      const total = await db.collection('tickets').countDocuments(filter)
      const items = await db.collection('tickets').find(filter).sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit).toArray()
      return json({ items: clean(items), total, page, limit, pages: Math.ceil(total / limit) })
    }

    if (route === '/tickets' && method === 'POST') {
      const b = await request.json()
      const department = b.department || 'IT'
      // employees can raise; IT/Admin can raise for others
      const id = uuidv4()
      const prefix = department === 'Admin' ? 'ADM' : 'IT'
      const hid = await humanId(db, prefix)
      const priority = b.priority || 'Medium'
      const t = {
        id, human_id: hid, department, category: b.category || '', subcategory: b.subcategory || '',
        title: b.title || 'Untitled', description: b.description || '', priority, status: 'Open',
        raised_by_id: session.id, raised_by_name: session.name,
        raised_for_name: b.raised_for_name || session.name,
        employee_id: b.employee_id || '', email: b.email || session.email,
        location: b.location || 'HQ1', assignee_id: null, assignee_name: null,
        approval_required: false, legacy_id: null,
        ...slaDates(department, priority), created_at: new Date(), updated_at: new Date(),
        resolution: null, confirmation: null,
      }
      await db.collection('tickets').insertOne(t)
      await addHistory(db, id, 'created', session, 'Ticket raised', null, 'Open')
      await audit(db, session, 'ticket.create', 'ticket', id, { human_id: hid })
      // notify department
      const deptRole = department === 'Admin' ? 'admin' : 'it'
      const staff = await db.collection('users').find({ role: deptRole }).toArray()
      await notify(db, staff.map((u) => u.id), `New ${department} ticket ${hid}: ${t.title}`, t)
      return json(clean(t))
    }

    // /tickets/:id ...
    if (seg[0] === 'tickets' && seg[1]) {
      const ticketId = seg[1]
      const ticket = await db.collection('tickets').findOne({ id: ticketId })
      if (!ticket) return json({ error: 'Not found' }, 404)
      // object-level authorization
      const scope = scopeFilter(session)
      if (session.role === 'employee' && ticket.raised_by_id !== session.id) return json({ error: 'Forbidden' }, 403)
      if (session.role === 'it' && ticket.department !== 'IT') return json({ error: 'Forbidden' }, 403)
      if (session.role === 'admin' && ticket.department !== 'Admin') return json({ error: 'Forbidden' }, 403)

      // GET detail
      if (seg.length === 2 && method === 'GET') {
        const history = await db.collection('history').find({ ticket_id: ticketId }).sort({ created_at: 1 }).toArray()
        let comments = await db.collection('comments').find({ ticket_id: ticketId }).sort({ created_at: 1 }).toArray()
        // employees only see public comments
        if (session.role === 'employee') comments = comments.filter((c) => c.type === 'public')
        const approval = await db.collection('approvals').findOne({ ticket_id: ticketId })
        const detail = clean(ticket)
        detail.history = clean(history)
        detail.comments = clean(comments)
        detail.approval = session.role === 'employee' ? null : clean(approval)
        return json(detail)
      }

      // staff-only mutations
      const isStaff = ['it', 'admin', 'super_admin'].includes(session.role)

      // update (status/assign/priority/resolution)
      if (seg.length === 2 && method === 'PATCH') {
        if (!isStaff) return json({ error: 'Forbidden' }, 403)
        const b = await request.json()
        const set = { updated_at: new Date() }
        const notes = []
        if (b.assignee_id !== undefined) {
          const u = await db.collection('users').findOne({ id: b.assignee_id })
          set.assignee_id = b.assignee_id; set.assignee_name = u?.name || null
          if (ticket.status === 'Open') set.status = 'Assigned'
          await addHistory(db, ticketId, 'assignment', session, `Assigned to ${u?.name || 'unassigned'}`, ticket.assignee_name, u?.name)
          if (b.assignee_id) await notify(db, b.assignee_id, `Ticket ${ticket.human_id} assigned to you`, ticket)
        }
        if (b.priority && b.priority !== ticket.priority) {
          set.priority = b.priority
          const sla = slaDates(ticket.department, b.priority)
          set.sla_response_due = sla.sla_response_due; set.sla_resolution_due = sla.sla_resolution_due
          await addHistory(db, ticketId, 'priority', session, `Priority changed`, ticket.priority, b.priority)
        }
        if (b.status && b.status !== ticket.status) {
          if (!STATUSES.includes(b.status)) return json({ error: 'Invalid status' }, 400)
          // block execution before approval
          const executionStatuses = ['In Progress', 'Resolved']
          if (ticket.approval_required && executionStatuses.includes(b.status)) {
            const appr = await db.collection('approvals').findOne({ ticket_id: ticketId })
            if (!appr || appr.status !== 'Approved' && appr.status !== 'Partially Approved') {
              return json({ error: 'Approval required before execution' }, 400)
            }
          }
          set.status = b.status
          await addHistory(db, ticketId, 'status', session, b.note || '', ticket.status, b.status)
          await notify(db, ticket.raised_by_id, `Ticket ${ticket.human_id} status: ${b.status}`, ticket)
        }
        if (b.resolution) {
          set.resolution = { ...b.resolution, resolved_by: session.name, resolved_date: new Date() }
          set.status = 'Resolved'
          await addHistory(db, ticketId, 'status', session, 'Resolved: ' + (b.resolution.summary || ''), ticket.status, 'Resolved')
          await notify(db, ticket.raised_by_id, `Ticket ${ticket.human_id} resolved - please confirm`, ticket)
        }
        await db.collection('tickets').updateOne({ id: ticketId }, { $set: set })
        await audit(db, session, 'ticket.update', 'ticket', ticketId, b)
        const updated = await db.collection('tickets').findOne({ id: ticketId })
        return json(clean(updated))
      }

      // comments
      if (seg[2] === 'comments' && method === 'POST') {
        const b = await request.json()
        let type = b.type || 'public'
        if (session.role === 'employee') type = 'public'
        if (type === 'internal' && session.role === 'employee') return json({ error: 'Forbidden' }, 403)
        const c = {
          id: uuidv4(), ticket_id: ticketId, type, body: b.body || '',
          author_id: session.id, author_name: session.name, author_role: session.role, created_at: new Date(),
        }
        await db.collection('comments').insertOne(c)
        await addHistory(db, ticketId, 'comment', session, `${type} comment added`)
        // notify other party
        if (session.role === 'employee') {
          const staff = await db.collection('users').find({ role: ticket.department === 'Admin' ? 'admin' : 'it' }).toArray()
          await notify(db, staff.map((u) => u.id), `New comment on ${ticket.human_id}`, ticket)
        } else if (type === 'public') {
          await notify(db, ticket.raised_by_id, `New response on ${ticket.human_id}`, ticket)
        }
        return json(clean(c))
      }

      // employee confirm / reopen + rating
      if (seg[2] === 'confirm' && method === 'POST') {
        if (ticket.raised_by_id !== session.id && session.role !== 'employee') {
          // allow raiser only
        }
        if (ticket.raised_by_id !== session.id) return json({ error: 'Forbidden' }, 403)
        const b = await request.json()
        if (b.action === 'confirm') {
          await db.collection('tickets').updateOne({ id: ticketId }, { $set: { status: 'Closed', confirmation: { confirmed: true, rating: b.rating || null, comment: b.comment || '', at: new Date() }, updated_at: new Date() } })
          await addHistory(db, ticketId, 'status', session, `Confirmed. Rating: ${b.rating || 'n/a'}`, ticket.status, 'Closed')
          await notify(db, ticket.assignee_id, `Ticket ${ticket.human_id} confirmed & closed`, ticket)
        } else if (b.action === 'reopen') {
          await db.collection('tickets').updateOne({ id: ticketId }, { $set: { status: 'Reopened', confirmation: { confirmed: false, comment: b.comment || '', at: new Date() }, updated_at: new Date() } })
          await addHistory(db, ticketId, 'status', session, `Reopened: ${b.comment || ''}`, ticket.status, 'Reopened')
          await notify(db, ticket.assignee_id, `Ticket ${ticket.human_id} reopened by employee`, ticket)
        }
        await audit(db, session, 'ticket.confirm', 'ticket', ticketId, b)
        const updated = await db.collection('tickets').findOne({ id: ticketId })
        return json(clean(updated))
      }

      // ---- APPROVAL: submit (IT or Admin, dept-scoped by object auth above) ----
      if (seg[2] === 'approval' && seg[3] === 'submit' && method === 'POST') {
        if (!['it', 'admin'].includes(session.role)) return json({ error: 'Forbidden' }, 403)
        const b = await request.json()
        const existing = await db.collection('approvals').findOne({ ticket_id: ticketId })
        const apprData = {
          justification: b.justification || '', requested_amount: b.requested_amount || 0,
          vendor: b.vendor || '', quotation: b.quotation || '', alternatives: b.alternatives || '',
          recommendation: b.recommendation || '', required_by: b.required_by ? new Date(b.required_by) : null,
          risk: b.risk || '', attachments: b.attachments || [],
        }
        let approval
        if (existing) {
          approval = existing
          await db.collection('approvals').updateOne({ ticket_id: ticketId }, {
            $set: { ...apprData, status: 'Pending', updated_at: new Date() },
            $push: { history: { action: 'resubmitted', by: session.name, at: new Date(), remarks: b.justification } },
          })
        } else {
          const ahid = await humanId(db, 'APR')
          approval = {
            id: uuidv4(), human_id: ahid, ticket_id: ticketId, ...apprData,
            status: 'Pending', approved_amount: null, decision_remarks: '', decided_by: null,
            history: [{ action: 'submitted', by: session.name, at: new Date(), remarks: b.justification }],
            created_at: new Date(), updated_at: new Date(),
          }
          await db.collection('approvals').insertOne(approval)
        }
        await db.collection('tickets').updateOne({ id: ticketId }, { $set: { status: 'Pending Super Admin Approval', approval_required: true, updated_at: new Date() } })
        await addHistory(db, ticketId, 'approval', session, 'Submitted for Super Admin approval', ticket.status, 'Pending Super Admin Approval')
        const supers = await db.collection('users').find({ role: 'super_admin' }).toArray()
        await notify(db, supers.map((u) => u.id), `Approval requested for ${ticket.human_id}`, ticket)
        await audit(db, session, 'approval.submit', 'ticket', ticketId, apprData)
        return json({ ok: true })
      }

      // ---- APPROVAL: decision (super admin) ----
      if (seg[2] === 'approval' && seg[3] === 'decision' && method === 'POST') {
        if (session.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
        const b = await request.json()
        const decision = b.decision // approve | partial | reject | hold | clarify
        const remarksRequired = ['partial', 'reject', 'hold', 'clarify']
        if (remarksRequired.includes(decision) && !b.remarks) return json({ error: 'Remarks required' }, 400)
        const map = {
          approve: { appr: 'Approved', ticket: 'Approved - Ready for Action' },
          partial: { appr: 'Partially Approved', ticket: 'Approved - Ready for Action' },
          reject: { appr: 'Rejected', ticket: 'Approval Rejected' },
          hold: { appr: 'On Hold', ticket: 'Approval On Hold' },
          clarify: { appr: 'Clarification', ticket: 'Clarification Required' },
        }
        const m = map[decision]
        if (!m) return json({ error: 'Invalid decision' }, 400)
        await db.collection('approvals').updateOne({ ticket_id: ticketId }, {
          $set: { status: m.appr, approved_amount: b.approved_amount ?? null, decision_remarks: b.remarks || '', decided_by: session.name, updated_at: new Date() },
          $push: { history: { action: decision, by: session.name, at: new Date(), remarks: b.remarks || '', approved_amount: b.approved_amount ?? null } },
        })
        await db.collection('tickets').updateOne({ id: ticketId }, { $set: { status: m.ticket, updated_at: new Date() } })
        await addHistory(db, ticketId, 'approval', session, `${decision.toUpperCase()}: ${b.remarks || ''}`, ticket.status, m.ticket)
        await notify(db, ticket.assignee_id, `Approval ${m.appr} for ${ticket.human_id}`, ticket)
        await audit(db, session, 'approval.decision', 'ticket', ticketId, { decision, ...b })
        return json({ ok: true })
      }
    }

    // ---- TASKS ----
    if (route === '/tasks' && method === 'GET') {
      if (!['admin', 'super_admin'].includes(session.role)) return json({ error: 'Forbidden' }, 403)
      const tasks = await db.collection('tasks').find({}).sort({ created_at: -1 }).toArray()
      return json(clean(tasks))
    }
    if (route === '/tasks' && method === 'POST') {
      if (session.role !== 'admin') return json({ error: 'Forbidden' }, 403)
      const b = await request.json()
      const hid = await humanId(db, 'ATSK')
      const t = {
        id: uuidv4(), human_id: hid, title: b.title || 'Untitled', category: b.category || 'Facilities',
        location: b.location || 'HQ1', recurrence: b.recurrence || 'one-time', owner_id: session.id,
        owner_name: session.name, backup_owner_name: b.backup_owner_name || '', priority: b.priority || 'Medium',
        due_date: b.due_date ? new Date(b.due_date) : new Date(), status: 'Not Started', remarks: b.remarks || '',
        linked_approval: null, completion_proof: null, created_at: new Date(), updated_at: new Date(),
      }
      await db.collection('tasks').insertOne(t)
      await audit(db, session, 'task.create', 'task', t.id, { human_id: hid })
      return json(clean(t))
    }
    if (seg[0] === 'tasks' && seg[1] && method === 'PATCH') {
      if (session.role !== 'admin') return json({ error: 'Forbidden' }, 403)
      const b = await request.json()
      const set = { updated_at: new Date() }
      for (const k of ['status', 'remarks', 'priority', 'completion_proof']) if (b[k] !== undefined) set[k] = b[k]
      await db.collection('tasks').updateOne({ id: seg[1] }, { $set: set })
      await audit(db, session, 'task.update', 'task', seg[1], b)
      return json(clean(await db.collection('tasks').findOne({ id: seg[1] })))
    }

    // ---- CHECKLISTS ----
    if (route === '/checklists/templates' && method === 'GET') {
      if (!['admin', 'super_admin'].includes(session.role)) return json({ error: 'Forbidden' }, 403)
      return json(clean(await db.collection('checklist_templates').find({}).toArray()))
    }
    if (route === '/checklists/executions' && method === 'GET') {
      if (!['admin', 'super_admin'].includes(session.role)) return json({ error: 'Forbidden' }, 403)
      return json(clean(await db.collection('checklist_executions').find({}).sort({ created_at: -1 }).toArray()))
    }
    if (route === '/checklists/executions' && method === 'POST') {
      if (session.role !== 'admin') return json({ error: 'Forbidden' }, 403)
      const b = await request.json()
      const tpl = await db.collection('checklist_templates').findOne({ id: b.template_id })
      if (!tpl) return json({ error: 'Template not found' }, 404)
      const hid = await humanId(db, 'CHK', tpl.location)
      const exec = {
        id: uuidv4(), human_id: hid, template_id: tpl.id, template_name: tpl.name, location: tpl.location,
        date: new Date(), responses: (b.responses || tpl.items.map((it) => ({ item: it.label, status: 'Not Started', remarks: '' }))),
        status: 'In Progress', owner_name: session.name, created_at: new Date(), updated_at: new Date(),
      }
      await db.collection('checklist_executions').insertOne(exec)
      await audit(db, session, 'checklist.create', 'checklist', exec.id, { human_id: hid })
      return json(clean(exec))
    }
    if (seg[0] === 'checklists' && seg[1] === 'executions' && seg[2] && method === 'PATCH') {
      if (session.role !== 'admin') return json({ error: 'Forbidden' }, 403)
      const b = await request.json()
      const set = { updated_at: new Date() }
      if (b.responses) set.responses = b.responses
      if (b.status) set.status = b.status
      await db.collection('checklist_executions').updateOne({ id: seg[2] }, { $set: set })
      return json(clean(await db.collection('checklist_executions').findOne({ id: seg[2] })))
    }
    // create ticket from checklist item
    if (seg[0] === 'checklists' && seg[1] === 'to-ticket' && method === 'POST') {
      if (session.role !== 'admin') return json({ error: 'Forbidden' }, 403)
      const b = await request.json()
      const id = uuidv4()
      const hid = await humanId(db, 'ADM')
      const t = {
        id, human_id: hid, department: 'Admin', category: 'Facilities', subcategory: '',
        title: `Checklist issue: ${b.item}`, description: b.remarks || '', priority: b.priority || 'Medium',
        status: 'Open', raised_by_id: session.id, raised_by_name: session.name, raised_for_name: session.name,
        employee_id: '', email: session.email, location: b.location || 'HQ1', assignee_id: session.id,
        assignee_name: session.name, approval_required: false, legacy_id: null, source: 'checklist',
        ...slaDates('Admin', b.priority || 'Medium'), created_at: new Date(), updated_at: new Date(), resolution: null, confirmation: null,
      }
      await db.collection('tickets').insertOne(t)
      await addHistory(db, id, 'created', session, `Created from checklist item: ${b.item}`, null, 'Open')
      await audit(db, session, 'ticket.from_checklist', 'ticket', id, { item: b.item })
      return json(clean(t))
    }

    // ---- MEMBER CHECKLISTS (Super Admin defines; IT/Admin submit daily) ----
    if (route === '/member-checklists' && method === 'GET') {
      const today = new Date().toISOString().slice(0, 10)
      let q = {}
      if (session.role === 'super_admin') {
        const mid = new URL(request.url).searchParams.get('member_id')
        if (mid) q = { member_id: mid }
      } else if (['it', 'admin'].includes(session.role)) {
        q = { member_id: session.id }
      } else {
        return json({ error: 'Forbidden' }, 403)
      }
      const lists = await db.collection('member_checklists').find(q).toArray()
      // attach today's submission for member view
      const out = []
      for (const l of lists) {
        const sub = await db.collection('member_checklist_submissions').findOne({ checklist_id: l.id, date: today })
        out.push({ ...clean(l), today_submission: sub ? clean(sub) : null })
      }
      return json(out)
    }
    if (route === '/member-checklists' && method === 'POST') {
      if (session.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
      const b = await request.json()
      const member = await db.collection('users').findOne({ id: b.member_id })
      if (!member) return json({ error: 'Member not found' }, 400)
      const doc = {
        id: uuidv4(), member_id: member.id, member_name: member.name, member_role: member.role,
        title: b.title || 'Daily Checklist', frequency: b.frequency || 'daily', active: true,
        items: (b.items || []).filter(Boolean).map((label, i) => ({ key: `mc_${i}`, label })),
        created_by: session.name, created_at: new Date(),
      }
      await db.collection('member_checklists').insertOne(doc)
      await audit(db, session, 'member_checklist.create', 'member_checklist', doc.id, { member: member.name })
      await notify(db, member.id, `New daily checklist assigned: ${doc.title}`, null)
      return json(clean(doc))
    }
    if (seg[0] === 'member-checklists' && seg[1] && seg[2] === 'submit' && method === 'POST') {
      if (!['it', 'admin'].includes(session.role)) return json({ error: 'Forbidden' }, 403)
      const list = await db.collection('member_checklists').findOne({ id: seg[1] })
      if (!list) return json({ error: 'Not found' }, 404)
      if (list.member_id !== session.id) return json({ error: 'Forbidden' }, 403)
      const b = await request.json()
      const date = b.date || new Date().toISOString().slice(0, 10)
      const responses = b.responses || []
      const doneCount = responses.filter((r) => r.done).length
      const status = doneCount === responses.length && responses.length > 0 ? 'Completed' : 'Partial'
      const existing = await db.collection('member_checklist_submissions').findOne({ checklist_id: list.id, date })
      const payload = { checklist_id: list.id, checklist_title: list.title, member_id: session.id, member_name: session.name, date, responses, done_count: doneCount, total: responses.length, status, submitted_at: new Date() }
      if (existing) await db.collection('member_checklist_submissions').updateOne({ id: existing.id }, { $set: payload })
      else await db.collection('member_checklist_submissions').insertOne({ id: uuidv4(), ...payload, created_at: new Date() })
      await audit(db, session, 'member_checklist.submit', 'member_checklist', list.id, { date, status })
      return json({ ok: true, status, done_count: doneCount, total: responses.length })
    }
    if (seg[0] === 'member-checklists' && seg[1] && method === 'DELETE') {
      if (session.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
      await db.collection('member_checklists').deleteOne({ id: seg[1] })
      return json({ ok: true })
    }
    if (route === '/member-checklist-submissions' && method === 'GET') {
      if (session.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
      const p = new URL(request.url).searchParams
      const q = {}
      if (p.get('member_id')) q.member_id = p.get('member_id')
      if (p.get('date')) q.date = p.get('date')
      const items = await db.collection('member_checklist_submissions').find(q).sort({ date: -1, submitted_at: -1 }).limit(200).toArray()
      return json(clean(items))
    }

    // ---- NOTIFICATIONS ----
    if (route === '/notifications' && method === 'GET') {
      const items = await db.collection('notifications').find({ user_id: session.id }).sort({ created_at: -1 }).limit(50).toArray()
      return json(clean(items))
    }
    if (route === '/notifications/read' && method === 'POST') {
      await db.collection('notifications').updateMany({ user_id: session.id }, { $set: { read: true } })
      return json({ ok: true })
    }

    // ---- AUDIT ----
    if (route === '/audit' && method === 'GET') {
      if (session.role !== 'super_admin') return json({ error: 'Forbidden' }, 403)
      const items = await db.collection('audit_logs').find({}).sort({ created_at: -1 }).limit(300).toArray()
      return json(clean(items))
    }

    return json({ error: `Route ${route} not found` }, 404)
  } catch (error) {
    console.error('API Error:', error)
    return json({ error: 'Internal server error', detail: String(error?.message || error) }, 500)
  }
}

export const GET = handleRoute
export const POST = handleRoute
export const PUT = handleRoute
export const DELETE = handleRoute
export const PATCH = handleRoute
