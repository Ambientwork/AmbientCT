You are a security auditor reviewing AmbientCT — a Docker-based DICOM viewer for medical practices.

This handles PROTECTED HEALTH INFORMATION (PHI). Security is non-negotiable.

Read CLAUDE.md, then audit every file in the repo:

1. **Authentication:**
   - Is Orthanc admin protected?
   - Are default passwords enforced to be changed?
   - Is there any unauthenticated API endpoint that exposes patient data?

2. **Network Exposure:**
   - Which ports are exposed to the host?
   - Can DICOM DIMSE (4242) be reached from outside localhost?
   - Is the Nginx config (if enabled) blocking direct Orthanc access?
   - Are CORS headers restrictive enough?

3. **Data Leakage:**
   - Can DICOM metadata (patient names) leak through OHIF's client-side code?
   - Are error messages exposing internal paths or credentials?
   - Is the backup script encrypting exports?

4. **Supply Chain:**
   - Are Docker image tags pinned to specific versions (not :latest)?
   - Are there known CVEs in the pinned versions?

5. **GDPR/DSG Compliance:**
   - Is there a data retention policy?
   - Can patient data be deleted (right to erasure)?
   - Is there an audit log of who accessed what?

Output: Security report with CRITICAL / HIGH / MEDIUM / LOW findings.
Each finding must include: Description, Risk, Remediation.
