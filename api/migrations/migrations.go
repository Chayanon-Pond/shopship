// Package migrations embeds the goose SQL migrations so the server binary is
// self-contained. Files are numbered 0001_, 0002_, ...; api-core owns this
// directory after Wave 0 and appends new files only (never edit a shipped one).
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
