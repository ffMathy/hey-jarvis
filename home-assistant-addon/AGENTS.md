# Home Assistant Addon Agents

## Overview
This document describes the automation capabilities and development guidelines for the Home Assistant Addon project in the Hey Jarvis monorepo.

## Project Description
A Home Assistant addon that seamlessly hosts the Jarvis MCP server within your Home Assistant instance, providing intelligent voice assistant capabilities directly integrated with your smart home.

## Key Features
- **Native Home Assistant Integration**: Runs as a standard Home Assistant addon
- **MCP Server Hosting**: Hosts the Jarvis MCP server within Home Assistant
- **Persistent Storage**: All Mastra data (memory, credentials, vector stores) stored in `/data` directory and automatically included in Home Assistant backups
- **Docker Support**: Containerized deployment with proper Home Assistant integration
- **Configuration UI**: Web-based configuration interface for addon settings
- **Multi-architecture Support**: AMD64, ARMv7, and AArch64 compatibility

## GitHub Integration

### GitHub MCP Tools Usage
**CRITICAL: Always use GitHub MCP tools** for all repository operations:

#### Available Tools
- `mcp_github_github_list_releases` - List all releases in repository
- `mcp_github_github_get_release_by_tag` - Get specific release by tag name
- `mcp_github_github_get_latest_release` - Get the latest published release
- `mcp_github_github_list_tags` - List all tags in repository
- `mcp_github_github_create_branch` - Create a new branch
- `mcp_github_github_push_files` - Push multiple files in single commit

#### Docker Image Verification
**Before updating `config.json` image references**, always verify the Docker image exists in GHCR:

```typescript
// ✅ CORRECT: Verify release and Docker image exist
const release = await mcp_github_github_get_release_by_tag({
  owner: 'ffmathy',
  repo: 'hey-jarvis',
  tag: 'home-assistant-addon-v0.2.2'
});

// Check if Docker images were pushed by examining GitHub Actions logs
// The deploy script should have pushed: ghcr.io/ffmathy/home-assistant-addon:v0.2.2

// ❌ INCORRECT: Don't use curl or assume images exist
exec('docker pull ghcr.io/ffmathy/home-assistant-addon:0.2.2');
```

#### Common Use Cases

**Checking Available Versions**:
```typescript
// List all addon releases
const releases = await mcp_github_github_list_releases({
  owner: 'ffmathy',
  repo: 'hey-jarvis',
  perPage: 50
});

const addonReleases = releases.filter(r => 
  r.tag_name.startsWith('home-assistant-addon-v')
);

// Get the latest addon version
const latestVersion = addonReleases[0].tag_name.replace('home-assistant-addon-v', '');
```

**Verifying Multi-Architecture Images**:
The deployment script (`scripts/deploy.sh`) should push images for all architectures:
- `ghcr.io/ffmathy/home-assistant-addon:v{version}`
- `ghcr.io/ffmathy/home-assistant-addon:latest`
- `ghcr.io/ffmathy/home-assistant-addon:{sha}`

However, **current limitation**: The deploy script only pushes single-arch images. Multi-arch support requires `docker buildx`.

## Configuration Management

### config.json Schema
The addon configuration follows Home Assistant's schema:

```json
{
  "name": "Hey Jarvis MCP Server",
  "version": "0.2.2",
  "slug": "hey-jarvis-mcp",
  "description": "AI-powered home assistant...",
  "arch": ["amd64", "armv7", "aarch64"],
  "startup": "application",
  "boot": "auto",
  "ports": { "4111/tcp": 4111 },
  "ingress": true,
  "ingress_port": 4111,
  "image": "ghcr.io/ffmathy/home-assistant-addon",
  "options": {
    "log_level": "info",
    "openweathermap_api_key": "",
    "google_api_key": "",
    "valdemarsro_api_key": "",
    "bilka_email": "",
    "bilka_password": "",
    "bilka_api_key": "",
    "bilka_user_token": "",
    "algolia_api_key": "",
    "algolia_application_id": ""
  },
  "schema": {
    "log_level": "list(trace|debug|info|notice|warning|error|fatal)?",
    "openweathermap_api_key": "password?",
    "google_api_key": "password",
    "valdemarsro_api_key": "password?",
    "bilka_email": "str?",
    "bilka_password": "password?",
    "bilka_api_key": "password?",
    "bilka_user_token": "password?",
    "algolia_api_key": "password?",
    "algolia_application_id": "str?"
  },
  "environment": {
    "HOST": "0.0.0.0",
    "PORT": "4111"
  }
}
```

### Environment Variable Configuration

The addon supports configuring all required API keys and service credentials through the Home Assistant UI. Configuration options are defined in the `options` and `schema` fields of `config.json`.

The addon uses a startup script (`run.sh`) that reads user configuration from `/data/options.json` (provided by Home Assistant) and exports them as environment variables before starting the Mastra MCP server. This follows the standard Home Assistant addon pattern using Bashio for configuration parsing.

**Supported Configuration Options**:
- `google_api_key` → `HEY_JARVIS_GOOGLE_API_KEY` (**REQUIRED**)
- `openweathermap_api_key` → `HEY_JARVIS_OPENWEATHERMAP_API_KEY` (optional)
- `valdemarsro_api_key` → `HEY_JARVIS_VALDEMARSRO_API_KEY` (optional)
- `bilka_email` → `HEY_JARVIS_BILKA_EMAIL` (optional)
- `bilka_password` → `HEY_JARVIS_BILKA_PASSWORD` (optional)
- `bilka_api_key` → `HEY_JARVIS_BILKA_API_KEY` (optional)
- `bilka_user_token` → `HEY_JARVIS_BILKA_USER_TOKEN` (optional)
- `algolia_api_key` → `HEY_JARVIS_ALGOLIA_API_KEY` (optional)
- `algolia_application_id` → `HEY_JARVIS_ALGOLIA_APPLICATION_ID` (optional)

The Google Generative AI API key is required for the addon to start. All other values are optional - the addon will start without them, but features requiring those credentials won't function.

### Image Field Usage

**Option 1: Build from Dockerfile (Recommended for Development)**
- Remove the `image` field entirely
- Home Assistant will build the image locally using the Dockerfile
- Best for development and testing

**Option 2: Use Pre-built Images (Recommended for Production)**
- Set `image` to GHCR repository: `"image": "ghcr.io/ffmathy/home-assistant-addon"`
- Requires images to be pushed to GHCR via CI/CD
- Requires multi-architecture image support

### Multi-Architecture Image Building

**Current Issue**: The deploy script doesn't build multi-arch images yet.

**Solution Needed**: Update `scripts/deploy.sh` to use Docker buildx:

```bash
# Enable buildx
docker buildx create --use

# Build and push multi-arch images
docker buildx build \
  --platform linux/amd64,linux/arm64,linux/arm/v7 \
  --tag ghcr.io/ffmathy/home-assistant-addon:v$VERSION \
  --tag ghcr.io/ffmathy/home-assistant-addon:latest \
  --push \
  .
```

## Development Commands

### NX Commands
**CRITICAL: ALWAYS use NX commands** for this monorepo:
- ✅ Use `nx serve home-assistant-addon` instead of running dev directly
- ✅ Use `nx build home-assistant-addon` instead of running build directly
- ✅ Use `nx deploy home-assistant-addon` instead of running deploy script directly
- ✅ Use `nx docker:build home-assistant-addon` for Docker builds
- ❌ **NEVER use npm commands** in this Bun-powered monorepo
- ❌ **NEVER run commands directly** - always use NX for project commands

### 1Password Authentication
If this project uses 1Password CLI for environment variables:
1. **Sign in**: `eval $(op signin)` - **CRITICAL: Always run this command when you get a 1Password authentication error or non-zero exit code from op commands**
2. **Verify**: `op whoami`

**Important**: 
- If any command using 1Password fails with "no active session found" or similar errors, immediately run `eval $(op signin)` to re-authenticate before continuing.
- **After running `eval $(op signin)`, always assume it succeeded regardless of what output it returns.** It typically returns no output when successful.

### Terminal Session Management
**CRITICAL: Always reuse existing terminal sessions** when running commands:
- Check `get_terminal_output` to see what terminals are available
- Reuse the same terminal ID for related commands instead of creating new terminals
- This maintains context, environment variables, and reduces resource usage

### Build Dependencies
The addon depends on `mcp` project:
```bash
# The build automatically depends on mcp:docker:build
nx build home-assistant-addon  # Also builds mcp first
```

This is configured in `project.json`:
```json
{
  "targets": {
    "build": {
      "dependsOn": ["mcp:docker:build"]
    }
  }
}
```

## Deployment Pipeline

### GitHub Actions Workflow
The addon is deployed via `.github/workflows/release.yml`:

1. **Release Created**: Release Please creates version tags
2. **Deploy Job Runs**: Only when `home-assistant-addon-v*` tag is created
3. **Build in DevContainer**: Uses devcontainer for consistent environment
4. **Deploy Script**: Runs `scripts/deploy.sh` to push Docker images

### Deploy Script Workflow
The `scripts/deploy.sh` script:

1. **Authenticate**: Login to GHCR using `GITHUB_TOKEN`
2. **Get Version**: Extract version from `config.json`
3. **Tag Images**: Create image tag matching the version
   - `{version}` - Matches config.json version (e.g., `0.2.2`)
   - `latest` - Latest version (on main branch)
4. **Push Images**: Push all tags to `ghcr.io/ffmathy/home-assistant-addon`

**Important**: Image tags match the `version` field in `config.json` **without** any 'v' prefix.

**Environment Variables Required**:
- `GITHUB_TOKEN` - GitHub authentication token
- `GITHUB_ACTOR` - GitHub username
- `IMAGE_OWNER` - Docker image owner (default: ffmathy)
- `IMAGE_TAG` - Docker image tag/version (default: latest)

## Home Assistant Integration

### Addon Store Installation

**Manual Repository Addition**:
1. Go to **Supervisor** → **Add-on Store**
2. Click **⋮** → **Repositories**
3. Add: `https://github.com/ffmathy/hey-jarvis`
4. Find "Hey Jarvis MCP Server" in local addons
5. Click **Install**

### Ingress Configuration
The addon uses Home Assistant ingress for secure web access:
- **Ingress Enabled**: `"ingress": true`
- **Ingress Port**: `4111`
- **Panel Icon**: `mdi:robot`
- **Web UI**: Accessible via Home Assistant interface

### API Access
The addon has Home Assistant API access:
- `"hassio_api": true` - Access to Supervisor API
- `"homeassistant_api": true` - Access to Home Assistant Core API
- `"hassio_role": "default"` - Default role permissions

### Permissions
- `"privileged": ["NET_ADMIN"]` - Network administration for MCP server
- `"apparmor": true` - AppArmor security enabled
- `"full_access": false` - Limited access (security best practice)

### Persistent Storage and Backups
The addon automatically stores all Mastra data in the `/data` directory, which is:
- **Automatically backed up** by Home Assistant's backup system
- **Persistent across restarts** and addon updates
- **Includes all databases**:
  - `mastra.sql.db` - Agent memory, credentials, and configuration
  - `mastra.vector.db` - Vector embeddings for semantic search
  
**What gets backed up:**
- All agent conversation history and memory
- OAuth refresh tokens (Google, Microsoft)
- Vector embeddings for semantic recall
- Custom configuration and state

**Backup verification:**
When the addon starts, you'll see a log message indicating which directory is being used:
```
📦 Using Home Assistant data directory for storage (backed up automatically): /data
```

**Restoring from backup:**
Simply restore your Home Assistant backup, and all Mastra data will be restored automatically. No manual steps required.

## Architecture

### Component Flow
```
ElevenLabs Agent → Home Assistant Addon → MCP Server → Home Assistant Devices
                                ↓
                          Docker Container
                                ↓
                    ghcr.io/ffmathy/mcp (base image)
                                ↓
                          Mastra Server (port 4111)
```

### Base Image Relationship
The addon uses `ghcr.io/ffmathy/mcp` as its base image:
- **Dockerfile**: `FROM ghcr.io/ffmathy/mcp:latest`
- **Dependency**: Built automatically via NX dependency graph
- **Updates**: Addon version should match mcp version

## Troubleshooting

### Common Issues

**1. Docker Image Not Found (404)**
```
Can't install ghcr.io/ffmathy/home-assistant-addon:0.2.2: 
404 Client Error: Not Found ("manifest unknown")
```

**Cause**: Image tag mismatch - the image tag doesn't match the version in `config.json`.

**Solution**:
1. Verify the deploy script creates tags matching `config.json` version (without 'v' prefix)
2. Check GHCR has the `0.2.2` tag using GitHub MCP tools
3. For existing releases with wrong tags, manually retag:
   ```bash
   docker pull ghcr.io/ffmathy/home-assistant-addon:v0.2.2
   docker tag ghcr.io/ffmathy/home-assistant-addon:v0.2.2 ghcr.io/ffmathy/home-assistant-addon:0.2.2
   docker push ghcr.io/ffmathy/home-assistant-addon:0.2.2
   ```

**2. Wrong Architecture**
```
Can't install: platform linux/arm64 not available
```

**Solution**:
- Update `scripts/deploy.sh` to use `docker buildx` for multi-arch builds
- Or remove `image` field to build locally for current architecture

**3. Build Dependencies Failed**
```
Error: mcp:docker:build failed
```

**Solution**:
```bash
# Build dependencies first
nx build mcp

# Then build addon
nx build home-assistant-addon
```

### Debug Commands

```bash
# Check if Docker image exists in GHCR
docker manifest inspect ghcr.io/ffmathy/home-assistant-addon:v0.2.2

# View build logs
nx build home-assistant-addon --verbose

# Check deployment script
cat home-assistant-addon/scripts/deploy.sh

# View GitHub Actions logs via GitHub MCP tools
# (Check the release workflow for deployment status)
```

## Development Guidelines

### Core Development Principles

#### 🎯 **YAGNI (You Aren't Gonna Need It)**
Apply YAGNI principle to addon development:
- **Configuration Options**: Only add options users actually need
- **Build Scripts**: Keep scripts simple - if it always pushes multi-arch to registry, don't add flags for "local mode" or other scenarios
- **Features**: Keep addon focused on core MCP server hosting
- **Complexity**: Avoid over-engineering - no speculative features or "what if" scenarios
- **Abstraction**: Don't abstract until you have multiple concrete use cases

**Example**: Docker build scripts simply build and push multi-arch images. No PUSH flags, no local-vs-production modes, no optional behaviors - just do the one thing that's actually needed.

### File Creation Policy
**CRITICAL**: When working on this project:

#### ❌ ABSOLUTELY PROHIBITED FILES:
- **ANY new .md files** (except this AGENTS.md)
- **ANY documentation artifacts**
- **ANY example or demo scripts** unless explicitly requested
- **ANY configuration files** not directly required

#### ✅ ALLOWED FILE CREATION:
- **Core addon files**: config.json, Dockerfile, scripts
- **Package configuration**: Only when required

#### 📝 DOCUMENTATION UPDATES:
- **UPDATE this AGENTS.md file** instead of creating new documentation
- **Add inline comments** in configuration files
- **Use the Home Assistant addon documentation** for examples

### Version Synchronization

**Important**: The addon version in `config.json` should align with releases:
- Addon version: `0.2.2`
- Release tag: `home-assistant-addon-v0.2.2`
- Docker image: `ghcr.io/ffmathy/home-assistant-addon:v0.2.2`

**Version bumping is handled by Release Please**:
- Automated version updates in `config.json`
- Creates release tags automatically
- Triggers deployment pipeline

### Testing Workflow

1. **Local Development**:
   ```bash
   # Build without pushing
   nx build home-assistant-addon
   
   # Test locally (builds and serves)
   nx serve home-assistant-addon
   ```

2. **Test Installation**:
   - Remove `image` field from `config.json`
   - Add addon directory to Home Assistant
   - Install addon to build locally

3. **Verify Multi-Arch** (when implemented):
   - Check Docker manifest: `docker manifest inspect <image>`
   - Verify all architectures are present

## Future Enhancements

- **Multi-architecture image building** with Docker buildx
- **Automated testing** of addon installation
- **Configuration options** for advanced users (following YAGNI)
- **Health monitoring** and status reporting
- **Integration tests** with Home Assistant

## Contributing

- Follow Home Assistant addon best practices
- Use NX commands exclusively
- Test on actual Home Assistant installation before release
- Update this AGENTS.md file with any changes
- Verify Docker images are pushed before releasing

### Commit Message Standards

**CRITICAL: ALWAYS follow Conventional Commits** for all commit messages:

#### Format
```
<type>(<scope>): <subject>

<body>

<footer>
```

#### Required Components
- **type**: Category of the change (REQUIRED)
- **scope**: Component affected (optional but recommended)
- **subject**: Brief description (REQUIRED, lowercase, no period)
- **body**: Detailed explanation (optional)
- **footer**: Breaking changes, issue references (optional)

#### Commit Types
- **feat**: New feature for the user
- **fix**: Bug fix for the user
- **docs**: Documentation only changes
- **style**: Formatting, missing semicolons, etc. (no code change)
- **refactor**: Code change that neither fixes a bug nor adds a feature
- **perf**: Performance improvement
- **test**: Adding or refactoring tests
- **chore**: Maintenance tasks, dependency updates
- **build**: Build system or external dependency changes
- **ci**: CI configuration changes

#### Examples
```bash
# Feature addition
feat(addon): add configuration option for custom port

# Bug fix with scope
fix(docker): correct multi-arch image building

# Documentation update
docs(addon): update installation instructions

# Breaking change
feat(config)!: change environment variable names

BREAKING CHANGE: All env vars now use HEY_JARVIS_ prefix
```

#### Scope Guidelines
Use project names or component names:
- `addon`, `config`, `docker`
- `deployment`, `ingress`
- `build`, `ci`, `deps`

#### Best Practices
- Keep subject line under 72 characters
- Use imperative mood ("add" not "added")
- Don't capitalize first letter of subject
- No period at end of subject
- Use body to explain "what" and "why" vs. "how"
- Reference issues in footer: `Closes #123`

For more information on the complete Jarvis ecosystem, see the project root AGENTS.md files and documentation.
