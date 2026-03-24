# Contributing to AmbientCT

Built by a dentist, for dental practices.
You don't need to be a DICOM expert to contribute — good ideas, bug reports, and documentation improvements are just as valuable as code.

---

## Ways to Contribute

- **Bug fixes** — Anything in [Issues](https://github.com/Ambientwork/AmbientCT/issues) with the `bug` label
- **Features** — Check [Issues](https://github.com/Ambientwork/AmbientCT/issues) for open feature requests first
- **Documentation** — Setup guides, troubleshooting tips, usage examples
- **Dental presets** — New Window/Level presets for specific imaging modalities (CBCT, DVT, OPG)
- **Translations** — UI strings or documentation in other languages

---

## Good First Issues

New to the project? Look for issues labeled [`good-first-issue`](https://github.com/Ambientwork/AmbientCT/issues?q=label%3Agood-first-issue).

These are scoped, well-described tasks with no hidden complexity. If you get stuck, comment on the issue — we'll help.

---

## Dev Setup

1. **Fork and clone**
   ```bash
   git clone https://github.com/<your-username>/AmbientCT.git
   cd AmbientCT
   ```

2. **Create your `.env`**
   ```bash
   cp .env.example .env
   ```

3. **Set a strong password** — edit `.env` and change `ORTHANC_PASSWORD` to something secure,
   or let the setup wizard generate one automatically:
   ```bash
   ./scripts/setup.sh
   ```

4. **Start the stack**
   ```bash
   docker compose up -d
   ```

5. **Open the viewer** at http://localhost:3000

The stack takes ~30 seconds to become healthy. Run `docker compose logs -f` to watch startup.

---

## Branch & Commit Style

**Branch naming:**
```
Ambientwork/short-description
```
Examples: `Ambientwork/fix-ohif-config`, `Ambientwork/add-mri-preset`

**Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | When |
|--------|------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `chore:` | Tooling, deps, CI |
| `refactor:` | No behavior change |

---

## Before You Submit a PR

- [ ] `./scripts/smoke-test.sh` passes locally
- [ ] No `.dcm`, `.env`, or patient data files in the diff
- [ ] No log snippets containing patient names, IDs, or dates of birth
- [ ] `docs/` updated if behavior changed

---

## Patient Data Rule (DSGVO / GDPR)

**Never include patient data in any form.**

This means: no DICOM image files, no log snippets with patient names/IDs/dates of birth, no screenshots with PHI (Protected Health Information), no filenames derived from patient names.

This is a legal requirement under DSGVO (EU) / GDPR. Any PR containing patient data will be closed immediately and the data reported for removal from git history.

If your logs contain patient data, scrub them first:
```bash
python3 scripts/scrub.py your-logfile.txt
```

---

## Code of Conduct

Be kind. This project is used in healthcare settings. Treat other contributors with the same care you'd want shown to patients.

---

<div align="center">

**By [Ambientwork](https://ambientwork.ai)** — the better OS for dental practices.

MIT License · Made with AI and coffee.

</div>
