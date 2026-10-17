package unit

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"

	"ponta_drive/app/facades"
	_ "ponta_drive/tests"
)

// TestDatabaseHasADefaultConnection pins the contract that database.default
// always resolves to a valid connection name even if DB_CONNECTION is omitted
// from the environment. An empty value causes app.MakeOrm() to return nil.
func TestDatabaseHasADefaultConnection(t *testing.T) {
	def := facades.Config().GetString("database.default")

	assert.NotEmpty(t, def,
		"database.default must resolve to a connection name; "+
			"an empty value causes app.MakeOrm() to return nil")
}

func TestDatabaseDefaultNamesAConfiguredConnection(t *testing.T) {
	def := facades.Config().GetString("database.default")

	viaKey := fmt.Sprintf("database.connections.%s.via", def)
	assert.NotNil(t, facades.Config().Get(viaKey),
		"database.default (%q) must point to a connection configured with a 'via' factory",
		def)
}
