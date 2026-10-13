package storage

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// S3 does not encode the CopySource header for us, and it must be encoded per
// path segment: a whole-string escape would turn the "/" separators into %2F
// and S3 would look for a single object whose key contains literal slashes.
func TestEncodeCopySource(t *testing.T) {
	assert.Equal(t,
		"my-bucket/users/1/report.pdf",
		encodeCopySource("my-bucket", "users/1/report.pdf"))

	assert.Equal(t,
		"my-bucket/users/1/T%C3%A0i%20li%E1%BB%87u/a%20b.txt",
		encodeCopySource("my-bucket", "users/1/Tài liệu/a b.txt"))
}
