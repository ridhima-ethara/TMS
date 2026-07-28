#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: "IT & Admin Ticket, Approval, Task and Checklist Management Platform. RBAC across Employee/IT/Admin/Super Admin, ticket lifecycle, Admin approval workflow (Super Admin decisions), operational tasks, location checklists, SLA, in-app notifications, immutable audit logs. Built on Next.js API routes + MongoDB with JWT httpOnly cookie auth + bcrypt."

backend:
  - task: "Auth (login/me/logout) with JWT cookie + bcrypt"
    implemented: true
    working: true
    file: "/app/app/api/[[...path]]/route.js"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "POST /api/auth/login sets tf_token httpOnly cookie; /api/auth/me returns user; logout clears. Seeded users password Passw0rd!. Test invalid creds -> 401."
        - working: true
          agent: "testing"
          comment: "Tested 5 auth scenarios: (1) Login with valid credentials returns 200 + user + sets tf_token cookie, (2) Login with wrong password returns 401, (3) GET /auth/me returns logged-in user when cookie present, (4) GET /auth/me returns {user:null} without cookie, (5) POST /auth/logout clears session. All tests passed."
  - task: "Seed endpoint (idempotent) from CSV data"
    implemented: true
    working: true
    file: "/app/app/api/[[...path]]/route.js"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "POST /api/seed creates 5 users (4 roles), categories, locations, ~13 IT tickets, 13 admin tasks, checklist templates, 1 admin approval-prep ticket. Should be idempotent."
        - working: true
          agent: "testing"
          comment: "Tested seed endpoint: POST /api/seed is idempotent, returns {seeded:false, message:'already seeded'} when data already exists. All seeded data verified including users, tickets, tasks, and checklist templates."
  - task: "Tickets CRUD + RBAC scoping + filters + pagination"
    implemented: true
    working: true
    file: "/app/app/api/[[...path]]/route.js"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "GET /api/tickets scoped: employee->own, it->IT dept, admin->Admin dept, super_admin->all. POST create generates IT-/ADM- human ids + SLA. Object-level auth on GET/PATCH /tickets/:id (403 for cross-role). Verify IDOR prevention: employee cannot open others tickets."
        - working: true
          agent: "testing"
          comment: "Tested 8 RBAC scenarios: (1) Employee sees only own tickets, (2) IT sees only IT department tickets, (3) Admin sees only Admin department tickets, (4) Super admin sees all tickets, (5) Unauthenticated returns 401, (6) IDOR: Employee cannot access tickets not raised by them (403), (7) IDOR: IT cannot access Admin tickets (403), (8) IDOR: Admin cannot access IT tickets (403). All RBAC and IDOR protections working correctly."
  - task: "Ticket lifecycle: assign/priority/status/resolve + timeline + comments"
    implemented: true
    working: true
    file: "/app/app/api/[[...path]]/route.js"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "PATCH updates assignee/priority/status/resolution with history entries. POST /tickets/:id/comments (public/internal; employees restricted to public and cannot see internal). Employee confirm/reopen+rating via POST /tickets/:id/confirm."
        - working: true
          agent: "testing"
          comment: "Tested 10 ticket lifecycle scenarios: (1) Employee creates IT ticket with human_id IT-DDMMYY-000xxx and status Open, (2) IT assigns ticket (Open->Assigned), (3) IT changes priority, (4) IT changes status to In Progress, (5) IT resolves ticket with resolution, (6) GET detail returns history[] and comments[], (7) IT adds internal comment, (8) Employee cannot see internal comments, (9) Employee confirms ticket (Resolved->Closed with rating), (10) Employee reopens ticket (Reopened). All lifecycle transitions working correctly."
  - task: "Admin Approval workflow (submit + Super Admin decision)"
    implemented: true
    working: true
    file: "/app/app/api/[[...path]]/route.js"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Admin POST /tickets/:id/approval/submit -> status Pending Super Admin Approval, creates APR- id. Super Admin POST /tickets/:id/approval/decision (approve/partial/reject/hold/clarify) with remarks required for non-approve. Approve -> Approved-Ready-for-Action. Execution (In Progress/Resolved) blocked until approved when approval_required."
        - working: true
          agent: "testing"
          comment: "Tested 13 approval workflow scenarios: (1) Found seeded approval ticket 'New printer procurement for HQ2', (2) Admin blocked from In Progress before approval (400), (3) Admin submits approval (status->Pending Super Admin Approval, APR- human_id created), (4) Super admin decision without remarks returns 400, (5) Super admin clarify decision (status->Clarification Required), (6) Admin resubmits approval (status->Pending again), (7) Super admin partial approval with approved_amount stored separately from requested_amount (status->Approved - Ready for Action), (8) Admin can move to In Progress after approval, (9) Admin resolves approved ticket, (10-13) RBAC: Employee/IT cannot submit approval (403), Admin cannot make decision (403), Super admin cannot submit approval (403). All approval workflow and RBAC working correctly."
  - task: "Tasks, Checklists (+ create ticket from item), Notifications, Audit, Dashboard"
    implemented: true
    working: true
    file: "/app/app/api/[[...path]]/route.js"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Admin tasks GET/POST/PATCH (admin only). Checklist templates/executions + /checklists/to-ticket. Notifications GET + read. Audit GET super_admin only. Dashboard role-scoped stats."
        - working: true
          agent: "testing"
          comment: "Tested 13 scenarios: (1) GET /tasks as admin returns 13 seeded tasks, (2) GET /tasks as employee returns 403, (3) POST /tasks creates task with human_id ATSK-..., (4) PATCH /tasks updates status, (5) GET /checklists/templates returns templates, (6) POST /checklists/executions creates execution with human_id CHK-{LOCATION}-..., (7) POST /checklists/to-ticket creates Admin ticket, (8) GET /notifications returns notifications, (9) POST /notifications/read marks read, (10) GET /audit as super_admin returns audit entries, (11) GET /audit as admin returns 403, (12) GET /dashboard returns role-scoped stats. All endpoints working correctly with proper RBAC."

frontend:
  - task: "Full UI (login, dashboards, tickets, drawer, approvals, tasks, checklists, audit)"
    implemented: true
    working: "NA"
    file: "/app/app/page.js"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Login + Super Admin dashboard verified via screenshot. Frontend testing pending user approval."

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 1
  run_ui: false

test_plan:
  current_focus: []
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    - agent: "main"
      message: "Built full-stack TicketFlow on Next.js API routes + MongoDB. Please test backend end-to-end. Use demo users (password Passw0rd!): employee@demo.com, it@demo.com, admin@demo.com, superadmin@demo.com. Auth uses httpOnly cookie tf_token - persist cookies across requests. Key flow to validate: (1) login all roles, (2) RBAC scoping + IDOR (employee cannot access others/IT/Admin tickets => 403), (3) employee raise ticket, IT assign/status/resolve, employee confirm+rating, (4) Admin approval: submit on the seeded 'New printer procurement for HQ2' ADM ticket then Super Admin decision -> status transitions, (5) execution locked before approval, (6) notifications + audit (super admin only). Base path is /api."
    - agent: "testing"
      message: "Backend testing complete. All 49 tests passed (0 failures). Tested: (1) Auth - login/logout/me with JWT cookie, (2) RBAC scoping - employee/IT/admin/super_admin ticket access, (3) IDOR protection - cross-role access blocked with 403, (4) Ticket lifecycle - create/assign/priority/status/resolve/confirm/reopen, (5) Comments - internal/public with proper visibility, (6) Admin approval workflow - submit/decision/clarify/partial approval with execution blocking, (7) Tasks/Checklists/Notifications/Audit/Dashboard with proper RBAC. All endpoints working correctly. Backend is production-ready."