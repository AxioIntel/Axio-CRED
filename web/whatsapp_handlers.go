package web

import (
	"context"
	"errors"
	"fmt"
	"html/template"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/AxioIntel/Axio-CRED/web/leads"
	"github.com/AxioIntel/Axio-CRED/web/whatsapp"
)

// WhatsApp template sending, for opted-in leads only. A scraped phone number is not permission:
// a lead can be messaged only after the operator has recorded that the business agreed to
// WhatsApp messages, and how ("replied yes to our email, 25 Sep"). Everything below is checked
// here on the server against the stored lead, whatever the page sends.

const (
	// maxWhatsAppBatch caps one send; a few at a time keeps a mistake small.
	maxWhatsAppBatch = 100
	// whatsAppGap is the pause between two messages.
	whatsAppGap = 150 * time.Millisecond
	// whatsAppCooldown is how long a lead that was just messaged is left alone.
	whatsAppCooldown = 24 * time.Hour
)

// WithWhatsApp turns on template sending through c; a nil client leaves it off.
func WithWhatsApp(c *whatsapp.Client) Option {
	return func(s *Server) { s.whatsapp = c }
}

func (s *Server) registerWhatsAppRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /whatsapp/templates", s.whatsappTemplates)
	mux.HandleFunc("POST /leads/whatsapp", s.whatsappSend)
	mux.HandleFunc("POST /leads/wa-optin", s.whatsappOptIn)
	mux.HandleFunc("POST /leads/wa-optout", s.whatsappOptOut)
}

// waFields are the lead fields a template placeholder can be filled with.
var waFields = map[string]func(*leads.Lead) string{
	"name":     func(l *leads.Lead) string { return l.Name },
	"city":     func(l *leads.Lead) string { return l.City },
	"category": func(l *leads.Lead) string { return l.Category },
	"rating":   func(l *leads.Lead) string { return strconv.FormatFloat(l.Rating, 'f', 1, 64) },
	"reviews":  func(l *leads.Lead) string { return strconv.Itoa(l.Reviews) },
}

var errWhatsAppOff = errors.New("not connected: WhatsApp is not configured on the server")

var waTemplatesTmpl = template.Must(template.New("wa").Parse(`{{if .Err}}<option value="">{{.Err}}</option>{{else}}` +
	`<option value="">Choose an approved template…</option>` +
	`{{range .Templates}}<option value="{{.Key}}" data-params="{{.Params}}" title="{{.Body}}">{{.Name}} ({{.Language}}, {{.Category}}{{if .Params}}, {{.Params}} value{{if gt .Params 1}}s{{end}}{{end}})</option>{{end}}` +
	`{{end}}`))

func (s *Server) whatsappTemplates(w http.ResponseWriter, r *http.Request) {
	data := struct {
		Templates []whatsapp.Template
		Err       string
	}{}

	if s.whatsapp == nil {
		data.Err = errWhatsAppOff.Error()
	} else if tpls, err := s.whatsapp.Templates(r.Context()); err != nil {
		data.Err = "Could not load templates: " + err.Error()
	} else if len(tpls) == 0 {
		data.Err = "No approved templates in the WhatsApp account yet"
	} else {
		data.Templates = tpls
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = waTemplatesTmpl.Execute(w, data)
}

// whatsappOptIn records a lead's opt-in; the source comes from the form or htmx's prompt.
func (s *Server) whatsappOptIn(w http.ResponseWriter, r *http.Request) {
	if s.leads == nil || r.ParseForm() != nil {
		http.Error(w, "bad request", http.StatusBadRequest)

		return
	}

	id, err := strconv.ParseInt(r.Form.Get("id"), 10, 64)
	if err != nil {
		http.Error(w, "bad lead id", http.StatusBadRequest)

		return
	}

	source := r.Form.Get("source")
	if source == "" {
		source = r.Header.Get("HX-Prompt")
	}

	if err := s.leads.SetWhatsAppOptIn(r.Context(), id, source); err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, leads.ErrOptInSource) {
			status = http.StatusUnprocessableEntity
		}

		http.Error(w, err.Error(), status)

		return
	}

	w.Header().Set("HX-Trigger", "leads-changed")
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) whatsappOptOut(w http.ResponseWriter, r *http.Request) {
	if s.leads == nil || r.ParseForm() != nil {
		http.Error(w, "bad request", http.StatusBadRequest)

		return
	}

	id, err := strconv.ParseInt(r.Form.Get("id"), 10, 64)
	if err != nil {
		http.Error(w, "bad lead id", http.StatusBadRequest)

		return
	}

	if err := s.leads.SetWhatsAppOptOut(r.Context(), id); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)

		return
	}

	w.Header().Set("HX-Trigger", "leads-changed")
	w.WriteHeader(http.StatusNoContent)
}

var waResultTmpl = template.Must(template.New("result").Parse(`<div class="sh-result {{if .Err}}sh-err{{end}}">` +
	`{{if .Err}}{{.Err}}{{else}}Sent <strong>{{.Sent}}</strong> WhatsApp message{{if ne .Sent 1}}s{{end}} ({{.Template}}).` +
	`{{if .Skipped}} Skipped {{.Skipped}} ({{.Why}}).{{end}}` +
	`{{if .Failed}} Meta refused {{len .Failed}}:{{range .Failed}} <span class="chip" title="{{.Error}}">{{.Name}}</span>{{end}}.{{end}}{{end}}</div>`))

type waFailure struct{ Name, Error string }

type waResult struct {
	Err      string
	Template string
	Sent     int
	Skipped  int
	Why      string
	Failed   []waFailure
}

func (s *Server) whatsappResult(w http.ResponseWriter, res *waResult) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	if res.Sent > 0 {
		w.Header().Set("HX-Trigger", "leads-changed")
	}

	_ = waResultTmpl.Execute(w, res)
}

// whatsappSend sends an approved template to the ticked leads, or to every lead matching the
// filters (scope=filtered). Only leads with a recorded opt-in, no opt-out since, not
// do_not_contact, a usable number and no message in the last 24 hours are sent to.
func (s *Server) whatsappSend(w http.ResponseWriter, r *http.Request) {
	if s.leads == nil || r.ParseForm() != nil {
		http.Error(w, "bad request", http.StatusBadRequest)

		return
	}

	if s.whatsapp == nil {
		s.whatsappResult(w, &waResult{Err: errWhatsAppOff.Error()})

		return
	}

	tpl, err := s.approvedTemplate(r.Context(), r.Form.Get("template"))
	if err != nil {
		s.whatsappResult(w, &waResult{Err: err.Error()})

		return
	}

	fill := r.Form["var"]
	if len(fill) != tpl.Params {
		s.whatsappResult(w, &waResult{Err: fmt.Sprintf("%s takes %d value(s); choose what fills each.", tpl.Name, tpl.Params)})

		return
	}

	for _, f := range fill {
		if _, ok := waFields[f]; !ok {
			s.whatsappResult(w, &waResult{Err: fmt.Sprintf("%q is not a lead field.", f)})

			return
		}
	}

	f := filterFromQuery(r.Form)
	f.WhatsApp = "opted_in"

	if r.Form.Get("scope") != "filtered" {
		f = leads.Filter{IDs: formIDs(r), WhatsApp: "opted_in"}
		if len(f.IDs) == 0 {
			s.whatsappResult(w, &waResult{Err: "Tick some leads first, or send to everything matching the filters."})

			return
		}
	}

	f.Page, f.PageSize = 1, maxWhatsAppBatch+1

	// The opted-in filter above is the first check; each lead is checked again as it is sent.
	rows, _, err := s.leads.Query(r.Context(), &f)
	if err != nil {
		s.whatsappResult(w, &waResult{Err: err.Error()})

		return
	}

	if len(rows) > maxWhatsAppBatch {
		s.whatsappResult(w, &waResult{Err: fmt.Sprintf("More than %d opted-in leads; narrow the filters and send in batches.", maxWhatsAppBatch)})

		return
	}

	res := s.sendWhatsApp(r.Context(), rows, tpl, fill)
	if asked := len(f.IDs); asked > len(rows) {
		res.Skipped += asked - len(rows)
		res.Why = joinWhy(res.Why, fmt.Sprintf("%d without a WhatsApp opt-in", asked-len(rows)))
	}

	s.whatsappResult(w, res)
}

func (s *Server) approvedTemplate(ctx context.Context, key string) (*whatsapp.Template, error) {
	if key == "" {
		return nil, errors.New("choose a template first")
	}

	tpls, err := s.whatsapp.Templates(ctx)
	if err != nil {
		return nil, fmt.Errorf("could not load templates: %w", err)
	}

	for i := range tpls {
		if tpls[i].Key() == key {
			return &tpls[i], nil
		}
	}

	return nil, errors.New("that template is not approved in the WhatsApp account")
}

func (s *Server) sendWhatsApp(ctx context.Context, rows []leads.Lead, tpl *whatsapp.Template, fill []string) *waResult {
	res := &waResult{Template: tpl.Name}
	skipped := map[string]int{}
	now := time.Now()

	for i := range rows {
		l := &rows[i]
		phone := leads.PhoneE164(l.Phone)

		switch {
		case !l.WhatsAppAllowed():
			skipped["without a WhatsApp opt-in"]++

			continue
		case phone == "":
			skipped["no usable number"]++

			continue
		case !l.WhatsAppAt.IsZero() && now.Sub(l.WhatsAppAt) < whatsAppCooldown:
			skipped["messaged in the last 24 hours"]++

			continue
		}

		params := make([]string, len(fill))
		for j, f := range fill {
			params[j] = waFields[f](l)
		}

		if res.Sent+len(res.Failed) > 0 {
			select {
			case <-ctx.Done():
				res.Err = "Stopped: " + ctx.Err().Error()

				return res
			case <-time.After(whatsAppGap):
			}
		}

		send := leads.WhatsAppSend{LeadID: l.ID, Phone: phone, Template: tpl.Name, Language: tpl.Language}

		id, err := s.whatsapp.Send(ctx, phone, tpl, params)
		send.MessageID = id

		if err != nil {
			send.Error = err.Error()
			res.Failed = append(res.Failed, waFailure{Name: l.Name, Error: send.Error})
		} else {
			res.Sent++
		}

		if rerr := s.leads.RecordWhatsApp(ctx, &send); rerr != nil {
			res.Err = "Sent, but could not record it: " + rerr.Error()

			return res
		}
	}

	reasons := make([]string, 0, len(skipped))

	for why, n := range skipped {
		res.Skipped += n
		reasons = append(reasons, fmt.Sprintf("%d %s", n, why))
	}

	sort.Strings(reasons)
	res.Why = strings.Join(reasons, ", ")

	return res
}

func joinWhy(a, b string) string {
	if a == "" {
		return b
	}

	return a + ", " + b
}
