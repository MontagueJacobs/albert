# Experiment Data Analysis

This folder contains tools for analyzing data from the CO2 awareness experiment.

## Setup

```bash
# From the sustainable-shop-webapp directory
cd analysis
pip install -r requirements.txt
```

## Usage

### Quick Summary (via API)
Check the live summary endpoint:
```bash
curl http://localhost:3001/api/admin/experiment/summary | jq .
```

### Export Raw Data
```bash
# Get JSON export
curl "http://localhost:3001/api/admin/experiment/export" > data.json

# Get CSV export  
curl "http://localhost:3001/api/admin/experiment/export?format=csv" > data.csv

# Only completed sessions
curl "http://localhost:3001/api/admin/experiment/export?completedOnly=true" > completed.json
```

### Run Full Analysis
```bash
python analyze_experiment.py --server http://localhost:3001 --completed-only
```

This generates:
- `analysis_output/experiment_data.csv` - Flat data for SPSS/Excel
- `analysis_output/experiment_data_full.json` - Full data with nested quiz details
- `analysis_output/qualitative_responses.json` - Open-ended responses for coding
- `analysis_output/analysis_report.txt` - Statistical analysis report
- `analysis_output/*.png` - Visualization charts

## Key Metrics

### Quiz Score Interpretation
- Scores range from 0-100 (higher = better CO2 knowledge)
- Score = 100 × (1 - total_distance / max_distance)
- Perfect ranking = 100, random = ~50, reversed = 0

### Learning Effect
Measured as post-intervention score minus pre-intervention score:
- **Generic products**: Quiz 3 - Quiz 1
- **AH-specific products**: Quiz 6 - Quiz 5  
- **Personal products**: Quiz 4 - Quiz 2

Positive improvement indicates learning occurred.

### Statistical Tests Used
- **Paired t-test**: Within-subject pre/post comparisons
- **Wilcoxon signed-rank**: Non-parametric alternative
- **Cohen's d**: Effect size (0.2=small, 0.5=medium, 0.8=large)

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/admin/experiment/export` | Export all session data |
| `GET /api/admin/experiment/summary` | Get summary statistics |

### Export Query Parameters
| Parameter | Values | Description |
|-----------|--------|-------------|
| `format` | `json`, `csv` | Output format (default: json) |
| `completedOnly` | `true`, `false` | Only include completed sessions |
| `from` | ISO date | Filter sessions started after date |
