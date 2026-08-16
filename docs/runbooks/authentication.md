# Authentication boundary

The application owns the versioned authenticated-principal contract. `IdentityMapping(provider, providerSubject, userId)` will attach a future email-based managed OIDC provider to the internal `User`; replacing that provider does not move roles or organization membership out of the application.

Phase 10 implements deterministic development/test authentication only. It does not store passwords or send email. Development identity headers are accepted only outside production and only with a development/test adapter. Production startup fails closed unless `AUTH_ADAPTER=managed`; because no managed adapter is selected yet, that mode also reports an explicit startup error.

Authorization is server-side: the authenticated internal user, active user lifecycle, active database membership, organization lifecycle, and role policy must all pass. A path/header/body organization ID is a requested context only and cannot establish authority.

| Operation              | Personal                           | School                                                    |
| ---------------------- | ---------------------------------- | --------------------------------------------------------- |
| Read workspace context | Active `TEACHER` member            | Active `TEACHER`, `COORDINATOR`, or `SCHOOL_ADMIN` member |
| Rename workspace       | The single active `TEACHER` member | Active `SCHOOL_ADMIN` only                                |

`PLATFORM_ADMIN` is never inferred from an organization membership. Cross-tenant, inactive, and insufficient-role access uses the same non-disclosing 404 response. Missing authentication is 401; missing organization context after authentication is a distinct 400 contract.
