package services

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// An object the app uploaded is stored flat at
// users/<userID>/items/<uuid>-<real name>. Sync must recover the real name so a
// re-sync after a database reset does not surface the uuid prefix as part of the
// file name, nor materialize the internal prefix as a folder tree.
func TestInternalUploadRealName(t *testing.T) {
	const uuid = "09d3c478-1bfe-449b-a202-e84ef72b16e5"

	cases := []struct {
		name string
		key  string
		want string
	}{
		{
			name: "plain name",
			key:  "users/1/items/" + uuid + "-file-sample_1MB.docx",
			want: "file-sample_1MB.docx",
		},
		{
			name: "name that itself contains hyphens and dots",
			key:  "users/42/items/" + uuid + "-my-report.v2.final.pdf",
			want: "my-report.v2.final.pdf",
		},
		{
			name: "no uuid prefix (not an app upload)",
			key:  "users/1/items/plain.docx",
			want: "",
		},
		{
			name: "uuid prefix but empty name",
			key:  "users/1/items/" + uuid + "-",
			want: "",
		},
		{
			name: "leading slash tolerated by caller, still recovers name",
			key:  "users/1/items/" + uuid + "-a.txt",
			want: "a.txt",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, internalUploadRealName(tc.key))
		})
	}
}

func TestInternalUploadPrefix(t *testing.T) {
	assert.Equal(t, "users/7/items/", internalUploadPrefix(7))
	assert.True(t, len(internalUploadPrefix(1)) > 0)
}
