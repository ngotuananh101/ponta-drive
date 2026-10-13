package jobs

import (
	"context"
	"fmt"

	"ponta_drive/app/services"
)

// RekeyDriveItemJob re-keys the object(s) behind a renamed/moved item. It runs
// off the request thread so a large folder move cannot time out the caller.
type RekeyDriveItemJob struct{}

func (j *RekeyDriveItemJob) Signature() string {
	return "rekey_drive_item_job"
}

func (j *RekeyDriveItemJob) Handle(args ...any) error {
	if len(args) < 3 {
		return fmt.Errorf("insufficient arguments: expected userID, itemUUID and newName")
	}

	var userID uint
	switch v := args[0].(type) {
	case uint:
		userID = v
	case int:
		userID = uint(v)
	case int64:
		userID = uint(v)
	case float64:
		userID = uint(v)
	}

	itemUUID, _ := args[1].(string)
	newName, _ := args[2].(string)

	// parentID is a plain uint (0 = root) with a separate flag for "the parent
	// changes at all": a *uint argument would be dropped by the database
	// driver's ConvertArgs, silently turning a move-into-folder into a move to
	// root. See the plan's Global Constraints.
	var parentID uint
	if len(args) >= 4 {
		switch v := args[3].(type) {
		case uint:
			parentID = v
		case int:
			parentID = uint(v)
		case int64:
			parentID = uint(v)
		case float64:
			parentID = uint(v)
		}
	}
	hasParentChange := false
	if len(args) >= 5 {
		if b, ok := args[4].(bool); ok {
			hasParentChange = b
		}
	}

	var newParentID *uint
	if hasParentChange {
		pid := parentID
		newParentID = &pid
	}

	service := services.NewCloudDriveService()
	return service.RekeyItem(context.Background(), userID, itemUUID, newName, newParentID)
}
