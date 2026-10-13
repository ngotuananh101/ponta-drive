package services

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// buildStorageKey is the single place the new key scheme is spelled out, so a
// regression there silently re-flattens every upload.
func TestBuildStorageKey(t *testing.T) {
	assert.Equal(t, "users/1/report.pdf", buildStorageKey(1, "", "report.pdf"))
	assert.Equal(t, "users/1/Tài liệu/2026/report.pdf", buildStorageKey(1, "Tài liệu/2026", "report.pdf"))
	assert.Equal(t, "users/7/items/a.txt", buildStorageKey(7, "items", "a.txt"))
}
