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
// because both lack an id would be worse than counting one twice.
type reviewSet struct {
	primary    []Review
	primaryIDs map[string]int

	rows      []Review
	byID      map[string]int
	withoutID int

	cap int
}

// newReviewSet seeds the set with a place's inline reviews so an RPC or DOM page that re-reads
// one of them enriches it instead of being counted as new. `cap` is the most rows `rows` will
// ever hold; `add` still enriches an existing row past it, only a genuinely new one is refused.
func newReviewSet(primary []Review, cap int) *reviewSet {
	if cap <= 0 {
		cap = defaultReviewCap
	}
	ids := make(map[string]int, len(primary))
	for i := range primary {
		if primary[i].ReviewID != "" {
			ids[primary[i].ReviewID] = i
		}
	}
	return &reviewSet{primary: primary, primaryIDs: ids, byID: make(map[string]int), cap: cap}
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
// to `rows`, or (an id-less review) always. A duplicate of `primary` or of a row already added
// enriches that row in place and returns false: it is not new, and it is never appended twice.
// A new row past the cap is refused; an enrichment past the cap still happens.
func (s *reviewSet) add(r Review) bool {
	if r.ReviewID == "" {
		s.rows = append(s.rows, r)
		s.withoutID++
		return true
	}
	if j, ok := s.primaryIDs[r.ReviewID]; ok {
		enrich(&s.primary[j], &r)
		return false
	}
	if i, ok := s.byID[r.ReviewID]; ok {
		enrich(&s.rows[i], &r)
		return false
	}
	if len(s.rows) >= s.cap {
		return false
	}
	s.byID[r.ReviewID] = len(s.rows)
	s.rows = append(s.rows, r)
	return true
}

// addPage folds every review an RPC page returned. Returns how many were genuinely new.
func (s *reviewSet) addPage(p rpcPage) int {
	added := 0
	for _, r := range p.Reviews {
		if s.add(r) {
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

// distinct is the whole union counted once: primary plus everything found beyond it. What a
// collection's progress is measured against the place's reported total.
func (s *reviewSet) distinct() int {
	if s == nil {
		return 0
	}
	return len(s.primary) + len(s.rows)
}

// extended is what belongs in `user_reviews_extended`: everything this set holds beyond primary,
// in the order it was found.
func (s *reviewSet) extended() []Review {
	if s == nil {
		return nil
	}
	return s.rows
}
