//go:build !linux

package web

// hostStats reports nothing outside Linux: the dashboard runs on a Linux server, and local
// development only needs the page to render.
func hostStats(string) (hostSample, bool) { return hostSample{}, false }
