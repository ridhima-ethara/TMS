#!/usr/bin/env python3
"""
TicketFlow Backend API Test Suite - Round 3 Enhancements
Tests NEW/CHANGED endpoints: locations, daily-kra, member-checklist-submissions access, raise request flow
"""
import requests
import json
from typing import Dict, Any

# Base URL from .env
BASE_URL = "https://ticket-flow-pro-8.preview.emergentagent.com/api"

# Demo users
USERS = {
    "employee": {"email": "employee@demo.com", "password": "Passw0rd!", "name": "Emma Employee"},
    "it": {"email": "it@demo.com", "password": "Passw0rd!", "name": "Ajeet Kumar"},
    "it2": {"email": "it2@demo.com", "password": "Passw0rd!", "name": "Sunil Rathore"},
    "admin": {"email": "admin@demo.com", "password": "Passw0rd!", "name": "Rajeev Goyal"},
    "admin2": {"email": "admin2@demo.com", "password": "Passw0rd!", "name": "Neha Sharma"},
    "superadmin": {"email": "superadmin@demo.com", "password": "Passw0rd!", "name": "Sara Superadmin"}
}

class TestResult:
    def __init__(self):
        self.passed = []
        self.failed = []
    
    def add_pass(self, test_name: str, details: str = ""):
        self.passed.append(test_name)
        print(f"✅ PASS: {test_name}")
        if details:
            print(f"   {details}")
    
    def add_fail(self, test_name: str, reason: str):
        self.failed.append((test_name, reason))
        print(f"❌ FAIL: {test_name}")
        print(f"   Reason: {reason}")
    
    def summary(self):
        print("\n" + "="*80)
        print("ROUND 3 TEST SUMMARY")
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
print("TICKETFLOW ROUND 3 BACKEND API TEST SUITE")
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

admin2_session = requests.Session()
admin2_user = login(admin2_session, "admin2")

superadmin_session = requests.Session()
superadmin_user = login(superadmin_session, "superadmin")

# ============================================================================
# 1. LOCATIONS ENDPOINT
# ============================================================================
print("\n[1] LOCATIONS ENDPOINT...")

# 1.1 GET /api/locations returns exactly 6 objects with name, building, code
try:
    resp = it_session.get(f"{BASE_URL}/locations")
    if resp.status_code == 200:
        locations = resp.json()
        if len(locations) == 6:
            # Check each location has required fields
            all_valid = True
            tulip_count = 0
            lotus_count = 0
            for loc in locations:
                if not all(k in loc for k in ['name', 'building', 'code']):
                    all_valid = False
                    results.add_fail("Locations structure", f"Location missing required fields: {loc}")
                    break
                if loc['building'] == 'Tulip':
                    tulip_count += 1
                elif loc['building'] == 'Lotus':
                    lotus_count += 1
            
            if all_valid:
                if tulip_count == 4 and lotus_count == 2:
                    results.add_pass("GET /api/locations returns exactly 6 objects with name, building, code", 
                                   f"Tulip: 4 floors, Lotus: 2 areas (Bullpen, Labs)")
                else:
                    results.add_fail("Locations building distribution", 
                                   f"Expected Tulip:4, Lotus:2, got Tulip:{tulip_count}, Lotus:{lotus_count}")
        else:
            results.add_fail("Locations count", f"Expected 6 locations, got {len(locations)}")
    else:
        results.add_fail("GET /api/locations", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("GET /api/locations", str(e))

# ============================================================================
# 2. DAILY KRA COMPLIANCE REPORT
# ============================================================================
print("\n[2] DAILY KRA COMPLIANCE REPORT...")

# 2.1 As superadmin: GET /api/reports/daily-kra returns proper structure
try:
    resp = superadmin_session.get(f"{BASE_URL}/reports/daily-kra")
    if resp.status_code == 200:
        data = resp.json()
        if 'date' in data and 'members' in data:
            members = data['members']
            if len(members) == 4:
                # Check structure of each member
                required_fields = ['member_name', 'member_role', 'total_items', 'done_items', 
                                 'submitted_lists', 'total_lists', 'status', 'compliant', 'pct']
                all_valid = True
                member_names = set()
                for m in members:
                    member_names.add(m.get('member_name'))
                    for field in required_fields:
                        if field not in m:
                            all_valid = False
                            results.add_fail("Daily KRA structure", f"Member missing field '{field}': {m}")
                            break
                    # Check status is one of the valid values
                    if m.get('status') not in ['Completed', 'Partial', 'Not Submitted']:
                        all_valid = False
                        results.add_fail("Daily KRA status", f"Invalid status '{m.get('status')}' for {m.get('member_name')}")
                        break
                    # Check compliant is boolean
                    if not isinstance(m.get('compliant'), bool):
                        all_valid = False
                        results.add_fail("Daily KRA compliant", f"compliant is not boolean for {m.get('member_name')}")
                        break
                    # Check pct is 0-100
                    if not (0 <= m.get('pct', -1) <= 100):
                        all_valid = False
                        results.add_fail("Daily KRA pct", f"pct out of range for {m.get('member_name')}: {m.get('pct')}")
                        break
                
                if all_valid:
                    expected_members = {'Ajeet Kumar', 'Sunil Rathore', 'Rajeev Goyal', 'Neha Sharma'}
                    if member_names == expected_members:
                        results.add_pass("GET /api/reports/daily-kra as superadmin returns proper structure",
                                       f"4 members (Ajeet, Sunil IT; Rajeev, Neha Admin) with all required fields")
                    else:
                        results.add_fail("Daily KRA members", f"Expected {expected_members}, got {member_names}")
            else:
                results.add_fail("Daily KRA member count", f"Expected 4 members, got {len(members)}")
        else:
            results.add_fail("Daily KRA response structure", f"Missing 'date' or 'members' in response: {data.keys()}")
    else:
        results.add_fail("GET /api/reports/daily-kra as superadmin", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("GET /api/reports/daily-kra as superadmin", str(e))

# 2.2 As IT: GET /api/reports/daily-kra returns 403
try:
    resp = it_session.get(f"{BASE_URL}/reports/daily-kra")
    if resp.status_code == 403:
        results.add_pass("GET /api/reports/daily-kra as IT returns 403")
    else:
        results.add_fail("Daily KRA IT RBAC", f"Expected 403, got {resp.status_code}")
except Exception as e:
    results.add_fail("Daily KRA IT RBAC", str(e))

# 2.3 As Admin: GET /api/reports/daily-kra returns 403
try:
    resp = admin_session.get(f"{BASE_URL}/reports/daily-kra")
    if resp.status_code == 403:
        results.add_pass("GET /api/reports/daily-kra as Admin returns 403")
    else:
        results.add_fail("Daily KRA Admin RBAC", f"Expected 403, got {resp.status_code}")
except Exception as e:
    results.add_fail("Daily KRA Admin RBAC", str(e))

# 2.4 As Employee: GET /api/reports/daily-kra returns 403
try:
    resp = employee_session.get(f"{BASE_URL}/reports/daily-kra")
    if resp.status_code == 403:
        results.add_pass("GET /api/reports/daily-kra as Employee returns 403")
    else:
        results.add_fail("Daily KRA Employee RBAC", f"Expected 403, got {resp.status_code}")
except Exception as e:
    results.add_fail("Daily KRA Employee RBAC", str(e))

# ============================================================================
# 3. MEMBER SUBMISSIONS ACCESS CHANGE
# ============================================================================
print("\n[3] MEMBER SUBMISSIONS ACCESS CHANGE...")

# 3.1 As IT (Ajeet): Get own checklist and submit
ajeet_checklist_id = None
try:
    resp = it_session.get(f"{BASE_URL}/member-checklists")
    if resp.status_code == 200:
        checklists = resp.json()
        if checklists:
            ajeet_checklist_id = checklists[0]['id']
            results.add_pass("IT (Ajeet) GET /api/member-checklists returns own checklists")
            
            # Submit checklist
            submission_data = {
                "responses": [
                    {"item": "Verify server backups completed", "done": True, "remark": "ok"},
                    {"item": "Check network & Wi-Fi uptime", "done": True, "remark": ""}
                ]
            }
            resp = it_session.post(f"{BASE_URL}/member-checklists/{ajeet_checklist_id}/submit", json=submission_data)
            if resp.status_code == 200:
                result = resp.json()
                if all(k in result for k in ['ok', 'status', 'done_count', 'total']):
                    results.add_pass("IT (Ajeet) POST /api/member-checklists/{id}/submit succeeds",
                                   f"Response: {result}")
                else:
                    results.add_fail("Member checklist submit response", f"Missing fields in response: {result}")
            else:
                results.add_fail("Member checklist submit", f"Status {resp.status_code}: {resp.text}")
        else:
            results.add_fail("IT member checklists", "No checklists found for IT user")
    else:
        results.add_fail("IT GET /api/member-checklists", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("IT member checklist operations", str(e))

# 3.2 As IT (Ajeet): GET /api/member-checklist-submissions returns ONLY own submissions
try:
    resp = it_session.get(f"{BASE_URL}/member-checklist-submissions")
    if resp.status_code == 200:
        submissions = resp.json()
        # Check all submissions belong to Ajeet
        all_ajeet = True
        for sub in submissions:
            if sub.get('member_name') != 'Ajeet Kumar':
                all_ajeet = False
                results.add_fail("IT member submissions scope", 
                               f"Found submission from {sub.get('member_name')}, expected only 'Ajeet Kumar'")
                break
        
        if all_ajeet:
            results.add_pass("IT (Ajeet) GET /api/member-checklist-submissions returns ONLY own submissions",
                           f"All {len(submissions)} submissions have member_name == 'Ajeet Kumar'")
    else:
        results.add_fail("IT GET /api/member-checklist-submissions", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("IT GET /api/member-checklist-submissions", str(e))

# 3.3 As Employee: GET /api/member-checklist-submissions returns 403
try:
    resp = employee_session.get(f"{BASE_URL}/member-checklist-submissions")
    if resp.status_code == 403:
        results.add_pass("Employee GET /api/member-checklist-submissions returns 403")
    else:
        results.add_fail("Employee member submissions RBAC", f"Expected 403, got {resp.status_code}")
except Exception as e:
    results.add_fail("Employee member submissions RBAC", str(e))

# 3.4 As Superadmin: GET /api/member-checklist-submissions returns submissions across members
try:
    resp = superadmin_session.get(f"{BASE_URL}/member-checklist-submissions")
    if resp.status_code == 200:
        submissions = resp.json()
        member_names = set(sub.get('member_name') for sub in submissions)
        # Should include Ajeet's submission from earlier
        if 'Ajeet Kumar' in member_names:
            results.add_pass("Superadmin GET /api/member-checklist-submissions returns submissions across members",
                           f"Found submissions from: {member_names}")
        else:
            results.add_fail("Superadmin member submissions", 
                           f"Expected to find Ajeet Kumar's submission, found: {member_names}")
    else:
        results.add_fail("Superadmin GET /api/member-checklist-submissions", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("Superadmin GET /api/member-checklist-submissions", str(e))

# 3.5 Verify daily-kra reflects Ajeet's submission
try:
    resp = superadmin_session.get(f"{BASE_URL}/reports/daily-kra")
    if resp.status_code == 200:
        data = resp.json()
        members = data.get('members', [])
        ajeet_data = next((m for m in members if m.get('member_name') == 'Ajeet Kumar'), None)
        if ajeet_data:
            if ajeet_data.get('done_items', 0) > 0 and ajeet_data.get('status') in ['Completed', 'Partial']:
                results.add_pass("Daily KRA reflects Ajeet's submission",
                               f"Ajeet: status={ajeet_data.get('status')}, done_items={ajeet_data.get('done_items')}")
            else:
                results.add_fail("Daily KRA Ajeet status", 
                               f"Expected done_items>0 and status Completed/Partial, got: {ajeet_data}")
        else:
            results.add_fail("Daily KRA Ajeet data", "Ajeet Kumar not found in daily-kra report")
    else:
        results.add_fail("Daily KRA verification", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("Daily KRA verification", str(e))

# ============================================================================
# 4. RAISE REQUEST FLOW (IT)
# ============================================================================
print("\n[4] RAISE REQUEST FLOW (IT)...")

# 4.1 As IT: POST /api/tickets with specific location
it_ticket = None
try:
    ticket_data = {
        "department": "IT",
        "category": "Software",
        "title": "Need paid IDE license",
        "priority": "High",
        "location": "Tulip - First Floor"
    }
    resp = it_session.post(f"{BASE_URL}/tickets", json=ticket_data)
    if resp.status_code == 200:
        it_ticket = resp.json()
        if it_ticket.get('human_id', '').startswith('IT-') and it_ticket.get('location') == 'Tulip - First Floor':
            results.add_pass("IT POST /api/tickets creates ticket with human_id IT-... and location 'Tulip - First Floor'",
                           f"Ticket: {it_ticket.get('human_id')}, Location: {it_ticket.get('location')}")
        else:
            results.add_fail("IT create ticket", 
                           f"Invalid human_id or location: {it_ticket.get('human_id')}, {it_ticket.get('location')}")
    else:
        results.add_fail("IT POST /api/tickets", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("IT POST /api/tickets", str(e))

# 4.2 As IT: POST /api/tickets/{id}/approval/submit
if it_ticket:
    try:
        approval_data = {
            "justification": "productivity",
            "requested_amount": 5000,
            "vendor": "JetBrains",
            "required_by": "2026-08-15"
        }
        resp = it_session.post(f"{BASE_URL}/tickets/{it_ticket['id']}/approval/submit", json=approval_data)
        if resp.status_code == 200:
            # Check ticket status changed
            resp = it_session.get(f"{BASE_URL}/tickets/{it_ticket['id']}")
            if resp.status_code == 200:
                updated = resp.json()
                if updated.get('status') == 'Pending Super Admin Approval':
                    # Check approval has human_id starting with APR-
                    approval = updated.get('approval')
                    if approval and approval.get('human_id', '').startswith('APR-'):
                        results.add_pass("IT POST /api/tickets/{id}/approval/submit succeeds",
                                       f"Status: 'Pending Super Admin Approval', Approval ID: {approval.get('human_id')}")
                    else:
                        results.add_fail("IT approval submit - approval ID", 
                                       f"Approval human_id doesn't start with APR-: {approval}")
                else:
                    results.add_fail("IT approval submit - status", 
                                   f"Expected 'Pending Super Admin Approval', got: {updated.get('status')}")
            else:
                results.add_fail("IT approval submit - verify", f"Status {resp.status_code}")
        else:
            results.add_fail("IT POST /api/tickets/{id}/approval/submit", f"Status {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("IT approval submit", str(e))

# 4.3 As Superadmin: GET /api/tickets?department=IT&status=Pending Super Admin Approval
if it_ticket:
    try:
        resp = superadmin_session.get(f"{BASE_URL}/tickets?department=IT&status=Pending%20Super%20Admin%20Approval")
        if resp.status_code == 200:
            data = resp.json()
            tickets = data.get('items', [])
            # Check if our ticket is in the list
            found = any(t.get('id') == it_ticket['id'] for t in tickets)
            if found:
                results.add_pass("Superadmin GET /api/tickets?department=IT&status=Pending Super Admin Approval includes IT ticket",
                               f"Found {len(tickets)} pending approval tickets including our test ticket")
            else:
                results.add_fail("Superadmin filter pending approvals", 
                               f"IT ticket {it_ticket.get('human_id')} not found in pending approvals")
        else:
            results.add_fail("Superadmin GET pending approvals", f"Status {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("Superadmin GET pending approvals", str(e))

# ============================================================================
# SUMMARY
# ============================================================================
results.summary()
