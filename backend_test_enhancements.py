#!/usr/bin/env python3
"""
TicketFlow Backend API Test Suite - Enhancement Round
Tests NEW endpoints: Dashboard dept scoping, Member SLA report, IT approval submit, Member checklists
"""
import requests
import json
import os
from typing import Dict, Any, Optional

# Base URL from .env
BASE_URL = os.getenv("BASE_URL", "http://localhost:3004/api")

# Demo users
USERS = {
    "employee": {"email": "employee@demo.com", "password": "Passw0rd!", "name": "Emma Employee"},
    "it": {"email": "it@demo.com", "password": "Passw0rd!", "name": "Ajeet Kumar"},
    "it2": {"email": "it2@demo.com", "password": "Passw0rd!", "name": "Sunil Rathore"},
    "admin": {"email": "admin@demo.com", "password": "Passw0rd!", "name": "Rajeev Goyal"},
    "superadmin": {"email": "superadmin@demo.com", "password": "Passw0rd!", "name": "Sara Superadmin"}
}

class TestResult:
    def __init__(self):
        self.passed = []
        self.failed = []
    
    def add_pass(self, test_name: str):
        self.passed.append(test_name)
        print(f"✅ PASS: {test_name}")
    
    def add_fail(self, test_name: str, reason: str):
        self.failed.append((test_name, reason))
        print(f"❌ FAIL: {test_name}")
        print(f"   Reason: {reason}")
    
    def summary(self):
        print("\n" + "="*80)
        print("TEST SUMMARY - ENHANCEMENT ROUND")
        print("="*80)
        print(f"Total Passed: {len(self.passed)}")
        print(f"Total Failed: {len(self.failed)}")
        if self.failed:
            print("\nFailed Tests:")
            for test_name, reason in self.failed:
                print(f"  ❌ {test_name}: {reason}")
        print("="*80)

results = TestResult()

def login(session: requests.Session, user_type: str) -> Dict[str, Any]:
    """Login and return user data"""
    user = USERS[user_type]
    resp = session.post(f"{BASE_URL}/auth/login", json={"email": user["email"], "password": user["password"]})
    if resp.status_code == 200:
        return resp.json().get("user")
    return None

print("="*80)
print("TICKETFLOW BACKEND API TEST SUITE - ENHANCEMENT ROUND")
print("="*80)

# Create sessions for each role
employee_session = requests.Session()
employee_user = login(employee_session, "employee")

it_session = requests.Session()
it_user = login(it_session, "it")

it2_session = requests.Session()
it2_user = login(it2_session, "it2")

admin_session = requests.Session()
admin_user = login(admin_session, "admin")

superadmin_session = requests.Session()
superadmin_user = login(superadmin_session, "superadmin")

print(f"\n✓ Logged in as: employee={employee_user['name']}, it={it_user['name']}, it2={it2_user['name']}, admin={admin_user['name']}, superadmin={superadmin_user['name']}")

# ============================================================================
# 1. DASHBOARD DEPARTMENT SCOPING
# ============================================================================
print("\n[1] DASHBOARD DEPARTMENT SCOPING...")

# 1.1 Super admin: GET /dashboard?department=IT returns IT-scoped stats
try:
    resp = superadmin_session.get(f"{BASE_URL}/dashboard?department=IT")
    if resp.status_code == 200:
        stats = resp.json()
        # Check required fields
        required_fields = ['avg_response_hours', 'avg_resolution_hours', 'sla_compliance', 'calendar']
        missing = [f for f in required_fields if f not in stats]
        if missing:
            results.add_fail("Dashboard IT scoping - required fields", f"Missing fields: {missing}")
        else:
            # Verify calendar has tickets
            if not isinstance(stats['calendar'], list):
                results.add_fail("Dashboard IT scoping - calendar", f"calendar is not a list: {type(stats['calendar'])}")
            else:
                # Check calendar items have required fields
                if len(stats['calendar']) > 0:
                    sample = stats['calendar'][0]
                    required_cal_fields = ['id', 'human_id', 'priority', 'created_at']
                    missing_cal = [f for f in required_cal_fields if f not in sample]
                    if missing_cal:
                        results.add_fail("Dashboard IT scoping - calendar items", f"Missing fields in calendar items: {missing_cal}")
                    else:
                        results.add_pass("Super admin GET /dashboard?department=IT returns IT-scoped stats with required fields")
                else:
                    results.add_pass("Super admin GET /dashboard?department=IT returns IT-scoped stats with required fields (no tickets in calendar)")
    else:
        results.add_fail("Dashboard IT scoping", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("Dashboard IT scoping", str(e))

# 1.2 Super admin: GET /dashboard?department=Admin returns Admin-scoped stats
try:
    resp = superadmin_session.get(f"{BASE_URL}/dashboard?department=Admin")
    if resp.status_code == 200:
        stats = resp.json()
        required_fields = ['avg_response_hours', 'avg_resolution_hours', 'sla_compliance', 'calendar']
        missing = [f for f in required_fields if f not in stats]
        if missing:
            results.add_fail("Dashboard Admin scoping - required fields", f"Missing fields: {missing}")
        else:
            results.add_pass("Super admin GET /dashboard?department=Admin returns Admin-scoped stats with required fields")
    else:
        results.add_fail("Dashboard Admin scoping", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("Dashboard Admin scoping", str(e))

# 1.3 IT user: GET /dashboard?department=Admin should be IGNORED (returns IT scope)
try:
    # Get IT dashboard without param
    resp_no_param = it_session.get(f"{BASE_URL}/dashboard")
    if resp_no_param.status_code != 200:
        results.add_fail("IT dashboard no param", f"Status {resp_no_param.status_code}")
    else:
        stats_no_param = resp_no_param.json()
        # Get IT dashboard with department=Admin param (should be ignored)
        resp_with_param = it_session.get(f"{BASE_URL}/dashboard?department=Admin")
        if resp_with_param.status_code != 200:
            results.add_fail("IT dashboard with Admin param", f"Status {resp_with_param.status_code}")
        else:
            stats_with_param = resp_with_param.json()
            # Compare totals - they should be equal (both IT-scoped)
            if stats_no_param['total'] == stats_with_param['total']:
                # Verify all tickets are IT department
                all_it = all(t.get('department') == 'IT' if 'department' in t else True for t in stats_with_param.get('calendar', []))
                if all_it or len(stats_with_param.get('calendar', [])) == 0:
                    results.add_pass("IT user: GET /dashboard?department=Admin is IGNORED (returns IT scope)")
                else:
                    results.add_fail("IT dashboard param ignored", "Found non-IT tickets in calendar when department=Admin param used")
            else:
                results.add_fail("IT dashboard param ignored", f"Totals differ: no_param={stats_no_param['total']}, with_param={stats_with_param['total']}")
except Exception as e:
    results.add_fail("IT dashboard param ignored", str(e))

# ============================================================================
# 2. MEMBER SLA REPORT
# ============================================================================
print("\n[2] MEMBER SLA REPORT...")

# 2.1 Super admin: GET /reports/member-sla?department=IT
try:
    resp = superadmin_session.get(f"{BASE_URL}/reports/member-sla?department=IT")
    if resp.status_code == 200:
        data = resp.json()
        if data.get('department') != 'IT':
            results.add_fail("Member SLA IT - department field", f"Expected 'IT', got {data.get('department')}")
        elif 'members' not in data:
            results.add_fail("Member SLA IT - members field", "Missing 'members' field")
        else:
            members = data['members']
            if not isinstance(members, list):
                results.add_fail("Member SLA IT - members type", f"members is not a list: {type(members)}")
            else:
                # Check for Ajeet Kumar and Sunil Rathore
                member_names = [m.get('member_name') for m in members]
                if 'Ajeet Kumar' not in member_names:
                    results.add_fail("Member SLA IT - Ajeet Kumar", "Ajeet Kumar not found in members")
                elif 'Sunil Rathore' not in member_names:
                    results.add_fail("Member SLA IT - Sunil Rathore", "Sunil Rathore not found in members")
                else:
                    # Check required fields in member objects
                    required_fields = ['member_name', 'assigned', 'open', 'resolved', 'avg_response_hours', 'avg_resolution_hours', 'sla_compliance']
                    sample = members[0]
                    missing = [f for f in required_fields if f not in sample]
                    if missing:
                        results.add_fail("Member SLA IT - member fields", f"Missing fields: {missing}")
                    else:
                        # Check Ajeet Kumar has assigned > 0
                        ajeet = next((m for m in members if m['member_name'] == 'Ajeet Kumar'), None)
                        if ajeet and ajeet['assigned'] > 0:
                            results.add_pass("Super admin GET /reports/member-sla?department=IT returns IT members with required fields")
                        else:
                            results.add_pass("Super admin GET /reports/member-sla?department=IT returns IT members with required fields (Ajeet has 0 assigned)")
    else:
        results.add_fail("Member SLA IT", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("Member SLA IT", str(e))

# 2.2 Super admin: GET /reports/member-sla?department=Admin
try:
    resp = superadmin_session.get(f"{BASE_URL}/reports/member-sla?department=Admin")
    if resp.status_code == 200:
        data = resp.json()
        if data.get('department') != 'Admin':
            results.add_fail("Member SLA Admin - department field", f"Expected 'Admin', got {data.get('department')}")
        else:
            members = data.get('members', [])
            member_names = [m.get('member_name') for m in members]
            if 'Rajeev Goyal' in member_names:
                results.add_pass("Super admin GET /reports/member-sla?department=Admin returns Rajeev Goyal")
            else:
                results.add_fail("Member SLA Admin - Rajeev Goyal", f"Rajeev Goyal not found. Found: {member_names}")
    else:
        results.add_fail("Member SLA Admin", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("Member SLA Admin", str(e))

# 2.3 IT user: GET /reports/member-sla returns 403
try:
    resp = it_session.get(f"{BASE_URL}/reports/member-sla?department=IT")
    if resp.status_code == 403:
        results.add_pass("IT user: GET /reports/member-sla returns 403")
    else:
        results.add_fail("Member SLA IT RBAC", f"Expected 403, got {resp.status_code}")
except Exception as e:
    results.add_fail("Member SLA IT RBAC", str(e))

# 2.4 Admin user: GET /reports/member-sla returns 403
try:
    resp = admin_session.get(f"{BASE_URL}/reports/member-sla?department=Admin")
    if resp.status_code == 403:
        results.add_pass("Admin user: GET /reports/member-sla returns 403")
    else:
        results.add_fail("Member SLA Admin RBAC", f"Expected 403, got {resp.status_code}")
except Exception as e:
    results.add_fail("Member SLA Admin RBAC", str(e))

# 2.5 Employee user: GET /reports/member-sla returns 403
try:
    resp = employee_session.get(f"{BASE_URL}/reports/member-sla?department=IT")
    if resp.status_code == 403:
        results.add_pass("Employee user: GET /reports/member-sla returns 403")
    else:
        results.add_fail("Member SLA Employee RBAC", f"Expected 403, got {resp.status_code}")
except Exception as e:
    results.add_fail("Member SLA Employee RBAC", str(e))

# ============================================================================
# 3. IT APPROVAL SUBMIT
# ============================================================================
print("\n[3] IT APPROVAL SUBMIT...")

# 3.1 IT user: Find an IT ticket and submit approval
it_ticket_id = None
try:
    resp = it_session.get(f"{BASE_URL}/tickets")
    if resp.status_code == 200:
        tickets = resp.json().get('items', [])
        # Find a ticket that doesn't have approval yet
        for t in tickets:
            if t.get('status') not in ['Pending Super Admin Approval', 'Approved - Ready for Action', 'Resolved', 'Closed']:
                it_ticket_id = t['id']
                break
        
        if not it_ticket_id and len(tickets) > 0:
            # Use any IT ticket
            it_ticket_id = tickets[0]['id']
        
        if it_ticket_id:
            # Submit approval
            approval_data = {
                "justification": "Need budget for network upgrade",
                "requested_amount": 15000,
                "vendor": "Cisco Systems",
                "required_by": "2025-03-01"
            }
            resp = it_session.post(f"{BASE_URL}/tickets/{it_ticket_id}/approval/submit", json=approval_data)
            if resp.status_code == 200:
                # Check ticket status changed
                resp_detail = it_session.get(f"{BASE_URL}/tickets/{it_ticket_id}")
                if resp_detail.status_code == 200:
                    ticket = resp_detail.json()
                    if ticket.get('status') == 'Pending Super Admin Approval':
                        # Check approval object
                        if ticket.get('approval') and ticket['approval'].get('human_id', '').startswith('APR-'):
                            results.add_pass("IT user: POST /tickets/{id}/approval/submit succeeds, status -> Pending Super Admin Approval, APR- human_id created")
                        else:
                            results.add_fail("IT approval submit - approval object", f"Approval object missing or invalid: {ticket.get('approval')}")
                    else:
                        results.add_fail("IT approval submit - status", f"Status not updated: {ticket.get('status')}")
                else:
                    results.add_fail("IT approval submit - get detail", f"Status {resp_detail.status_code}")
            else:
                results.add_fail("IT approval submit", f"Status {resp.status_code}: {resp.text}")
        else:
            results.add_fail("IT approval submit", "No IT tickets found to test")
    else:
        results.add_fail("IT approval submit - get tickets", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("IT approval submit", str(e))

# 3.2 Employee: POST /tickets/{any own ticket}/approval/submit returns 403
try:
    resp = employee_session.get(f"{BASE_URL}/tickets")
    if resp.status_code == 200:
        tickets = resp.json().get('items', [])
        if len(tickets) > 0:
            employee_ticket_id = tickets[0]['id']
            resp = employee_session.post(f"{BASE_URL}/tickets/{employee_ticket_id}/approval/submit", 
                                        json={"justification": "test", "requested_amount": 1000})
            if resp.status_code == 403:
                results.add_pass("Employee: POST /tickets/{id}/approval/submit returns 403")
            else:
                results.add_fail("Employee approval submit RBAC", f"Expected 403, got {resp.status_code}")
        else:
            results.add_fail("Employee approval submit RBAC", "No employee tickets found")
    else:
        results.add_fail("Employee approval submit RBAC - get tickets", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("Employee approval submit RBAC", str(e))

# 3.3 Super admin: POST /tickets/{IT ticket}/approval/decision approve
if it_ticket_id:
    try:
        resp = superadmin_session.post(f"{BASE_URL}/tickets/{it_ticket_id}/approval/decision",
                                      json={"decision": "approve", "remarks": "Approved for network upgrade"})
        if resp.status_code == 200:
            # Check ticket status
            resp_detail = superadmin_session.get(f"{BASE_URL}/tickets/{it_ticket_id}")
            if resp_detail.status_code == 200:
                ticket = resp_detail.json()
                if ticket.get('status') == 'Approved - Ready for Action':
                    results.add_pass("Super admin: POST /tickets/{IT ticket}/approval/decision approve -> status 'Approved - Ready for Action'")
                else:
                    results.add_fail("Super admin approval decision - status", f"Status: {ticket.get('status')}")
            else:
                results.add_fail("Super admin approval decision - get detail", f"Status {resp_detail.status_code}")
        else:
            results.add_fail("Super admin approval decision", f"Status {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("Super admin approval decision", str(e))

# ============================================================================
# 4. MEMBER CHECKLISTS
# ============================================================================
print("\n[4] MEMBER CHECKLISTS...")

# 4.1 Super admin: GET /member-checklists returns seeded checklists
try:
    resp = superadmin_session.get(f"{BASE_URL}/member-checklists")
    if resp.status_code == 200:
        checklists = resp.json()
        if not isinstance(checklists, list):
            results.add_fail("Member checklists GET - type", f"Expected list, got {type(checklists)}")
        elif len(checklists) >= 3:
            results.add_pass("Super admin: GET /member-checklists returns >=3 seeded checklists")
        else:
            results.add_fail("Member checklists GET - count", f"Expected >=3, got {len(checklists)}")
    else:
        results.add_fail("Member checklists GET", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("Member checklists GET", str(e))

# 4.2 Super admin: POST /member-checklists creates new checklist
created_checklist_id = None
try:
    # Get IT user id
    resp = superadmin_session.get(f"{BASE_URL}/users")
    if resp.status_code == 200:
        users = resp.json()
        it_user_obj = next((u for u in users if u['email'] == 'it@demo.com'), None)
        if it_user_obj:
            checklist_data = {
                "member_id": it_user_obj['id'],
                "title": "Test Checklist for IT",
                "items": ["Check server status", "Verify backups"]
            }
            resp = superadmin_session.post(f"{BASE_URL}/member-checklists", json=checklist_data)
            if resp.status_code == 200:
                checklist = resp.json()
                created_checklist_id = checklist.get('id')
                if checklist.get('items') and len(checklist['items']) == 2:
                    results.add_pass("Super admin: POST /member-checklists creates checklist with 2 items")
                else:
                    results.add_fail("Member checklist POST - items", f"Items count: {len(checklist.get('items', []))}")
            else:
                results.add_fail("Member checklist POST", f"Status {resp.status_code}: {resp.text}")
        else:
            results.add_fail("Member checklist POST - get user", "IT user not found")
    else:
        results.add_fail("Member checklist POST - get users", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("Member checklist POST", str(e))

# 4.3 IT user (Ajeet): GET /member-checklists returns only own checklists with today_submission field
try:
    resp = it_session.get(f"{BASE_URL}/member-checklists")
    if resp.status_code == 200:
        checklists = resp.json()
        if not isinstance(checklists, list):
            results.add_fail("IT member checklists GET - type", f"Expected list, got {type(checklists)}")
        else:
            # All should be for Ajeet (it_user)
            all_own = all(c.get('member_id') == it_user['id'] for c in checklists)
            if not all_own:
                results.add_fail("IT member checklists GET - ownership", "Found checklists not belonging to IT user")
            else:
                # Check today_submission field exists
                if len(checklists) > 0:
                    sample = checklists[0]
                    if 'today_submission' in sample:
                        results.add_pass("IT user: GET /member-checklists returns only own checklists with today_submission field")
                    else:
                        results.add_fail("IT member checklists GET - today_submission", "today_submission field missing")
                else:
                    results.add_pass("IT user: GET /member-checklists returns only own checklists (empty list)")
    else:
        results.add_fail("IT member checklists GET", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("IT member checklists GET", str(e))

# 4.4 IT user: POST /member-checklists/{own id}/submit succeeds
ajeet_checklist_id = None
try:
    resp = it_session.get(f"{BASE_URL}/member-checklists")
    if resp.status_code == 200:
        checklists = resp.json()
        if len(checklists) > 0:
            ajeet_checklist_id = checklists[0]['id']
            checklist_items = checklists[0].get('items', [])
            # Build responses
            responses = []
            for item in checklist_items:
                responses.append({
                    "item": item['label'],
                    "done": True,
                    "remark": "Completed successfully"
                })
            
            submit_data = {"responses": responses}
            resp = it_session.post(f"{BASE_URL}/member-checklists/{ajeet_checklist_id}/submit", json=submit_data)
            if resp.status_code == 200:
                result = resp.json()
                if result.get('ok') and 'status' in result and 'done_count' in result and 'total' in result:
                    results.add_pass("IT user: POST /member-checklists/{own id}/submit succeeds with {ok, status, done_count, total}")
                else:
                    results.add_fail("IT member checklist submit - response", f"Missing fields in response: {result}")
            else:
                results.add_fail("IT member checklist submit", f"Status {resp.status_code}: {resp.text}")
        else:
            results.add_fail("IT member checklist submit", "No checklists found for IT user")
    else:
        results.add_fail("IT member checklist submit - get checklists", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("IT member checklist submit", str(e))

# 4.5 IT user: GET /member-checklists again - today_submission should be non-null
if ajeet_checklist_id:
    try:
        resp = it_session.get(f"{BASE_URL}/member-checklists")
        if resp.status_code == 200:
            checklists = resp.json()
            submitted_checklist = next((c for c in checklists if c['id'] == ajeet_checklist_id), None)
            if submitted_checklist:
                if submitted_checklist.get('today_submission') is not None:
                    # Check responses in today_submission
                    submission = submitted_checklist['today_submission']
                    if 'responses' in submission and len(submission['responses']) > 0:
                        results.add_pass("IT user: GET /member-checklists after submit shows today_submission with responses")
                    else:
                        results.add_fail("IT member checklist today_submission - responses", "Responses missing or empty")
                else:
                    results.add_fail("IT member checklist today_submission", "today_submission is still null after submit")
            else:
                results.add_fail("IT member checklist today_submission", "Checklist not found after submit")
        else:
            results.add_fail("IT member checklist today_submission - get", f"Status {resp.status_code}")
    except Exception as e:
        results.add_fail("IT member checklist today_submission", str(e))

# 4.6 IT user: attempt to submit another member's checklist (403)
try:
    # Get all checklists as super admin
    resp = superadmin_session.get(f"{BASE_URL}/member-checklists")
    if resp.status_code == 200:
        all_checklists = resp.json()
        # Find a checklist NOT belonging to Ajeet (it_user)
        other_checklist = next((c for c in all_checklists if c.get('member_id') != it_user['id']), None)
        if other_checklist:
            other_id = other_checklist['id']
            resp = it_session.post(f"{BASE_URL}/member-checklists/{other_id}/submit", 
                                  json={"responses": [{"item": "test", "done": True, "remark": ""}]})
            if resp.status_code == 403:
                results.add_pass("IT user: POST /member-checklists/{another member's id}/submit returns 403")
            else:
                results.add_fail("IT member checklist submit other - RBAC", f"Expected 403, got {resp.status_code}")
        else:
            results.add_pass("IT user: POST /member-checklists/{another member's id}/submit returns 403 (no other checklists to test)")
    else:
        results.add_fail("IT member checklist submit other - get all", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("IT member checklist submit other - RBAC", str(e))

# 4.7 IT user: GET /member-checklist-submissions returns 403
try:
    resp = it_session.get(f"{BASE_URL}/member-checklist-submissions")
    if resp.status_code == 403:
        results.add_pass("IT user: GET /member-checklist-submissions returns 403")
    else:
        results.add_fail("Member checklist submissions IT RBAC", f"Expected 403, got {resp.status_code}")
except Exception as e:
    results.add_fail("Member checklist submissions IT RBAC", str(e))

# 4.8 Super admin: GET /member-checklist-submissions returns submissions
try:
    resp = superadmin_session.get(f"{BASE_URL}/member-checklist-submissions")
    if resp.status_code == 200:
        submissions = resp.json()
        if not isinstance(submissions, list):
            results.add_fail("Member checklist submissions GET - type", f"Expected list, got {type(submissions)}")
        else:
            # Should have at least the submission we just created
            if len(submissions) > 0:
                results.add_pass("Super admin: GET /member-checklist-submissions returns submissions")
            else:
                results.add_fail("Member checklist submissions GET - count", "No submissions found")
    else:
        results.add_fail("Member checklist submissions GET", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("Member checklist submissions GET", str(e))

# ============================================================================
# SUMMARY
# ============================================================================
results.summary()
