package gmaps

// defaultReviewCap is the most reviews one place's collection keeps. A named constant instead
// of a literal repeated at every stopping point; PR-2 threads a configurable one through
// `ReviewConfig` and this stays as the default when none is given.
const defaultReviewCap = 5000

// reviewSet is every review found for one place, however many sources read it, counted once.
// `primary` is the caller's own slice (`entry.UserReviews`, the inline reviews `EntryFromJSON`
// already parsed) and is never appended to -- only enriched in place, exactly as
// `dedupeDOMReviewsAgainstPrimary` enriched it before this existed. Everything this set adds
// beyond `primary` is `rows`, which becomes `entry.UserReviewsExtended`.
//
// An id-less review is never treated as a duplicate of anything, primary or otherwise -- there
// is nothing to compare it by, and treating two different reviewers' words as "the same review"
// because both lack an id would be worse than counting one twice. For the same reason it is never
// *counted*: it is kept in `orphans` and written out, but it cannot bring a collection up to the
// listing's total, and it is not held against the cap. A collection is complete only when the
// reviews that can be told apart reach the total; AxioIntel's removal detection rests on that.
type reviewSet struct {
	primary    []Review
	primaryIDs map[string]int

	rows    []Review
	byID    map[string]int
	orphans []Review

	cap int
}

// newReviewSet seeds the set with a place's inline reviews so an RPC or DOM page that re-reads
// one of them enriches it instead of being counted as new. `cap` is the most rows `rows` will
// ever hold; `add` still enriches an existing row past it, only a genuinely new one is refused.
func newReviewSet(primary []Review, limit int) *reviewSet {
	if limit <= 0 {
		limit = defaultReviewCap
	}

	ids := make(map[string]int, len(primary))

	for i := range primary {
		if primary[i].ReviewID != "" {
			ids[primary[i].ReviewID] = i
		}
	}

	return &reviewSet{primary: primary, primaryIDs: ids, byID: make(map[string]int), cap: limit}
}

// enrich fills anything `old` is missing from `next`, the same rule this codebase has used since
// before this file existed (`dedupeDOMReviewsAgainstPrimary`, `mergeDOMReviews`): a longer
// description, a filled author URL or reply, an earlier publish time, or more images.
func enrich(old, next *Review) {
	if len(next.Description) > len(old.Description) {
		old.Description = next.Description
	}

	if old.AuthorURL == "" {
		old.AuthorURL = next.AuthorURL
	}

	if old.ReplyText == "" {
		old.ReplyText = next.ReplyText
	}

	if old.PublishedAt == nil {
		old.PublishedAt = next.PublishedAt
	}

	if len(next.Images) > len(old.Images) {
		old.Images = next.Images
	}
}

// has is whether a review with this id is already known -- primary's own, or already added. A
// nil set (nothing known yet) has nothing.
func (s *reviewSet) has(id string) bool {
	if s == nil || id == "" {
		return false
	}

	if _, ok := s.primaryIDs[id]; ok {
		return true
	}

	_, ok := s.byID[id]

	return ok
}

// add folds one collected review in. Returns true when it is a genuinely new review -- appended
// to `rows`. An id-less review is kept aside in `orphans` and returns false: nothing can say it is
// new. A duplicate of `primary` or of a row already added enriches that row in place and returns
// false: it is not new, and it is never appended twice. A new row past the cap is refused; an
// enrichment past the cap still happens.
func (s *reviewSet) add(r *Review) bool {
	if r.ReviewID == "" {
		if len(s.orphans) < s.cap {
			s.orphans = append(s.orphans, *r)
		}

		return false
	}

	if j, ok := s.primaryIDs[r.ReviewID]; ok {
		enrich(&s.primary[j], r)
		return false
	}

	if i, ok := s.byID[r.ReviewID]; ok {
		enrich(&s.rows[i], r)
		return false
	}

	if len(s.rows) >= s.cap {
		return false
	}

	s.byID[r.ReviewID] = len(s.rows)
	s.rows = append(s.rows, *r)

	return true
}

// addPage folds every review an RPC page returned. Returns how many were genuinely new.
func (s *reviewSet) addPage(p rpcPage) int {
	added := 0

	for i := range p.Reviews {
		if s.add(&p.Reviews[i]) {
			added++
		}
	}

	return added
}

// len is how many distinct reviews this set holds beyond primary -- what "cap" bounds. A nil set
// holds none.
func (s *reviewSet) len() int {
	if s == nil {
		return 0
	}

	return len(s.rows)
}

// distinct is the whole union counted once: primary's reviews that carry an id, plus every id
// found beyond them. What a collection's progress is measured against the place's reported
// total. Reviews without an id are not in it (see `orphans`).
func (s *reviewSet) distinct() int {
	if s == nil {
		return 0
	}

	return len(s.primaryIDs) + len(s.rows)
}

// withoutID is how many reviews were kept that carry no id, primary's included: written out,
// never counted.
func (s *reviewSet) withoutID() int {
	if s == nil {
		return 0
	}

	n := len(s.orphans)

	for i := range s.primary {
		if s.primary[i].ReviewID == "" {
			n++
		}
	}

	return n
}

// extended is what belongs in `user_reviews_extended`: everything this set holds beyond primary,
// in the order it was found, then the id-less ones.
func (s *reviewSet) extended() []Review {
	if s == nil {
		return nil
	}

	if len(s.orphans) == 0 {
		return s.rows
	}

	out := make([]Review, 0, len(s.rows)+len(s.orphans))
	out = append(out, s.rows...)

	return append(out, s.orphans...)
}
