# Mologo Tax Data

Country tax rate data for [Mologo](https://mologo.app) — fetched automatically by the app weekly.

## How to update a rate

Edit `tax-data.json` directly on GitHub. The app fetches it with a 7-day cache, so all users get the update within a week.

## Fields
| Field | Meaning |
|---|---|
| `vn` | VAT name (IVA, MwSt., TVA…) |
| `vs` | VAT standard rate (%) |
| `vr` | Reduced VAT rates |
| `wn` | Withholding tax name (IRPF, TDS…) |
| `wr` | Withholding rate options |
| `wd` | Default withholding rate (%) |

## Last verified
May 2026
