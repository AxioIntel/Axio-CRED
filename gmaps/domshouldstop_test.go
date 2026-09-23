package gmaps

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDomShouldStop(t *testing.T) {
	cases := []struct {
		name                                                  string
		domCount, cap, unionCount, target, stuckPasses, limit int
		wantStop                                              bool
		wantReason                                            string
	}{
		{"under every limit keeps going", 10, 5000, 10, 1169, 0, 15, false, ""},
		{"cap reached stops even short of target", 5000, 5000, 5000, 10000, 0, 15, true, domStopCap},
		{"cap checked before target", 5000, 5000, 100, 200, 0, 15, true, domStopCap},
		{"union reaching the target stops", 50, 5000, 1169, 1169, 0, 15, true, domStopTarget},
		{"union past the target stops", 50, 5000, 1200, 1169, 0, 15, true, domStopTarget},
		{"target zero (unknown) is never the reason", 50, 5000, 0, 0, 0, 15, false, ""},
		{"stuck for fewer than the limit keeps going", 50, 5000, 50, 1169, 14, 15, false, ""},
		{"stuck at the limit stops", 50, 5000, 50, 1169, 15, 15, true, domStopStuck},
		{"stuck past the limit stops", 50, 5000, 50, 1169, 20, 15, true, domStopStuck},
		{"target checked before stuck", 50, 5000, 1169, 1169, 15, 15, true, domStopTarget},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			stop, reason := domShouldStop(c.domCount, c.cap, c.unionCount, c.target, c.stuckPasses, c.limit)
			assert.Equal(t, c.wantStop, stop)
			assert.Equal(t, c.wantReason, reason)
		})
	}
}
