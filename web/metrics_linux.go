//go:build linux

package web

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"syscall"
)

// hostStats reads the machine's CPU counters, memory, the data folder's filesystem and network
// counters from /proc. Inside the dashboard's container /proc/stat and /proc/meminfo describe the
// host, which is what an operator sizing the server wants.
func hostStats(dataFolder string) (hostSample, bool) {
	var h hostSample

	if b, err := os.ReadFile("/proc/stat"); err == nil {
		line, _, _ := strings.Cut(string(b), "\n")
		fields := strings.Fields(line)

		if len(fields) > 5 && fields[0] == "cpu" {
			var total uint64

			vals := make([]uint64, 0, len(fields)-1)

			for _, f := range fields[1:] {
				v, _ := strconv.ParseUint(f, 10, 64)
				vals = append(vals, v)
				total += v
			}

			idle := vals[3]
			if len(vals) > 4 {
				idle += vals[4] // iowait
			}

			h.cpuTotal, h.cpuBusy = total, total-idle
		}
	}

	if f, err := os.Open("/proc/meminfo"); err == nil {
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			fields := strings.Fields(sc.Text())
			if len(fields) < 2 {
				continue
			}

			kb, _ := strconv.ParseUint(fields[1], 10, 64)

			switch fields[0] {
			case "MemTotal:":
				h.memTotal = kb * 1024
			case "MemAvailable:":
				h.memAvail = kb * 1024
			}
		}

		_ = f.Close()
	}

	var fs syscall.Statfs_t
	if dataFolder == "" {
		dataFolder = "/"
	}

	if err := syscall.Statfs(dataFolder, &fs); err == nil {
		h.diskTotal = fs.Blocks * uint64(fs.Bsize)
		h.diskFree = fs.Bavail * uint64(fs.Bsize)
	}

	if b, err := os.ReadFile("/proc/net/dev"); err == nil {
		for _, line := range strings.Split(string(b), "\n")[2:] {
			name, rest, ok := strings.Cut(line, ":")
			if !ok || strings.TrimSpace(name) == "lo" {
				continue
			}

			fields := strings.Fields(rest)
			if len(fields) >= 9 {
				in, _ := strconv.ParseUint(fields[0], 10, 64)
				out, _ := strconv.ParseUint(fields[8], 10, 64)
				h.netIn += in
				h.netOut += out
			}
		}
	}

	return h, h.cpuTotal > 0
}
