// Mirrors api/schemas.py. A rename on either side must happen on both.

export type Status =
  | "ACTIVE" | "IDLE" | "UNASSIGNED" | "OVERDUE" | "IN_SERVICE" | "AT_YARD"
export type Severity = "CRITICAL" | "WARNING" | "INFO"

export interface AssetRow {
  equipment_id: string
  type: string
  status: Status
  site_id: string | null
  branch_id: string | null
  operator_id: string | null
  utilization_pct: number
  engine_hours_day: number
  idle_hours_day: number
  due_back: string | null
  day_rate: number
  flags_count: number
  latitude: number | null
  longitude: number | null
  last_fix: string | null
  on_hire_from: string | null
  condition_grade: "A" | "B" | "C"
  hours_since_service: number
}

export interface AskAnswer {
  answer: string
  grounded_on: string[]
  source: "rules" | "model" | "fallback"
  checked: boolean
  unverified?: string[]
}

export interface Briefing {
  as_of: string
  headline: string
  lines: string[]
  counts: {
    assets: number
    critical: number
    overdue: number
    due_soon: number
    maintenance: number
  }
}

export interface Signal {
  field: string
  value: string
  threshold?: string | null
}

export interface Anomaly {
  equipment_id: string
  rule_id: string
  severity: Severity
  title: string
  signals: Signal[]
  est_value_inr: number
  recommended_action: string
}

export interface Alert extends Omit<Anomaly, "recommended_action"> {
  source: "OVERDUE" | "ANOMALY" | "MAINTENANCE"
  recommended_action: string
}

export interface MaintenanceRisk {
  equipment_id: string
  spn: number
  fmi: number
  label: string
  part: string
  action: string
  days_to_failure: number
  current_temp_c: number
  slope: number
}

export interface AvailabilityAnswer {
  can_commit: boolean
  equipment_id: string | null
  free_from: string | null
  confidence: number
  reason: string
  alternatives: string[]
}

export interface RentalEvent {
  event_id: string
  timestamp: string
  equipment_id: string
  event_type: string
  actor: string
  site_id?: string | null
  operator_id?: string | null
  condition_grade?: string | null
  notes?: string | null
}

export interface TelemetryPoint {
  date: string
  coolant_temp_c: number
  cumulative_operating_hours: number
}

export interface AssetDetail {
  asset: Record<string, unknown> & {
    equipment_id: string
    type: string
    model: string
    serial_number: string
    site_id: string | null
    operator_id: string | null
    on_rent: boolean
    check_out_date: string | null
    check_in_date: string | null
    engine_hours_day: number
    idle_hours_day: number
    operating_days: number
    cumulative_operating_hours: number
    hours_since_service: number
    day_rate: number
    condition_grade: string
  }
  status: Status
  signals: Anomaly[]
  events: RentalEvent[]
  telemetry_series: TelemetryPoint[]
  maintenance: MaintenanceRisk[]
}

export interface SiteUsage {
  site_id: string
  branch_id: string | null
  assets: number
  rented_days: number
  engine_hours: number
  idle_hours: number
  downtime_hours: number
  utilisation_pct: number
  idle_cost_inr: number
}

export interface UsageSummary {
  by_site: SiteUsage[]
  fleet: Omit<SiteUsage, "site_id" | "branch_id">
}

export interface Exposure {
  waste_inr: number
  recoverable_inr: number
  avoided_inr: number
  total_exposure_inr: number
  by_asset: Record<string, Record<string, number>>
  note: string
}

export interface LedgerEntry {
  entry_id: string
  timestamp: string
  equipment_id: string
  rule_id?: string | null
  action: string
  est_value_inr: number
}

export interface Ledger {
  entries: LedgerEntry[]
  total_recovered_inr: number
  exposure: Exposure
}

export interface Config {
  now: string
  idle_utilisation_warn: number
  idle_utilisation_crit: number
  zero_output_min_days: number
  service_interval_hours: number
  transit_days: number
  service_days: number
  default_hours_per_day: number
  day_rates: Record<string, number>
  day_rates_price_implied: Record<string, number>
  rate_basis: string
  branches: Record<string, { city: string; lat: number; lon: number }>
  site_branch: Record<string, string>
  branch_transit_days: Record<string, number>
  due_soon_days: number
  idle_burn_min_days: number
  coolant_warn_c: number
  coolant_slope_min: number
  coolant_failure_c: number
  [key: string]: unknown
}

export interface Forecast {
  site_id: string
  site_label: string
  equipment_type: string
  needed_from: string
  /** "return" is projected from a machine leaving; "booking" is a request already made. */
  basis: "return" | "booking"
  headline: string
  confidence: number
  signals: { field: string; value: string | number; threshold: string | number | null }[]
  leaving: string[]
  history: { date: string; engine_hours: number }[]
  recommendation: {
    can_commit: boolean
    equipment_id: string | null
    free_from: string | null
    confidence: number
    reason: string
    alternatives: string[]
  } | null
}

export interface Role {
  id: string
  label: string
  blurb: string
  needs_key: boolean
  can_write: boolean
}

export interface SessionInfo {
  actor: string
  role: string
  role_label: string
  can_write: boolean
  elevated: boolean
  site_id: string | null
  admin_required: boolean
}

export interface HireRequestRow {
  request_id: string
  raised_at: string
  status: string
  equipment_id: string
  kind: "EXTEND" | "COLLECT"
  actor: string
  site_id: string | null
  days: number | null
  note: string | null
}
