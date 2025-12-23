#!/bin/bash

# Remote Command Relay - Release Script
# Handles versioning, building, npm publish, and GitHub release

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$(dirname "$CLI_DIR")")"

cd "$CLI_DIR"

# Helper functions
log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

log_step() {
    echo -e "\n${MAGENTA}${BOLD}==>${NC} ${BOLD}$1${NC}"
}

# Check for required tools
check_requirements() {
    log_step "Checking requirements"
    
    local missing=0
    
    if ! command -v bun &> /dev/null; then
        log_error "bun is required but not installed"
        missing=1
    else
        log_success "bun found: $(bun --version)"
    fi
    
    if ! command -v npm &> /dev/null; then
        log_error "npm is required but not installed"
        missing=1
    else
        log_success "npm found: $(npm --version)"
    fi
    
    if ! command -v gh &> /dev/null; then
        log_error "GitHub CLI (gh) is required but not installed"
        log_info "Install with: brew install gh"
        missing=1
    else
        log_success "gh found: $(gh --version | head -1)"
    fi
    
    if ! command -v git &> /dev/null; then
        log_error "git is required but not installed"
        missing=1
    else
        log_success "git found: $(git --version)"
    fi
    
    if ! command -v jq &> /dev/null; then
        log_error "jq is required but not installed"
        log_info "Install with: brew install jq"
        missing=1
    else
        log_success "jq found: $(jq --version)"
    fi
    
    if [ $missing -eq 1 ]; then
        log_error "Missing required tools. Please install them and try again."
        exit 1
    fi
    
    # Check gh auth
    if ! gh auth status &> /dev/null; then
        log_error "GitHub CLI is not authenticated. Run: gh auth login"
        exit 1
    fi
    log_success "GitHub CLI authenticated"
    
    # Check npm auth
    if ! npm whoami &> /dev/null; then
        log_error "npm is not authenticated. Run: npm login"
        exit 1
    fi
    log_success "npm authenticated as: $(npm whoami)"
}

# Get current version
get_current_version() {
    jq -r '.version' package.json
}

# Calculate new version
calculate_new_version() {
    local current=$1
    local bump_type=$2
    
    IFS='.' read -r major minor patch <<< "$current"
    
    case $bump_type in
        major)
            echo "$((major + 1)).0.0"
            ;;
        minor)
            echo "${major}.$((minor + 1)).0"
            ;;
        patch)
            echo "${major}.${minor}.$((patch + 1))"
            ;;
        *)
            # Assume it's a specific version
            echo "$bump_type"
            ;;
    esac
}

# Update version in package.json
update_package_json_version() {
    local new_version=$1
    local tmp_file=$(mktemp)
    
    jq --arg v "$new_version" '.version = $v' package.json > "$tmp_file" && mv "$tmp_file" package.json
    log_success "Updated package.json version to $new_version"
}

# Update version in src/index.ts
update_source_version() {
    local new_version=$1
    
    sed -i.bak "s/const VERSION = \"[^\"]*\"/const VERSION = \"$new_version\"/" src/index.ts
    rm -f src/index.ts.bak
    log_success "Updated src/index.ts version to $new_version"
}

# Run tests
run_tests() {
    log_step "Running tests"
    
    log_info "Running typecheck..."
    npm run typecheck
    log_success "Typecheck passed"
    
    log_info "Running tests..."
    npm run test
    log_success "Tests passed"
}

# Build npm package
build_npm() {
    log_step "Building npm package"
    
    # Clean dist directory of JS files (keep binaries if any)
    rm -f dist/*.js dist/*.d.ts 2>/dev/null || true
    
    npm run build:npm
    log_success "npm package built"
}

# Build all binaries
build_binaries() {
    log_step "Building binaries for all platforms"
    
    # Clean up old binaries first
    rm -f dist/remote-cmd-relay_* 2>/dev/null || true
    
    local platforms=("linux-amd64" "linux-arm64" "darwin-amd64" "darwin-arm64")
    
    for platform in "${platforms[@]}"; do
        log_info "Building for $platform..."
        npm run "build:$platform"
        log_success "Built remote-cmd-relay_$platform"
    done
    
    echo ""
    log_info "Built binaries:"
    ls -lh dist/remote-cmd-relay_* 2>/dev/null | while read line; do
        echo "  $line"
    done
}

# Git operations
git_commit_and_tag() {
    local version=$1
    
    log_step "Creating git commit and tag"
    
    # The script updates package.json and src/index.ts, so those changes are expected
    # Only warn about OTHER uncommitted changes
    local other_changes=$(git status --short | grep -v 'package.json' | grep -v 'src/index.ts')
    if [ -n "$other_changes" ]; then
        log_warning "You have other uncommitted changes:"
        echo "$other_changes"
        log_info "These will NOT be included in the release commit."
    fi
    
    git add package.json src/index.ts
    git commit -m "chore(cli): release v$version"
    log_success "Created commit"
    
    git tag -a "cli-v$version" -m "CLI Release v$version"
    log_success "Created tag cli-v$version"
}

git_push() {
    local version=$1
    
    log_step "Pushing to remote"
    
    git push origin HEAD
    log_success "Pushed commits"
    
    git push origin "cli-v$version"
    log_success "Pushed tag cli-v$version"
}

# Publish to npm
publish_npm() {
    log_step "Publishing to npm"
    
    npm publish --access public
    log_success "Published to npm"
}

# Create GitHub release
create_github_release() {
    local version=$1
    
    log_step "Creating GitHub release"
    
    local release_notes="## Remote Command Relay CLI v$version

### Installation

#### Via npm/npx
\`\`\`bash
npx @fatagnus/remote-cmd-relay --help
\`\`\`

#### Download Binary
Download the appropriate binary for your platform from the assets below.

### Binaries
- \`remote-cmd-relay_linux_amd64\` - Linux x86_64
- \`remote-cmd-relay_linux_arm64\` - Linux ARM64
- \`remote-cmd-relay_darwin_amd64\` - macOS Intel
- \`remote-cmd-relay_darwin_arm64\` - macOS Apple Silicon

### Changelog
See [commits](https://github.com/fatagnus/remote-cmd-relay/commits/cli-v$version) for changes."

    # Create release with binaries (use --repo to ensure correct repository)
    gh release create "cli-v$version" \
        --repo fatagnus/remote-cmd-relay \
        --title "CLI v$version" \
        --notes "$release_notes" \
        dist/remote-cmd-relay_linux_amd64 \
        dist/remote-cmd-relay_linux_arm64 \
        dist/remote-cmd-relay_darwin_amd64 \
        dist/remote-cmd-relay_darwin_arm64
    
    log_success "Created GitHub release cli-v$version"
    log_info "View at: https://github.com/fatagnus/remote-cmd-relay/releases/tag/cli-v$version"
}

# Print usage
usage() {
    echo -e "${BOLD}Remote Command Relay - Release Script${NC}"
    echo ""
    echo "Usage: $0 <version-type|version>"
    echo ""
    echo "Arguments:"
    echo "  patch       Bump patch version (1.0.0 -> 1.0.1)"
    echo "  minor       Bump minor version (1.0.0 -> 1.1.0)"
    echo "  major       Bump major version (1.0.0 -> 2.0.0)"
    echo "  x.y.z       Set specific version"
    echo ""
    echo "Options:"
    echo "  --dry-run   Show what would be done without making changes"
    echo "  --skip-tests Skip running tests"
    echo "  --help      Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 patch"
    echo "  $0 minor"
    echo "  $0 1.2.3"
    echo "  $0 patch --dry-run"
}

# Main
main() {
    local version_arg=""
    local dry_run=false
    local skip_tests=false
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --dry-run)
                dry_run=true
                shift
                ;;
            --skip-tests)
                skip_tests=true
                shift
                ;;
            --help|-h)
                usage
                exit 0
                ;;
            -*)
                log_error "Unknown option: $1"
                usage
                exit 1
                ;;
            *)
                if [ -z "$version_arg" ]; then
                    version_arg="$1"
                else
                    log_error "Unexpected argument: $1"
                    usage
                    exit 1
                fi
                shift
                ;;
        esac
    done
    
    if [ -z "$version_arg" ]; then
        usage
        exit 1
    fi
    
    echo -e "${CYAN}${BOLD}"
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║          Remote Command Relay - Release Script            ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    
    # Check requirements
    check_requirements
    
    # Calculate versions
    local current_version=$(get_current_version)
    local new_version=$(calculate_new_version "$current_version" "$version_arg")
    
    # Validate version format
    if ! [[ $new_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        log_error "Invalid version format: $new_version"
        log_info "Version must be in format: x.y.z"
        exit 1
    fi
    
    echo ""
    log_info "Current version: ${YELLOW}$current_version${NC}"
    log_info "New version:     ${GREEN}$new_version${NC}"
    echo ""
    
    if [ "$dry_run" = true ]; then
        log_warning "DRY RUN - No changes will be made"
        echo ""
        echo "Would perform the following actions:"
        echo "  1. Update package.json version to $new_version"
        echo "  2. Update src/index.ts version to $new_version"
        echo "  3. Run typecheck and tests"
        echo "  4. Build npm package"
        echo "  5. Build binaries (linux-x64, linux-arm64, darwin-x64, darwin-arm64)"
        echo "  6. Create git commit and tag cli-v$new_version"
        echo "  7. Push to remote"
        echo "  8. Publish to npm"
        echo "  9. Create GitHub release with binaries"
        exit 0
    fi
    
    # Confirmation
    echo "This will:"
    echo "  • Update version to ${GREEN}$new_version${NC}"
    echo "  • Build npm package and 4 platform binaries"
    echo "  • Create git tag ${CYAN}cli-v$new_version${NC}"
    echo "  • Publish to npm as ${CYAN}@fatagnus/remote-cmd-relay@$new_version${NC}"
    echo "  • Create GitHub release with binaries"
    echo ""
    read -p "Continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Aborted."
        exit 0
    fi
    
    echo ""
    
    # Update versions
    log_step "Updating version to $new_version"
    update_package_json_version "$new_version"
    update_source_version "$new_version"
    
    # Run tests (unless skipped)
    if [ "$skip_tests" = false ]; then
        run_tests
    else
        log_warning "Skipping tests"
    fi
    
    # Build
    build_npm
    build_binaries
    
    # Git
    git_commit_and_tag "$new_version"
    git_push "$new_version"
    
    # Publish
    publish_npm
    
    # GitHub release
    create_github_release "$new_version"
    
    # Done!
    echo ""
    echo -e "${GREEN}${BOLD}"
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║                    Release Complete! 🎉                    ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo ""
    log_success "Version $new_version released successfully!"
    echo ""
    echo "  npm:    https://www.npmjs.com/package/@fatagnus/remote-cmd-relay"
    echo "  GitHub: https://github.com/fatagnus/remote-cmd-relay/releases/tag/cli-v$new_version"
    echo ""
}

main "$@"
