package leads

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestPractoImportReimportPreservesOperatorState(t *testing.T) {
	s, _ := newStore(t)
	ctx := context.Background()
	_, err := s.ImportPracto(ctx, "first", strings.NewReader("name,profile_url,specialty,city,emails\nDr Example,https://practo.com/bangalore/doctor/example/?ref=list,Dermatology,Bengaluru,clinic@example.com\n"))
	require.NoError(t, err)
	rows, total, err := s.Query(ctx, &Filter{Source: SourcePracto})
	require.NoError(t, err)
	require.Equal(t, 1, total)
	require.Equal(t, "https://www.practo.com/bangalore/doctor/example", rows[0].Link)
	require.NoError(t, s.SetStatus(ctx, []int64{rows[0].ID}, "do_not_contact", "Operator note"))
	_, err = s.ImportPracto(ctx, "second", strings.NewReader("name,profile_url,city\nDr Updated,https://www.practo.com/bangalore/doctor/example#contact,Mysuru\n"))
	require.NoError(t, err)
	rows, total, err = s.Query(ctx, &Filter{Source: SourcePracto})
	require.NoError(t, err)
	require.Equal(t, 1, total)
	require.Equal(t, "Dr Updated", rows[0].Name)
	require.Equal(t, "Mysuru", rows[0].City)
	require.Equal(t, "do_not_contact", rows[0].Status)
	require.Equal(t, "Operator note", rows[0].Note)
	require.Equal(t, "clinic@example.com", rows[0].Emails)
	require.Zero(t, rows[0].Reviews, "Practo imports must not claim Google review eligibility")
}

func TestPractoImportRejectsWholeFile(t *testing.T) {
	for _, badRow := range []string{
		"Bad,https://practo.com.evil.test/bangalore/doctor/example",
		"Bad,javascript:alert(1)",
		"Bad,https://www.practo.com/bangalore/doctors",
		"Bad,https://user:pass@www.practo.com/bangalore/doctor/example",
		"Bad,https://www.practo.com:8443/bangalore/doctor/example",
		"Bad,https://www.practo.com/bangalore/doctor/good/?duplicate=yes",
		"Bad,\"unterminated",
	} {
		t.Run(badRow, func(t *testing.T) {
			s, _ := newStore(t)
			_, err := s.ImportPracto(context.Background(), "bad", strings.NewReader("name,profile_url\nGood,https://www.practo.com/bangalore/doctor/good\n"+badRow+"\n"))
			var validation *ImportError
			require.ErrorAs(t, err, &validation)
			_, total, err := s.Query(context.Background(), &Filter{})
			require.NoError(t, err)
			require.Zero(t, total)
		})
	}
}

func TestPractoImportBoundsAndHeaders(t *testing.T) {
	for _, input := range []string{
		"name,name,profile_url\nA,B,https://practo.com/x/doctor/y\n",
		"name,profile_url,unexpected\nA,https://practo.com/x/doctor/y,x\n",
		"name\nA\n", "name,profile_url\n",
		"name,profile_url\n" + strings.Repeat("a", 4097) + ",https://practo.com/x/doctor/y\n",
		"name,profile_url,website\nA,https://practo.com/x/doctor/y,javascript:alert(1)\n",
	} {
		_, err := parsePractoCSV(strings.NewReader(input))
		require.Error(t, err)
	}
	var input strings.Builder
	input.WriteString("name,profile_url\n")
	for i := 0; i < 1001; i++ {
		input.WriteString("Doctor,https://practo.com/x/doctor/" + strings.Repeat("a", i+1) + "\n")
	}
	_, err := parsePractoCSV(strings.NewReader(input.String()))
	require.ErrorContains(t, err, "1,000")
}
