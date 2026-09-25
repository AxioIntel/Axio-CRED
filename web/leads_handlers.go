package web

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/AxioIntel/Axio-CRED/web/leads"
)

const (
	leadsPageSize = 50
	formOn        = "on" // a ticked checkbox
)

// WithLeads gives the dashboard its lead list: the Leads page, status tracking and exports.
func WithLeads(store *leads.Store) Option {
	return func(s *Server) { s.leads = store }
}

// Option configures a Server.
type Option func(*Server)

func (s *Server) registerLeadRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /leads", s.leadsPage)
	mux.HandleFunc("GET /leads/table", s.leadsTable)
	mux.HandleFunc("POST /leads/status", s.leadsSetStatus)
	mux.HandleFunc("POST /leads/note", s.leadsSetNote)
	mux.HandleFunc("GET /leads/export", s.leadsExport)
}

func filterFromQuery(q url.Values) leads.Filter {
	f := leads.Filter{
		Q:          q.Get("q"),
		Source:     q.Get("source"),
		Status:     q.Get("status"),
		City:       q.Get("city"),
		Category:   q.Get("category"),
		JobID:      q.Get("job"),
		Saleshandy: q.Get("saleshandy"),
		WhatsApp:   q.Get("whatsapp"),
		HasEmail:   q.Get("has_email") == formOn,
		HasPhone:   q.Get("has_phone") == formOn,
		HasWebsite: q.Get("has_website") == formOn,
		Sort:       q.Get("sort"),
		PageSize:   leadsPageSize,
	}

	f.MinRating, _ = strconv.ParseFloat(q.Get("min_rating"), 64)
	f.MinReviews, _ = strconv.Atoi(q.Get("min_reviews"))
	f.Page, _ = strconv.Atoi(q.Get("page"))
	f.Page = max(f.Page, 1)

	return f
}

type leadsPageData struct {
	Stats    leads.Stats
	Statuses []string
	Filter   leads.Filter
	JobName  string
}

type leadsTableData struct {
	Leads    []leadRow
	Total    int
	Page     int
	Pages    int
	From, To int
	PrevURL  string
	NextURL  string
	Statuses []string
}

type leadRow struct {
	leads.Lead
	EmailList []string
	WhatsApp  string // wa.me number, digits only
}

func (s *Server) leadsPage(w http.ResponseWriter, r *http.Request) {
	if s.leads == nil {
		http.Error(w, "the lead list is not enabled", http.StatusNotFound)

		return
	}

	stats, err := s.leads.Stats(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)

		return
	}

	data := leadsPageData{Stats: stats, Statuses: leads.Statuses, Filter: filterFromQuery(r.URL.Query())}

	if data.Filter.JobID != "" {
		if job, err := s.svc.Get(r.Context(), data.Filter.JobID); err == nil {
			data.JobName = job.Name
		}
	}

	s.render(w, "static/templates/leads.html", data)
}

func (s *Server) leadsTable(w http.ResponseWriter, r *http.Request) {
	if s.leads == nil {
		http.Error(w, "the lead list is not enabled", http.StatusNotFound)

		return
	}

	q := r.URL.Query()
	f := filterFromQuery(q)

	rows, total, err := s.leads.Query(r.Context(), &f)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)

		return
	}

	data := leadsTableData{Total: total, Page: f.Page, Statuses: leads.Statuses}
	data.Pages = max(1, (total+leadsPageSize-1)/leadsPageSize)

	if total > 0 {
		data.From = (f.Page-1)*leadsPageSize + 1
		data.To = data.From + len(rows) - 1
	}

	pageURL := func(p int) string {
		qq := url.Values{}
		for k, v := range q {
			qq[k] = v
		}

		qq.Set("page", strconv.Itoa(p))

		return "/leads/table?" + qq.Encode()
	}

	if f.Page > 1 {
		data.PrevURL = pageURL(f.Page - 1)
	}

	if f.Page < data.Pages {
		data.NextURL = pageURL(f.Page + 1)
	}

	for i := range rows {
		lr := leadRow{Lead: rows[i]}

		for _, e := range strings.Split(rows[i].Emails, ";") {
			if e = strings.TrimSpace(e); e != "" {
				lr.EmailList = append(lr.EmailList, e)
			}
		}

		lr.WhatsApp = strings.TrimPrefix(leads.PhoneE164(rows[i].Phone), "+")
		data.Leads = append(data.Leads, lr)
	}

	s.render(w, "static/templates/leads_table.html", data)
}

func formIDs(r *http.Request) []int64 {
	var ids []int64

	for _, raw := range r.Form["id"] {
		if id, err := strconv.ParseInt(raw, 10, 64); err == nil {
			ids = append(ids, id)
		}
	}

	return ids
}

// leadsSetStatus moves one lead (from its row) or every ticked lead (bulk) to a status. Bulk
// answers with a trigger that makes the table reload.
func (s *Server) leadsSetStatus(w http.ResponseWriter, r *http.Request) {
	if s.leads == nil || r.ParseForm() != nil {
		http.Error(w, "bad request", http.StatusBadRequest)

		return
	}

	ids := formIDs(r)
	if len(ids) == 0 {
		http.Error(w, "tick at least one lead", http.StatusUnprocessableEntity)

		return
	}

	if err := s.leads.SetStatus(r.Context(), ids, r.Form.Get("status"), ""); err != nil {
		http.Error(w, err.Error(), http.StatusUnprocessableEntity)

		return
	}

	if len(ids) > 1 || r.Form.Get("bulk") == "1" {
		w.Header().Set("HX-Trigger", "leads-changed")
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) leadsSetNote(w http.ResponseWriter, r *http.Request) {
	if s.leads == nil || r.ParseForm() != nil {
		http.Error(w, "bad request", http.StatusBadRequest)

		return
	}

	ids := formIDs(r)
	if len(ids) != 1 {
		http.Error(w, "one lead at a time", http.StatusUnprocessableEntity)

		return
	}

	note := strings.TrimSpace(r.Form.Get("note"))
	if len(note) > 2000 {
		note = note[:2000]
	}

	if err := s.leads.SetNote(r.Context(), ids[0], note); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)

		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// leadsExport downloads every lead the current filters match (not just the page on screen).
func (s *Server) leadsExport(w http.ResponseWriter, r *http.Request) {
	if s.leads == nil {
		http.Error(w, "the lead list is not enabled", http.StatusNotFound)

		return
	}

	f := filterFromQuery(r.URL.Query())
	f.PageSize, f.Page = 0, 0

	rows, _, err := s.leads.Query(r.Context(), &f)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)

		return
	}

	stamp := time.Now().UTC().Format("2006-01-02-1504")

	if r.URL.Query().Get("format") == "xlsx" {
		w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="leads-%s.xlsx"`, stamp))

		_ = leads.WriteXLSX(w, rows)

		return
	}

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="leads-%s.csv"`, stamp))

	_ = leads.WriteCSV(w, rows)
}

func (s *Server) render(w http.ResponseWriter, key string, data any) {
	tmpl, ok := s.tmpl[key]
	if !ok {
		http.Error(w, "missing tpl", http.StatusInternalServerError)

		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")

	if err := tmpl.Execute(w, data); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}
