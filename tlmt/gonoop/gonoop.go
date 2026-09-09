package gonoop

import (
	"context"

	"github.com/AxioIntel/Axio-CRED/tlmt"
)

type service struct {
}

func New() tlmt.Telemetry {
	return &service{}
}

func (s *service) Send(context.Context, tlmt.Event) error {
	return nil
}

func (s *service) Close() error {
	return nil
}
