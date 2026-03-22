You are reviewing the AmbientCT project architecture.

Read CLAUDE.md first. Then analyze:

1. **Docker Composition:** Is the docker-compose.yml production-ready? Check: health checks, restart policies, volume persistence, network isolation, resource limits.

2. **Security:** Are there exposed ports that shouldn't be? Is Orthanc auth enforced? Are default credentials still present? Is CORS properly configured? Can the DICOM port (4242) be reached from outside the Docker network?

3. **Configuration:** Is ohif-config.js correctly pointing to Orthanc's DICOMweb endpoints? Are the dental Window/Level presets medically reasonable?

4. **Data Safety:** Is .gitignore blocking all DICOM files? Are patient data paths excluded from version control? Is the anonymization workflow documented?

5. **Deployment:** Can a non-technical person follow the setup? Are error messages helpful? Does setup.sh handle edge cases (Docker not installed, port conflicts, insufficient disk space)?

Output format:
- ✅ PASS: [what's good]
- ⚠️ WARN: [what could be improved]
- 🛑 BLOCK: [what must be fixed before release]

End with a prioritized action list.
