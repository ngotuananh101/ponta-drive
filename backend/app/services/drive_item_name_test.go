package services

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// A name is part of the S3 key path (users/<uid>/<folder>/<name>), so a name
// that carries a path separator or a control character would corrupt the key of
// this item and of every object a later sync derives from the same folder.
func TestValidateItemName(t *testing.T) {
	cases := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{name: "plain name", input: "report.pdf"},
		{name: "vietnamese name", input: "Tài liệu 2026.docx"},
		{name: "dots inside the name", input: "my-report.v2.final.pdf"},
		{name: "leading and trailing spaces are allowed", input: "  spaced.txt  "},
		{name: "forward slash", input: "a/b.txt", wantErr: true},
		{name: "backslash", input: `a\b.txt`, wantErr: true},
		{name: "newline control character", input: "a\nb.txt", wantErr: true},
		{name: "tab control character", input: "a\tb.txt", wantErr: true},
		{name: "single dot", input: ".", wantErr: true},
		{name: "double dot", input: "..", wantErr: true},
		{name: "empty", input: "", wantErr: true},
		{name: "whitespace only", input: "   ", wantErr: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateItemName(tc.input)
			if tc.wantErr {
				assert.ErrorIs(t, err, ErrInvalidName)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}
