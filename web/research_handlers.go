package web

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/google/uuid"

	"github.com/AxioIntel/Axio-CRED/web/leads"
)

func (s *Server) registerResearchRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /research", func(w http.ResponseWriter, _ *http.Request) {
		s.render(w, "static/templates/research.html", nil)
	})
	mux.HandleFunc("GET /practo", func(w http.ResponseWriter, _ *http.Request) {
		s.render(w, "static/templates/practo.html", struct{ Enabled bool }{s.leads != nil})
	})
	mux.HandleFunc("GET /practo/template.csv", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="practo-import-template.csv"`)
		_, _ = fmt.Fprintln(w, "name,profile_url,specialty,phone,emails,website,address,city,state,country")
	})
	mux.Handle("POST /practo/import", http.NewCrossOriginProtection().Handler(http.HandlerFunc(s.importPracto)))
}

func (s *Server) importPracto(w http.ResponseWriter, r *http.Request) {
	if s.leads == nil {
		http.Error(w, "The lead list is not enabled.", http.StatusServiceUnavailable)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	if err := r.ParseMultipartForm(2 << 20); err != nil {
		http.Error(w, "Upload one CSV file, up to 2 MB.", http.StatusBadRequest)
		return
	}
	defer r.MultipartForm.RemoveAll()
	f, _, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "Choose a CSV file to import.", http.StatusBadRequest)
		return
	}
	defer f.Close()
	n, err := s.leads.ImportPracto(r.Context(), "practo-import-"+uuid.NewString(), f)
	if err != nil {
		var validation *leads.ImportError
		if errors.As(err, &validation) {
			http.Error(w, validation.Error(), http.StatusUnprocessableEntity)
		} else {
			http.Error(w, "Import failed. No records were saved. Please try again.", http.StatusInternalServerError)
		}
		return
	}
	renderJSON(w, http.StatusOK, map[string]any{"imported": n, "leads_url": "/leads?source=practo"})
}
