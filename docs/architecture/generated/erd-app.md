<!-- 생성물이다. 직접 편집하지 않고 `pnpm architecture:erd:write`로 다시 만든다. 원천: packages/db/drizzle/20260915232504_run_workflow_name/snapshot.json -->
# `app` 스키마 ERD

Drizzle 마이그레이션 `20260915232504_run_workflow_name`의 snapshot에서 만든 표·컬럼·외래키 그림이다. 표 14개.
다른 스키마의 표는 관계선에만 `schema__table`로 나타난다. 의미와 불변식은
[domain-and-data.md](../domain-and-data.md)와 [수집 쓰기 지도](../ingestion-write-map.md)가 설명한다.

```mermaid
erDiagram
    auth_account {
        text id PK
        text issuer
        text accountId
        text providerId
        text userId FK
        text accessToken
        text refreshToken
        text idToken
        timestamptz accessTokenExpiresAt
        timestamptz refreshTokenExpiresAt
        text scope
        text password
        timestamptz createdAt
        timestamptz updatedAt
    }
    auth_rate_limit {
        text id PK
        text key
        integer count
        bigint lastRequest
    }
    auth_session {
        text id PK
        timestamptz expiresAt
        text token
        timestamptz createdAt
        timestamptz updatedAt
        text ipAddress
        text userAgent
        text userId FK
    }
    auth_user {
        text id PK
        text name
        text email
        boolean emailVerified
        text image
        timestamptz createdAt
        timestamptz updatedAt
    }
    auth_verification {
        text id PK
        text identifier
        text value
        timestamptz expiresAt
        timestamptz createdAt
        timestamptz updatedAt
    }
    identity_subject {
        bigint identity_subject_id PK
        bigint principal_id FK
        varchar_64 provider UK
        text issuer UK
        text subject UK
        timestamptz created_at
    }
    principal {
        bigint principal_id PK
        timestamptz created_at
    }
    principal_default_workspace {
        bigint principal_id PK, FK
        bigint workspace_id FK
        timestamptz initialized_at
    }
    registered_business {
        bigint registered_business_id PK
        bigint workspace_id FK
        char_10 business_number
        bigint registered_by_principal_id FK
        timestamptz registered_at
        timestamptz revoked_at
    }
    registered_business_location {
        bigint registered_business_id PK, FK
        text address_text
        timestamptz updated_at
        bigint updated_by_principal_id FK
    }
    workspace {
        bigint workspace_id PK
        text name
        timestamptz created_at
    }
    workspace_membership {
        bigint workspace_id PK, FK
        bigint principal_id PK, FK
        varchar_32 role
        timestamptz created_at
    }
    workspace_region_preference {
        bigint workspace_id PK, FK
        timestamptz confirmed_at
        bigint confirmed_by_principal_id FK
    }
    workspace_region_preference_area {
        bigint workspace_id PK, FK
        bigint code_value_id PK, FK
    }
    auth_user ||--o{ auth_account : "userId"
    auth_user ||--o{ auth_session : "userId"
    core__code_value ||--o{ workspace_region_preference_area : "code_value_id"
    principal ||--o{ identity_subject : "principal_id"
    principal ||--o{ principal_default_workspace : "principal_id"
    principal ||--o{ registered_business : "registered_by_principal_id"
    principal ||--o{ registered_business_location : "updated_by_principal_id"
    principal ||--o{ workspace_membership : "principal_id"
    principal ||--o{ workspace_region_preference : "confirmed_by_principal_id"
    registered_business ||--o{ registered_business_location : "registered_business_id"
    workspace ||--o{ principal_default_workspace : "workspace_id"
    workspace ||--o{ registered_business : "workspace_id"
    workspace ||--o{ workspace_membership : "workspace_id"
    workspace ||--o{ workspace_region_preference : "workspace_id"
    workspace_region_preference ||--o{ workspace_region_preference_area : "workspace_id"
```
