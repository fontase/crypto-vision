#!/bin/bash

# ═══════════════════════════════════════════════════════════════
# Crypto Vision — Local Development Services
# ═══════════════════════════════════════════════════════════════
# Usage:
#   ./dev.sh api              # Start main API (port 8080)
#   ./dev.sh dashboard        # Start dashboard (port 3000)
#   ./dev.sh news             # Start news app (port 3001)
#   ./dev.sh video            # Start video app (port 3002)
#   ./dev.sh redis            # Start Redis (port 6379)
#   ./dev.sh all              # Start all services
#   ./dev.sh status           # Show running services
# ═══════════════════════════════════════════════════════════════

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="$ROOT_DIR/.dev-pids"

# Create pid directory
mkdir -p "$PID_DIR"

# ─────────────────────────────────────────────────────────────
# Helper Functions
# ─────────────────────────────────────────────────────────────

log_info() {
  echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
  echo -e "${GREEN}✓${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
  echo -e "${RED}✗${NC} $1"
}

# Save PID for later cleanup
save_pid() {
  local service=$1
  local pid=$2
  echo $pid > "$PID_DIR/$service.pid"
}

get_pid() {
  local service=$1
  if [ -f "$PID_DIR/$service.pid" ]; then
    cat "$PID_DIR/$service.pid"
  fi
}

# Check if service is running
is_running() {
  local service=$1
  local pid=$(get_pid "$service")
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  return 1
}

# Start a service
start_service() {
  local service=$1
  local port=$2
  local dir=$3
  local cmd=$4

  if is_running "$service"; then
    log_warn "$service is already running (PID: $(get_pid "$service"))"
    return 0
  fi

  log_info "Starting $service on port $port..."
  
  cd "$dir"
  eval "$cmd" &
  local pid=$!
  save_pid "$service" "$pid"
  log_success "$service started (PID: $pid)"
}

# Stop a service
stop_service() {
  local service=$1
  local pid=$(get_pid "$service")
  
  if [ -z "$pid" ]; then
    log_warn "$service is not running"
    return 0
  fi

  if kill -0 "$pid" 2>/dev/null; then
    log_info "Stopping $service (PID: $pid)..."
    kill $pid 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 $pid 2>/dev/null || true
    fi
    rm -f "$PID_DIR/$service.pid"
    log_success "$service stopped"
  else
    log_warn "$service is not running"
    rm -f "$PID_DIR/$service.pid"
  fi
}

# Show status
show_status() {
  echo ""
  echo "Service Status:"
  echo "─────────────────────────────────────────────"
  
  local services=("redis" "api" "dashboard" "news" "video")
  local ports=("6379" "8080" "3000" "3001" "3002")
  
  for i in "${!services[@]}"; do
    local service="${services[$i]}"
    local port="${ports[$i]}"
    local pid=$(get_pid "$service")
    
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo -e "${GREEN}●${NC} $service (PID: $pid, port: $port)"
    else
      echo -e "${RED}●${NC} $service (not running)"
    fi
  done
  
  echo ""
}

# ─────────────────────────────────────────────────────────────
# Main Commands
# ─────────────────────────────────────────────────────────────

cmd_redis() {
  if is_running "redis"; then
    log_warn "Redis is already running"
  else
    log_info "Starting Redis..."
    redis-server --port 6379 &
    local pid=$!
    save_pid "redis" "$pid"
    sleep 1
    log_success "Redis started on port 6379 (PID: $pid)"
  fi
}

cmd_api() {
  start_service "api" "8080" "$ROOT_DIR" "npm run dev"
  sleep 2
  echo ""
  log_info "API available at http://localhost:8080"
  echo ""
}

cmd_dashboard() {
  start_service "dashboard" "3000" "$ROOT_DIR/apps/dashboard" "npm run dev"
  sleep 2
  echo ""
  log_info "Dashboard available at http://localhost:3000"
  echo ""
}

cmd_news() {
  start_service "news" "3001" "$ROOT_DIR/apps/news" "PORT=3001 npm run dev"
  sleep 2
  echo ""
  log_info "News app available at http://localhost:3001"
  echo ""
}

cmd_video() {
  start_service "video" "3002" "$ROOT_DIR/apps/video" "PORT=3002 npm run dev"
  sleep 2
  echo ""
  log_info "Video app available at http://localhost:3002"
  echo ""
}

cmd_all() {
  log_info "Starting all services..."
  echo ""
  
  cmd_redis
  cmd_api
  cmd_dashboard
  cmd_news
  cmd_video
  
  show_status
  
  log_info "All services started!"
  log_warn "To view logs: tail -f <service>.log"
  log_warn "To stop: ./dev.sh stop <service> or ./dev.sh stop all"
}

cmd_stop() {
  local target=$1
  
  if [ "$target" == "all" ] || [ -z "$target" ]; then
    log_info "Stopping all services..."
    stop_service "redis"
    stop_service "api"
    stop_service "dashboard"
    stop_service "news"
    stop_service "video"
    echo ""
    log_success "All services stopped"
  else
    stop_service "$target"
  fi
}

cmd_status() {
  show_status
}

cmd_help() {
  cat << EOF
${BLUE}Crypto Vision — Local Development${NC}

Usage: ./dev.sh <command> [options]

Commands:
  ${GREEN}api${NC}         Start main API server (port 8080)
  ${GREEN}dashboard${NC}  Start dashboard (port 3000)
  ${GREEN}news${NC}       Start news app (port 3001)
  ${GREEN}video${NC}      Start video app (port 3002)
  ${GREEN}redis${NC}      Start Redis server (port 6379)
  ${GREEN}all${NC}        Start all services
  ${GREEN}stop${NC}       Stop service(s) - usage: ./dev.sh stop [service|all]
  ${GREEN}status${NC}     Show service status
  ${GREEN}help${NC}       Show this help message

Examples:
  ./dev.sh api              # Start only API
  ./dev.sh all              # Start everything
  ./dev.sh stop api         # Stop API
  ./dev.sh stop all         # Stop all services
  ./dev.sh status           # Check what's running

Services:
  api      - http://localhost:8080
  dashboard - http://localhost:3000
  news     - http://localhost:3001
  video    - http://localhost:3002
  redis    - localhost:6379

EOF
}

# ─────────────────────────────────────────────────────────────
# Main Entry Point
# ─────────────────────────────────────────────────────────────

if [ -z "$1" ]; then
  cmd_help
  exit 0
fi

case "$1" in
  redis)
    cmd_redis
    ;;
  api)
    cmd_api
    ;;
  dashboard)
    cmd_dashboard
    ;;
  news)
    cmd_news
    ;;
  video)
    cmd_video
    ;;
  all)
    cmd_all
    ;;
  stop)
    cmd_stop "$2"
    ;;
  status)
    cmd_status
    ;;
  help|--help|-h)
    cmd_help
    ;;
  *)
    log_error "Unknown command: $1"
    echo ""
    cmd_help
    exit 1
    ;;
esac
