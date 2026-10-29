# Security policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please report privately through GitHub's **Report a vulnerability** button on the repository's Security tab. Do not open a public issue.

Include the affected version, steps to reproduce and the impact you expect. You can expect an acknowledgement within 7 days and a fix or mitigation plan within 30 days for confirmed issues.

## Scope

In scope: the desktop app, its Rust core, the build and release pipeline. See [docs/threat-model.md](docs/threat-model.md) for the threats already considered.

## Verifying releases

Each release includes `SHA256SUMS.txt`, a CycloneDX SBOM and build provenance attestations:

    gh attestation verify <installer>.exe --repo atharva-acharya/lifeos-app
