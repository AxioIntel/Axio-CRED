export class PlanLimitError extends Error {
  readonly status = 403;
  constructor(message: string) { super(message); this.name = "PlanLimitError"; }
}
