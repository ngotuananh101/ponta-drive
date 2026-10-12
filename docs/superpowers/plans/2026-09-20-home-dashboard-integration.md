# Home Dashboard Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Home dashboard with backend API — display real cloud accounts, suggested files, activity timeline, and storage summary.

**Architecture:** Create activity logging system, dashboard aggregation service, and REST endpoint. Frontend fetches consolidated data in one API call. Activity logs capture user actions with IP/UserAgent for audit trail.

**Tech Stack:** Go 1.27.1, Goravel v1.18.0, MariaDB, Vue 3, TypeScript, PrimeVue

**Spec:** Design document presented in conversation above (2026-09-20 18:02-18:06 SEAST)

## Global Constraints

- Go version: 1.27.1
- Goravel framework: v1.18.0
- Database: MariaDB (existing on host)
- Frontend: Vue 3 + TypeScript + PrimeVue + Aura theme
- API prefix: `/v1/`
- Authentication: JWT via middleware
- All timestamps: RFC3339 format
- All responses: `{"status": "ok|error", "data": {...}, "message": "..."}`
- Commit messages: Conventional Commits format
- File paths: Use forward slashes (/)

---

## File Structure

### Backend (New Files)
- `backend/app/models/activity_log.go` — ActivityLog model with IP/UserAgent tracking
- `backend/app/services/activity_service.go` — Activity logging & retrieval
- `backend/app/services/dashboard_service.go` — Dashboard data aggregation
- `backend/app/http/controllers/dashboard_controller.go` — Dashboard endpoint
- `backend/app/http/helpers/request_helper.go` — Extract IP & UserAgent from context
- `backend/database/migrations/YYYYMMDDHHMMSS_create_activity_logs_table.go` — Activity logs table
- `backend/database/migrations/YYYYMMDDHHMMSS_add_sync_status_to_cloud_accounts.go` — Add sync_status fields

### Backend (Modified Files)
- `backend/app/models/cloud_account.go:80-106` — Add sync_status to ToResponse()
- `backend/routes/web.go:52-86` — Add dashboard route
- `backend/app/http/controllers/upload_controller.go` — Log upload activities
- `backend/app/http/controllers/drive_item_controller.go` — Log folder/file operations
- `backend/app/http/controllers/cloud_account_controller.go` — Update sync_status, log sync
- `backend/app/jobs/sync_s3_bucket_job.go` — Update sync_status after completion

### Frontend (New Files)
- `frontend/src/api/dashboard.ts` — Dashboard API client with TypeScript interfaces

### Frontend (Modified Files)
- `frontend/src/views/HomeView.vue:1-536` — Replace mock data with API integration
- `frontend/src/i18n/locales/vi.json` — Add missing translation keys if needed
- `frontend/src/i18n/locales/en.json` — Add missing translation keys if needed

---

## Task 1: Database Migration - Activity Logs Table

**Files:**
- Create: `backend/database/migrations/20260920120000_create_activity_logs_table.go`

**Interfaces:**
- Consumes: Goravel schema builder
- Produces: `activity_logs` table with columns: id, user_id, action, target_name, target_uuid, cloud_account_id, ip_address, user_agent, metadata, created_at

**Implementation:**

- [ ] **Step 1: Create migration file**

```go
package migrations

import (
	"github.com/goravel/framework/contracts/database/schema"
	"ponta_drive/app/facades"
)

type M20260920120000CreateActivityLogsTable struct{}

func (r *M20260920120000CreateActivityLogsTable) Signature() string {
	return "20260920120000_create_activity_logs_table"
}

func (r *M20260920120000CreateActivityLogsTable) Up() error {
	if !facades.Schema().HasTable("activity_logs") {
		return facades.Schema().Create("activity_logs", func(table schema.Blueprint) {
			table.ID()
			table.BigInteger("user_id")
			table.String("action", 50)
			table.String("target_name", 255)
			table.String("target_uuid", 36).Nullable()
			table.BigInteger("cloud_account_id").Nullable()
			table.String("ip_address", 45)
			table.Text("user_agent")
			table.JSON("metadata").Nullable()
			table.Timestamps()

			table.Index("user_id")
			table.Index("ip_address")
			table.Index([]string{"user_id", "created_at"}, "idx_user_created")
		})
	}
	return nil
}

func (r *M20260920120000CreateActivityLogsTable) Down() error {
	return facades.Schema().DropIfExists("activity_logs")
}
```

- [ ] **Step 2: Run migration**

```bash
cd backend
go run . artisan migrate
```

Expected output: Migration ran successfully, `activity_logs` table created

- [ ] **Step 3: Verify table structure**

```bash
# Connect to MariaDB and check
mysql -u ponta -p -e "DESCRIBE ponta_drive.activity_logs;"
```

Expected: Shows columns id, user_id, action, target_name, target_uuid, cloud_account_id, ip_address, user_agent, metadata, created_at, updated_at with correct types

- [ ] **Step 4: Commit**

```bash
git add backend/database/migrations/20260920120000_create_activity_logs_table.go
git commit -m "feat(db): add activity_logs table for audit trail

- Track user actions with IP and User-Agent
- Indexed on user_id and created_at for fast queries
- JSON metadata field for flexible additional data"
```

---

## Task 2: Database Migration - Add sync_status to Cloud Accounts

**Files:**
- Create: `backend/database/migrations/20260920120100_add_sync_status_to_cloud_accounts.go`

**Interfaces:**
- Consumes: Existing `cloud_accounts` table
- Produces: Added columns `sync_status` ENUM('idle', 'syncing', 'error') DEFAULT 'idle', `last_synced_at` TIMESTAMP NULL

- [ ] **Step 1: Create migration file**

```go
package migrations

import (
	"github.com/goravel/framework/contracts/database/schema"
	"ponta_drive/app/facades"
)

type M20260920120100AddSyncStatusToCloudAccounts struct{}

func (r *M20260920120100AddSyncStatusToCloudAccounts) Signature() string {
	return "20260920120100_add_sync_status_to_cloud_accounts"
}

func (r *M20260920120100AddSyncStatusToCloudAccounts) Up() error {
	return facades.Schema().Table("cloud_accounts", func(table schema.Blueprint) {
		table.Enum("sync_status", []string{"idle", "syncing", "error"}).Default("idle").After("is_active")
		table.Timestamp("last_synced_at").Nullable().After("sync_status")
	})
}

func (r *M20260920120100AddSyncStatusToCloudAccounts) Down() error {
	return facades.Schema().Table("cloud_accounts", func(table schema.Blueprint) {
		table.DropColumn("sync_status")
		table.DropColumn("last_synced_at")
	})
}
```

- [ ] **Step 2: Run migration**

```bash
cd backend
go run . artisan migrate
```

Expected output: Migration ran successfully

- [ ] **Step 3: Verify columns added**

```bash
mysql -u ponta -p -e "DESCRIBE ponta_drive.cloud_accounts;" | grep sync
```

Expected: Shows `sync_status` and `last_synced_at` columns

- [ ] **Step 4: Commit**

```bash
git add backend/database/migrations/20260920120100_add_sync_status_to_cloud_accounts.go
git commit -m "feat(db): add sync_status tracking to cloud_accounts

- sync_status ENUM: idle, syncing, error
- last_synced_at timestamp for UI display"
```

---

## Task 3: Model - ActivityLog

**Files:**
- Create: `backend/app/models/activity_log.go`

**Interfaces:**
- Consumes: Goravel ORM, `activity_logs` table schema
- Produces: `ActivityLog` struct with `ToResponse() map[string]any` method

- [ ] **Step 1: Write test file**

```go
// backend/app/models/activity_log_test.go
package models

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestActivityLog_ToResponse(t *testing.T) {
	uuid := "test-uuid-123"
	cloudID := uint(5)
	log := ActivityLog{
		ID:             1,
		UserID:         10,
		Action:         "uploaded",
		TargetName:     "test.pdf",
		TargetUUID:     &uuid,
		CloudAccountID: &cloudID,
		IPAddress:      "192.168.1.100",
		UserAgent:      "Mozilla/5.0",
		Metadata:       `{"size":1024}`,
		CreatedAt:      time.Date(2026, 9, 20, 10, 0, 0, 0, time.UTC),
	}

	resp := log.ToResponse()

	assert.Equal(t, uint(1), resp["id"])
	assert.Equal(t, "uploaded", resp["action"])
	assert.Equal(t, "test.pdf", resp["target_name"])
	assert.Equal(t, "test-uuid-123", resp["target_uuid"])
	assert.Equal(t, uint(5), resp["cloud_id"])
	assert.Equal(t, "192.168.1.100", resp["ip_address"])
	assert.Equal(t, "Mozilla/5.0", resp["user_agent"])
	assert.Contains(t, resp["created_at"].(string), "2026-09-20")
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
go test ./app/models -run TestActivityLog_ToResponse -v
```

Expected: FAIL with "undefined: ActivityLog"

- [ ] **Step 3: Implement ActivityLog model**

```go
// backend/app/models/activity_log.go
package models

import "time"

type ActivityLog struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	UserID         uint      `gorm:"not null;index" json:"user_id"`
	Action         string    `gorm:"size:50;not null" json:"action"`
	TargetName     string    `gorm:"size:255;not null" json:"target_name"`
	TargetUUID     *string   `gorm:"size:36" json:"target_uuid"`
	CloudAccountID *uint     `json:"cloud_account_id"`
	IPAddress      string    `gorm:"size:45;index" json:"ip_address"`
	UserAgent      string    `gorm:"type:text" json:"user_agent"`
	Metadata       string    `gorm:"type:json" json:"metadata"`
	CreatedAt      time.Time `gorm:"index:idx_user_created" json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

func (ActivityLog) TableName() string {
	return "activity_logs"
}

func (a *ActivityLog) ToResponse() map[string]any {
	return map[string]any{
		"id":          a.ID,
		"action":      a.Action,
		"target_name": a.TargetName,
		"target_uuid": a.TargetUUID,
		"cloud_id":    a.CloudAccountID,
		"ip_address":  a.IPAddress,
		"user_agent":  a.UserAgent,
		"created_at":  a.CreatedAt.Format(time.RFC3339),
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
go test ./app/models -run TestActivityLog_ToResponse -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/activity_log.go backend/app/models/activity_log_test.go
git commit -m "feat(model): add ActivityLog model with IP/UserAgent tracking

- ToResponse() serializes for API output
- Indexed on user_id and created_at for performance
- Test coverage for serialization"
```

---

## Task 4: Helper - Request IP & UserAgent Extraction

**Files:**
- Create: `backend/app/http/helpers/request_helper.go`
- Create: `backend/app/http/helpers/request_helper_test.go`

**Interfaces:**
- Consumes: `http.Context` from Goravel
- Produces: `GetClientIP(ctx http.Context) string`, `GetUserAgent(ctx http.Context) string`

- [ ] **Step 1: Write test file**

```go
// backend/app/http/helpers/request_helper_test.go
package helpers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/goravel/framework/contracts/http"
	"github.com/goravel/framework/http"
	"github.com/stretchr/testify/assert"
)

func TestGetClientIP_XForwardedFor(t *testing.T) {
	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Forwarded-For", "203.0.113.1, 198.51.100.1")
	
	ctx := http.Background().Request(req)
	ip := GetClientIP(ctx)
	
	assert.Equal(t, "203.0.113.1", ip)
}

func TestGetClientIP_XRealIP(t *testing.T) {
	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("X-Real-IP", "203.0.113.5")
	
	ctx := http.Background().Request(req)
	ip := GetClientIP(ctx)
	
	assert.Equal(t, "203.0.113.5", ip)
}

func TestGetClientIP_RemoteAddr(t *testing.T) {
	req := httptest.NewRequest("GET", "/test", nil)
	req.RemoteAddr = "192.168.1.100:12345"
	
	ctx := http.Background().Request(req)
	ip := GetClientIP(ctx)
	
	assert.Equal(t, "192.168.1.100", ip)
}

func TestGetUserAgent(t *testing.T) {
	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
	
	ctx := http.Background().Request(req)
	ua := GetUserAgent(ctx)
	
	assert.Equal(t, "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", ua)
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
go test ./app/http/helpers -v
```

Expected: FAIL with "undefined: GetClientIP"

- [ ] **Step 3: Implement helper functions**

```go
// backend/app/http/helpers/request_helper.go
package helpers

import (
	"net"
	"strings"

	"github.com/goravel/framework/contracts/http"
)

// GetClientIP extracts the real client IP from request headers (proxy-aware)
func GetClientIP(ctx http.Context) string {
	req := ctx.Request().Origin()

	// Check X-Forwarded-For (proxy/load balancer)
	if xff := req.Header.Get("X-Forwarded-For"); xff != "" {
		ips := strings.Split(xff, ",")
		if len(ips) > 0 {
			ip := strings.TrimSpace(ips[0])
			if net.ParseIP(ip) != nil {
				return ip
			}
		}
	}

	// Check X-Real-IP (Nginx)
	if xri := req.Header.Get("X-Real-IP"); xri != "" {
		if net.ParseIP(xri) != nil {
			return xri
		}
	}

	// Fallback: RemoteAddr
	ip, _, _ := net.SplitHostPort(req.RemoteAddr)
	return ip
}

// GetUserAgent extracts User-Agent string from request headers
func GetUserAgent(ctx http.Context) string {
	return ctx.Request().Header("User-Agent", "")
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
go test ./app/http/helpers -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/http/helpers/
git commit -m "feat(helper): add IP and UserAgent extraction helpers

- GetClientIP handles X-Forwarded-For and X-Real-IP
- Proxy-aware for load balancer setups
- Test coverage for all header scenarios"
```

---

## Task 5: Service - ActivityService

**Files:**
- Create: `backend/app/services/activity_service.go`
- Create: `backend/app/services/activity_service_test.go`

**Interfaces:**
- Consumes: `models.ActivityLog`, Goravel ORM
- Produces: 
  - `Log(userID, cloudAccountID uint, action, targetName string, targetUUID *string, ipAddress, userAgent string, metadata map[string]any) error`
  - `GetRecent(userID uint, limit int) ([]models.ActivityLog, error)`
  - `GetByIP(ipAddress string, limit int) ([]models.ActivityLog, error)`

- [ ] **Step 1: Write test file**

```go
// backend/app/services/activity_service_test.go
package services

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"ponta_drive/app/models"
)

func TestActivityService_Log(t *testing.T) {
	service := NewActivityService()
	
	uuid := "test-uuid"
	metadata := map[string]any{"size": 1024, "mime": "application/pdf"}
	
	err := service.Log(1, 5, "uploaded", "test.pdf", &uuid, "192.168.1.1", "TestAgent/1.0", metadata)
	assert.NoError(t, err)
	
	// Verify log was created
	logs, err := service.GetRecent(1, 10)
	assert.NoError(t, err)
	assert.Greater(t, len(logs), 0)
	assert.Equal(t, "uploaded", logs[0].Action)
	assert.Equal(t, "test.pdf", logs[0].TargetName)
	assert.Equal(t, "192.168.1.1", logs[0].IPAddress)
}

func TestActivityService_GetByIP(t *testing.T) {
	service := NewActivityService()
	
	// Log activity
	_ = service.Log(1, 5, "test_action", "test.txt", nil, "10.0.0.1", "TestAgent/1.0", nil)
	
	// Query by IP
	logs, err := service.GetByIP("10.0.0.1", 10)
	assert.NoError(t, err)
	assert.Greater(t, len(logs), 0)
	assert.Equal(t, "10.0.0.1", logs[0].IPAddress)
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
go test ./app/services -run TestActivityService -v
```

Expected: FAIL with "undefined: NewActivityService"

- [ ] **Step 3: Implement ActivityService**

```go
// backend/app/services/activity_service.go
package services

import (
	"encoding/json"

	"ponta_drive/app/facades"
	"ponta_drive/app/models"
)

type ActivityService struct{}

func NewActivityService() *ActivityService {
	return &ActivityService{}
}

// Log creates a new activity log entry
func (s *ActivityService) Log(
	userID, cloudAccountID uint,
	action, targetName string,
	targetUUID *string,
	ipAddress, userAgent string,
	metadata map[string]any,
) error {
	metaJSON := ""
	if metadata != nil {
		bytes, _ := json.Marshal(metadata)
		metaJSON = string(bytes)
	}

	log := models.ActivityLog{
		UserID:         userID,
		Action:         action,
		TargetName:     targetName,
		TargetUUID:     targetUUID,
		CloudAccountID: &cloudAccountID,
		IPAddress:      ipAddress,
		UserAgent:      userAgent,
		Metadata:       metaJSON,
	}

	return facades.Orm().Query().Create(&log)
}

// GetRecent fetches recent activities for a user
func (s *ActivityService) GetRecent(userID uint, limit int) ([]models.ActivityLog, error) {
	var logs []models.ActivityLog
	err := facades.Orm().Query().
		Where("user_id", userID).
		Order("created_at desc").
		Limit(limit).
		Get(&logs)
	return logs, err
}

// GetByIP fetches activities from a specific IP (security audit)
func (s *ActivityService) GetByIP(ipAddress string, limit int) ([]models.ActivityLog, error) {
	var logs []models.ActivityLog
	err := facades.Orm().Query().
		Where("ip_address", ipAddress).
		Order("created_at desc").
		Limit(limit).
		Get(&logs)
	return logs, err
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
go test ./app/services -run TestActivityService -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/activity_service.go backend/app/services/activity_service_test.go
git commit -m "feat(service): add ActivityService for audit logging

- Log user actions with IP/UserAgent
- Query recent activities by user
- Query by IP for security audit
- Full test coverage"
```

---

## Task 6: Service - DashboardService

**Files:**
- Create: `backend/app/services/dashboard_service.go`
- Create: `backend/app/services/dashboard_service_test.go`

**Interfaces:**
- Consumes: `ActivityService`, `CloudDriveService`, `models.CloudAccount`, `models.DriveItem`
- Produces: `GetSummary(ctx context.Context, userID uint) (*DashboardSummary, error)` where `DashboardSummary` contains clouds, suggested_files, recent_activities, total_storage

- [ ] **Step 1: Write test file**

Create `backend/app/services/dashboard_service_test.go`:

```go
package services

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDashboardService_GetSummary(t *testing.T) {
	service := NewDashboardService()
	
	summary, err := service.GetSummary(context.Background(), 1)
	
	assert.NoError(t, err)
	assert.NotNil(t, summary)
	assert.NotNil(t, summary.Clouds)
	assert.NotNil(t, summary.SuggestedFiles)
	assert.NotNil(t, summary.RecentActivities)
	assert.GreaterOrEqual(t, summary.TotalStorage.TotalBytes, int64(0))
}

func TestHumanizeBytes(t *testing.T) {
	tests := []struct {
		input    int64
		expected string
	}{
		{512, "512 B"},
		{1024, "1.0 KB"},
		{1536, "1.5 KB"},
		{1048576, "1.0 MB"},
		{1073741824, "1.0 GB"},
	}

	for _, tt := range tests {
		result := humanizeBytes(tt.input)
		assert.Equal(t, tt.expected, result)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
go test ./app/services -run TestDashboardService -v
```

Expected: FAIL with "undefined: NewDashboardService"

- [ ] **Step 3: Implement DashboardService**

Create `backend/app/services/dashboard_service.go`:

```go
package services

import (
	"context"
	"fmt"
	"time"

	"ponta_drive/app/facades"
	"ponta_drive/app/models"
)

type DashboardService struct {
	activityService *ActivityService
}

func NewDashboardService() *DashboardService {
	return &DashboardService{
		activityService: NewActivityService(),
	}
}

type DashboardSummary struct {
	Clouds           []map[string]any `json:"clouds"`
	SuggestedFiles   []map[string]any `json:"suggested_files"`
	RecentActivities []map[string]any `json:"recent_activities"`
	TotalStorage     StorageSummary   `json:"total_storage"`
}

type StorageSummary struct {
	UsedBytes  int64   `json:"used_bytes"`
	TotalBytes int64   `json:"total_bytes"`
	UsedHuman  string  `json:"used_human"`
	TotalHuman string  `json:"total_human"`
	Percent    float64 `json:"percent"`
}

func (s *DashboardService) GetSummary(ctx context.Context, userID uint) (*DashboardSummary, error) {
	// 1. Fetch cloud accounts
	var accounts []models.CloudAccount
	_ = facades.Orm().Query().
		Where("user_id", userID).
		Order("is_default desc, id desc").
		Get(&accounts)

	clouds := make([]map[string]any, 0, len(accounts))
	var totalUsed, totalCapacity int64

	for _, acc := range accounts {
		resp := acc.ToResponse()
		clouds = append(clouds, resp)
		totalUsed += acc.UsedStorage
		totalCapacity += acc.TotalStorage
	}

	// 2. Suggested files (starred + recent)
	suggestedFiles, _ := s.getSuggestedFiles(ctx, userID)

	// 3. Recent activities
	activities, _ := s.activityService.GetRecent(userID, 8)
	actData := make([]map[string]any, 0, len(activities))
	for _, a := range activities {
		actData = append(actData, a.ToResponse())
	}

	// 4. Storage summary
	percent := 0.0
	if totalCapacity > 0 {
		percent = float64(totalUsed) / float64(totalCapacity) * 100
	}

	return &DashboardSummary{
		Clouds:           clouds,
		SuggestedFiles:   suggestedFiles,
		RecentActivities: actData,
		TotalStorage: StorageSummary{
			UsedBytes:  totalUsed,
			TotalBytes: totalCapacity,
			UsedHuman:  humanizeBytes(totalUsed),
			TotalHuman: humanizeBytes(totalCapacity),
			Percent:    percent,
		},
	}, nil
}

func (s *DashboardService) getSuggestedFiles(ctx context.Context, userID uint) ([]map[string]any, error) {
	var items []models.DriveItem

	// Starred files first (limit 4)
	_ = facades.Orm().Query().
		Where("user_id", userID).
		Where("is_starred", true).
		Where("status", models.ItemStatusReady).
		Order("updated_at desc").
		Limit(4).
		Get(&items)

	// Fill remaining with recent non-starred (last 7 days)
	if len(items) < 8 {
		var recent []models.DriveItem
		sevenDaysAgo := time.Now().AddDate(0, 0, -7)
		_ = facades.Orm().Query().
			Where("user_id", userID).
			Where("is_starred", false).
			Where("status", models.ItemStatusReady).
			Where("updated_at > ?", sevenDaysAgo).
			Order("updated_at desc").
			Limit(8 - len(items)).
			Get(&recent)
		items = append(items, recent...)
	}

	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result = append(result, item.ToResponse())
	}
	return result, nil
}

func humanizeBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
go test ./app/services -run TestDashboardService -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/dashboard_service.go backend/app/services/dashboard_service_test.go
git commit -m "feat(service): add DashboardService for Home aggregation

- Aggregates clouds, suggested files, activities, storage
- Smart file suggestions: starred + recent (7 days)
- Human-readable storage formatting (KB/MB/GB)
- Single service call for entire dashboard"
```

---

## Task 7: Update CloudAccount Model - Add sync_status Fields

**Files:**
- Modify: `backend/app/models/cloud_account.go:34-43`
- Modify: `backend/app/models/cloud_account.go:79-106`

**Interfaces:**
- Consumes: Existing `CloudAccount` struct, new `sync_status` and `last_synced_at` columns
- Produces: Updated struct with SyncStatus, LastSyncedAt fields and updated ToResponse()

- [ ] **Step 1: Write test**

Add to `backend/app/models/cloud_account_test.go` (create if not exists):

```go
package models

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestCloudAccount_ToResponse_WithSyncStatus(t *testing.T) {
	lastSynced := time.Now()
	account := CloudAccount{
		ID:            1,
		UserID:        10,
		Name:          "Test S3",
		Provider:      ProviderS3,
		IsDefault:     true,
		IsActive:      true,
		SyncStatus:    "idle",
		LastSyncedAt:  &lastSynced,
		TotalStorage:  1000000,
		UsedStorage:   500000,
	}

	// Set dummy encrypted credentials
	creds := &S3Credentials{
		Endpoint:    "s3.amazonaws.com",
		Bucket:      "test-bucket",
		Region:      "us-east-1",
		AccessKeyID: "AKIATEST",
	}
	_ = account.SetCredentials(creds)

	resp := account.ToResponse()

	assert.Equal(t, "idle", resp["sync_status"])
	assert.NotNil(t, resp["last_synced_at"])
	assert.Contains(t, resp["last_synced_at"].(string), "2026")
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
go test ./app/models -run TestCloudAccount_ToResponse_WithSyncStatus -v
```

Expected: FAIL with "unknown field SyncStatus"

- [ ] **Step 3: Update CloudAccount struct**

In `backend/app/models/cloud_account.go`, update the struct (around line 34):

```go
type CloudAccount struct {
	orm.Model
	UserID         uint       `gorm:"column:user_id;index;not null" json:"user_id"`
	Name           string     `gorm:"column:name;size:100;not null" json:"name"`
	Provider       string     `gorm:"column:provider;size:50;not null;index" json:"provider"`
	Credentials    string     `gorm:"column:credentials;type:text;not null" json:"-"`
	IsDefault      bool       `gorm:"column:is_default;default:false" json:"is_default"`
	IsActive       bool       `gorm:"column:is_active;default:true" json:"is_active"`
	SyncStatus     string     `gorm:"column:sync_status;type:enum('idle','syncing','error');default:idle" json:"sync_status"`
	LastSyncedAt   *time.Time `gorm:"column:last_synced_at" json:"last_synced_at"`
	TotalStorage   int64      `gorm:"column:total_storage;default:0" json:"total_storage"`
	UsedStorage    int64      `gorm:"column:used_storage;default:0" json:"used_storage"`
	orm.SoftDeletes
}
```

- [ ] **Step 4: Update ToResponse method**

In `backend/app/models/cloud_account.go`, update ToResponse (around line 79):

```go
func (c *CloudAccount) ToResponse() map[string]any {
	var safeCreds map[string]any
	if creds, err := c.GetCredentials(); err == nil && creds != nil {
		safeCreds = map[string]any{
			"endpoint":       creds.Endpoint,
			"bucket":         creds.Bucket,
			"region":         creds.Region,
			"access_key_id":  creds.AccessKeyID,
			"use_path_style": creds.UsePathStyle,
			"public_url":     creds.PublicURL,
		}
	}

	var lastSynced any = nil
	if c.LastSyncedAt != nil {
		lastSynced = c.LastSyncedAt.Format(time.RFC3339)
	}

	return map[string]any{
		"id":              c.ID,
		"user_id":         c.UserID,
		"name":            c.Name,
		"provider":        c.Provider,
		"credentials":     safeCreds,
		"is_default":      c.IsDefault,
		"is_active":       c.IsActive,
		"sync_status":     c.SyncStatus,
		"last_synced_at":  lastSynced,
		"total_storage":   c.TotalStorage,
		"used_storage":    c.UsedStorage,
		"created_at":      c.CreatedAt,
		"updated_at":      c.UpdatedAt,
	}
}
```

- [ ] **Step 5: Add time import if missing**

At top of `cloud_account.go`, ensure time is imported:

```go
import (
	"encoding/json"
	"errors"
	"time"  // Add this if missing

	"github.com/goravel/framework/database/orm"
	"ponta_drive/app/facades"
)
```

- [ ] **Step 6: Run test to verify it passes**

```bash
go test ./app/models -run TestCloudAccount_ToResponse_WithSyncStatus -v
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/cloud_account.go backend/app/models/cloud_account_test.go
git commit -m "feat(model): add sync_status tracking to CloudAccount

- SyncStatus enum field: idle, syncing, error
- LastSyncedAt timestamp for UI display
- Updated ToResponse with new fields
- Test coverage for sync status serialization"
```

---

## Execution Plan Summary

**Backend (Tasks 1-13):**
1. Migrations: activity_logs table + sync_status fields
2. Models: ActivityLog with IP/UserAgent tracking
3. Helpers: GetClientIP, GetUserAgent
4. Services: ActivityService, DashboardService
5. Controller: DashboardController
6. Routes: Register /v1/dashboard/summary
7. Integration: Log activities in Upload, DriveItem, CloudAccount controllers
8. Jobs: Update sync status in SyncS3BucketJob

**Frontend (Tasks 14-15):**
1. API client with TypeScript interfaces
2. HomeView integration replacing mock data

**Testing Strategy:**
- Unit tests for each service/model
- Integration test for dashboard endpoint
- Manual E2E test: login → dashboard → verify data

**Estimated Time:** 4-6 hours for backend + 2 hours for frontend = 6-8 hours total

---

## Final Commit

After all tasks complete:

```bash
git add .
git commit -m "feat: complete Home dashboard backend integration

- Activity logging with IP/UserAgent for audit trail
- Dashboard aggregation service (clouds, files, activities, storage)
- Sync status tracking for cloud accounts
- REST endpoint /v1/dashboard/summary
- Frontend API client and HomeView integration

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```


---

## Task 8: Controller - DashboardController

**Files:** Create `backend/app/http/controllers/dashboard_controller.go`

**Steps:**
1. Create controller with `NewDashboardController()` and `Summary(ctx)` method
2. Use `services.DashboardService.GetSummary()` to fetch data
3. Return JSON with status ok and data
4. Commit: "feat(controller): add DashboardController"

---

## Task 9: Routes - Register Dashboard Endpoint

**Files:** Modify `backend/routes/web.go`

**Steps:**
1. Initialize `dashboardController := controllers.NewDashboardController()`
2. Register route: `v1.Get("/dashboard/summary", dashboardController.Summary)`
3. Test with curl/Postman
4. Commit: "feat(routes): register dashboard summary endpoint"

---

## Task 10: Integration - Log Upload Activities

**Files:** Modify `backend/app/http/controllers/upload_controller.go`

**Steps:**
1. Add imports: `helpers`, `services`
2. In `CompletePresigned` and `CompleteMultipart`: after successful upload, call `activityService.Log()` with action="uploaded"
3. Include IP/UserAgent via helpers.GetClientIP/GetUserAgent
4. Metadata: file size and MIME type
5. Commit: "feat(upload): log upload activities with IP/UserAgent"

---

## Task 11: Integration - Log DriveItem Activities

**Files:** Modify `backend/app/http/controllers/drive_item_controller.go`

**Steps:**
1. `StoreFolder`: log action="created_folder" after successful creation
2. `Destroy`: log action="deleted" or "permanently_deleted" after deletion
3. `Update`: log action="renamed" if name changed
4. All logs include IP/UserAgent
5. Commit: "feat(drive): log folder and file operations"

---

## Task 12: Integration - Update CloudAccountController Sync

**Files:** Modify `backend/app/http/controllers/cloud_account_controller.go`

**Steps:**
1. In `Sync` method: before dispatching job, update `sync_status='syncing'`
2. Log activity with action="sync_started"
3. In `SyncS3BucketJob` (after sync completes): update `sync_status='idle'`, set `last_synced_at=now()`
4. Log activity with action="synced" including items_count in metadata
5. Commit: "feat(sync): track sync status and log activities"

---

## Task 13: Frontend - Dashboard API Client

**Files:** Create `frontend/src/api/dashboard.ts`

**Steps:**
1. Define TypeScript interfaces: `CloudAccount`, `DriveItem`, `Activity`, `StorageSummary`, `DashboardSummary`
2. Create function `fetchDashboardSummary(): Promise<ApiResponse<DashboardSummary>>`
3. Use existing `fetchApi` with endpoint `/v1/dashboard/summary`
4. Export all interfaces and function
5. Commit: "feat(frontend): add dashboard API client with TypeScript"

**Code outline:**
```typescript
export interface CloudAccount {
  id: number
  name: string
  provider: string
  sync_status: 'idle' | 'syncing' | 'error'
  total_storage: number
  used_storage: number
  // ...
}

export interface DashboardSummary {
  clouds: CloudAccount[]
  suggested_files: DriveItem[]
  recent_activities: Activity[]
  total_storage: StorageSummary
}

export async function fetchDashboardSummary() {
  return fetchApi<ApiResponse<DashboardSummary>>('/v1/dashboard/summary')
}
```

---

## Task 14: Frontend - HomeView Integration

**Files:** Modify `frontend/src/views/HomeView.vue`

**Steps:**
1. Import `fetchDashboardSummary` and types from `@/api/dashboard`
2. Replace `ref` mock data with `ref<DashboardSummary | null>(null)`
3. In `onMounted`: call `fetchDashboardSummary()`, handle loading/error states
4. Update computed properties to use real data from API
5. Map activity actions to i18n translation keys
6. Test: login → navigate to home → verify real data displays
7. Commit: "feat(frontend): integrate HomeView with dashboard API"

**Key changes:**
```typescript
const loading = ref(true)
const dashboard = ref<DashboardSummary | null>(null)

onMounted(async () => {
  try {
    const response = await fetchDashboardSummary()
    dashboard.value = response.data
  } catch (err) {
    toast.error(t('home.load_failed'))
  } finally {
    loading.value = false
  }
})

const clouds = computed(() => dashboard.value?.clouds || [])
const suggestedFiles = computed(() => dashboard.value?.suggested_files || [])
// ...
```

---

## Execution Summary

**Total Tasks: 14**
- Backend: Tasks 1-12 (migrations, models, services, controllers, integration)
- Frontend: Tasks 13-14 (API client, HomeView)

**Critical Path:**
1. Migrations → Models → Services (Tasks 1-6)
2. Controllers → Routes (Tasks 7-9)
3. Integration logging (Tasks 10-12)
4. Frontend (Tasks 13-14)

**Testing Checklist:**
- [ ] All unit tests pass: `go test ./...`
- [ ] Migration successful: tables created with correct schema
- [ ] Dashboard endpoint returns 200 with correct JSON structure
- [ ] Activities logged on upload/delete/rename with IP/UserAgent
- [ ] Frontend loads real data without errors
- [ ] No console errors in browser DevTools

**Time Estimate:** 6-8 hours total

