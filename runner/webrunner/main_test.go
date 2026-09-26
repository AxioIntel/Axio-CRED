//nolint:testpackage // package-wide test setup
package webrunner

import (
	"os"
	"testing"
)

// The runner sends usage events to the upstream project's analytics unless told not to; a test
// run must never reach out.
func TestMain(m *testing.M) {
	_ = os.Setenv("DISABLE_TELEMETRY", "1")

	os.Exit(m.Run())
}
