package services

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// A key's shape decides whether sync recovers a name, derives a path, or
// treats the key as an external object. The "items" case is the whole reason
// the legacy shape needs the uuid pattern and not just the prefix: a user
// folder literally named "items" produces keys that share the legacy prefix.
func TestClassifyKey(t *testing.T) {
	const uid = 7
	const uuid = "09d3c478-1bfe-449b-a202-e84ef72b16e5"

	cases := []struct {
		name    string
		key     string
		shape   scanShape
		recover string
	}{
		{
			name:    "legacy flat upload key",
			key:     "users/7/items/" + uuid + "-file-sample_1MB.docx",
			shape:   scanShapeLegacy,
			recover: "file-sample_1MB.docx",
		},
		{
			name:    "new-scheme key in a folder named items is NOT legacy",
			key:     "users/7/items/a.txt",
			shape:   scanShapeNew,
			recover: "",
		},
		{
			name:  "new-scheme key in a nested folder",
			key:   "users/7/Tài liệu/2026/report.pdf",
			shape: scanShapeNew,
		},
		{
			name:  "new-scheme key at the root",
			key:   "users/7/report.pdf",
			shape: scanShapeNew,
		},
		{
			name:  "external key (other user prefix)",
			key:   "users/8/photos/beach.jpg",
			shape: scanShapeExternal,
		},
		{
			name:  "external key (no users prefix)",
			key:   "photos/vacation/beach.jpg",
			shape: scanShapeExternal,
		},
		{
			name:  "external key that merely starts with the user id digits",
			key:   "users/70/report.pdf",
			shape: scanShapeExternal,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			shape, recover := classifyKey(uid, tc.key)
			assert.Equal(t, tc.shape, shape)
			assert.Equal(t, tc.recover, recover)
		})
	}
}
