// API helper + shared UI constants for TicketFlow

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch (e) { data = null }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`)
  return data
}

export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low']

export const PRIORITY_META = {
  Critical: { badge: 'bg-red-800 text-white border-red-900', dot: 'bg-red-800' },
  High: { badge: 'bg-orange-500 text-white border-orange-600', dot: 'bg-orange-500' },
  Medium: { badge: 'bg-yellow-400 text-yellow-950 border-yellow-500', dot: 'bg-yellow-400' },
  Low: { badge: 'bg-emerald-500 text-white border-emerald-600', dot: 'bg-emerald-500' },
}

export function statusClass(s) {
  const map = {
    Open: 'bg-slate-100 text-slate-700 border-slate-300',
    Assigned: 'bg-blue-100 text-blue-700 border-blue-300',
    Acknowledged: 'bg-blue-100 text-blue-700 border-blue-300',
    'Approval Preparation': 'bg-purple-100 text-purple-700 border-purple-300',
    'Pending Super Admin Approval': 'bg-amber-100 text-amber-800 border-amber-300',
    'Clarification Required': 'bg-orange-100 text-orange-700 border-orange-300',
    'Approval On Hold': 'bg-yellow-100 text-yellow-800 border-yellow-300',
    'Approval Rejected': 'bg-red-100 text-red-700 border-red-300',
    'Approved - Ready for Action': 'bg-teal-100 text-teal-700 border-teal-300',
    'In Progress': 'bg-indigo-100 text-indigo-700 border-indigo-300',
    'Pending User Response': 'bg-cyan-100 text-cyan-700 border-cyan-300',
    Resolved: 'bg-green-100 text-green-700 border-green-300',
    Closed: 'bg-slate-200 text-slate-600 border-slate-300',
    Reopened: 'bg-rose-100 text-rose-700 border-rose-300',
    Cancelled: 'bg-gray-100 text-gray-500 border-gray-300',
  }
  return map[s] || 'bg-slate-100 text-slate-700 border-slate-300'
}

export const ALL_STATUSES = ['Open','Assigned','Acknowledged','Approval Preparation','Pending Super Admin Approval','Clarification Required','Approval On Hold','Approval Rejected','Approved - Ready for Action','In Progress','Pending User Response','Pending Vendor','Pending Finance','Pending Material','On Hold','Resolved','Closed','Reopened','Cancelled']

export const ROLE_LABEL = {
  employee: 'Employee',
  it: 'IT Team',
  admin: 'Admin Team',
  super_admin: 'Super Admin',
}

export function fmtDate(d) {
  if (!d) return '-'
  const x = new Date(d)
  return x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
}
export function fmtDateTime(d) {
  if (!d) return '-'
  const x = new Date(d)
  return x.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
export function slaRemaining(due) {
  if (!due) return { text: '-', breach: false }
  const diff = new Date(due).getTime() - Date.now()
  const breach = diff < 0
  const abs = Math.abs(diff)
  const h = Math.floor(abs / 3600000)
  const d = Math.floor(h / 24)
  const text = d > 0 ? `${d}d ${h % 24}h` : `${h}h`
  return { text: breach ? `Overdue ${text}` : text, breach }
}
