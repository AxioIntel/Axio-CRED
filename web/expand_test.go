//nolint:testpackage // tests the job form's unexported search expansion
package web

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestExpandSearchesRunsEverySearchInEveryPlace(t *testing.T) {
	got := expandSearches("dentist\n orthodontist \n\n", "Austin TX\nRound Rock TX\n")

	assert.Equal(t, []string{
		"dentist in Austin TX", "dentist in Round Rock TX",
		"orthodontist in Austin TX", "orthodontist in Round Rock TX",
	}, got)
}

func TestExpandSearchesWithoutPlacesRunsSearchesAsTyped(t *testing.T) {
	assert.Equal(t, []string{"dentist in Austin TX", "plumber near me"},
		expandSearches("dentist in Austin TX\nplumber near me\nDentist in Austin TX", ""))
}

func TestExpandSearchesWithNothingTypedIsEmpty(t *testing.T) {
	assert.Empty(t, expandSearches(" \n ", "Austin TX"))
}
