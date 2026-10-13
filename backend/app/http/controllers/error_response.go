package controllers

import (
	"errors"

	"github.com/goravel/framework/contracts/http"

	"ponta_drive/app/facades"
	"ponta_drive/app/services"
)

// failResponse builds the JSON body returned to a client when an operation
// fails.
//
// The underlying error is deliberately NOT included in the response: ORM and
// driver errors carry schema names, table names, constraint names and query
// fragments, none of which a client should see. The real error is written to
// the application log instead, so the failure stays diagnosable.
//
// A missing translation key falls back to the key itself (goravel behaviour),
// so the client never receives an empty message.
func failResponse(ctx http.Context, status int, langKey string, err error) http.Response {
	if err != nil {
		facades.Log().Errorf("[API] %s: %v", langKey, err)
	}

	return ctx.Response().Json(status, http.Json{
		"status":  "error",
		"message": facades.Lang(ctx).Get(langKey),
	})
}

// failServiceError maps the service's sentinel name errors to their localized
// 422 responses and every other service error to a generic localized failure.
// Keeping the mapping here means every controller that can introduce a name
// (create folder, upload, rename/move) reports a conflict the same way, and no
// service error text ever reaches the client.
func failServiceError(ctx http.Context, err error, fallbackKey string) http.Response {
	switch {
	case errors.Is(err, services.ErrNameConflict):
		return failResponse(ctx, http.StatusUnprocessableEntity, "drive.name_conflict", err)
	case errors.Is(err, services.ErrInvalidName):
		return failResponse(ctx, http.StatusUnprocessableEntity, "drive.name_invalid", err)
	default:
		return failResponse(ctx, http.StatusBadRequest, fallbackKey, err)
	}
}
