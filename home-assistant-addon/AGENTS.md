# Home Assistant Addon Agents

## Overview
This document describes the automation capabilities and development guidelines for the Home Assistant Addon project in the Hey Jarvis monorepo.

## Project Description
A Home Assistant addon that seamlessly hosts the Jarvis MCP server within your Home Assistant instance, providing intelligent voice assistant capabilities directly integrated with your smart home.

## Key Features
- **Native Home Assistant Integration**: Runs as a standard Home Assistant addon
- **MCP Server Hosting**: Hosts the Jarvis MCP server within Home Assistant
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
  "image": "ghcr.io/ffmathy/home-assistant-addon"
}
```

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
- ✅ Use `nx serve home-assistant-addon` instead of `npm run dev`
- ✅ Use `nx build home-assistant-addon` instead of `npm run build`
- ✅ Use `nx deploy home-assistant-addon` instead of running deploy script directly
- ✅ Use `nx docker:build home-assistant-addon` for Docker builds
- ❌ **NEVER use `npm run` commands** in this NX monorepo
- ❌ **NEVER use `npm install` directly** - use NX workspace commands

### Build Dependencies
The addon depends on `jarvis-mcp` project:
```bash
# The build automatically depends on jarvis-mcp:docker:build
nx build home-assistant-addon  # Also builds jarvis-mcp first
```

This is configured in `project.json`:
```json
{
  "targets": {
    "build": {
      "dependsOn": ["jarvis-mcp:docker:build"]
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

## Architecture

### Component Flow
```
ElevenLabs Agent → Home Assistant Addon → Jarvis MCP Server → Home Assistant Devices
                                ↓
                          Docker Container
                                ↓
                    ghcr.io/ffmathy/jarvis-mcp (base image)
                                ↓
                          Mastra Server (port 4111)
```

### Base Image Relationship
The addon uses `ghcr.io/ffmathy/jarvis-mcp` as its base image:
- **Dockerfile**: `FROM ghcr.io/ffmathy/jarvis-mcp:latest`
- **Dependency**: Built automatically via NX dependency graph
- **Updates**: Addon version should match jarvis-mcp version

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
Error: jarvis-mcp:docker:build failed
```

**Solution**:
```bash
# Build dependencies first
nx build jarvis-mcp

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
- **Integrations**: Don't implement integrations until they solve real problems
- **Features**: Keep addon focused on core MCP server hosting
- **Complexity**: Avoid over-engineering the addon wrapper

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

For more information on the complete Jarvis ecosystem, see the project root AGENTS.md files and documentation.
