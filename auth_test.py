#!/usr/bin/env python3
"""
TicketFlow Auth Test Suite - NEW @ethara.ai domain + register endpoint
Tests login domain enforcement, registration, and registered user functionality
"""
import requests
import json
from typing import Dict, Any

# Base URL from .env
BASE_URL = "https://ticket-flow-pro-8.preview.emergentagent.com/api"

# Seeded users with @ethara.ai domain
USERS = {
    "employee": {"email": "employee@ethara.ai", "password": "Passw0rd!"},
    "it": {"email": "it@ethara.ai", "password": "Passw0rd!"},
    "admin": {"email": "admin@ethara.ai", "password": "Passw0rd!"},
    "superadmin": {"email": "superadmin@ethara.ai", "password": "Passw0rd!"}
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
        print("AUTH TEST SUMMARY")
        print("="*80)
        print(f"Total Passed: {len(self.passed)}")
        print(f"Total Failed: {len(self.failed)}")
        if self.failed:
            print("\nFailed Tests:")
            for test_name, reason in self.failed:
                print(f"  ❌ {test_name}: {reason}")
        print("="*80)
        return len(self.failed) == 0

results = TestResult()

print("="*80)
print("TICKETFLOW AUTH TEST SUITE - @ethara.ai domain + register")
print("="*80)

# ============================================================================
# 1. LOGIN DOMAIN ENFORCEMENT
# ============================================================================
print("\n[1] LOGIN DOMAIN ENFORCEMENT...")

# 1.1 Login with valid @ethara.ai superadmin
try:
    session = requests.Session()
    resp = session.post(f"{BASE_URL}/auth/login", json={
        "email": "superadmin@ethara.ai",
        "password": "Passw0rd!"
    })
    if resp.status_code == 200:
        data = resp.json()
        user = data.get("user")
        if user and "tf_token" in session.cookies:
            results.add_pass(
                "Login @ethara.ai superadmin -> 200 + user + cookie",
                f"User: {user.get('name')}, Role: {user.get('role')}"
            )
        else:
            results.add_fail("Login superadmin", f"Missing user or cookie: {data}")
    else:
        results.add_fail("Login superadmin", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("Login superadmin", str(e))

# 1.2 Login with non-@ethara.ai domain (gmail.com) -> 400 with domain error
try:
    session2 = requests.Session()
    resp = session2.post(f"{BASE_URL}/auth/login", json={
        "email": "someone@gmail.com",
        "password": "x"
    })
    if resp.status_code == 400:
        data = resp.json()
        error_msg = data.get("error", "").lower()
        if "@ethara.ai" in error_msg or "ethara.ai" in error_msg:
            results.add_pass(
                "Login @gmail.com -> 400 with @ethara.ai error (domain checked BEFORE credentials)",
                f"Error: {data.get('error')}"
            )
        else:
            results.add_fail(
                "Login domain error message",
                f"Expected error mentioning @ethara.ai, got: {data.get('error')}"
            )
    else:
        results.add_fail(
            "Login domain enforcement",
            f"Expected 400, got {resp.status_code}: {resp.text}"
        )
except Exception as e:
    results.add_fail("Login domain enforcement", str(e))

# 1.3 Login with valid @ethara.ai but wrong password -> 401 invalid credentials
try:
    session3 = requests.Session()
    resp = session3.post(f"{BASE_URL}/auth/login", json={
        "email": "superadmin@ethara.ai",
        "password": "wrong"
    })
    if resp.status_code == 401:
        data = resp.json()
        error_msg = data.get("error", "").lower()
        if "invalid" in error_msg or "credential" in error_msg:
            results.add_pass(
                "Login @ethara.ai wrong password -> 401 invalid credentials",
                f"Error: {data.get('error')}"
            )
        else:
            results.add_fail(
                "Login invalid credentials message",
                f"Expected 'invalid credentials', got: {data.get('error')}"
            )
    else:
        results.add_fail(
            "Login wrong password",
            f"Expected 401, got {resp.status_code}: {resp.text}"
        )
except Exception as e:
    results.add_fail("Login wrong password", str(e))

# ============================================================================
# 2. REGISTER ENDPOINT
# ============================================================================
print("\n[2] REGISTER ENDPOINT...")

# 2.1 Register new employee with @ethara.ai
new_employee_session = requests.Session()
new_employee_email = "newemp1@ethara.ai"
try:
    resp = new_employee_session.post(f"{BASE_URL}/auth/register", json={
        "name": "New Emp",
        "email": new_employee_email,
        "password": "Passw0rd!",
        "role": "employee"
    })
    if resp.status_code == 200:
        data = resp.json()
        user = data.get("user")
        if user and user.get("role") == "employee" and user.get("department") == "General":
            if "tf_token" in new_employee_session.cookies:
                results.add_pass(
                    "Register employee -> 200, role=employee, department=General, sets cookie",
                    f"User: {user.get('name')}, Email: {user.get('email')}"
                )
                # Verify /auth/me returns the user
                resp_me = new_employee_session.get(f"{BASE_URL}/auth/me")
                if resp_me.status_code == 200 and resp_me.json().get("user"):
                    me_user = resp_me.json()["user"]
                    if me_user.get("email") == new_employee_email:
                        results.add_pass(
                            "GET /auth/me after register returns registered user",
                            f"Email: {me_user.get('email')}"
                        )
                    else:
                        results.add_fail("Auth/me after register", f"Wrong user: {me_user}")
                else:
                    results.add_fail("Auth/me after register", f"Status {resp_me.status_code}")
            else:
                results.add_fail("Register employee cookie", "tf_token cookie not set")
        else:
            results.add_fail("Register employee", f"Invalid role/department: {user}")
    else:
        results.add_fail("Register employee", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("Register employee", str(e))

# 2.2 Register new IT user
new_it_session = requests.Session()
new_it_email = "newit1@ethara.ai"
try:
    resp = new_it_session.post(f"{BASE_URL}/auth/register", json={
        "name": "New IT",
        "email": new_it_email,
        "password": "Passw0rd!",
        "role": "it"
    })
    if resp.status_code == 200:
        data = resp.json()
        user = data.get("user")
        if user and user.get("role") == "it" and user.get("department") == "IT":
            results.add_pass(
                "Register IT -> 200, role=it, department=IT",
                f"User: {user.get('name')}"
            )
        else:
            results.add_fail("Register IT", f"Invalid role/department: {user}")
    else:
        results.add_fail("Register IT", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("Register IT", str(e))

# 2.3 Register new Admin user
new_admin_session = requests.Session()
new_admin_email = "newadmin1@ethara.ai"
try:
    resp = new_admin_session.post(f"{BASE_URL}/auth/register", json={
        "name": "New Admin",
        "email": new_admin_email,
        "password": "Passw0rd!",
        "role": "admin"
    })
    if resp.status_code == 200:
        data = resp.json()
        user = data.get("user")
        if user and user.get("role") == "admin" and user.get("department") == "Admin":
            results.add_pass(
                "Register admin -> 200, role=admin, department=Admin",
                f"User: {user.get('name')}"
            )
        else:
            results.add_fail("Register admin", f"Invalid role/department: {user}")
    else:
        results.add_fail("Register admin", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("Register admin", str(e))

# 2.4 DOMAIN: Register with non-@ethara.ai domain -> 400
try:
    session_bad_domain = requests.Session()
    resp = session_bad_domain.post(f"{BASE_URL}/auth/register", json={
        "name": "X",
        "email": "x@gmail.com",
        "password": "Passw0rd!",
        "role": "employee"
    })
    if resp.status_code == 400:
        data = resp.json()
        error_msg = data.get("error", "").lower()
        if "@ethara.ai" in error_msg or "ethara.ai" in error_msg or "restricted" in error_msg:
            results.add_pass(
                "Register @gmail.com -> 400 (restricted to @ethara.ai)",
                f"Error: {data.get('error')}"
            )
        else:
            results.add_fail(
                "Register domain error",
                f"Expected error mentioning @ethara.ai, got: {data.get('error')}"
            )
    else:
        results.add_fail(
            "Register domain restriction",
            f"Expected 400, got {resp.status_code}: {resp.text}"
        )
except Exception as e:
    results.add_fail("Register domain restriction", str(e))

# 2.5 ROLE RESTRICTION: Register with super_admin role -> 400
try:
    session_super = requests.Session()
    resp = session_super.post(f"{BASE_URL}/auth/register", json={
        "name": "Hacker",
        "email": "hacker@ethara.ai",
        "password": "Passw0rd!",
        "role": "super_admin"
    })
    if resp.status_code == 400:
        data = resp.json()
        error_msg = data.get("error", "").lower()
        if "role" in error_msg or "valid" in error_msg:
            results.add_pass(
                "Register super_admin role -> 400 (not allowed to self-register)",
                f"Error: {data.get('error')}"
            )
        else:
            results.add_fail(
                "Register super_admin error",
                f"Expected role error, got: {data.get('error')}"
            )
    else:
        results.add_fail(
            "Register super_admin restriction",
            f"Expected 400, got {resp.status_code}: {resp.text}"
        )
except Exception as e:
    results.add_fail("Register super_admin restriction", str(e))

# 2.6 PASSWORD: Register with short password -> 400
try:
    session_short_pwd = requests.Session()
    resp = session_short_pwd.post(f"{BASE_URL}/auth/register", json={
        "name": "Short",
        "email": "short@ethara.ai",
        "password": "123",
        "role": "employee"
    })
    if resp.status_code == 400:
        data = resp.json()
        error_msg = data.get("error", "").lower()
        if "password" in error_msg or "6" in error_msg or "character" in error_msg:
            results.add_pass(
                "Register short password -> 400 (min 6 chars)",
                f"Error: {data.get('error')}"
            )
        else:
            results.add_fail(
                "Register password error",
                f"Expected password length error, got: {data.get('error')}"
            )
    else:
        results.add_fail(
            "Register password validation",
            f"Expected 400, got {resp.status_code}: {resp.text}"
        )
except Exception as e:
    results.add_fail("Register password validation", str(e))

# 2.7 DUPLICATE: Register with existing email -> 409
try:
    session_dup = requests.Session()
    resp = session_dup.post(f"{BASE_URL}/auth/register", json={
        "name": "Duplicate",
        "email": new_employee_email,  # Already registered above
        "password": "Passw0rd!",
        "role": "employee"
    })
    if resp.status_code == 409:
        data = resp.json()
        error_msg = data.get("error", "").lower()
        if "exist" in error_msg or "already" in error_msg:
            results.add_pass(
                "Register duplicate email -> 409 (already exists)",
                f"Error: {data.get('error')}"
            )
        else:
            results.add_fail(
                "Register duplicate error",
                f"Expected 'already exists' error, got: {data.get('error')}"
            )
    else:
        results.add_fail(
            "Register duplicate check",
            f"Expected 409, got {resp.status_code}: {resp.text}"
        )
except Exception as e:
    results.add_fail("Register duplicate check", str(e))

# ============================================================================
# 3. REGISTERED USER FUNCTIONALITY
# ============================================================================
print("\n[3] REGISTERED USER FUNCTIONALITY...")

# 3.1 Login as newly registered IT user and verify RBAC
try:
    # Login as newit1@ethara.ai
    it_login_session = requests.Session()
    resp = it_login_session.post(f"{BASE_URL}/auth/login", json={
        "email": new_it_email,
        "password": "Passw0rd!"
    })
    if resp.status_code == 200:
        results.add_pass(
            "Login as newly registered IT user -> 200",
            f"Email: {new_it_email}"
        )
        
        # GET /tickets should return only IT department tickets
        resp_tickets = it_login_session.get(f"{BASE_URL}/tickets")
        if resp_tickets.status_code == 200:
            tickets = resp_tickets.json().get("items", [])
            # All tickets should be IT department
            non_it_tickets = [t for t in tickets if t.get("department") != "IT"]
            if len(non_it_tickets) == 0:
                results.add_pass(
                    "Registered IT user GET /tickets returns only IT department tickets",
                    f"Total tickets: {len(tickets)}, All IT department"
                )
            else:
                results.add_fail(
                    "Registered IT user ticket scoping",
                    f"Found {len(non_it_tickets)} non-IT tickets"
                )
        else:
            results.add_fail("Registered IT GET /tickets", f"Status {resp_tickets.status_code}")
        
        # GET /reports/member-sla should return 403 (not super_admin)
        resp_sla = it_login_session.get(f"{BASE_URL}/reports/member-sla?department=IT")
        if resp_sla.status_code == 403:
            results.add_pass(
                "Registered IT user GET /reports/member-sla -> 403 (not super_admin)",
                "RBAC working correctly"
            )
        else:
            results.add_fail(
                "Registered IT user SLA report RBAC",
                f"Expected 403, got {resp_sla.status_code}"
            )
    else:
        results.add_fail("Login registered IT user", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("Registered IT user functionality", str(e))

# 3.2 Login as newly registered employee and verify RBAC
try:
    # Login as newemp1@ethara.ai
    emp_login_session = requests.Session()
    resp = emp_login_session.post(f"{BASE_URL}/auth/login", json={
        "email": new_employee_email,
        "password": "Passw0rd!"
    })
    if resp.status_code == 200:
        results.add_pass(
            "Login as newly registered employee -> 200",
            f"Email: {new_employee_email}"
        )
        
        # GET /tickets should return only own tickets (should be empty array)
        resp_tickets = emp_login_session.get(f"{BASE_URL}/tickets")
        if resp_tickets.status_code == 200:
            tickets_data = resp_tickets.json()
            items = tickets_data.get("items", [])
            # Should be empty since this is a new user who hasn't raised any tickets
            if len(items) == 0:
                results.add_pass(
                    "Registered employee GET /tickets returns only own tickets (empty array)",
                    "No tickets raised yet by this new user"
                )
            else:
                # If there are tickets, verify they are all raised by this user
                resp_me = emp_login_session.get(f"{BASE_URL}/auth/me")
                emp_user = resp_me.json().get("user")
                non_own_tickets = [t for t in items if t.get("raised_by_id") != emp_user.get("id")]
                if len(non_own_tickets) == 0:
                    results.add_pass(
                        "Registered employee GET /tickets returns only own tickets",
                        f"Total tickets: {len(items)}, All raised by this user"
                    )
                else:
                    results.add_fail(
                        "Registered employee ticket scoping",
                        f"Found {len(non_own_tickets)} tickets not raised by this user"
                    )
        else:
            results.add_fail("Registered employee GET /tickets", f"Status {resp_tickets.status_code}")
        
        # GET /audit should return 403
        resp_audit = emp_login_session.get(f"{BASE_URL}/audit")
        if resp_audit.status_code == 403:
            results.add_pass(
                "Registered employee GET /audit -> 403",
                "RBAC working correctly"
            )
        else:
            results.add_fail(
                "Registered employee audit RBAC",
                f"Expected 403, got {resp_audit.status_code}"
            )
    else:
        results.add_fail("Login registered employee", f"Status {resp.status_code}: {resp.text}")
except Exception as e:
    results.add_fail("Registered employee functionality", str(e))

# ============================================================================
# SUMMARY
# ============================================================================
all_passed = results.summary()

if all_passed:
    print("\n🎉 ALL AUTH TESTS PASSED!")
else:
    print(f"\n⚠️  {len(results.failed)} TEST(S) FAILED")
