package web

import (
	"context"
	"errors"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/AxioIntel/Axio-CRED/web/leads"
	"github.com/AxioIntel/Axio-CRED/web/saleshandy"
)

// maxSaleshandyBatch caps one send; Saleshandy takes 100,000 per import, but a click that sends
// more than this at once is far more likely to be a mistake than a plan.
const maxSaleshandyBatch = 5000

// stepByCategory is the step choice that routes each lead into its category's sequence.
const stepByCategory = "by-category"

// WithSaleshandy lets the dashboard send leads into the Saleshandy sequences cfg allows. A nil
// client (no API key configured) leaves the feature off.
func WithSaleshandy(c *saleshandy.Client, cfg *saleshandy.Config) Option {
	return func(s *Server) {
		s.saleshandy = c
		s.shConfig = cfg
	}
}

func (s *Server) registerSaleshandyRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /saleshandy/steps", s.saleshandySteps)
	mux.HandleFunc("POST /leads/saleshandy", s.saleshandySend)
	mux.HandleFunc("GET /saleshandy/status", s.saleshandyStatus)
}

var shStepsTmpl = template.Must(template.New("steps").Parse(`{{if .Err}}<option value="">{{.Err}}</option>{{else}}` +
	`<option value="">Choose where to send…</option>` +
	`{{if .Routes}}<option value="by-category">Each lead into its category's campaign ({{.Routes}} routes)</option>{{end}}` +
	`{{range .Sequences}}<optgroup label="{{.Title}}{{if not .Active}} (paused){{end}}">` +
	`{{range .Steps}}<option value="{{.ID}}">{{.Name}}</option>{{end}}` +
	`</optgroup>{{end}}{{end}}`))

// allowedSequences are the account's sequences the server config allows, with at least one step.
func (s *Server) allowedSequences(ctx context.Context) (all, allowed []saleshandy.Sequence, err error) {
	if s.saleshandy == nil {
		return nil, nil, errors.New("not connected: no Saleshandy API key on the server")
	}

	if s.shConfig == nil || len(s.shConfig.Sequences) == 0 {
		return nil, nil, saleshandy.ErrNoConfig
	}

	all, err = s.saleshandy.Sequences(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("could not load sequences: %w", err)
	}

	for i := range all {
		if len(all[i].Steps) > 0 && s.shConfig.Allowed(&all[i]) {
			allowed = append(allowed, all[i])
		}
	}

	if len(allowed) == 0 {
		return all, nil, errors.New("none of the allowed sequences exist in Saleshandy (check the titles in saleshandy.json)")
	}

	return all, allowed, nil
}

func (s *Server) saleshandySteps(w http.ResponseWriter, r *http.Request) {
	data := struct {
		Sequences []saleshandy.Sequence
		Routes    int
		Err       string
	}{}

	if _, allowed, err := s.allowedSequences(r.Context()); err != nil {
		data.Err = err.Error()
	} else {
		data.Sequences = allowed
		data.Routes = len(s.shConfig.Routes)
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = shStepsTmpl.Execute(w, data)
}

var shResultTmpl = template.Must(template.New("result").Parse(`<div class="sh-result {{if .Err}}sh-err{{end}}">` +
	`{{if .Err}}{{.Err}}{{else}}Sent <strong>{{.Sent}}</strong> lead{{if ne .Sent 1}}s{{end}}:` +
	`{{range .Batches}} <span class="chip">{{.Sequence}}: {{.Count}}</span>{{end}}.` +
	`{{if .Skipped}} Skipped {{.Skipped}} ({{.Why}}).{{end}}` +
	` Saleshandy is importing them now` +
	`{{range .Batches}} — <a href="#" hx-get="/saleshandy/status?request={{.RequestID}}" hx-target="closest .sh-result" hx-swap="outerHTML">progress of {{.Sequence}}</a>{{end}}.{{end}}</div>`))

type shBatch struct {
	Sequence  string
	Count     int
	RequestID string
}

type shResult struct {
	Err     string
	Sent    int
	Skipped int
	Why     string
	Batches []shBatch
}

func (s *Server) saleshandyResult(w http.ResponseWriter, res *shResult) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	if res.Sent > 0 {
		w.Header().Set("HX-Trigger", "leads-changed")
	}

	_ = shResultTmpl.Execute(w, res)
}

// saleshandySend adds the ticked leads, or every lead matching the filters (scope=filtered), to an
// allowed sequence step, or with step "by-category" each lead to its category's sequence. The
// step is checked here against the server's allowed list; the page's choice is never trusted.
// Only leads with an email go; do_not_contact never goes; a lead already sent goes again only
// when resend is ticked.
func (s *Server) saleshandySend(w http.ResponseWriter, r *http.Request) {
	if s.leads == nil {
		http.Error(w, "the lead list is not enabled", http.StatusNotFound)

		return
	}

	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)

		return
	}

	stepID := strings.TrimSpace(r.Form.Get("step_id"))
	if stepID == "" {
		s.saleshandyResult(w, &shResult{Err: "Choose where to send first."})

		return
	}

	all, _, err := s.allowedSequences(r.Context())
	if err != nil {
		s.saleshandyResult(w, &shResult{Err: err.Error()})

		return
	}

	var fixed *saleshandy.Sequence

	if stepID != stepByCategory {
		seq, ok := s.shConfig.FindStep(all, stepID)
		if !ok {
			s.saleshandyResult(w, &shResult{Err: "That step is not in one of the allowed campaigns."})

			return
		}

		fixed = seq
	}

	f := filterFromQuery(r.Form)
	f.PageSize, f.Page = maxSaleshandyBatch+1, 1

	if r.Form.Get("scope") != "filtered" {
		f = leads.Filter{IDs: formIDs(r), PageSize: maxSaleshandyBatch + 1}
		if len(f.IDs) == 0 {
			s.saleshandyResult(w, &shResult{Err: "Tick some leads first, or send everything matching the filters."})

			return
		}
	}

	rows, _, err := s.leads.Query(r.Context(), &f)
	if err != nil {
		s.saleshandyResult(w, &shResult{Err: err.Error()})

		return
	}

	if len(rows) > maxSaleshandyBatch {
		s.saleshandyResult(w, &shResult{Err: fmt.Sprintf("That is more than %d leads; narrow the filters and send in batches.", maxSaleshandyBatch)})

		return
	}

	opts := sendOptions{
		// Always verified, whatever the page sent (owner's rule, 25 Sep 2026): Saleshandy checks
		// every address before its campaign emails it.
		verify: true,
		resend: r.Form.Get("resend") == formOn,
		tag:    r.Form.Get("tag"),
	}

	s.saleshandyResult(w, s.sendToSaleshandy(r.Context(), rows, all, fixed, stepID, opts))
}

type sendOptions struct {
	verify, resend bool
	tag            string
}

// target is where one lead is going: a sequence and the step it enters at.
type target struct {
	seq    *saleshandy.Sequence
	stepID string
}

func (s *Server) sendToSaleshandy(ctx context.Context, rows []leads.Lead, all []saleshandy.Sequence,
	fixed *saleshandy.Sequence, stepID string, opts sendOptions) *shResult {
	res := &shResult{}

	fields, err := s.saleshandy.Fields(ctx)
	if err != nil {
		res.Err = "Could not read Saleshandy's prospect fields: " + err.Error()

		return res
	}

	labels := fieldLabels(fields)

	type batch struct {
		t         target
		prospects []saleshandy.Prospect
		ids       []int64
	}

	batches := map[string]*batch{}

	var noEmail, fewReviews, dnc, already, noRoute int

	floor := s.shConfig.ReviewFloor()

	for i := range rows {
		l := &rows[i]

		switch {
		case l.FirstEmail() == "":
			noEmail++

			continue
		case l.Reviews < floor:
			fewReviews++

			continue
		case l.Status == "do_not_contact":
			dnc++

			continue
		case !l.SaleshandyAt.IsZero() && !opts.resend:
			already++

			continue
		}

		t := target{seq: fixed, stepID: stepID}

		if fixed == nil {
			seq, first, ok := s.shConfig.FirstStep(all, s.shConfig.Route(l.Category))
			if !ok {
				noRoute++

				continue
			}

			t = target{seq: seq, stepID: first}
		}

		b := batches[t.stepID]
		if b == nil {
			b = &batch{t: t}
			batches[t.stepID] = b
		}

		b.prospects = append(b.prospects, toProspect(l, labels))
		b.ids = append(b.ids, l.ID)
	}

	res.Skipped = noEmail + fewReviews + dnc + already + noRoute
	res.Why = skipReason(floor, noEmail, fewReviews, dnc, already, noRoute)

	if len(batches) == 0 {
		res.Err = "Nothing to send"
		if res.Why != "" {
			res.Err += ": " + res.Why
		}

		return res
	}

	tags := []string{"AxioCRED"}
	if t := strings.TrimSpace(opts.tag); t != "" {
		tags = append(tags, t)
	}

	keys := make([]string, 0, len(batches))
	for k := range batches {
		keys = append(keys, k)
	}

	sort.Strings(keys)

	var failures []string

	for _, k := range keys {
		b := batches[k]

		requestID, err := s.saleshandy.Import(ctx, &saleshandy.ImportRequest{
			Prospects: b.prospects, StepID: b.t.stepID, Verify: opts.verify, Tags: tags,
		})
		if err != nil {
			var apiErr *saleshandy.Error
			if errors.As(err, &apiErr) {
				err = errors.New(apiErr.Message)
			}

			failures = append(failures, b.t.seq.Title+": "+err.Error())

			continue
		}

		if err := s.leads.MarkSaleshandy(ctx, b.ids, requestID, b.t.seq.Title, b.t.stepID); err != nil {
			log.Printf("saleshandy import %s started but marking %d leads failed: %v", requestID, len(b.ids), err)
		}

		res.Sent += len(b.prospects)
		res.Batches = append(res.Batches, shBatch{Sequence: b.t.seq.Title, Count: len(b.prospects), RequestID: requestID})
	}

	if len(failures) > 0 {
		res.Err = "Saleshandy refused: " + strings.Join(failures, "; ")
		if res.Sent > 0 {
			res.Err += fmt.Sprintf(" (the other %d were sent)", res.Sent)
		}
	}

	return res
}

func skipReason(floor, noEmail, fewReviews, dnc, already, noRoute int) string {
	var parts []string

	for _, p := range []struct {
		n    int
		what string
	}{
		{noEmail, "without an email"},
		{fewReviews, "with " + strconv.Itoa(floor-1) + " or fewer Google reviews"},
		{dnc, "marked do_not_contact"},
		{already, "already sent"},
		{noRoute, "with no campaign for their category"},
	} {
		if p.n > 0 {
			parts = append(parts, strconv.Itoa(p.n)+" "+p.what)
		}
	}

	return strings.Join(parts, ", ")
}

// fieldLabels maps a lower-cased field label to the account's exact label, so a lead is sent only
// with fields the account has (Saleshandy rejects unknown field names).
func fieldLabels(fields []saleshandy.Field) map[string]string {
	out := make(map[string]string, len(fields))
	for _, f := range fields {
		out[strings.ToLower(strings.TrimSpace(f.Label))] = f.Label
	}

	return out
}

// toProspect is a lead as a Saleshandy prospect: the business is the Company; its first email the
// Email. Any of the other fields the account has (system or custom, matched by name) are filled.
func toProspect(l *leads.Lead, labels map[string]string) saleshandy.Prospect {
	p := saleshandy.Prospect{}

	set := func(value string, names ...string) {
		if value == "" {
			return
		}

		for _, n := range names {
			if label, ok := labels[n]; ok {
				p[label] = value

				return
			}
		}
	}

	set(l.FirstEmail(), "email")
	set(l.Name, "company", "company name")
	set(l.Phone, "phone number", "phone")
	set(l.Website, "website", "company website", "company domain")
	set(l.City, "city")
	set(l.State, "state")
	set(l.Country, "country")
	set(l.Category, "category", "industry")
	set(l.Address, "address", "company address")
	set(l.Link, "google maps", "google maps link", "maps link")

	if l.Rating > 0 {
		set(strconv.FormatFloat(l.Rating, 'f', 1, 64), "rating", "google rating")
		set(strconv.Itoa(l.Reviews), "reviews", "review count", "google reviews")
	}

	if _, ok := labels["email"]; !ok {
		p["Email"] = l.FirstEmail() // Email is a system field; the account's list should always have it
	}

	return p
}

var shStatusTmpl = template.Must(template.New("status").Parse(`<div class="sh-result">` +
	`{{if .Err}}Could not read the import's progress: {{.Err}}{{else if .S.Completed}}Saleshandy finished importing.` +
	`{{if .S.FailedURL}} Some prospects failed: <a href="{{.S.FailedURL}}" target="_blank" rel="noopener noreferrer">error report</a>.{{end}}` +
	`{{else}}Still importing — <a href="#" hx-get="/saleshandy/status?request={{.ID}}" hx-target="closest .sh-result" hx-swap="outerHTML">check again</a>.{{end}}</div>`))

func (s *Server) saleshandyStatus(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("request")
	data := struct {
		ID  string
		S   saleshandy.ImportStatus
		Err string
	}{ID: id}

	if s.saleshandy == nil || id == "" {
		data.Err = "no import to check"
	} else if st, err := s.saleshandy.ImportStatus(r.Context(), id); err != nil {
		data.Err = err.Error()
	} else {
		data.S = st
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = shStatusTmpl.Execute(w, data)
}
