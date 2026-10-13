package services

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/goravel/framework/contracts/database/orm"
	"github.com/goravel/framework/support/carbon"

	"ponta_drive/app/contracts"
	"ponta_drive/app/facades"
	"ponta_drive/app/models"
	"ponta_drive/app/services/storage"
)

// CloudDriveService orchestrates file hierarchy management and cloud storage operations.
type CloudDriveService struct {
	factory *storage.DriverFactory
}

func NewCloudDriveService() *CloudDriveService {
	return &CloudDriveService{
		factory: storage.NewDriverFactory(),
	}
}

// GetDriver resolves a CloudDriver and verifies ownership of the CloudAccount.
func (s *CloudDriveService) GetDriver(ctx context.Context, userID uint, cloudAccountID uint) (contracts.CloudDriver, *models.CloudAccount, error) {
	var account models.CloudAccount
	err := facades.Orm().Query().
		Where("id", cloudAccountID).
		Where("user_id", userID).
		First(&account)
	if err != nil || account.ID == 0 {
		return nil, nil, errors.New("cloud account not found or access denied")
	}

	driver, err := s.factory.DriverForAccount(ctx, &account)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to initialize driver: %w", err)
	}

	return driver, &account, nil
}

// EnsureCloudAccountOwnership verifies the numeric cloud account id belongs to
// the user. The API speaks the numeric id directly, so this is the ownership
// gate every input path shares; it returns a generic error that callers map to
// a user-facing message.
func (s *CloudDriveService) EnsureCloudAccountOwnership(ctx context.Context, userID uint, cloudAccountID uint) error {
	if cloudAccountID == 0 {
		return errors.New("cloud account id is required")
	}

	var account models.CloudAccount
	err := facades.Orm().Query().
		Where("id", cloudAccountID).
		Where("user_id", userID).
		First(&account)
	if err != nil || account.ID == 0 {
		return errors.New("cloud account not found or access denied")
	}

	return nil
}

// ResolveDriveItemID maps a public item uuid to its numeric id, scoped to the
// user and (when non-empty) the owning account.
func (s *CloudDriveService) ResolveDriveItemID(ctx context.Context, userID uint, itemUUID string) (uint, error) {
	if itemUUID == "" {
		return 0, errors.New("item uuid is required")
	}

	var item models.DriveItem
	err := facades.Orm().Query().
		Where("uuid", itemUUID).
		Where("user_id", userID).
		First(&item)
	if err != nil || item.ID == 0 {
		return 0, errors.New("item not found")
	}

	return item.ID, nil
}

// CreateFolder creates a virtual folder under the specified parent directory.
func (s *CloudDriveService) CreateFolder(ctx context.Context, userID uint, cloudAccountID uint, parentID *uint, name string) (*models.DriveItem, error) {
	// Verify account belongs to user
	var account models.CloudAccount
	err := facades.Orm().Query().
		Where("id", cloudAccountID).
		Where("user_id", userID).
		First(&account)
	if err != nil || account.ID == 0 {
		return nil, errors.New("invalid cloud account")
	}

	// If parentID provided, verify it exists and is a folder
	if parentID != nil && *parentID > 0 {
		var parent models.DriveItem
		err := facades.Orm().Query().
			Where("id", *parentID).
			Where("user_id", userID).
			Where("cloud_account_id", cloudAccountID).
			First(&parent)
		if err != nil || parent.ID == 0 {
			return nil, errors.New("parent folder not found")
		}
		if !parent.IsFolder() {
			return nil, errors.New("parent item is not a folder")
		}
	}

	trimmedName := strings.TrimSpace(name)
	if err := ValidateItemName(trimmedName); err != nil {
		return nil, err
	}
	if err := s.EnsureUniqueName(ctx, userID, cloudAccountID, parentID, trimmedName, 0); err != nil {
		return nil, err
	}

	folder := &models.DriveItem{
		UUID:           uuid.New().String(),
		UserID:         userID,
		CloudAccountID: cloudAccountID,
		ParentID:       parentID,
		Name:           trimmedName,
		Type:           models.ItemTypeFolder,
		Status:         models.ItemStatusReady,
	}

	if err := facades.Orm().Query().Create(folder); err != nil {
		return nil, fmt.Errorf("failed to create folder: %w", err)
	}

	return folder, nil
}

// ListItems queries one page of items for a given cloud account and parent
// directory.
//
// Results are ordered folders-first, then by sortField/sortOrder, then by id.
// The id tier is not decoration: without it the ordering is not total, and rows
// that share a sort value - routine for updated_at, which has one-second
// granularity - would shuffle between pages, so a paging client would see some
// items twice and never see others.
//
// An empty cursor means the first page. A non-empty limit is required; callers
// pass limit+1 and trim, so has_more can be decided without a COUNT.
func (s *CloudDriveService) ListItems(ctx context.Context, userID uint, cloudAccountID uint, parentID *uint, search string, itemType string, sortField string, sortOrder string, cursor DriveCursor, limit int) ([]models.DriveItem, error) {
	orderCol := NormalizeSortField(sortField)
	orderDir := NormalizeSortOrder(sortOrder)

	query := facades.Orm().Query().
		Where("user_id", userID).
		Where("cloud_account_id", cloudAccountID)

	// A search spans the whole account rather than the folder in view, so the
	// parent_id constraint is dropped when a term is present. Browsing (no
	// term) stays scoped to the current folder.
	trimmedSearch := strings.TrimSpace(search)
	if trimmedSearch != "" {
		query = query.Where("name LIKE ?", "%"+trimmedSearch+"%")
	} else if parentID == nil || *parentID == 0 {
		query = query.Where("parent_id IS NULL")
	} else {
		query = query.Where("parent_id", *parentID)
	}

	if itemType == models.ItemTypeFolder || itemType == models.ItemTypeFile {
		query = query.Where("type", itemType)
	}

	// A cursor only means something inside the ordering that produced it. If
	// the caller changed `sort` or `order` since, the position is meaningless
	// and is ignored, so the request degrades to a first page instead of
	// comparing, say, a name against the size column.
	if cursor.ID > 0 && cursor.Matches(orderCol, orderDir) {
		cond, args := BuildCursorWhere(cursor, orderCol, orderDir)
		query = query.Where(cond, args...)
	}

	if limit <= 0 {
		limit = 50
	}

	// ORDER BY type DESC replaces the old
	// `CASE WHEN type = 'folder' THEN 0 ELSE 1 END`: 'file' sorts before
	// 'folder' alphabetically, so descending puts folders first while still
	// being a plain column reference the index can serve.
	var items []models.DriveItem
	if err := query.
		Order("type DESC").
		Order(orderCol + " " + orderDir).
		Order("id ASC").
		Limit(limit).
		Get(&items); err != nil {
		return nil, err
	}

	return items, nil
}

// GetItemByUUID returns an item by public UUID.
func (s *CloudDriveService) GetItemByUUID(ctx context.Context, userID uint, itemUUID string) (*models.DriveItem, error) {
	var item models.DriveItem
	err := facades.Orm().Query().
		Where("uuid", itemUUID).
		Where("user_id", userID).
		First(&item)
	if err != nil || item.ID == 0 {
		return nil, errors.New("item not found")
	}
	return &item, nil
}

// GetBreadcrumb returns the ancestor chain for a folder, ordered root first and
// ending with the folder itself. A client renders it as the breadcrumb and uses
// the first entry to know it is at the top.
//
// The walk is bounded by a visited set: a corrupted `parent_id` cycle would
// otherwise loop forever, and a depth cap keeps a pathologically deep tree from
// issuing an unbounded number of queries.
func (s *CloudDriveService) GetBreadcrumb(ctx context.Context, userID uint, itemUUID string) ([]models.DriveItem, error) {
	item, err := s.GetItemByUUID(ctx, userID, itemUUID)
	if err != nil {
		return nil, err
	}

	const maxDepth = 100
	chain := []models.DriveItem{*item}
	visited := map[uint]bool{item.ID: true}

	current := item
	for current.ParentID != nil && *current.ParentID > 0 {
		if len(chain) >= maxDepth {
			break
		}

		parentID := *current.ParentID
		if visited[parentID] {
			// A cycle: stop rather than loop. The chain stays usable.
			break
		}

		var parent models.DriveItem
		if err := facades.Orm().Query().
			Where("id", parentID).
			Where("user_id", userID).
			First(&parent); err != nil || parent.ID == 0 {
			// A dangling parent (deleted out from under us): stop at the last
			// resolvable entry rather than fail the whole breadcrumb.
			break
		}

		visited[parent.ID] = true
		chain = append(chain, parent)
		current = &parent
	}

	// The walk produced child -> ... -> root; the caller wants root first.
	for i, j := 0, len(chain)-1; i < j; i, j = i+1, j-1 {
		chain[i], chain[j] = chain[j], chain[i]
	}

	return chain, nil
}

// ValidateMove resolves and checks a rename/move without writing anything: the
// item exists, the destination is an existing folder in the same account, the
// move cannot create a cycle, and the resulting name is valid and unique in its
// destination folder. It returns the item as it is today (unchanged) so the
// caller can log against the current name.
func (s *CloudDriveService) ValidateMove(ctx context.Context, userID uint, itemUUID string, newName string, newParentID *uint) (*models.DriveItem, error) {
	item, err := s.GetItemByUUID(ctx, userID, itemUUID)
	if err != nil {
		return nil, err
	}

	if newParentID != nil {
		if *newParentID == item.ID {
			return nil, errors.New("an item cannot be its own parent")
		}
		if *newParentID > 0 {
			var parent models.DriveItem
			err := facades.Orm().Query().
				Where("id", *newParentID).
				Where("user_id", userID).
				Where("cloud_account_id", item.CloudAccountID).
				First(&parent)
			if err != nil || parent.ID == 0 {
				return nil, errors.New("destination folder not found")
			}
			if !parent.IsFolder() {
				return nil, errors.New("destination is not a folder")
			}
			// Prevent cycles: the destination must not be the item itself or one
			// of its own descendants.
			if s.isSelfOrDescendant(userID, item.CloudAccountID, *newParentID, item.ID) {
				return nil, errors.New("cannot move a folder into itself or its own subfolder")
			}
		}
	}

	// The name the item will carry once the move settles. A rename is validated
	// only when the caller supplies one: an existing item may predate the rule.
	finalName := item.Name
	if trimmed := strings.TrimSpace(newName); trimmed != "" {
		if err := ValidateItemName(trimmed); err != nil {
			return nil, err
		}
		finalName = trimmed
	}

	// The folder the item will live in once the move settles. A non-nil pointer
	// to 0 means "the drive root", which is parent_id IS NULL.
	destParentID := item.ParentID
	if newParentID != nil {
		if *newParentID == 0 {
			destParentID = nil
		} else {
			destParentID = newParentID
		}
	}

	if err := s.EnsureUniqueName(ctx, userID, item.CloudAccountID, destParentID, finalName, item.ID); err != nil {
		return nil, err
	}

	return item, nil
}

// ApplyMove performs the database part of a rename/move: it writes the item's
// new name, parent_id and storage_path (when one is supplied) and marks it
// ready. Destination and name checks belong to ValidateMove, which must run
// first. A settled move always ends at status = ready, so this also clears the
// "moving" marker the controller sets before dispatching a re-key job.
func (s *CloudDriveService) ApplyMove(ctx context.Context, userID uint, itemUUID string, newName string, newParentID *uint, newStoragePath string) (*models.DriveItem, error) {
	item, err := s.GetItemByUUID(ctx, userID, itemUUID)
	if err != nil {
		return nil, err
	}

	if strings.TrimSpace(newName) != "" {
		item.Name = strings.TrimSpace(newName)
	}

	if newParentID != nil {
		if *newParentID > 0 {
			item.ParentID = newParentID
		} else {
			item.ParentID = nil
		}
	}

	if newStoragePath != "" {
		item.StoragePath = newStoragePath
	}

	item.Status = models.ItemStatusReady

	if err := facades.Orm().Query().Save(item); err != nil {
		return nil, err
	}

	return item, nil
}

// isSelfOrDescendant reports whether startID equals targetID or has targetID as
// an ancestor. It walks the parent chain upward, guarded by a visited set
// against pre-existing cycles and a depth cap against runaway trees.
func (s *CloudDriveService) isSelfOrDescendant(userID uint, cloudAccountID uint, startID uint, targetID uint) bool {
	const maxDepth = 10000
	visited := map[uint]bool{}
	current := startID
	for depth := 0; current != 0 && depth < maxDepth; depth++ {
		if current == targetID {
			return true
		}
		if visited[current] {
			break
		}
		visited[current] = true

		var node models.DriveItem
		if err := facades.Orm().Query().
			Where("id", current).
			Where("user_id", userID).
			Where("cloud_account_id", cloudAccountID).
			First(&node); err != nil || node.ID == 0 {
			break
		}
		if node.ParentID == nil {
			break
		}
		current = *node.ParentID
	}
	return false
}

// ToggleStar toggles the starred status of an item.
func (s *CloudDriveService) ToggleStar(ctx context.Context, userID uint, itemUUID string) (*models.DriveItem, error) {
	item, err := s.GetItemByUUID(ctx, userID, itemUUID)
	if err != nil {
		return nil, err
	}

	item.IsStarred = !item.IsStarred
	if err := facades.Orm().Query().Save(item); err != nil {
		return nil, err
	}

	return item, nil
}

// DeleteItem deletes an item (soft-delete or permanent delete). For folders with
// permanent=true, all descendant files and folders are recursively deleted and
// used_storage is decremented.
func (s *CloudDriveService) DeleteItem(ctx context.Context, userID uint, itemUUID string, permanent bool) error {
	item, err := s.GetItemByUUID(ctx, userID, itemUUID)
	if err != nil {
		return err
	}

	if !permanent {
		_, err = facades.Orm().Query().Delete(item)
		return err
	}

	// Permanent delete path
	driver, account, driverErr := s.GetDriver(ctx, userID, item.CloudAccountID)
	if driverErr != nil {
		// Log internally only: the S3 delete is skipped, but the row deletion below
		// still proceeds so the item is not orphaned in the DB. The error is never
		// returned to the client.
		facades.Log().Warningf("[Drive] Failed to initialize storage driver for item %s (user %d) during permanent delete: %v", itemUUID, userID, driverErr)
	}

	if item.IsFile() {
		if driverErr == nil && driver != nil && item.StoragePath != "" {
			_ = driver.Delete(ctx, item.StoragePath)
		}
		if _, err := facades.Orm().Query().ForceDelete(item); err != nil {
			return err
		}
		if account != nil && item.Size > 0 {
			newUsed := account.UsedStorage - item.Size
			if newUsed < 0 {
				newUsed = 0
			}
			account.UsedStorage = newUsed
			_ = facades.Orm().Query().Save(account)
		}
		return nil
	}

	// Folder permanent delete: collect all descendants
	allItems, keys, totalSize, collectErr := s.CollectDescendantItems(ctx, userID, item.CloudAccountID, item.ID)
	if collectErr != nil {
		return collectErr
	}

	// Batch delete from S3 driver
	if driverErr == nil && driver != nil && len(keys) > 0 {
		if batchErr := driver.DeleteObjects(ctx, keys); batchErr != nil {
			facades.Log().Warningf("[Drive] Failed to batch delete %d objects for folder %s: %v", len(keys), itemUUID, batchErr)
		}
	}

	// Force delete rows in batch
	ids := make([]uint, 0, len(allItems))
	for _, it := range allItems {
		ids = append(ids, it.ID)
	}

	if len(ids) > 0 {
		if _, err := facades.Orm().Query().Where("id IN (?)", ids).ForceDelete(&models.DriveItem{}); err != nil {
			return err
		}
	}

	// Decrement used_storage floored at 0
	if account != nil && totalSize > 0 {
		newUsed := account.UsedStorage - totalSize
		if newUsed < 0 {
			newUsed = 0
		}
		account.UsedStorage = newUsed
		_ = facades.Orm().Query().Save(account)
	}

	return nil
}

// CollectDescendantItems walks the folder subtree via BFS starting from rootFolderID,
// guarded by a visited set against cycles. It returns all collected DriveItems (including
// root), all non-empty file storage keys, and the total size of files.
func (s *CloudDriveService) CollectDescendantItems(ctx context.Context, userID uint, cloudAccountID uint, rootFolderID uint) ([]models.DriveItem, []string, int64, error) {
	var root models.DriveItem
	err := facades.Orm().Query().
		Where("id", rootFolderID).
		Where("user_id", userID).
		Where("cloud_account_id", cloudAccountID).
		First(&root)
	if err != nil || root.ID == 0 {
		return nil, nil, 0, errors.New("root item not found")
	}

	queue := []uint{root.ID}
	visited := map[uint]bool{root.ID: true}
	allItems := []models.DriveItem{root}
	var keys []string
	var totalSize int64

	const maxItems = 10000

	for len(queue) > 0 {
		if len(allItems) >= maxItems {
			break
		}
		currentID := queue[0]
		queue = queue[1:]

		var children []models.DriveItem
		err := facades.Orm().Query().
			Where("user_id", userID).
			Where("cloud_account_id", cloudAccountID).
			Where("parent_id", currentID).
			Get(&children)
		if err != nil {
			return nil, nil, 0, err
		}

		for _, child := range children {
			if visited[child.ID] {
				continue
			}
			visited[child.ID] = true
			allItems = append(allItems, child)

			if child.IsFolder() {
				queue = append(queue, child.ID)
			} else if child.IsFile() {
				if child.StoragePath != "" {
					keys = append(keys, child.StoragePath)
				}
				if child.Size > 0 {
					totalSize += child.Size
				}
			}
		}
	}

	return allItems, keys, totalSize, nil
}

// InitiatePresignedUpload creates a pending DriveItem and generates an S3 Presigned Upload URL.
func (s *CloudDriveService) InitiatePresignedUpload(ctx context.Context, userID uint, cloudAccountID uint, parentID *uint, fileName string, size int64, mimeType string) (*models.DriveItem, *contracts.PresignedURLResponse, error) {
	driver, _, err := s.GetDriver(ctx, userID, cloudAccountID)
	if err != nil {
		return nil, nil, err
	}

	if parentID != nil && *parentID > 0 {
		var parent models.DriveItem
		err := facades.Orm().Query().
			Where("id", *parentID).
			Where("user_id", userID).
			Where("cloud_account_id", cloudAccountID).
			First(&parent)
		if err != nil || parent.ID == 0 || !parent.IsFolder() {
			return nil, nil, errors.New("parent folder not found or is not a folder")
		}
	}

	if err := ValidateItemName(fileName); err != nil {
		return nil, nil, err
	}
	if err := s.EnsureUniqueName(ctx, userID, cloudAccountID, parentID, fileName, 0); err != nil {
		return nil, nil, err
	}

	fileExt := strings.TrimPrefix(filepath.Ext(fileName), ".")
	fp, err := s.folderPath(ctx, userID, cloudAccountID, parentID)
	if err != nil {
		return nil, nil, err
	}
	storageKey := buildStorageKey(userID, fp, fileName)

	item := &models.DriveItem{
		UUID:           uuid.New().String(),
		UserID:         userID,
		CloudAccountID: cloudAccountID,
		ParentID:       parentID,
		Name:           fileName,
		Type:           models.ItemTypeFile,
		MimeType:       mimeType,
		Size:           size,
		Extension:      fileExt,
		StoragePath:    storageKey,
		Status:         models.ItemStatusUploading,
	}

	if err := facades.Orm().Query().Create(item); err != nil {
		return nil, nil, fmt.Errorf("failed to create pending drive item: %w", err)
	}

	presignedResp, err := driver.GetPresignedUploadURL(ctx, storageKey, mimeType, 15*time.Minute)
	if err != nil {
		_, _ = facades.Orm().Query().ForceDelete(item)
		return nil, nil, fmt.Errorf("failed to generate presigned upload url: %w", err)
	}

	return item, presignedResp, nil
}

// CompletePresignedUpload verifies the uploaded object on S3 and marks the DriveItem as ready.
func (s *CloudDriveService) CompletePresignedUpload(ctx context.Context, userID uint, itemUUID string) (*models.DriveItem, error) {
	item, err := s.GetItemByUUID(ctx, userID, itemUUID)
	if err != nil {
		return nil, err
	}

	driver, account, err := s.GetDriver(ctx, userID, item.CloudAccountID)
	if err != nil {
		return nil, err
	}

	meta, err := driver.GetMetadata(ctx, item.StoragePath)
	if err != nil {
		item.Status = models.ItemStatusFailed
		_ = facades.Orm().Query().Save(item)
		return nil, fmt.Errorf("uploaded file not found on storage: %w", err)
	}

	item.Status = models.ItemStatusReady
	item.ETag = meta.ETag
	if meta.Size > 0 {
		item.Size = meta.Size
	}
	if meta.MimeType != "" {
		item.MimeType = meta.MimeType
	}

	if err := facades.Orm().Query().Save(item); err != nil {
		return nil, fmt.Errorf("failed to finalize drive item: %w", err)
	}

	// Increment used storage on cloud account
	if account != nil && item.Size > 0 {
		account.UsedStorage += item.Size
		_ = facades.Orm().Query().Save(account)
	}

	return item, nil
}

// InitiateMultipartUpload starts an S3 multipart upload session and stores tracking metadata.
func (s *CloudDriveService) InitiateMultipartUpload(ctx context.Context, userID uint, cloudAccountID uint, parentID *uint, fileName string, size int64, mimeType string, chunkSize int64) (*models.UploadSession, error) {
	driver, _, err := s.GetDriver(ctx, userID, cloudAccountID)
	if err != nil {
		return nil, err
	}

	if parentID != nil && *parentID > 0 {
		var parent models.DriveItem
		err := facades.Orm().Query().
			Where("id", *parentID).
			Where("user_id", userID).
			Where("cloud_account_id", cloudAccountID).
			First(&parent)
		if err != nil || parent.ID == 0 {
			return nil, errors.New("parent folder not found")
		}
	}

	if err := ValidateItemName(fileName); err != nil {
		return nil, err
	}
	if err := s.EnsureUniqueName(ctx, userID, cloudAccountID, parentID, fileName, 0); err != nil {
		return nil, err
	}

	if chunkSize <= 0 {
		chunkSize = 5 * 1024 * 1024 // 5MB default chunk size
	}

	totalParts := int32((size + chunkSize - 1) / chunkSize)
	if totalParts < 1 {
		totalParts = 1
	}

	fp, err := s.folderPath(ctx, userID, cloudAccountID, parentID)
	if err != nil {
		return nil, err
	}
	storageKey := buildStorageKey(userID, fp, fileName)

	uploadID, err := driver.InitiateMultipart(ctx, storageKey, mimeType)
	if err != nil {
		return nil, fmt.Errorf("failed to initiate multipart upload on storage: %w", err)
	}

	now := carbon.Now()
	exp := now.AddDays(1)
	expDateTime := carbon.NewDateTime(exp)

	session := &models.UploadSession{
		SessionID:      uuid.New().String(),
		UploadID:       uploadID,
		UserID:         userID,
		CloudAccountID: cloudAccountID,
		ParentID:       parentID,
		FileName:       fileName,
		MimeType:       mimeType,
		TotalSize:      size,
		ChunkSize:      chunkSize,
		TotalParts:     totalParts,
		UploadedParts:  "[]",
		StoragePath:    storageKey,
		ExpiresAt:      expDateTime,
	}

	if err := facades.Orm().Query().Create(session); err != nil {
		_ = driver.AbortMultipart(ctx, storageKey, uploadID)
		return nil, fmt.Errorf("failed to save upload session: %w", err)
	}

	return session, nil
}

// UploadPart streams an uploaded chunk to S3 and records the part's ETag.
func (s *CloudDriveService) UploadPart(ctx context.Context, userID uint, sessionID string, partNumber int32, reader io.Reader, size int64) (string, *models.UploadSession, error) {
	var session models.UploadSession
	err := facades.Orm().Query().
		Where("session_id", sessionID).
		Where("user_id", userID).
		First(&session)
	if err != nil || session.ID == 0 {
		return "", nil, errors.New("upload session not found")
	}

	if session.ExpiresAt != nil && session.ExpiresAt.IsPast() {
		return "", nil, errors.New("upload session has expired")
	}

	driver, _, err := s.GetDriver(ctx, userID, session.CloudAccountID)
	if err != nil {
		return "", nil, err
	}

	etag, err := driver.UploadPart(ctx, session.StoragePath, session.UploadID, partNumber, reader, size)
	if err != nil {
		return "", nil, fmt.Errorf("failed to upload part %d: %w", partNumber, err)
	}

	if err := session.AddUploadedPart(contracts.CompletedPart{
		PartNumber: partNumber,
		ETag:       etag,
	}); err != nil {
		return "", nil, fmt.Errorf("failed to record uploaded part: %w", err)
	}

	if err := facades.Orm().Query().Save(&session); err != nil {
		return "", nil, fmt.Errorf("failed to update upload session: %w", err)
	}

	return etag, &session, nil
}

// CompleteMultipartUpload finalizes all parts on S3 and records the DriveItem.
func (s *CloudDriveService) CompleteMultipartUpload(ctx context.Context, userID uint, sessionID string) (*models.DriveItem, error) {
	var session models.UploadSession
	err := facades.Orm().Query().
		Where("session_id", sessionID).
		Where("user_id", userID).
		First(&session)
	if err != nil || session.ID == 0 {
		return nil, errors.New("upload session not found")
	}

	driver, account, err := s.GetDriver(ctx, userID, session.CloudAccountID)
	if err != nil {
		return nil, err
	}

	parts, err := session.GetUploadedParts()
	if err != nil || len(parts) == 0 {
		return nil, errors.New("no uploaded parts recorded for this session")
	}

	if err := driver.CompleteMultipart(ctx, session.StoragePath, session.UploadID, parts); err != nil {
		return nil, fmt.Errorf("failed to complete multipart upload: %w", err)
	}

	meta, err := driver.GetMetadata(ctx, session.StoragePath)
	fileExt := strings.TrimPrefix(filepath.Ext(session.FileName), ".")
	etag := ""
	fileSize := session.TotalSize

	if err == nil && meta != nil {
		etag = meta.ETag
		if meta.Size > 0 {
			fileSize = meta.Size
		}
	}

	item := &models.DriveItem{
		UUID:           uuid.New().String(),
		UserID:         userID,
		CloudAccountID: session.CloudAccountID,
		ParentID:       session.ParentID,
		Name:           session.FileName,
		Type:           models.ItemTypeFile,
		MimeType:       session.MimeType,
		Size:           fileSize,
		Extension:      fileExt,
		StoragePath:    session.StoragePath,
		ETag:           etag,
		Status:         models.ItemStatusReady,
	}

	if err := facades.Orm().Query().Create(item); err != nil {
		return nil, fmt.Errorf("failed to create drive item: %w", err)
	}

	// Update used storage
	if account != nil && item.Size > 0 {
		account.UsedStorage += item.Size
		_ = facades.Orm().Query().Save(account)
	}

	// Cleanup session record
	_, _ = facades.Orm().Query().Where("id", session.ID).Delete(&models.UploadSession{})

	return item, nil
}

// AbortMultipartUpload aborts an in-progress multipart upload on S3 and removes session.
func (s *CloudDriveService) AbortMultipartUpload(ctx context.Context, userID uint, sessionID string) error {
	var session models.UploadSession
	err := facades.Orm().Query().
		Where("session_id", sessionID).
		Where("user_id", userID).
		First(&session)
	if err != nil || session.ID == 0 {
		return errors.New("upload session not found")
	}

	driver, _, err := s.GetDriver(ctx, userID, session.CloudAccountID)
	if err == nil {
		_ = driver.AbortMultipart(ctx, session.StoragePath, session.UploadID)
	}

	_, _ = facades.Orm().Query().Where("id", session.ID).Delete(&models.UploadSession{})
	return nil
}

// GetPresignedDownloadURL generates a temporary secure download URL for an item.
func (s *CloudDriveService) GetPresignedDownloadURL(ctx context.Context, userID uint, itemUUID string, expire time.Duration) (string, *models.DriveItem, error) {
	item, err := s.GetItemByUUID(ctx, userID, itemUUID)
	if err != nil {
		return "", nil, err
	}

	if item.Type == models.ItemTypeFolder {
		return "", nil, errors.New("cannot generate download url for a folder")
	}

	driver, _, err := s.GetDriver(ctx, userID, item.CloudAccountID)
	if err != nil {
		return "", nil, err
	}

	url, err := driver.GetPresignedDownloadURL(ctx, item.StoragePath, item.Name, expire)
	if err != nil {
		return "", nil, fmt.Errorf("failed to generate presigned download url: %w", err)
	}

	return url, item, nil
}

// GetItemStream returns an io.ReadCloser to stream object content from S3.
func (s *CloudDriveService) GetItemStream(ctx context.Context, userID uint, itemUUID string) (io.ReadCloser, *models.DriveItem, error) {
	item, err := s.GetItemByUUID(ctx, userID, itemUUID)
	if err != nil {
		return nil, nil, err
	}

	if item.Type == models.ItemTypeFolder {
		return nil, nil, errors.New("cannot stream a folder")
	}

	driver, _, err := s.GetDriver(ctx, userID, item.CloudAccountID)
	if err != nil {
		return nil, nil, err
	}

	body, err := driver.Get(ctx, item.StoragePath)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get storage object: %w", err)
	}

	return body, item, nil
}

// GetItemRange returns a byte range of an item's object plus its total size.
func (s *CloudDriveService) GetItemRange(ctx context.Context, userID uint, itemUUID string, offset int64, length int64) (io.ReadCloser, int64, error) {
	item, err := s.GetItemByUUID(ctx, userID, itemUUID)
	if err != nil {
		return nil, 0, err
	}
	if item.Type == models.ItemTypeFolder {
		return nil, 0, errors.New("cannot read a folder")
	}

	driver, _, err := s.GetDriver(ctx, userID, item.CloudAccountID)
	if err != nil {
		return nil, 0, err
	}

	return driver.GetRange(ctx, item.StoragePath, offset, length)
}

// ScanBucket recursively scans an S3 bucket and synchronizes its objects into virtual DriveItem folders and files.
func (s *CloudDriveService) ScanBucket(ctx context.Context, userID uint, cloudAccountID uint, parentID *uint) (int, error) {
	driver, account, err := s.GetDriver(ctx, userID, cloudAccountID)
	if err != nil {
		return 0, err
	}

	syncedCount := 0
	var continuationToken string

	for {
		result, err := driver.ListObjects(ctx, "", continuationToken, 1000)
		if err != nil {
			return syncedCount, fmt.Errorf("failed to list objects: %w", err)
		}

		for _, obj := range result.Objects {
			key := strings.TrimPrefix(obj.Key, "/")
			if key == "" {
				continue
			}

			shape, recoveredName := classifyKey(userID, key)

			if shape == scanShapeLegacy {
				// A tracked row (same storage_path) is authoritative: refresh the
				// metadata S3 owns and keep its ParentID. When the row is gone — the
				// database was reset while the bucket still holds the object —
				// recover the user-facing name and re-attach the file at the scan
				// root, so the drive shows "file.docx" instead of a phantom
				// users/<id>/items tree holding a uuid-prefixed name.
				var tracked models.DriveItem
				_ = facades.Orm().Query().
					Where("user_id", userID).
					Where("cloud_account_id", cloudAccountID).
					Where("storage_path", obj.Key).
					First(&tracked)

				if tracked.ID > 0 {
					tracked.Size = obj.Size
					tracked.ETag = obj.ETag
					tracked.Status = models.ItemStatusReady
					_ = facades.Orm().Query().Save(&tracked)
					syncedCount++
					continue
				}

				if recoveredName == "" {
					continue
				}

				if err := s.upsertScannedFile(ctx, userID, cloudAccountID, parentID, obj, recoveredName); err == nil {
					syncedCount++
				}
				continue
			}

			// New-scheme and external keys both derive folders from segments. A
			// new-scheme key drops the users/<uid>/ prefix first; an external key
			// keeps its whole path.
			derivedKey := key
			if shape == scanShapeNew {
				derivedKey = strings.TrimPrefix(key, fmt.Sprintf("users/%d/", userID))
			}

			isDirMarker := strings.HasSuffix(derivedKey, "/")
			trimmedKey := strings.Trim(derivedKey, "/")
			segments := strings.Split(trimmedKey, "/")
			if len(segments) == 0 || trimmedKey == "" {
				continue
			}

			if isDirMarker {
				// A directory marker has no trailing file: every segment is a folder.
				if _, err := s.materializeFolders(ctx, userID, cloudAccountID, parentID, segments); err == nil {
					syncedCount++
				}
				continue
			}

			// The trailing segment is the file; the rest are its folders.
			fileParent, err := s.materializeFolders(ctx, userID, cloudAccountID, parentID, segments[:len(segments)-1])
			if err != nil {
				continue
			}
			fileName := segments[len(segments)-1]
			if err := s.upsertScannedFile(ctx, userID, cloudAccountID, fileParent, obj, fileName); err == nil {
				syncedCount++
			}
		}

		if !result.IsTruncated || result.NextContinuation == "" {
			break
		}
		continuationToken = result.NextContinuation
	}

	// Recalculate and update used storage for account
	if account != nil {
		var totalUsed int64
		_ = facades.Orm().Query().Model(&models.DriveItem{}).
			Where("user_id", userID).
			Where("cloud_account_id", cloudAccountID).
			Where("type", models.ItemTypeFile).
			Select("COALESCE(SUM(size), 0)").
			Scan(&totalUsed)
		account.UsedStorage = totalUsed
		_ = facades.Orm().Query().Save(account)
	}

	return syncedCount, nil
}

// materializeFolders ensures every segment exists as a folder under parentID,
// creating the missing ones, and returns the deepest folder's id (nil for an
// empty segment list). It is the folder-derivation loop the old ScanBucket
// else-branch ran inline, shared by the new-scheme path, the external path, and
// the directory-marker case.
func (s *CloudDriveService) materializeFolders(ctx context.Context, userID, cloudAccountID uint, parentID *uint, segments []string) (*uint, error) {
	currentParentID := parentID
	for _, folderName := range segments {
		if folderName == "" {
			continue
		}
		var folder models.DriveItem
		q := facades.Orm().Query().
			Where("user_id", userID).
			Where("cloud_account_id", cloudAccountID).
			Where("name", folderName).
			Where("type", models.ItemTypeFolder)
		if currentParentID == nil {
			q = q.Where("parent_id IS NULL")
		} else {
			q = q.Where("parent_id = ?", *currentParentID)
		}
		_ = q.First(&folder)

		if folder.ID == 0 {
			folder = models.DriveItem{
				UUID:           uuid.New().String(),
				UserID:         userID,
				CloudAccountID: cloudAccountID,
				ParentID:       currentParentID,
				Name:           folderName,
				Type:           models.ItemTypeFolder,
				Status:         models.ItemStatusReady,
			}
			if err := facades.Orm().Query().Create(&folder); err != nil {
				return nil, err
			}
		}
		fID := folder.ID
		currentParentID = &fID
	}
	return currentParentID, nil
}

// upsertScannedFile records a scanned object as a file row under parentID,
// matching an existing row by name so a re-scan does not duplicate it. The key
// was not tracked by storage_path (the caller checked), so a name match within
// the derived folder is the identity.
func (s *CloudDriveService) upsertScannedFile(ctx context.Context, userID, cloudAccountID uint, parentID *uint, obj contracts.ObjectMetadata, name string) error {
	fileExt := strings.TrimPrefix(filepath.Ext(name), ".")

	var nameMatch models.DriveItem
	q := facades.Orm().Query().
		Where("user_id", userID).
		Where("cloud_account_id", cloudAccountID).
		Where("name", name).
		Where("type", models.ItemTypeFile)
	if parentID == nil {
		q = q.Where("parent_id IS NULL")
	} else {
		q = q.Where("parent_id = ?", *parentID)
	}
	_ = q.First(&nameMatch)

	if nameMatch.ID > 0 {
		nameMatch.StoragePath = obj.Key
		nameMatch.Size = obj.Size
		nameMatch.ETag = obj.ETag
		nameMatch.Status = models.ItemStatusReady
		return facades.Orm().Query().Save(&nameMatch)
	}

	newItem := models.DriveItem{
		UUID:           uuid.New().String(),
		UserID:         userID,
		CloudAccountID: cloudAccountID,
		ParentID:       parentID,
		Name:           name,
		Type:           models.ItemTypeFile,
		MimeType:       obj.MimeType,
		Size:           obj.Size,
		Extension:      fileExt,
		StoragePath:    obj.Key,
		ETag:           obj.ETag,
		Status:         models.ItemStatusReady,
	}
	return facades.Orm().Query().Create(&newItem)
}

// PreviewResult is the resolved way to preview one file.
type PreviewResult struct {
	Strategy    PreviewStrategy
	URL         string
	DownloadURL string
	Item        *models.DriveItem
	Reason      string
}

// publicURLTimeout bounds the server-side reachability probe so a slow or
// black-holed CDN cannot hold the request open.
const publicURLTimeout = 3 * time.Second

// PublicURLReachable reports whether an absolute public URL answers a HEAD
// request with 2xx/3xx. It is deliberately done server-side: a browser check
// would be a CORS false-negative for a URL that is in fact public.
func PublicURLReachable(ctx context.Context, rawURL string) bool {
	if !strings.HasPrefix(rawURL, "http://") && !strings.HasPrefix(rawURL, "https://") {
		return false
	}

	probeCtx, cancel := context.WithTimeout(ctx, publicURLTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(probeCtx, http.MethodHead, rawURL, nil)
	if err != nil {
		return false
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	return resp.StatusCode >= 200 && resp.StatusCode < 400
}

// publicURLFor joins an account's configured public URL with an object key.
// Returns "" when no public URL is configured.
func publicURLFor(publicBase string, storagePath string) string {
	base := strings.TrimRight(strings.TrimSpace(publicBase), "/")
	key := strings.TrimLeft(strings.TrimSpace(storagePath), "/")
	if base == "" || key == "" {
		return ""
	}
	return base + "/" + key
}

// ResolvePreview decides how to preview an item. It never proxies on its own;
// it only reports the strategy, the URL to use and the always-available
// download URL.
func (s *CloudDriveService) ResolvePreview(ctx context.Context, userID uint, itemUUID string) (*PreviewResult, error) {
	item, err := s.GetItemByUUID(ctx, userID, itemUUID)
	if err != nil {
		return nil, err
	}
	if item.Type == models.ItemTypeFolder {
		return nil, errors.New("cannot preview a folder")
	}

	driver, _, err := s.GetDriver(ctx, userID, item.CloudAccountID)
	if err != nil {
		return nil, err
	}

	downloadURL, _, err := s.GetPresignedDownloadURL(ctx, userID, itemUUID, 15*time.Minute)
	if err != nil {
		return nil, err
	}

	kind := ClassifyPreviewKind(item.MimeType, item.Extension)

	publicURL := ""
	if pub := driver.GetPublicURL(); pub != "" {
		publicURL = publicURLFor(pub, item.StoragePath)
	}
	reachable := publicURL != "" && PublicURLReachable(ctx, publicURL)

	strategy, reason := DecidePreviewStrategy(kind, item.Size, reachable)

	result := &PreviewResult{
		Strategy:    strategy,
		DownloadURL: downloadURL,
		Item:        item,
		Reason:      reason,
	}

	switch strategy {
	case StrategyDirect:
		if reachable {
			result.URL = publicURL
		} else {
			result.URL = downloadURL
		}
	case StrategyProxy:
		result.URL = fmt.Sprintf("/v1/drive/items/%s/content", item.UUID)
	default:
		result.URL = ""
	}

	return result, nil
}

// internalUploadPrefix is the reserved key prefix under which the app stores
// objects it uploaded: users/<userID>/items/. The <uuid>- prefix that follows
// on each key is an implementation detail, never part of the user-facing name.
func internalUploadPrefix(userID uint) string {
	return fmt.Sprintf("users/%d/items/", userID)
}

// uuidPrefixPattern matches the "<uuid>-" head of an app-uploaded object's
// final key segment, e.g. "09d3c478-1bfe-449b-a202-e84ef72b16e5-file.docx".
var uuidPrefixPattern = regexp.MustCompile(
	`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-`,
)

// internalUploadRealName recovers the user-facing file name from an app-uploaded
// object key. It returns "" when the key is not shaped like an app upload (no
// uuid prefix, or nothing after it), so callers can fall back to normal
// derivation instead of losing the object.
func internalUploadRealName(key string) string {
	base := key[strings.LastIndex(key, "/")+1:]
	stripped := uuidPrefixPattern.ReplaceAllString(base, "")
	if stripped == "" || stripped == base {
		return ""
	}
	return stripped
}

// RekeyItem is the body of RekeyDriveItemJob: after a rename/move it copies the
// object(s) to their new key, updates the database, then deletes the old
// object(s). It runs outside the request, so a large folder move cannot time
// out the caller.
//
// An item with no object to move (a file with an empty storage_path, a folder
// with no file descendants) updates its row without any S3 call.
func (s *CloudDriveService) RekeyItem(ctx context.Context, userID uint, itemUUID string, newName string, newParentID *uint) error {
	item, err := s.GetItemByUUID(ctx, userID, itemUUID)
	if err != nil {
		return err
	}
	previousName := item.Name

	driver, _, err := s.GetDriver(ctx, userID, item.CloudAccountID)
	if err != nil {
		return s.markRekeyFailed(ctx, userID, item, err)
	}

	if item.IsFolder() {
		err = s.rekeyFolder(ctx, userID, driver, item, newName, newParentID)
	} else {
		err = s.rekeyFile(ctx, userID, driver, item, newName, newParentID)
	}
	if err != nil {
		return s.markRekeyFailed(ctx, userID, item, err)
	}

	finalName := item.Name
	if trimmed := strings.TrimSpace(newName); trimmed != "" {
		finalName = trimmed
	}
	if finalName != previousName {
		activityService := NewActivityService()
		activityService.LogSafe(userID, item.CloudAccountID, "renamed",
			fmt.Sprintf("%s -> %s", previousName, finalName), &item.UUID, "system", "Queue Worker", nil)
	}
	return nil
}

// rekeyFile re-keys a single file: copy to the new key, update the row, delete
// the old object.
func (s *CloudDriveService) rekeyFile(ctx context.Context, userID uint, driver contracts.CloudDriver, item *models.DriveItem, newName string, newParentID *uint) error {
	finalName := item.Name
	if trimmed := strings.TrimSpace(newName); trimmed != "" {
		finalName = trimmed
	}

	destPath, err := s.folderPath(ctx, userID, item.CloudAccountID, newParentID)
	if err != nil {
		return err
	}
	newKey := buildStorageKey(userID, destPath, finalName)

	// Nothing to copy: no object, or the key does not change. Update the row
	// (and clear the moving marker) without touching S3.
	if item.StoragePath == "" || item.StoragePath == newKey {
		_, err = s.ApplyMove(ctx, userID, item.UUID, newName, newParentID, item.StoragePath)
		return err
	}

	oldKey := item.StoragePath
	if err := driver.CopyObject(ctx, oldKey, newKey); err != nil {
		return err
	}
	if _, err := s.ApplyMove(ctx, userID, item.UUID, newName, newParentID, newKey); err != nil {
		// The row was not updated, so remove the object we just created to
		// avoid an orphan at the new key.
		_ = driver.Delete(ctx, newKey)
		return err
	}
	// The row already points at the new key. A failed delete leaves a stale
	// object, which is a cleanup issue, not a failed move.
	if err := driver.Delete(ctx, oldKey); err != nil {
		facades.Log().Errorf("[drive] rekey: failed to delete old object %q: %v", oldKey, err)
	}
	return nil
}

// rekeyFolder re-keys every file in a moved folder. Each file's new key is
// derived from its own name and its path inside the moved subtree — not by
// substituting the old key's prefix, because a descendant may still carry a
// legacy flat key that shares no prefix with its siblings.
func (s *CloudDriveService) rekeyFolder(ctx context.Context, userID uint, driver contracts.CloudDriver, item *models.DriveItem, newName string, newParentID *uint) error {
	allItems, _, _, err := s.CollectDescendantItems(ctx, userID, item.CloudAccountID, item.ID)
	if err != nil {
		return err
	}

	finalName := item.Name
	if trimmed := strings.TrimSpace(newName); trimmed != "" {
		finalName = trimmed
	}

	destPath, err := s.folderPath(ctx, userID, item.CloudAccountID, newParentID)
	if err != nil {
		return err
	}
	newFolderPath := finalName
	if destPath != "" {
		newFolderPath = destPath + "/" + finalName
	}

	byID := make(map[uint]models.DriveItem, len(allItems))
	for _, it := range allItems {
		byID[it.ID] = it
	}

	type rekeyMove struct {
		id     uint
		oldKey string
		newKey string
	}
	var moves []rekeyMove
	for _, it := range allItems {
		if !it.IsFile() || it.StoragePath == "" {
			continue
		}
		rel, err := relativeFolderPath(byID, item.ID, it)
		if err != nil {
			return err
		}
		filePath := newFolderPath
		if rel != "" {
			filePath = newFolderPath + "/" + rel
		}
		newKey := buildStorageKey(userID, filePath, it.Name)
		if newKey == it.StoragePath {
			continue
		}
		moves = append(moves, rekeyMove{id: it.ID, oldKey: it.StoragePath, newKey: newKey})
	}

	var copiedNewKeys []string
	for _, m := range moves {
		if err := driver.CopyObject(ctx, m.oldKey, m.newKey); err != nil {
			_ = driver.DeleteObjects(ctx, copiedNewKeys)
			return err
		}
		copiedNewKeys = append(copiedNewKeys, m.newKey)
	}

	err = facades.Orm().Transaction(func(tx orm.Query) error {
		folderUpdate := map[string]any{"name": finalName, "status": models.ItemStatusReady}
		if newParentID != nil {
			if *newParentID > 0 {
				folderUpdate["parent_id"] = *newParentID
			} else {
				folderUpdate["parent_id"] = nil
			}
		}
		if _, err := tx.Model(&models.DriveItem{}).Where("id", item.ID).Update(folderUpdate); err != nil {
			return err
		}
		for _, m := range moves {
			if _, err := tx.Model(&models.DriveItem{}).Where("id", m.id).Update(map[string]any{
				"storage_path": m.newKey,
				"status":       models.ItemStatusReady,
			}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		_ = driver.DeleteObjects(ctx, copiedNewKeys)
		return err
	}

	if len(moves) > 0 {
		oldKeys := make([]string, 0, len(moves))
		for _, m := range moves {
			oldKeys = append(oldKeys, m.oldKey)
		}
		if err := driver.DeleteObjects(ctx, oldKeys); err != nil {
			facades.Log().Errorf("[drive] rekey folder: failed to delete old objects: %v", err)
		}
	}
	return nil
}

// markRekeyFailed leaves the item at its old location (nothing was written
// before the failure) and records the failed status and activity.
func (s *CloudDriveService) markRekeyFailed(ctx context.Context, userID uint, item *models.DriveItem, cause error) error {
	_, _ = facades.Orm().Query().Model(&models.DriveItem{}).Where("id", item.ID).
		Update(map[string]any{"status": models.ItemStatusFailed})

	facades.Log().Errorf("[drive] rekey failed item=%d (%s): %v", item.ID, item.Name, cause)

	activityService := NewActivityService()
	activityService.LogSafe(userID, item.CloudAccountID, "move_failed", item.Name, &item.UUID, "system", "Queue Worker", nil)

	return cause
}

// relativeFolderPath returns the "/"-joined folder names strictly below rootID
// on the path from rootID down to item's parent. It returns "" when item is a
// direct child of rootID, so a direct child's key needs no extra segment. The
// walk is guarded against a corrupted cycle.
func relativeFolderPath(byID map[uint]models.DriveItem, rootID uint, item models.DriveItem) (string, error) {
	if item.ParentID == nil || *item.ParentID == rootID {
		return "", nil
	}

	seen := map[uint]bool{}
	var reversed []string
	current := *item.ParentID
	for current != 0 && current != rootID {
		if seen[current] {
			return "", errors.New("cycle in folder tree")
		}
		seen[current] = true
		node, ok := byID[current]
		if !ok {
			return "", errors.New("descendant folder not found")
		}
		reversed = append(reversed, node.Name)
		if node.ParentID == nil {
			break
		}
		current = *node.ParentID
	}

	parts := make([]string, 0, len(reversed))
	for i := len(reversed) - 1; i >= 0; i-- {
		parts = append(parts, reversed[i])
	}
	return strings.Join(parts, "/"), nil
}
