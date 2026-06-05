# Data Sources & Attribution

## AGRIBALYSE (ADEME)

- Primary source used by the app: **ADEME AGRIBALYSE v3.2 simplified dataset**
- Public access page: https://data.ademe.fr/datasets/agribalyse-31-synthese
- API pattern used in local snapshot:
  - `https://data.ademe.fr/data-fair/api/v1/datasets/agribalyse-31-synthese/lines?...`
- Local snapshot file in this repository:
  - `server/agribalyse_raw.json`
- Main indicator used for climate impact:
  - `Changement_climatique` (kg CO₂-eq/kg)
- License:
  - Etalab Open License (Licence Ouverte)

Suggested attribution text:

> Source ADEME, données AGRIBALYSE v3.2 (jeu simplifié `agribalyse-31-synthese`), snapshot local `server/agribalyse_raw.json`.

## OWID / Poore & Nemecek

- Used as validation/fallback reference in parts of the model.
- Source family: Our World in Data summaries based on Poore & Nemecek (2018).

## How the app uses AGRIBALYSE

- The running app does **not** query ADEME live on every request.
- It uses local, pre-aggregated category factors in:
  - `server/agribalyse_emissions.js`
- Those factors were derived from AGRIBALYSE simplified rows and then mapped to app categories.

## Important license boundary

- This project uses **simplified published indicators**.
- The repository does **not** import AGRIBALYSE disaggregated LCI background process datasets from LCA software.
- If disaggregated AGRIBALYSE/eCoinvent background processes are integrated into tools, ecoinvent licensing requirements may apply (see AGRIBALYSE documentation and ecoinvent license conditions).
