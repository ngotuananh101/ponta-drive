package services

import (
	"context"
	"errors"
	"fmt"

	"ponta_drive/app/facades"
	"ponta_drive/app/models"
)

// folderPath returns the "/"-joined ancestor folder names for parentID,
// root-first and excluding the drive root. It returns "" for the root itself
// (parentID nil or 0).
//
// The walk is bounded by a visited set and a depth cap so a pre-existing cycle
// in parent_id cannot spin forever; the cycle guard in ValidateMove prevents
// new ones, but this runs on every upload and must not trust that.
func (s *CloudDriveService) folderPath(ctx context.Context, userID, cloudAccountID uint, parentID *uint) (string, error) {
	if parentID == nil || *parentID == 0 {
		return "", nil
	}

	const maxDepth = 10000
	visited := map[uint]bool{}
	var reversed []string
	current := *parentID

	for depth := 0; current != 0 && depth < maxDepth; depth++ {
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
			return "", errors.New("parent folder not found")
		}
		if !node.IsFolder() {
			return "", errors.New("parent item is not a folder")
		}

		reversed = append(reversed, node.Name)
		if node.ParentID == nil {
			break
		}
		current = *node.ParentID
	}

	// The walk produced leaf -> ... -> root; the key path wants root first.
	path := ""
	for i := len(reversed) - 1; i >= 0; i-- {
		if path == "" {
			path = reversed[i]
		} else {
			path = path + "/" + reversed[i]
		}
	}
	return path, nil
}

// buildStorageKey assembles users/<uid>/<folder-path>/<name>. It is the single
// definition of the new key scheme; an empty folderPath yields
// users/<uid>/<name>.
func buildStorageKey(userID uint, folderPath, fileName string) string {
	if folderPath == "" {
		return fmt.Sprintf("users/%d/%s", userID, fileName)
	}
	return fmt.Sprintf("users/%d/%s/%s", userID, folderPath, fileName)
}
