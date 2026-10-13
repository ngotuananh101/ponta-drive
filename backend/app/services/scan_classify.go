package services

import (
	"fmt"
	"strings"
)

// scanShape is how a bucket key maps onto the drive after the folder-structure
// change: a legacy flat app-upload key, a new folder-structured key, or an
// object that belongs to no scheme (external content in the same bucket).
type scanShape int

const (
	scanShapeLegacy scanShape = iota
	scanShapeNew
	scanShapeExternal
)

// classifyKey decides how a key (leading "/" already stripped) is materialized.
//
//   - Legacy: starts with users/<uid>/items/ AND the basename carries the
//     "<uuid>-" prefix. The real name is recovered from the key and the path is
//     never derived (the "items" segment is a storage detail, not a folder).
//   - New: starts with users/<uid>/ and is not legacy. The remainder is the
//     real folder path.
//   - External: anything else, derived from the whole key.
//
// The uuid-pattern requirement is what separates the two shapes that share the
// "users/<uid>/items/" prefix: a legacy key always has "<uuid>-<name>", a
// new-scheme key inside a folder named "items" has a plain name.
func classifyKey(userID uint, key string) (scanShape, string) {
	prefix := internalUploadPrefix(userID)
	if strings.HasPrefix(key, prefix) {
		if realName := internalUploadRealName(key); realName != "" {
			return scanShapeLegacy, realName
		}
		// A key under the reserved prefix whose basename is not uuid-prefixed is
		// a new-scheme object in a folder named "items", not a legacy upload.
		return scanShapeNew, ""
	}
	if strings.HasPrefix(key, fmt.Sprintf("users/%d/", userID)) {
		return scanShapeNew, ""
	}
	return scanShapeExternal, ""
}
