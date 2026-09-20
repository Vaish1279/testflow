# TestFlow — Formal Product Documentation

## 1. Product Overview
TestFlow is a structured software testing workspace for reviewing source code and web applications from one connected interface. It separates Code Testing and Application Testing while keeping testing, evidence, history and reports connected.

## 2. Code Testing
Users upload source files and select a code-focused testing type. TestFlow analyses the supplied files for the selected purpose and reports the test type, checks performed, positive findings, review items and source metrics.

Supported code-focused types include White-box Testing, Function Analysis, Condition & Path Testing, Execution & Console Insight, Evidence Collection and Reports.

## 3. Application Testing
Users upload an application ZIP, select an HTML entry page and open the selected page inside the TestFlow browser workspace. Application-focused tests inspect the uploaded application structure, controls, forms, navigation, responsive signals, accessibility-related markup and other test-specific indicators.

Supported application-focused types include Functional, UI, Responsive, Regression, Compatibility and Performance Testing.

## 4. Test Workflow
1. Create or log in to a TestFlow account.
2. Select a testing type.
3. Upload the source required by that type.
4. Run the selected test explicitly.
5. Review the generated result and formal report.
6. Download the report.
7. Rate the downloaded report and provide optional suggestions.
8. The completed session remains available in private History.

## 5. Reports and History
A completed run creates a test session and stores its result, evidence and report in Supabase. History provides access to saved sessions and report view/download actions for the logged-in user.

## 6. Access Plans
- **Free:** basic functional, UI, responsive, evidence and report capabilities.
- **Premium — ₹499/month:** Free capabilities plus deeper code-level testing.
- **Pro — ₹999/month:** Premium capabilities plus regression, compatibility and performance workflows.
- **Admin:** Free + Premium + Pro access without payment. Admin capability is controlled server-side by the Supabase admin-email list and profile role.

## 7. Paid Plan Activation
A user first submits a paid-plan request using the real email of the signed-in account. No payment reference is required at this stage. After the admin accepts the request, the user can submit payment details. The plan becomes active only after the admin verifies the payment and activates the plan.

## 8. Product Boundary
The current browser workspace performs safe project-aware analysis of uploaded files. Server-side PHP/MySQL execution is not performed directly in the main browser workspace. Production runtime automation can be connected through an isolated worker architecture.

## Separate Code and Application Reports

TestFlow treats **Code Testing** and **Application Testing** as two separate testing subjects.
- Code Testing analyses uploaded source files and creates a **Code Testing Report**.
- Application Testing analyses an uploaded application ZIP and selected HTML entry page and creates an **Application Testing Report**.
- Shared testing types such as Functional, Regression, Compatibility and Performance can be run against either subject by selecting the subject first.
- Each run creates its own history session and report, so a Code report is never merged into an Application report.
- Each report contains expected result, actual result, verdict, checks performed, positive findings, review items, metrics and file-level scope.
