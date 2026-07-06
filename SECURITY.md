# Security Policy

Report vulnerabilities privately.

## Channel

Use GitHub Security Advisories for this repository.

If unavailable, open a public issue titled:

```text
security: contact request
```

Do not include vulnerability details in that issue.

## Scope

In scope:

- `apps/web`
- `/[locale]/admin`
- `/api/v1/**`
- Better Auth integration
- Role checks
- DB schema and migrations
- Workers that write data

Out of scope:

- Third-party services.
- Social engineering.
- Physical attacks.
- Findings requiring already-compromised credentials or rooted hosts.
- Volumetric DoS without asymmetric server-side cost.
- Best-practice nits without demonstrated impact.

## Response Targets

- Acknowledge: 5 business days.
- Initial assessment: 10 business days.
- Best effort. No SLA.

## Safe Harbor

We will not support legal action against good-faith researchers who:

- Avoid privacy violations and data destruction.
- Avoid service disruption.
- Report privately.
- Use only the access needed to prove impact.
- Do not retain user data.
- Allow reasonable remediation time.

No bug bounty exists.

## Project Commitments

- Keep reporter identity private unless consented.
- Coordinate disclosure after fix when possible.
- Credit reporter if requested.
