#!/usr/bin/env python3
"""
TicketFlow Backend API Test Suite
Tests all backend endpoints with RBAC, IDOR protection, and approval workflow
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
        print("TEST SUMMARY")
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

def logout(session: requests.Session):
    """Logout"""
    session.post(f"{BASE_URL}/auth/logout")

print("="*80)
print("TICKETFLOW BACKEND API TEST SUITE")
print("="*80)

# ============================================================================
# 1. SEED DATA (idempotent)
# ============================================================================
print("\n[1] SEEDING DATA...")
try:
    resp = requests.post(f"{BASE_URL}/seed")
    if resp.status_code == 200:
        data = resp.json()
        if data.get("seeded") == True or data.get("seeded") == False:
            results.add_pass("Seed endpoint idempotent")
            print(f"   Seed result: {data}")
        else:
            results.add_fail("Seed endpoint", f"Unexpected response: {data}")
    else:
        results.add_fail("Seed endpoint", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("Seed endpoint", str(e))

# ============================================================================
# 2. AUTH TESTS
# ============================================================================
print("\n[2] AUTH TESTS...")

# 2.1 Login with valid credentials
try:
    session = requests.Session()
    resp = session.post(f"{BASE_URL}/auth/login", json={"email": "employee@demo.com", "password": "Passw0rd!"})
    if resp.status_code == 200 and resp.json().get("user"):
        user = resp.json()["user"]
        if "tf_token" in session.cookies:
            results.add_pass("Login with valid credentials returns 200 + user + sets cookie")
        else:
            results.add_fail("Login cookie", "tf_token cookie not set")
    else:
        results.add_fail("Login with valid credentials", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("Login with valid credentials", str(e))

# 2.2 Login with wrong password
try:
    session2 = requests.Session()
    resp = session2.post(f"{BASE_URL}/auth/login", json={"email": "employee@demo.com", "password": "WrongPassword"})
    if resp.status_code == 401:
        results.add_pass("Login with wrong password returns 401")
    else:
        results.add_fail("Login with wrong password", f"Expected 401, got {resp.status_code}")
except Exception as e:
    results.add_fail("Login with wrong password", str(e))

# 2.3 GET /auth/me with cookie
try:
    resp = session.get(f"{BASE_URL}/auth/me")
    if resp.status_code == 200 and resp.json().get("user"):
        results.add_pass("GET /auth/me returns logged-in user when cookie present")
    else:
        results.add_fail("GET /auth/me with cookie", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("GET /auth/me with cookie", str(e))

# 2.4 GET /auth/me without cookie
try:
    session_no_auth = requests.Session()
    resp = session_no_auth.get(f"{BASE_URL}/auth/me")
    if resp.status_code == 200 and resp.json().get("user") is None:
        results.add_pass("GET /auth/me returns {user:null} without cookie")
    else:
        results.add_fail("GET /auth/me without cookie", f"Expected user:null, got {resp.json()}")
except Exception as e:
    results.add_fail("GET /auth/me without cookie", str(e))

# 2.5 Logout clears session
try:
    resp = session.post(f"{BASE_URL}/auth/logout")
    if resp.status_code == 200:
        resp_me = session.get(f"{BASE_URL}/auth/me")
        if resp_me.json().get("user") is None:
            results.add_pass("POST /auth/logout clears session")
        else:
            results.add_fail("Logout", "Session not cleared after logout")
    else:
        results.add_fail("Logout", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("Logout", str(e))

# ============================================================================
# 3. RBAC SCOPING + IDOR TESTS
# ============================================================================
print("\n[3] RBAC SCOPING + IDOR TESTS...")

# Create sessions for each role
employee_session = requests.Session()
employee_user = login(employee_session, "employee")

it_session = requests.Session()
it_user = login(it_session, "it")

admin_session = requests.Session()
admin_user = login(admin_session, "admin")

superadmin_session = requests.Session()
superadmin_user = login(superadmin_session, "superadmin")

# 3.1 Employee can only see own tickets
try:
    resp = employee_session.get(f"{BASE_URL}/tickets")
    if resp.status_code == 200:
        tickets = resp.json().get("items", [])
        # All tickets should be raised by employee
        if all(t.get("raised_by_id") == employee_user["id"] for t in tickets):
            results.add_pass("GET /tickets as employee returns only own tickets")
        else:
            results.add_fail("Employee ticket scoping", "Employee can see tickets not raised by them")
    else:
        results.add_fail("Employee GET /tickets", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("Employee GET /tickets", str(e))

# 3.2 IT sees only IT department tickets
try:
    resp = it_session.get(f"{BASE_URL}/tickets")
    if resp.status_code == 200:
        tickets = resp.json().get("items", [])
        if all(t.get("department") == "IT" for t in tickets):
            results.add_pass("GET /tickets as IT returns only IT department tickets")
        else:
            results.add_fail("IT ticket scoping", "IT can see non-IT tickets")
    else:
        results.add_fail("IT GET /tickets", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("IT GET /tickets", str(e))

# 3.3 Admin sees only Admin department tickets
try:
    resp = admin_session.get(f"{BASE_URL}/tickets")
    if resp.status_code == 200:
        tickets = resp.json().get("items", [])
        if all(t.get("department") == "Admin" for t in tickets):
            results.add_pass("GET /tickets as Admin returns only Admin department tickets")
        else:
            results.add_fail("Admin ticket scoping", "Admin can see non-Admin tickets")
    else:
        results.add_fail("Admin GET /tickets", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("Admin GET /tickets", str(e))

# 3.4 Super admin sees all tickets
try:
    resp = superadmin_session.get(f"{BASE_URL}/tickets")
    if resp.status_code == 200:
        tickets = resp.json().get("items", [])
        departments = set(t.get("department") for t in tickets)
        if "IT" in departments and "Admin" in departments:
            results.add_pass("GET /tickets as super_admin returns all tickets")
        else:
            results.add_fail("Super admin ticket scoping", f"Only saw departments: {departments}")
    else:
        results.add_fail("Super admin GET /tickets", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("Super admin GET /tickets", str(e))

# 3.5 Unauthenticated request returns 401
try:
    unauth_session = requests.Session()
    resp = unauth_session.get(f"{BASE_URL}/tickets")
    if resp.status_code == 401:
        results.add_pass("Unauthenticated request to /tickets returns 401")
    else:
        results.add_fail("Unauthenticated /tickets", f"Expected 401, got {resp.status_code}")
except Exception as e:
    results.add_fail("Unauthenticated /tickets", str(e))

# 3.6 IDOR: Employee cannot access ticket not raised by them
try:
    # Get an IT ticket NOT raised by employee
    resp = it_session.get(f"{BASE_URL}/tickets")
    it_tickets = resp.json().get("items", [])
    # Filter out tickets raised by employee
    non_employee_tickets = [t for t in it_tickets if t.get("raised_by_id") != employee_user["id"]]
    if non_employee_tickets:
        it_ticket_id = non_employee_tickets[0]["id"]
        # Try to access as employee
        resp = employee_session.get(f"{BASE_URL}/tickets/{it_ticket_id}")
        if resp.status_code == 403:
            results.add_pass("IDOR: Employee cannot access ticket not raised by them (403)")
        else:
            results.add_fail("IDOR employee", f"Expected 403, got {resp.status_code}")
    else:
        # If all IT tickets are raised by employee, create one as IT user
        resp = it_session.post(f"{BASE_URL}/tickets", json={
            "department": "IT",
            "category": "Hardware",
            "title": "Test ticket for IDOR",
            "description": "This ticket is raised by IT for testing",
            "priority": "Low",
            "raised_for_name": "IT Staff"
        })
        if resp.status_code == 200:
            it_ticket_id = resp.json()["id"]
            resp = employee_session.get(f"{BASE_URL}/tickets/{it_ticket_id}")
            if resp.status_code == 403:
                results.add_pass("IDOR: Employee cannot access ticket not raised by them (403)")
            else:
                results.add_fail("IDOR employee", f"Expected 403, got {resp.status_code}")
        else:
            results.add_fail("IDOR employee test", "Could not create test ticket")
except Exception as e:
    results.add_fail("IDOR employee", str(e))

# 3.7 IDOR: IT cannot access Admin ticket
try:
    resp = admin_session.get(f"{BASE_URL}/tickets")
    admin_tickets = resp.json().get("items", [])
    if admin_tickets:
        admin_ticket_id = admin_tickets[0]["id"]
        # Try to access as IT
        resp = it_session.get(f"{BASE_URL}/tickets/{admin_ticket_id}")
        if resp.status_code == 403:
            results.add_pass("IDOR: IT cannot access Admin department ticket (403)")
        else:
            results.add_fail("IDOR IT->Admin", f"Expected 403, got {resp.status_code}")
    else:
        results.add_fail("IDOR IT->Admin test", "No Admin tickets found")
except Exception as e:
    results.add_fail("IDOR IT->Admin", str(e))

# 3.8 IDOR: Admin cannot access IT ticket
try:
    resp = it_session.get(f"{BASE_URL}/tickets")
    it_tickets = resp.json().get("items", [])
    if it_tickets:
        it_ticket_id = it_tickets[0]["id"]
        # Try to access as Admin
        resp = admin_session.get(f"{BASE_URL}/tickets/{it_ticket_id}")
        if resp.status_code == 403:
            results.add_pass("IDOR: Admin cannot access IT department ticket (403)")
        else:
            results.add_fail("IDOR Admin->IT", f"Expected 403, got {resp.status_code}")
    else:
        results.add_fail("IDOR Admin->IT test", "No IT tickets found")
except Exception as e:
    results.add_fail("IDOR Admin->IT", str(e))

# ============================================================================
# 4. TICKET LIFECYCLE TESTS
# ============================================================================
print("\n[4] TICKET LIFECYCLE TESTS...")

# 4.1 Employee creates IT ticket
created_ticket = None
try:
    ticket_data = {
        "department": "IT",
        "category": "Network/Wi-Fi",
        "title": "WiFi connectivity issues in conference room",
        "description": "Unable to connect to WiFi network in conference room B. Connection drops frequently.",
        "priority": "High"
    }
    resp = employee_session.get(f"{BASE_URL}/auth/me")
    employee_user = resp.json()["user"]
    
    resp = employee_session.post(f"{BASE_URL}/tickets", json=ticket_data)
    if resp.status_code == 200:
        created_ticket = resp.json()
        if created_ticket.get("human_id", "").startswith("IT-") and created_ticket.get("status") == "Open":
            results.add_pass("Employee creates IT ticket with human_id IT-DDMMYY-000xxx and status Open")
        else:
            results.add_fail("Employee create ticket", f"Invalid human_id or status: {created_ticket}")
    else:
        results.add_fail("Employee create ticket", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("Employee create ticket", str(e))

# 4.2 IT assigns ticket
if created_ticket:
    try:
        resp = it_session.get(f"{BASE_URL}/auth/me")
        it_user = resp.json()["user"]
        
        resp = it_session.patch(f"{BASE_URL}/tickets/{created_ticket['id']}", json={"assignee_id": it_user["id"]})
        if resp.status_code == 200:
            updated = resp.json()
            if updated.get("assignee_id") == it_user["id"] and updated.get("status") == "Assigned":
                results.add_pass("IT assigns ticket: sets assignee and moves Open->Assigned")
            else:
                results.add_fail("IT assign ticket", f"Status not Assigned or assignee not set: {updated}")
        else:
            results.add_fail("IT assign ticket", f"Status {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("IT assign ticket", str(e))

# 4.3 IT changes priority
if created_ticket:
    try:
        resp = it_session.patch(f"{BASE_URL}/tickets/{created_ticket['id']}", json={"priority": "Critical"})
        if resp.status_code == 200:
            updated = resp.json()
            if updated.get("priority") == "Critical":
                results.add_pass("IT changes ticket priority")
            else:
                results.add_fail("IT change priority", f"Priority not updated: {updated}")
        else:
            results.add_fail("IT change priority", f"Status {resp.status_code}")
    except Exception as e:
        results.add_fail("IT change priority", str(e))

# 4.4 IT changes status to In Progress
if created_ticket:
    try:
        resp = it_session.patch(f"{BASE_URL}/tickets/{created_ticket['id']}", json={"status": "In Progress"})
        if resp.status_code == 200:
            updated = resp.json()
            if updated.get("status") == "In Progress":
                results.add_pass("IT changes status to In Progress")
            else:
                results.add_fail("IT status In Progress", f"Status not updated: {updated}")
        else:
            results.add_fail("IT status In Progress", f"Status {resp.status_code}")
    except Exception as e:
        results.add_fail("IT status In Progress", str(e))

# 4.5 IT resolves ticket
if created_ticket:
    try:
        resolution = {
            "summary": "WiFi router rebooted and firmware updated",
            "action_taken": "Rebooted router, updated firmware to latest version, tested connectivity",
            "root_cause": "Outdated firmware causing connection drops"
        }
        resp = it_session.patch(f"{BASE_URL}/tickets/{created_ticket['id']}", json={"resolution": resolution})
        if resp.status_code == 200:
            updated = resp.json()
            if updated.get("status") == "Resolved" and updated.get("resolution"):
                results.add_pass("IT resolves ticket with resolution")
            else:
                results.add_fail("IT resolve ticket", f"Status not Resolved: {updated}")
        else:
            results.add_fail("IT resolve ticket", f"Status {resp.status_code}")
    except Exception as e:
        results.add_fail("IT resolve ticket", str(e))

# 4.6 GET ticket detail includes history and comments
if created_ticket:
    try:
        resp = employee_session.get(f"{BASE_URL}/tickets/{created_ticket['id']}")
        if resp.status_code == 200:
            detail = resp.json()
            if "history" in detail and "comments" in detail:
                results.add_pass("GET /tickets/:id returns history[] and comments[]")
            else:
                results.add_fail("Ticket detail", f"Missing history or comments: {detail.keys()}")
        else:
            results.add_fail("Ticket detail", f"Status {resp.status_code}")
    except Exception as e:
        results.add_fail("Ticket detail", str(e))

# 4.7 IT adds internal comment
if created_ticket:
    try:
        comment_data = {"type": "internal", "body": "Internal note: Router firmware was 2 years old"}
        resp = it_session.post(f"{BASE_URL}/tickets/{created_ticket['id']}/comments", json=comment_data)
        if resp.status_code == 200:
            results.add_pass("IT adds internal comment")
        else:
            results.add_fail("IT internal comment", f"Status {resp.status_code}")
    except Exception as e:
        results.add_fail("IT internal comment", str(e))

# 4.8 Employee cannot see internal comments
if created_ticket:
    try:
        resp = employee_session.get(f"{BASE_URL}/tickets/{created_ticket['id']}")
        if resp.status_code == 200:
            detail = resp.json()
            comments = detail.get("comments", [])
            internal_comments = [c for c in comments if c.get("type") == "internal"]
            if len(internal_comments) == 0:
                results.add_pass("Employee cannot see internal comments")
            else:
                results.add_fail("Employee internal comments", f"Employee can see {len(internal_comments)} internal comments")
        else:
            results.add_fail("Employee view comments", f"Status {resp.status_code}")
    except Exception as e:
        results.add_fail("Employee view comments", str(e))

# 4.9 Employee confirms ticket with rating
if created_ticket:
    try:
        confirm_data = {"action": "confirm", "rating": 5, "comment": "Issue resolved quickly, thank you!"}
        resp = employee_session.post(f"{BASE_URL}/tickets/{created_ticket['id']}/confirm", json=confirm_data)
        if resp.status_code == 200:
            updated = resp.json()
            if updated.get("status") == "Closed":
                results.add_pass("Employee confirms ticket: moves to Closed with rating")
            else:
                results.add_fail("Employee confirm", f"Status not Closed: {updated}")
        else:
            results.add_fail("Employee confirm", f"Status {resp.status_code}")
    except Exception as e:
        results.add_fail("Employee confirm", str(e))

# 4.10 Employee reopens ticket
# Create another ticket to test reopen
try:
    ticket_data = {
        "department": "IT",
        "category": "Hardware",
        "title": "Laptop keyboard not working",
        "description": "Several keys on laptop keyboard are not responding",
        "priority": "Medium"
    }
    resp = employee_session.post(f"{BASE_URL}/tickets", json=ticket_data)
    if resp.status_code == 200:
        reopen_ticket = resp.json()
        # IT resolves it
        resp = it_session.get(f"{BASE_URL}/auth/me")
        it_user = resp.json()["user"]
        it_session.patch(f"{BASE_URL}/tickets/{reopen_ticket['id']}", json={"assignee_id": it_user["id"]})
        it_session.patch(f"{BASE_URL}/tickets/{reopen_ticket['id']}", json={"resolution": {"summary": "Keyboard replaced"}})
        
        # Employee reopens
        reopen_data = {"action": "reopen", "comment": "Issue still persists"}
        resp = employee_session.post(f"{BASE_URL}/tickets/{reopen_ticket['id']}/confirm", json=reopen_data)
        if resp.status_code == 200:
            updated = resp.json()
            if updated.get("status") == "Reopened":
                results.add_pass("Employee reopens ticket: moves to Reopened")
            else:
                results.add_fail("Employee reopen", f"Status not Reopened: {updated}")
        else:
            results.add_fail("Employee reopen", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("Employee reopen", str(e))

# ============================================================================
# 5. ADMIN APPROVAL WORKFLOW TESTS
# ============================================================================
print("\n[5] ADMIN APPROVAL WORKFLOW TESTS...")

# 5.1 Find the seeded Admin approval ticket
approval_ticket = None
try:
    resp = admin_session.get(f"{BASE_URL}/tickets")
    admin_tickets = resp.json().get("items", [])
    for t in admin_tickets:
        if "printer procurement" in t.get("title", "").lower() and t.get("status") == "Approval Preparation":
            approval_ticket = t
            break
    
    if approval_ticket:
        results.add_pass("Found seeded Admin approval ticket 'New printer procurement for HQ2'")
    else:
        results.add_fail("Find approval ticket", "Could not find seeded approval ticket")
except Exception as e:
    results.add_fail("Find approval ticket", str(e))

# 5.2 Admin cannot move to In Progress before approval
if approval_ticket:
    try:
        resp = admin_session.patch(f"{BASE_URL}/tickets/{approval_ticket['id']}", json={"status": "In Progress"})
        if resp.status_code == 400:
            results.add_pass("Admin blocked from In Progress before approval (400)")
        else:
            results.add_fail("Block execution before approval", f"Expected 400, got {resp.status_code}")
    except Exception as e:
        results.add_fail("Block execution before approval", str(e))

# 5.3 Admin submits approval
if approval_ticket:
    try:
        approval_data = {
            "justification": "Current printer is beyond repair, replacement needed urgently",
            "requested_amount": 50000,
            "vendor": "HP Enterprise Solutions",
            "required_by": "2025-02-15"
        }
        resp = admin_session.post(f"{BASE_URL}/tickets/{approval_ticket['id']}/approval/submit", json=approval_data)
        if resp.status_code == 200:
            # Check ticket status changed
            resp = admin_session.get(f"{BASE_URL}/tickets/{approval_ticket['id']}")
            if resp.status_code == 200:
                updated = resp.json()
                if updated.get("status") == "Pending Super Admin Approval":
                    results.add_pass("Admin submits approval: status -> Pending Super Admin Approval")
                else:
                    results.add_fail("Admin submit approval", f"Status not updated: {updated.get('status')}")
            else:
                results.add_fail("Admin submit approval check", f"Status {resp.status_code}")
        else:
            results.add_fail("Admin submit approval", f"Status {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("Admin submit approval", str(e))

# 5.4 Super admin decision without remarks (clarify) should fail
if approval_ticket:
    try:
        resp = superadmin_session.post(f"{BASE_URL}/tickets/{approval_ticket['id']}/approval/decision", 
                                       json={"decision": "clarify"})
        if resp.status_code == 400:
            results.add_pass("Super admin decision 'clarify' without remarks returns 400")
        else:
            results.add_fail("Decision without remarks", f"Expected 400, got {resp.status_code}")
    except Exception as e:
        results.add_fail("Decision without remarks", str(e))

# 5.5 Super admin decision with remarks (clarify)
if approval_ticket:
    try:
        resp = superadmin_session.post(f"{BASE_URL}/tickets/{approval_ticket['id']}/approval/decision",
                                       json={"decision": "clarify", "remarks": "Please provide 3 vendor quotes for comparison"})
        if resp.status_code == 200:
            # Check status
            resp = admin_session.get(f"{BASE_URL}/tickets/{approval_ticket['id']}")
            if resp.status_code == 200:
                updated = resp.json()
                if updated.get("status") == "Clarification Required":
                    results.add_pass("Super admin clarify decision: status -> Clarification Required")
                else:
                    results.add_fail("Clarify decision", f"Status not updated: {updated.get('status')}")
        else:
            results.add_fail("Clarify decision", f"Status {resp.status_code}")
    except Exception as e:
        results.add_fail("Clarify decision", str(e))

# 5.6 Admin resubmits approval
if approval_ticket:
    try:
        approval_data = {
            "justification": "Quotes from HP, Canon, and Epson attached. HP offers best value.",
            "requested_amount": 50000,
            "vendor": "HP Enterprise Solutions",
            "required_by": "2025-02-15"
        }
        resp = admin_session.post(f"{BASE_URL}/tickets/{approval_ticket['id']}/approval/submit", json=approval_data)
        if resp.status_code == 200:
            resp = admin_session.get(f"{BASE_URL}/tickets/{approval_ticket['id']}")
            if resp.status_code == 200:
                updated = resp.json()
                if updated.get("status") == "Pending Super Admin Approval":
                    results.add_pass("Admin resubmits approval: status -> Pending again")
                else:
                    results.add_fail("Resubmit approval", f"Status: {updated.get('status')}")
        else:
            results.add_fail("Resubmit approval", f"Status {resp.status_code}")
    except Exception as e:
        results.add_fail("Resubmit approval", str(e))

# 5.7 Super admin partial approval
if approval_ticket:
    try:
        resp = superadmin_session.post(f"{BASE_URL}/tickets/{approval_ticket['id']}/approval/decision",
                                       json={"decision": "partial", "approved_amount": 40000, 
                                             "remarks": "Approved 40K, negotiate better pricing"})
        if resp.status_code == 200:
            resp = admin_session.get(f"{BASE_URL}/tickets/{approval_ticket['id']}")
            if resp.status_code == 200:
                updated = resp.json()
                if updated.get("status") == "Approved - Ready for Action":
                    # Check approval has approved_amount
                    if updated.get("approval") and updated["approval"].get("approved_amount") == 40000:
                        results.add_pass("Super admin partial approval: status -> Approved - Ready for Action, approved_amount stored")
                    else:
                        results.add_fail("Partial approval amount", f"approved_amount not stored correctly")
                else:
                    results.add_fail("Partial approval", f"Status: {updated.get('status')}")
        else:
            results.add_fail("Partial approval", f"Status {resp.status_code}")
    except Exception as e:
        results.add_fail("Partial approval", str(e))

# 5.8 Admin can now move to In Progress (approval granted)
if approval_ticket:
    try:
        resp = admin_session.patch(f"{BASE_URL}/tickets/{approval_ticket['id']}", json={"status": "In Progress"})
        if resp.status_code == 200:
            updated = resp.json()
            if updated.get("status") == "In Progress":
                results.add_pass("Admin moves to In Progress after approval granted")
            else:
                results.add_fail("In Progress after approval", f"Status: {updated.get('status')}")
        else:
            results.add_fail("In Progress after approval", f"Status {resp.status_code}")
    except Exception as e:
        results.add_fail("In Progress after approval", str(e))

# 5.9 Admin resolves ticket
if approval_ticket:
    try:
        resolution = {
            "summary": "Printer procured and installed at HQ2",
            "action_taken": "Purchased HP LaserJet Pro within approved budget, installed and configured",
            "root_cause": "Old printer hardware failure"
        }
        resp = admin_session.patch(f"{BASE_URL}/tickets/{approval_ticket['id']}", json={"resolution": resolution})
        if resp.status_code == 200:
            updated = resp.json()
            if updated.get("status") == "Resolved":
                results.add_pass("Admin resolves approved ticket")
            else:
                results.add_fail("Resolve approved ticket", f"Status: {updated.get('status')}")
        else:
            results.add_fail("Resolve approved ticket", f"Status {resp.status_code}")
    except Exception as e:
        results.add_fail("Resolve approved ticket", str(e))

# 5.10 RBAC: Employee cannot submit approval
if approval_ticket:
    try:
        resp = employee_session.post(f"{BASE_URL}/tickets/{approval_ticket['id']}/approval/submit",
                                     json={"justification": "test", "requested_amount": 1000})
        if resp.status_code == 403:
            results.add_pass("RBAC: Employee cannot submit approval (403)")
        else:
            results.add_fail("RBAC employee approval submit", f"Expected 403, got {resp.status_code}")
    except Exception as e:
        results.add_fail("RBAC employee approval submit", str(e))

# 5.11 RBAC: IT cannot submit approval
if approval_ticket:
    try:
        resp = it_session.post(f"{BASE_URL}/tickets/{approval_ticket['id']}/approval/submit",
                               json={"justification": "test", "requested_amount": 1000})
        if resp.status_code == 403:
            results.add_pass("RBAC: IT cannot submit approval (403)")
        else:
            results.add_fail("RBAC IT approval submit", f"Expected 403, got {resp.status_code}")
    except Exception as e:
        results.add_fail("RBAC IT approval submit", str(e))

# 5.12 RBAC: Admin cannot make decision
if approval_ticket:
    try:
        resp = admin_session.post(f"{BASE_URL}/tickets/{approval_ticket['id']}/approval/decision",
                                  json={"decision": "approve", "remarks": "test"})
        if resp.status_code == 403:
            results.add_pass("RBAC: Admin cannot make approval decision (403)")
        else:
            results.add_fail("RBAC admin approval decision", f"Expected 403, got {resp.status_code}")
    except Exception as e:
        results.add_fail("RBAC admin approval decision", str(e))

# 5.13 RBAC: Super admin cannot submit approval
if approval_ticket:
    try:
        resp = superadmin_session.post(f"{BASE_URL}/tickets/{approval_ticket['id']}/approval/submit",
                                       json={"justification": "test", "requested_amount": 1000})
        if resp.status_code == 403:
            results.add_pass("RBAC: Super admin cannot submit approval (403)")
        else:
            results.add_fail("RBAC superadmin approval submit", f"Expected 403, got {resp.status_code}")
    except Exception as e:
        results.add_fail("RBAC superadmin approval submit", str(e))

# ============================================================================
# 6. TASKS / CHECKLISTS / NOTIFICATIONS / AUDIT / DASHBOARD
# ============================================================================
print("\n[6] TASKS / CHECKLISTS / NOTIFICATIONS / AUDIT / DASHBOARD...")

# 6.1 GET /tasks as admin
try:
    resp = admin_session.get(f"{BASE_URL}/tasks")
    if resp.status_code == 200:
        tasks = resp.json()
        if len(tasks) >= 13:
            results.add_pass("GET /tasks as admin returns tasks (13 seeded)")
        else:
            results.add_fail("GET /tasks", f"Expected 13+ tasks, got {len(tasks)}")
    else:
        results.add_fail("GET /tasks", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("GET /tasks", str(e))

# 6.2 GET /tasks as employee returns 403
try:
    resp = employee_session.get(f"{BASE_URL}/tasks")
    if resp.status_code == 403:
        results.add_pass("GET /tasks as employee returns 403")
    else:
        results.add_fail("Tasks employee RBAC", f"Expected 403, got {resp.status_code}")
except Exception as e:
    results.add_fail("Tasks employee RBAC", str(e))

# 6.3 POST /tasks as admin
try:
    task_data = {
        "title": "Monthly inventory audit",
        "category": "Inventory",
        "location": "HQ1",
        "recurrence": "monthly",
        "priority": "High",
        "due_date": "2025-02-28"
    }
    resp = admin_session.post(f"{BASE_URL}/tasks", json=task_data)
    if resp.status_code == 200:
        task = resp.json()
        if task.get("human_id", "").startswith("ATSK-"):
            results.add_pass("POST /tasks as admin creates task with human_id ATSK-...")
        else:
            results.add_fail("Create task", f"Invalid human_id: {task}")
    else:
        results.add_fail("Create task", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("Create task", str(e))

# 6.4 PATCH /tasks updates status
try:
    resp = admin_session.get(f"{BASE_URL}/tasks")
    tasks = resp.json()
    if tasks:
        task_id = tasks[0]["id"]
        resp = admin_session.patch(f"{BASE_URL}/tasks/{task_id}", json={"status": "Completed"})
        if resp.status_code == 200:
            updated = resp.json()
            if updated.get("status") == "Completed":
                results.add_pass("PATCH /tasks updates status")
            else:
                results.add_fail("Update task status", f"Status not updated: {updated}")
        else:
            results.add_fail("Update task", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("Update task", str(e))

# 6.5 GET /checklists/templates as admin
try:
    resp = admin_session.get(f"{BASE_URL}/checklists/templates")
    if resp.status_code == 200:
        templates = resp.json()
        if len(templates) >= 3:  # 3 locations
            results.add_pass("GET /checklists/templates returns templates")
        else:
            results.add_fail("Checklist templates", f"Expected 3+ templates, got {len(templates)}")
    else:
        results.add_fail("Checklist templates", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("Checklist templates", str(e))

# 6.6 POST /checklists/executions creates execution
try:
    resp = admin_session.get(f"{BASE_URL}/checklists/templates")
    templates = resp.json()
    if templates:
        template_id = templates[0]["id"]
        resp = admin_session.post(f"{BASE_URL}/checklists/executions", json={"template_id": template_id})
        if resp.status_code == 200:
            execution = resp.json()
            if execution.get("human_id", "").startswith("CHK-"):
                results.add_pass("POST /checklists/executions creates execution with human_id CHK-...")
            else:
                results.add_fail("Create checklist execution", f"Invalid human_id: {execution}")
        else:
            results.add_fail("Create checklist execution", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("Create checklist execution", str(e))

# 6.7 POST /checklists/to-ticket creates Admin ticket
try:
    ticket_data = {
        "item": "Air conditioning not working",
        "remarks": "AC unit in conference room not cooling",
        "priority": "High",
        "location": "HQ1"
    }
    resp = admin_session.post(f"{BASE_URL}/checklists/to-ticket", json=ticket_data)
    if resp.status_code == 200:
        ticket = resp.json()
        if ticket.get("department") == "Admin" and ticket.get("human_id", "").startswith("ADM-"):
            results.add_pass("POST /checklists/to-ticket creates Admin ticket")
        else:
            results.add_fail("Checklist to ticket", f"Invalid ticket: {ticket}")
    else:
        results.add_fail("Checklist to ticket", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("Checklist to ticket", str(e))

# 6.8 GET /notifications returns current user's notifications
try:
    resp = admin_session.get(f"{BASE_URL}/notifications")
    if resp.status_code == 200:
        notifications = resp.json()
        results.add_pass("GET /notifications returns notifications")
    else:
        results.add_fail("Get notifications", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("Get notifications", str(e))

# 6.9 POST /notifications/read marks read
try:
    resp = admin_session.post(f"{BASE_URL}/notifications/read")
    if resp.status_code == 200:
        results.add_pass("POST /notifications/read marks notifications as read")
    else:
        results.add_fail("Mark notifications read", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("Mark notifications read", str(e))

# 6.10 GET /audit as super_admin
try:
    resp = superadmin_session.get(f"{BASE_URL}/audit")
    if resp.status_code == 200:
        audit_logs = resp.json()
        if len(audit_logs) > 0:
            results.add_pass("GET /audit as super_admin returns audit entries")
        else:
            results.add_fail("Audit logs", "No audit entries found")
    else:
        results.add_fail("Audit logs", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("Audit logs", str(e))

# 6.11 GET /audit as non-super_admin returns 403
try:
    resp = admin_session.get(f"{BASE_URL}/audit")
    if resp.status_code == 403:
        results.add_pass("GET /audit as admin returns 403")
    else:
        results.add_fail("Audit RBAC", f"Expected 403, got {resp.status_code}")
except Exception as e:
    results.add_fail("Audit RBAC", str(e))

# 6.12 GET /dashboard returns role-scoped stats
try:
    resp = admin_session.get(f"{BASE_URL}/dashboard")
    if resp.status_code == 200:
        stats = resp.json()
        required_keys = ["total", "by_priority", "by_category", "recent"]
        if all(k in stats for k in required_keys):
            results.add_pass("GET /dashboard returns role-scoped stats")
        else:
            results.add_fail("Dashboard stats", f"Missing keys: {stats.keys()}")
    else:
        results.add_fail("Dashboard stats", f"Status {resp.status_code}")
except Exception as e:
    results.add_fail("Dashboard stats", str(e))

# ============================================================================
# SUMMARY
# ============================================================================
results.summary()
