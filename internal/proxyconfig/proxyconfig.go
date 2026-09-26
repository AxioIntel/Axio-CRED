// Package proxyconfig resolves proxy URLs from supported CLI inputs.
package proxyconfig

import (
	"bufio"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
)

var (
	// ErrConflict indicates that both supported proxy inputs were configured.
	ErrConflict = errors.New("-proxies and -proxies-file cannot be used together")
	// ErrEmptyFile indicates that a proxy file has no usable proxy URLs.
	ErrEmptyFile = errors.New("proxy file contains no proxy URLs")
	// ErrBadProxy indicates a proxy that is not scheme://[user:pass@]host:port.
	ErrBadProxy = errors.New("proxy is not scheme://[user:pass@]host:port (http, https, socks5)")
)

// check refuses a proxy a run could not use. The error names where it is, never what it says:
// a proxy line carries a password.
func check(proxy, where string) error {
	u, err := url.Parse(proxy)
	if err != nil || u.Host == "" || u.Port() == "" {
		return fmt.Errorf("%w: %s", ErrBadProxy, where)
	}

	switch u.Scheme {
	case "http", "https", "socks5", "socks5h":
		return nil
	}

	return fmt.Errorf("%w: %s", ErrBadProxy, where)
}

// Resolve returns proxy URLs from either an inline comma-separated value or a file.
func Resolve(inline, filePath string) ([]string, error) {
	if inline != "" && filePath != "" {
		return nil, ErrConflict
	}

	if inline != "" {
		proxies := strings.Split(inline, ",")
		for i, p := range proxies {
			if err := check(strings.TrimSpace(p), fmt.Sprintf("proxy %d of -proxies", i+1)); err != nil {
				return nil, err
			}
		}

		return proxies, nil
	}

	if filePath == "" {
		return nil, nil
	}

	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("open proxy file %q: %w", filePath, err)
	}
	defer file.Close()

	var proxies []string

	scanner := bufio.NewScanner(file)
	for n := 1; scanner.Scan(); n++ {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		if err := check(line, fmt.Sprintf("line %d of %q", n, filePath)); err != nil {
			return nil, err
		}

		proxies = append(proxies, line)
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read proxy file %q: %w", filePath, err)
	}

	if len(proxies) == 0 {
		return nil, fmt.Errorf("%w: %q", ErrEmptyFile, filePath)
	}

	return proxies, nil
}
