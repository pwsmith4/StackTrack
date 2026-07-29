# Automatic Azure API deployments

The API workflow builds a container image and then deploys that image to Azure
Container Apps. It uses GitHub OpenID Connect (OIDC), so GitHub does not store
an Azure password or client secret.

| Git branch | GitHub environment | Image tag | Target |
| --- | --- | --- | --- |
| `test` | `test` | `ghcr.io/pwsmith4/stacktrack-api:test` | Azure test Container App |
| `main` | `production` | `ghcr.io/pwsmith4/stacktrack-api:main` | Future production Container App |

## One-time Azure setup

Complete the following as an Azure subscription Owner or User Access
Administrator. The existing test environment is the only one that needs to be
configured now; leave production unconfigured until Goodwill provides the
production subscription and Container App.

1. In Azure portal, open **Microsoft Entra ID** → **App registrations** →
   **New registration**. Name it `stacktrack-github-deploy` and keep the default
   single-tenant option. No redirect URI is needed.
2. Open the new app registration. Copy its **Application (client) ID** and the
   **Directory (tenant) ID** from Overview. Also copy the Azure subscription ID
   from **Subscriptions**.
3. In the app registration, open **Certificates & secrets** → **Federated
   credentials** → **Add credential**. Choose **GitHub Actions deploying Azure
   resources**, then enter:

   - Organization: `pwsmith4`
   - Repository: `StackTrack`
   - Entity type: `Environment`
   - GitHub environment name: `test`
   - Name: `stacktrack-test-deploy`

   This limits the Azure identity to workflows that use the repository's
   `test` environment. Do not create a client secret.
4. Open Azure **Resource groups** → `test` → **Access control (IAM)** →
   **Add role assignment**. Assign the app registration the **Contributor**
   role at this *resource-group* scope. Do not grant subscription-wide access.

## One-time GitHub setup

1. In GitHub, open **Settings** → **Environments** → **New environment** and
   create one named `test`.
2. Open the `test` environment → **Environment variables** and add:

   | Variable | Test value |
   | --- | --- |
   | `AZURE_CLIENT_ID` | Application (client) ID from the app registration |
   | `AZURE_TENANT_ID` | Directory (tenant) ID |
   | `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
   | `AZURE_RESOURCE_GROUP` | `test` |
   | `AZURE_CONTAINER_APP_NAME` | `stacktrack-api-test` |

   These are identifiers, not passwords. No GitHub secret is required for the
   OIDC login.
3. Optional but recommended: add protection rules to the `production`
   environment when it is created, such as required reviewers. The production
   federated credential must use environment name `production`, and it should
   have Contributor only on its production resource group.

## Normal use

After setup, a push that changes API code, shared domain code, Docker files, or
the workflow automatically:

1. builds and publishes the branch-tagged image to GitHub Container Registry;
2. obtains a short-lived Azure token through OIDC;
3. creates a new Azure Container Apps revision using that image; and
4. waits until `/health` returns successfully.

The action is intentionally scoped by branch and GitHub environment. A `test`
push cannot deploy to production.

For further detail, see GitHub's [OIDC in Azure documentation](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-azure) and Microsoft's [OIDC guidance for GitHub Actions](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect).
