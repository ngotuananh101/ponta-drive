package services

import (
	"context"
	"errors"
	"strings"
	"unicode"

	"ponta_drive/app/facades"
	"ponta_drive/app/models"
)

// Sentinel errors the controllers map to localized 422 responses. They carry no
// schema, table, or driver text, so they are safe to pass to failResponse.
var (
	ErrNameConflict = errors.New("an item with this name already exists here")
	ErrInvalidName  = errors.New("the name is not valid")
)

// ValidateItemName rejects a name that would corrupt the storage key path.
// A name is one segment of users/<uid>/<folder-path>/<name>, so a path
// separator or a control character would break the key of this item and of
// every sibling a later sync derives from the same folder. "." and ".." are
// rejected because S3 clients and path resolvers treat them specially.
func ValidateItemName(name string) error {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" || trimmed == "." || trimmed == ".." {
		return ErrInvalidName
	}
	for _, r := range trimmed {
		if r == '/' || r == '\\' || unicode.IsControl(r) {
			return ErrInvalidName
		}
	}
	return nil
}

// EnsureUniqueName errors when another item in the same parent already uses
// name. Two items that share a name in the same folder would collide on the
// same S3 key, so uniqueness is enforced here in every flow that can introduce
// or change a name.
//
// The check spans both files and folders: a file a/b and a folder a/b would
// otherwise collide on the key. Comparison is case-sensitive, matching S3 key
// semantics. excludeID (0 when creating) lets rename/move ignore the item
// itself. A parentID that is nil or 0 means the drive root, where parent_id is
// NULL.
func (s *CloudDriveService) EnsureUniqueName(ctx context.Context, userID, cloudAccountID uint, parentID *uint, name string, excludeID uint) error {
	query := facades.Orm().Query().
		Where("user_id", userID).
		Where("cloud_account_id", cloudAccountID).
		Where("name", name)
	if parentID == nil || *parentID == 0 {
		query = query.Where("parent_id IS NULL")
	} else {
		query = query.Where("parent_id = ?", *parentID)
	}
	if excludeID > 0 {
		query = query.Where("id != ?", excludeID)
	}

	var existing models.DriveItem
	if err := query.First(&existing); err == nil && existing.ID > 0 {
		return ErrNameConflict
	}
	return nil
}
