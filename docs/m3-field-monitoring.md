# Milestone 3 – Field Monitoring, Charts and Reports

## 1. Responsibility

Field Monitoring, Charts and Reports.

The objective is to provide farmers with a clear overview of their registered fields, irrigation activity, water availability and monitoring information.

## 2. Implemented Features

### 2.1 Field Overview

The dashboard retrieves registered field information through the authenticated GET /api/fields endpoint.

The overview displays:

- Field name
- Crop
- Field area and unit
- Field location

Field details update when the farmer selects another registered field.

Only values supplied by the Fields API are displayed.

### 2.2 Monitoring Summary

The dashboard displays:

- Number of completed irrigation schedules
- Scheduled water quantity associated with completed schedules
- Selected field name

Water quantities are derived from individual completed schedule records.

They represent scheduled quantities and must not be interpreted as independently measured water consumption.

### 2.3 Monitoring Charts

Four charts are implemented.

1. Daily Scheduled Water Quantity

   - Displays completed irrigation schedule quantities grouped by scheduled date.
   - Supports Today, 7-day and 30-day filters.
   - Displays every date in the selected calendar range.
   - Supports horizontal scrolling when all dates cannot fit in the visible chart area.
2. Irrigation Schedule Status

   - Displays the distribution of available irrigation schedules by status.
3. Reservoir Water Availability

   - Displays reservoir water availability and unused capacity.
   - Includes reservoir details such as capacity, available water, reserved water and remaining water.
4. Weekly Irrigation Activity

   - Displays completed irrigation schedule counts grouped by scheduled date over the last seven days.

### 2.4 Sensor Information

The dashboard includes a Sensor Timelines section with 24-hour, 7-day and 30-day range controls.

Verified historical sensor readings are not currently connected to registered farmer fields.

Therefore, the dashboard explicitly communicates that soil moisture, temperature and humidity readings are unavailable.

The date controls do not currently retrieve or display sensor measurements.

No demonstration readings are presented as real farmer measurements.

### 2.5 CSV Export

The CSV export includes two record types:

- Irrigation Schedule
- Reservoir

The export includes the selected field ID and field name.

Irrigation schedule records include scheduled date, start time, end time, scheduled water quantity, duration and status.

Reservoir records include name, capacity, available water, reserved water and remaining water.

Scheduled water quantities are not represented as actual measured consumption.

### 2.6 PDF Field Report

The PDF report uses the browser's print functionality.

The farmer can select Save as PDF from the browser print dialog.

The report includes:

- Selected field name and ID
- Crop
- Field area and unit
- Field location
- Report generation date and time
- Selected summary period
- Completed irrigation summary
- Irrigation schedule history
- Reservoir information
- Available monitoring charts
- Sensor-data availability information
- Data limitations and disclaimers

The print layout is designed for A4 paper and hides unrelated dashboard sections and export controls.

### 2.7 Responsive Design

The monitoring dashboard supports:

- Desktop
- Tablet
- Mobile

Responsive CSS adjusts summary cards, chart panels, donut charts and the field overview.

The daily water chart has a visible horizontal scrollbar to allow navigation through all dates in the 30-day range.

## 3. Data Sources and API Integration

The dashboard uses authenticated same-origin API requests.

| Endpoint                       | Purpose                      |
| ------------------------------ | ---------------------------- |
| GET /api/fields                | Registered field information |
| GET /api/irrigation/schedules  | Irrigation schedules         |
| GET /api/irrigation/reservoirs | Reservoir information        |

Field-specific schedule and reservoir requests use the selected field ID.

The dashboard handles irrigation and reservoir requests independently using Promise.allSettled().

A failure in one service does not automatically prevent the other service from displaying available information.

## 4. Data Limitations

### Sensor Data

A verified field-to-sensor mapping is not currently available.

Actual soil moisture, soil temperature, humidity, pH, EC and sensor connectivity information are therefore not included as verified field measurements.

Integration requires an approved mapping and an accessible historical or live sensor-data source.

### Water Consumption

The application currently uses irrigation schedule quantities.

These are planned or scheduled water quantities and are not independent measurements of water consumed.

### Field Health

A verified field-health indicator has not been implemented because the required sensor measurements and approved thresholds are unavailable.

### Irrigation History

Schedule dates are used for chart grouping because an actual completion timestamp is not available in the current schedule response.

## 5. Manual Testing and Verification

The following checks were performed in the isolated M3 application environment.

| Test                        | Expected result                           | Result |
| --------------------------- | ----------------------------------------- | ------ |
| Field API loading           | Registered field details returned         | Passed |
| Schedule API loading        | Schedule records returned                 | Passed |
| Reservoir API loading       | Reservoir records returned                | Passed |
| Field overview              | Name, crop, area and location displayed   | Passed |
| Today filter                | Correct calendar-day results              | Passed |
| 7-day filter                | Correct completed schedule totals         | Passed |
| 30-day filter               | All 30 daily bars accessible              | Passed |
| Chart horizontal navigation | Visible scrollbar usable                  | Passed |
| Desktop layout              | Components fit correctly                  | Passed |
| Tablet layout               | Components fit correctly                  | Passed |
| Mobile layout               | Components fit correctly                  | Passed |
| CSV export                  | Schedule and reservoir records exported   | Passed |
| PDF report                  | Field details, charts and tables included | Passed |
| Irrigation API failure      | Reservoir information remains available   | Passed |
| Reservoir API failure       | Irrigation information remains available  | Passed |
| Empty API responses         | Appropriate empty states displayed        | Passed |
| Data restoration            | Actual test records load after simulation | Passed |
| JavaScript syntax           | Node syntax check succeeds                | Passed |

These results represent manual browser verification and syntax checking, not automated Field Monitoring unit-test coverage.

## 6. Test Environment and Test Records

Testing was performed using the isolated M3 environment.

The registered test field was:

- Field ID: 1
- Field name: m3 test field 01
- Crop: Paddy
- Area: 1 acre
- Location: Manthani, Peddapalli, Telangana

The irrigation schedule test fixture was:

- Schedule ID: 1
- Scheduled date: 6 November 2026
- Scheduled quantity: 500 litres
- Duration: 30 minutes
- Status: completed

Important: The schedule record is explicitly marked as an M3 test fixture and is not a real irrigation event.

The reservoir test record was:

- Reservoir name: m3 test water tank 01
- Capacity: 10,000 litres
- Available: 700 litres
- Reserved: 0 litres
- Remaining: 700 litres

These records were used only to verify dashboard calculations and exports.

They must not be presented as real irrigation or water-consumption measurements.

## 7. Files Implemented

- templates/index.html
- static/monitoring.js
- static/monitoring.css

The local isolated M3 Compose override is used for testing and is not automatically part of the shared application configuration.

## 8. Future Integration Requirements

The following work requires additional verified data or team integration:

- Connect registered fields to their actual sensor identifiers.
- Retrieve verified historical sensor readings.
- Implement soil moisture, temperature and humidity timelines.
- Add pH and EC readings when available.
- Implement reliable sensor-connectivity information.
- Implement field-health status using approved measurements and thresholds.
- Complete integration testing with the team's shared application environment.
